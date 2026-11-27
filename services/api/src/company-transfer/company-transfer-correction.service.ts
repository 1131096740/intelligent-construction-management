import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { AuditService } from "../audit/audit.service";
import { AuthService } from "../auth/auth.service";
import { PrismaService } from "../database/prisma.service";
import { ProjectFundingAvailabilityService } from "../project-funding/project-funding-availability.service";
import { companyTransferRoles } from "./company-transfer.access";
import { CompanyTransferReadService } from "./company-transfer-read.service";
import { OperatingLedgerService } from "../operating-ledger/operating-ledger.service";
import { appendCompanyTransferCanonicalCorrection } from "./company-transfer-canonical-correction";
import { transferTotals } from "./company-transfer.domain";
import { originalSourceKey } from "./company-transfer-legacy";
import { CompanyTransferNotificationService } from "./company-transfer-notification.service";

const CORRECTION_KEY = /^[A-Za-z0-9_-]{1,128}$/u;
const CORRECTION_TARGET = /^(proxy|movement|inter_entity|operational):[A-Za-z0-9_-]{1,128}$/u;

function repaymentCorrectionFamily(source: string) {
  const kind = source.split(":")[0];
  return ["proxy","inter_entity","operational"].includes(kind) ? "project_proxy" : kind;
}

type Tx = Prisma.TransactionClient;

function rejected(message: string) {
  return new ConflictException({ code: "COMPANY_TRANSFER_CORRECTION_REJECTED", message });
}

function checkedKey(key: unknown) {
  if (typeof key !== "string" || !CORRECTION_KEY.test(key)) throw new BadRequestException("更正操作凭据无效");
  return key;
}

function checkedReason(reason: unknown) {
  if (typeof reason !== "string" || !reason.trim() || reason.length > 2000) throw new BadRequestException("请填写有效的更正原因");
  return reason.trim();
}

function handleCorrectionError(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError || error instanceof Prisma.PrismaClientUnknownRequestError) {
    if (error.message.includes("company_transfer_correction_requires_receipt")) throw rejected("此笔尚未全部到账核对，不能更正原代付债务");
    if (error.message.includes("company_transfer_correction_capacity")) throw rejected("正确原债的未占用额度不足，或者原归还日期早于该债");
    if (error.message.includes("company_transfer_original_mismatch") || error.message.includes("company_transfer_correction_source_invalid")) {
      throw rejected("请核对正确原债的公司双方、项目和代付类别");
    }
    if (error.message.includes("company_transfer_canonical_correction_")) throw rejected("经营账更正依据与原流水不一致，未完成确认");
    if (error.message.includes("company_transfer_correction_already_applied")) throw rejected("此笔核销已更正，请查询结果");
    if (error.message.includes("company_transfer_correction_role_required")) throw new ForbiddenException("当前财务岗位已失效");
  }
  throw error;
}

