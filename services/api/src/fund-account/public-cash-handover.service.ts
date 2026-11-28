import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { type RoleKey } from "@jiangkong/shared-domain";
import { Prisma, type PublicCashHandover, type PublicCashHandoverReceipt } from "@prisma/client";
import { createHash } from "node:crypto";
import { AuditService } from "../audit/audit.service";
import { CompanyRoleResolverService } from "../auth/company-role-resolver.service";
import { PrismaService } from "../database/prisma.service";
import { availableRegisteredBalance, RegisteredBalanceDecimal } from "../payment/registered-payment-funding";
import type { ClaimInitialPublicCashCustodyDto, ConfirmPublicCashHandoverDto, StartPublicCashHandoverDto } from "./public-cash-handover.dto";

type Transaction = Prisma.TransactionClient;
const CASH = "comprehensive_director" satisfies RoleKey;
const FINANCE: readonly RoleKey[] = ["finance_staff", "finance_director"];
const fingerprint = (input: unknown) => createHash("sha256").update(JSON.stringify(input)).digest("hex");

@Injectable()
export class PublicCashHandoverService {
  private readonly roles: CompanyRoleResolverService;

  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {
    this.roles = new CompanyRoleResolverService(prisma);
  }

  async list(actorId: string) {
    return this.command(async tx => {
      const roles = await this.activeRoles(tx, actorId);
      const account = await tx.registeredFundAccount.findUnique({ where: { scopeKey: "public_cash" },
        select: { id: true, writeRevision: true, publicCashCustody: {
          select: { currentCustodian: { select: { id: true, name: true, isActive: true } } }
        } } });
      if (!account) return { revision: null, currentCustodian: null, candidates: [], handovers: [], canStart: false, canClaimInitial: false, canRecoverInitial: false };
      const current = account.publicCashCustody?.currentCustodian ?? null;
      const canStart = current?.isActive === true
        ? current.id === actorId && roles.includes(CASH)
        : current?.isActive === false && roles.some(role => FINANCE.includes(role));
      const handovers = await tx.publicCashHandover.findMany({
        where: { accountId: account.id }, orderBy: { startedRevision: "desc" },
        include: { fromCustodian: { select: { name: true } }, toCustodian: { select: { name: true } },
          startedBy: { select: { name: true } }, receipt: true }
      });
      const candidates = canStart ? await this.custodianCandidates(tx, current?.id) : [];
      return { revision: account.writeRevision, currentCustodian: current, candidates, canStart, canClaimInitial: !current && roles.includes(CASH),
        canRecoverInitial: roles.includes(CASH),
        handovers: handovers.map(row => {
          const currentHandover = account.writeRevision === row.startedRevision && current?.id === row.fromCustodianId;
          return {
            ...startedView(row), fromName: row.fromCustodian.name, toName: row.toCustodian.name, startedByName: row.startedBy.name,
            evidenceReference: row.evidenceReference, createdAt: row.createdAt.toISOString(),
            status: row.receipt ? confirmationView(row, row.receipt).status : currentHandover ? "pending" : "superseded",
            confirmation: row.receipt ? confirmationView(row, row.receipt) : null,
            canConfirm: !row.receipt && currentHandover && row.toCustodianId === actorId && roles.includes(CASH),
            canRecoverStart: row.startedByUserId === actorId,
            canRecoverConfirmation: row.toCustodianId === actorId && roles.includes(CASH)
          };
        })
      };
    });
  }

  private async custodianCandidates(tx: Transaction, currentCustodianId?: string) {
    const position = await tx.position.findUnique({ where: { key: CASH }, select: { id: true } });
    if (!position) return [];
    const assignments = await tx.userPosition.findMany({
      where: { positionId: position.id, projectId: null }, select: { userId: true }
    });
    return tx.user.findMany({ where: { isActive: true, id: { in: assignments.map(row => row.userId), not: currentCustodianId } },
      select: { id: true, name: true }, orderBy: [{ name: "asc" }, { id: "asc" }] });
  }

  async claimInitial(actorId: string, input: ClaimInitialPublicCashCustodyDto) {
    return this.command(async tx => {
      await this.activeRoles(tx, actorId, [CASH]);
      const account = await this.lockAccount(tx);
      const existing = await tx.publicCashCustody.findUnique({ where: { accountId: account.id } });
      if (existing?.initialIdempotencyKey === input.idempotencyKey && existing.initialCustodianId === actorId &&
          existing.initialRevision === input.expectedRevision + 1) {
        return { id: account.id, startedRevision: existing.initialRevision, custodianId: actorId };
      }
      if (existing || account.writeRevision > input.expectedRevision) throw superseded();
      if (account.writeRevision !== input.expectedRevision) throw new ConflictException("公共现金版本已变化，请刷新后重新核对");
      const startedRevision = account.writeRevision + 1;
      const updated = await tx.registeredFundAccount.updateMany({
        where: { id: account.id, writeRevision: account.writeRevision }, data: { writeRevision: { increment: 1 } }
      });
      if (updated.count !== 1) throw new ConflictException("公共现金版本已变化，请刷新后重新核对");
      await tx.publicCashCustody.create({ data: {
        accountId: account.id, currentCustodianId: actorId, initialCustodianId: actorId,
        initialIdempotencyKey: input.idempotencyKey, initialRevision: startedRevision
      } });
      await this.audit.record(tx, { actorUserId: actorId, action: "fund_account.cash_custody.claim_initial",
        businessType: "public_cash_custody", businessId: account.id, metadata: { custodianId: actorId, startedRevision } });
      return { id: account.id, startedRevision, custodianId: actorId };
    });
  }