@Injectable()
export class CompanyTransferCorrectionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly audit: AuditService,
    private readonly funding: ProjectFundingAvailabilityService,
    private readonly reader: CompanyTransferReadService,
    private readonly ledger: OperatingLedgerService,
    @Optional() private readonly notifications?: CompanyTransferNotificationService,
  ) {}

  private async context(tx: Tx, actor: string, transferId: string, eventId: string, confirm = false) {
    const roles = await companyTransferRoles(tx, actor);
    const director = roles.includes("finance_director");
    if (!director && (confirm || !roles.includes("finance_staff"))) throw new ForbiddenException("当前账号无权办理公司代付归还更正");
    const event = await tx.companyTransferEvent.findFirst({ where: { id: eventId, transferId, kind: "outgoing" } });
    const transfer = event ? await tx.companyTransfer.findUnique({ where: { id: event.transferId } }) : null;
    const originalSource = transfer && originalSourceKey(transfer);
    if (!event || !transfer || !originalSource || !transfer.sourceProjectId || !transfer.requiresParallelRepaymentApproval) {
      throw new NotFoundException("归还流水不存在");
    }
    return { event, transfer, originalSource, director, projectId: transfer.sourceProjectId };
  }

  async read(actor: string, transferId: string, eventId: string, idempotencyKey?: string) {
    const key = idempotencyKey === undefined ? undefined : checkedKey(idempotencyKey);
    const state = await this.prisma.$transaction(async tx => {
      const context = await this.context(tx, actor, transferId, eventId);
      const corrections = await tx.companyTransferOriginalDebtCorrection.findMany({
        where: { outgoingEventId: eventId }, orderBy: [{ requestedAt: "desc" }, { id: "asc" }],
      });
      const confirmed = corrections.find(row => row.status === "confirmed");
      const own = key ? corrections.find(row =>
        row.requestedByUserId === actor && row.requestKey === key || row.confirmedByUserId === actor && row.confirmKey === key
      ) : undefined;
      const events = await tx.companyTransferEvent.findMany({
        where: { outgoingEventId: eventId },
        select: { kind: true, amountCents: true, returnedIncomingEventId: true },
      });
      const totals = transferTotals(events);
      return { ...context, corrections, confirmed, own, settlingAmountCents: totals.netReceived,
        settled: totals.received === context.event.amountCents && totals.netReceived > 0n };

    });
    const view = await this.reader.list(actor, { projectId: state.projectId });
    const typedSources = [
      ...view.legacyOptions.filter(row => row.approvalFlow === "proxy_repayment_parallel").map(row => ({
        originalSource: `${row.legacyType}:${row.id}`, reference: row.reference, availableCents: row.availableCents,
        debtorId: row.sourceCompanyId, creditorId: row.destinationCompanyId,
      })),
      ...view.originalProxies.map(row => {
        const source = row.source as { debtor: { id: string }; actualPayer: { id: string }; reference?: string };
        return { originalSource: `proxy:${row.id}`, reference: source.reference ?? "原合同代付",
          availableCents: row.availableCents, debtorId: source.debtor.id, creditorId: source.actualPayer.id };
      }),
    ].filter(row => row.debtorId === (state.transfer.repaymentDebtorCompanyId ?? state.transfer.sourceCompanyId) &&
      row.creditorId === state.transfer.destinationCompanyId &&
      repaymentCorrectionFamily(row.originalSource) === repaymentCorrectionFamily(state.originalSource));
    const candidates = (state.settled && !state.confirmed ? typedSources : [])
      .filter(row => row.originalSource !== state.originalSource && BigInt(row.availableCents) >= state.settlingAmountCents)
      .map(({ originalSource, reference, availableCents }) => ({ originalSource, reference, availableCents }));
    const status = (row: { status: string }) => row.status === "pending" && state.confirmed ? "superseded" : row.status;
    return {
      originalSource: state.originalSource,
      originalReference: typedSources.find(item => item.originalSource === state.originalSource)?.reference ?? "原代付款归还",
      canRequest: candidates.length > 0,
      canConfirm: state.director && state.settled && !state.confirmed && state.corrections.some(row => row.status === "pending"),
      candidates,
      corrections: state.corrections.map(row => ({
        id: row.id, targetOriginalSource: row.targetOriginalSource, reason: row.reason,
        targetReference: typedSources.find(item => item.originalSource === row.targetOriginalSource)?.reference ?? "更正目标原债",
        status: status(row), requestedAt: row.requestedAt.toISOString(), confirmedAt: row.confirmedAt?.toISOString() ?? null,
        requiresSelfReview: row.requestedByUserId === actor,
      })),
      ...(state.own ? { result: { id: state.own.id, status: status(state.own) } } : {}),
    };
  }

  async request(actor: string, transferId: string, eventId: string, input: {
    targetOriginalSource: string; reason: string; idempotencyKey: string;
  }) {
    const key = checkedKey(input?.idempotencyKey), reason = checkedReason(input?.reason);
    if (typeof input.targetOriginalSource !== "string" || !CORRECTION_TARGET.test(input.targetOriginalSource)) {
      throw new BadRequestException("请选择有效的正确原债");
    }
    try {
      const result = await this.prisma.$transaction(async tx => {
        const { originalSource, projectId } = await this.context(tx, actor, transferId, eventId);
        await this.lock(tx, projectId);
        const prior = await tx.companyTransferOriginalDebtCorrection.findUnique({ where: { requestKey: key } });
        if (prior) {
          if (prior.requestedByUserId !== actor || prior.outgoingEventId !== eventId ||
              prior.reason !== reason || prior.targetOriginalSource !== input.targetOriginalSource) throw rejected("更正凭据已用于其他申请");
          return { id: prior.id, status: prior.status };
        }
        const row = await tx.companyTransferOriginalDebtCorrection.create({ data: {
          id: randomUUID(), outgoingEventId: eventId, originalSource, targetOriginalSource: input.targetOriginalSource, reason,
          requestedByUserId: actor, requestKey: key,
        } });
        await this.audit.record(tx, { actorUserId: actor, action: "company_transfer.original_debt_correction.request",
          businessType: "company_transfer", businessId: transferId, metadata: { correctionId: row.id, sourceEventId: eventId, originalSource, targetOriginalSource: row.targetOriginalSource } });
        await this.notifications?.queueCorrectionDuty(tx,transferId,eventId,actor);
        return { id: row.id, status: row.status };
      });
      void this.notifications?.afterCommit();
      return result;
    } catch (error) { return handleCorrectionError(error); }
  }

  async confirm(actor: string, transferId: string, eventId: string, correctionId: string, input: {
    idempotencyKey: string; confirmationPassword: string; selfReviewReason?: string;
  }) {
    const key = checkedKey(input?.idempotencyKey);
    if (typeof input.confirmationPassword !== "string" || !input.confirmationPassword.trim()) {
      throw new BadRequestException("请输入当前登录密码");
    }
    const reason = input.selfReviewReason === undefined ? null : checkedReason(input.selfReviewReason);
    try {
      return await this.prisma.$transaction(async tx => {
        const { projectId } = await this.context(tx, actor, transferId, eventId, true);
        await this.lock(tx, projectId);
        const row = await tx.companyTransferOriginalDebtCorrection.findFirst({ where: { id: correctionId, outgoingEventId: eventId } });
        if (!row) throw new NotFoundException("更正申请不存在");
        await this.auth.confirmPassword(actor, input.confirmationPassword, tx);
        if (row.status === "confirmed") {
          if (row.confirmedByUserId !== actor || row.confirmKey !== key || row.selfReviewReason !== reason) throw rejected("该更正已确认，请查询结果");
          return { id: row.id, status: row.status };
        }
        if (row.requestedByUserId === actor && !reason) throw new BadRequestException("请填写本人发起更正的自审原因");
        const priorKey = await tx.companyTransferOriginalDebtCorrection.findUnique({ where: { confirmKey: key }, select: { id: true } });
        if (priorKey) throw rejected("复核凭据已用于其他更正");
        const confirmed = await tx.companyTransferOriginalDebtCorrection.update({ where: { id: row.id },
          data: { status: "confirmed", confirmedByUserId: actor, confirmedAt: new Date(), confirmKey: key, selfReviewReason: reason },
        });
        await appendCompanyTransferCanonicalCorrection(tx, this.ledger, confirmed, actor);
        await this.audit.record(tx, { actorUserId: actor, action: "company_transfer.original_debt_correction.confirm",
          businessType: "company_transfer", businessId: transferId, metadata: { correctionId: row.id, sourceEventId: eventId,
            originalSource: row.originalSource, targetOriginalSource: row.targetOriginalSource,
            ...(row.requestedByUserId === actor ? { selfReview: true, selfReviewReason: reason } : {}) } });
        return { id: confirmed.id, status: confirmed.status };
      });
    } catch (error) { return handleCorrectionError(error); }
  }

  private async lock(tx: Tx, projectId: string) {
    await this.funding.lockFundingContext(tx, projectId);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(190731,91)`;
  }
}