  async start(actorId: string, input: StartPublicCashHandoverDto) {
    const deliveredYuan = cashAmount(input.deliveredYuan);
    const evidenceReference = input.evidenceReference.trim();
    if (!evidenceReference) throw new BadRequestException("请填写现金交付和盘点依据");
    const payloadFingerprint = fingerprint({ actorId, expectedRevision: input.expectedRevision,
      toCustodianId: input.toCustodianId, deliveredYuan, evidenceReference });
    return this.command(async tx => {
      const roles = await this.activeRoles(tx, actorId);
      const previous = await tx.publicCashHandover.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
      if (previous) {
        if (previous.payloadFingerprint !== payloadFingerprint || previous.startedByUserId !== actorId) {
          throw new ConflictException("原交接凭据已用于其他登记");
        }
        return startedView(previous);
      }

      const account = await this.lockAccount(tx);
      if (!account.currentCustodianId) throw new ConflictException("公共现金保管人待核对");
      if (account.writeRevision > input.expectedRevision) throw superseded();
      if (account.writeRevision !== input.expectedRevision) throw new ConflictException("公共现金已有新办理记录，请重新盘点");
      if (input.toCustodianId === account.currentCustodianId) throw new BadRequestException("请选择另一名综合部主管接收");
      const current = await tx.user.findUnique({ where: { id: account.currentCustodianId }, select: { isActive: true } });
      const isCustodian = actorId === account.currentCustodianId && roles.includes(CASH);
      const isFinanceFallback = current?.isActive === false && roles.some(role => FINANCE.includes(role));
      if (!isCustodian && !isFinanceFallback) throw new ForbiddenException("交接由原保管人发起，原人已停用时由财务发起");
      await this.activeRoles(tx, input.toCustodianId, [CASH]);

      const registration = await tx.fundAccountBalanceRegistration.findFirst({
        where: { accountId: account.id, status: "confirmed" },
        include: { sources: true },
        orderBy: { version: "desc" }
      });
      const balance = registration ? (await availableRegisteredBalance(tx, registration)).balanceYuan : null;
      const expectedBalanceYuan = balance?.toFixed(4) ?? null;
      const nextRevision = account.writeRevision + 1;
      const updated = await tx.registeredFundAccount.updateMany({
        where: { id: account.id, writeRevision: account.writeRevision },
        data: { writeRevision: { increment: 1 } }
      });
      if (updated.count !== 1) throw new ConflictException("公共现金版本已变化，请重新盘点");
      const row = await tx.publicCashHandover.create({ data: {
        accountId: account.id, fromCustodianId: account.currentCustodianId, toCustodianId: input.toCustodianId,
        startedByUserId: actorId, startedRevision: nextRevision, deliveredYuan, expectedBalanceYuan,
        evidenceReference, idempotencyKey: input.idempotencyKey, payloadFingerprint
      } });
      await this.audit.record(tx, {
        actorUserId: actorId, action: "fund_account.cash_handover.start",
        businessType: "public_cash_handover", businessId: row.id,
        metadata: { fromCustodianId: row.fromCustodianId, toCustodianId: row.toCustodianId,
          expectedBalanceYuan, deliveredYuan, evidenceReference, financeFallback: isFinanceFallback }
      });
      return startedView(row);
    });
  }

  async confirm(actorId: string, handoverId: string, input: ConfirmPublicCashHandoverDto) {
    const amountReceivedYuan = cashAmount(input.receivedYuan);
    const payloadFingerprint = fingerprint({ actorId, handoverId, amountReceivedYuan });
    return this.command(async tx => {
      await this.activeRoles(tx, actorId, [CASH]);
      const handover = await tx.publicCashHandover.findUnique({ where: { id: handoverId } });
      if (!handover) throw new NotFoundException("现金交接记录不存在，请刷新");
      if (handover.toCustodianId !== actorId) throw new ForbiddenException("仅指定的新保管人可以确认实点");
      const previous = await tx.publicCashHandoverReceipt.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
      if (previous) {
        if (previous.handoverId !== handoverId || previous.confirmedByUserId !== actorId || previous.payloadFingerprint !== payloadFingerprint) {
          throw new ConflictException("原确认凭据已用于其他登记");
        }
        return confirmationView(handover, previous);
      }

      const account = await this.lockAccount(tx);
      if (account.id === handover.accountId && account.writeRevision > handover.startedRevision) throw superseded();
      if (account.id !== handover.accountId || account.writeRevision !== handover.startedRevision ||
          account.currentCustodianId !== handover.fromCustodianId) {
        throw new ConflictException("公共现金在交接期间已有新办理记录，请重新盘点并发起交接");
      }
      const discrepancyYuan = handover.expectedBalanceYuan === null ? null
        : new RegisteredBalanceDecimal(amountReceivedYuan).minus(handover.expectedBalanceYuan).toFixed(4);
      await tx.publicCashHandoverReceipt.create({ data: {
        handoverId, confirmedByUserId: actorId, amountReceivedYuan, discrepancyYuan,
        idempotencyKey: input.idempotencyKey, payloadFingerprint
      } });
      const changed = await tx.registeredFundAccount.updateMany({
        where: { id: account.id, writeRevision: handover.startedRevision },
        data: { writeRevision: { increment: 1 } }
      });
      if (changed.count !== 1) throw new ConflictException("公共现金版本已变化，请重新盘点");
      const custody = await tx.publicCashCustody.updateMany({
        where: { accountId: account.id, currentCustodianId: handover.fromCustodianId },
        data: { currentCustodianId: actorId }
      });
      if (custody.count !== 1) throw new ConflictException("公共现金保管人已变化，请重新盘点");
      await this.audit.record(tx, {
        actorUserId: actorId, action: "fund_account.cash_handover.confirm",
        businessType: "public_cash_handover", businessId: handoverId,
        metadata: { fromCustodianId: handover.fromCustodianId, toCustodianId: actorId, amountReceivedYuan, discrepancyYuan }
      });
      return confirmationView(handover, { amountReceivedYuan, discrepancyYuan });
    });
  }

  private async lockAccount(tx: Transaction) {
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM public."RegisteredFundAccount" WHERE "scopeKey" = 'public_cash' FOR UPDATE`);
    const account = await tx.registeredFundAccount.findUnique({ where: { scopeKey: "public_cash" },
      select: { id: true, writeRevision: true, publicCashCustody: { select: { currentCustodianId: true } } } });
    if (!account) throw new ConflictException("公共现金尚未登记账户");
    return { id: account.id, writeRevision: account.writeRevision, currentCustodianId: account.publicCashCustody?.currentCustodianId ?? null };
  }

  private async activeRoles(tx: Transaction, actorId: string, allowed: readonly RoleKey[] = [CASH, ...FINANCE]) {
    const roles = await this.roles.resolveActiveRoleScopesInTransaction(tx, actorId)
      .catch(() => { throw new ForbiddenException("现金交接人员的账号或岗位不可用"); });
    if (!roles.some(role => allowed.includes(role))) throw new ForbiddenException("现金交接须由合格的保管人或财务办理");
    return roles;
  }

  private async command<T>(operation: (tx: Transaction) => Promise<T>) {
    const options = { isolationLevel: Prisma.TransactionIsolationLevel.Serializable };
    try {
      return await this.prisma.$transaction(operation, options);
    } catch (error) {
      if (!retryable(error)) throw error;
      try {
        return await this.prisma.$transaction(operation, options);
      } catch (retryError) {
        if (!retryable(retryError)) throw retryError;
        throw new ConflictException("公共现金正在办理其他业务，请保留原凭据并刷新核对");
      }
    }
  }
}

function superseded() {
  return new ConflictException({ statusCode: 409, code: "PUBLIC_CASH_HANDOVER_SUPERSEDED",
    message: "公共现金在交接期间已有新办理记录，请重新盘点并发起交接" });
}

function retryable(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError &&
    (["P2002", "P2034"].includes(error.code) || (error.code === "P2010" && error.meta?.code === "40001"));
}

function cashAmount(input: string) {
  if (!/^\d{1,20}(?:\.\d{1,4})?$/u.test(input)) throw new BadRequestException("请填写非负现金实点金额，最多四位小数");
  return new RegisteredBalanceDecimal(input).toFixed(4);
}

function startedView(row: PublicCashHandover) {
  return { id: row.id, startedRevision: row.startedRevision, fromCustodianId: row.fromCustodianId,
    toCustodianId: row.toCustodianId, deliveredYuan: row.deliveredYuan.toFixed(4),
    expectedBalanceYuan: row.expectedBalanceYuan?.toFixed(4) ?? null };
}

function confirmationView(row: PublicCashHandover, receipt: {
  amountReceivedYuan: PublicCashHandoverReceipt["amountReceivedYuan"] | string;
  discrepancyYuan: PublicCashHandoverReceipt["discrepancyYuan"] | string;
}) {
  const amountReceivedYuan = new RegisteredBalanceDecimal(receipt.amountReceivedYuan).toFixed(4);
  const discrepancyYuan = receipt.discrepancyYuan === null ? null : new RegisteredBalanceDecimal(receipt.discrepancyYuan).toFixed(4);
  const handoverDifferenceYuan = new RegisteredBalanceDecimal(amountReceivedYuan).minus(row.deliveredYuan).toFixed(4);
  const status = discrepancyYuan === "0.0000" && handoverDifferenceYuan === "0.0000" ? "confirmed" : "awaiting_reconciliation";
  return { id: row.id, amountReceivedYuan, discrepancyYuan, handoverDifferenceYuan, status };
}
