import { BadRequestException, ConflictException, ForbiddenException, Injectable } from "@nestjs/common";
import { businessAmountFromLegacyCents, chinaDateOnly, normalizeBusinessAmount, requiredPastChinaDate } from "@jiangkong/shared-domain";
import { Prisma } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import { AuditService } from "../audit/audit.service";
import { CompanyRoleResolverService } from "../auth/company-role-resolver.service";
import { PrismaService } from "../database/prisma.service";
import { rejectedFundAdvanceWithoutWrite } from "./fund-account-advance-conflict";
import type { RegisterCompanyOwnedFundReceiptDto, RegisterFundAccountAdvanceDto } from "./fund-account-advance.dto";
import { assertPublicCashCustodian } from "./public-cash-custodian";
import { planRegisteredFundAdvance } from "./registered-fund-advance-plan";

type Tx = Prisma.TransactionClient;

@Injectable()
export class FundAccountAdvanceService {
  private readonly roles: CompanyRoleResolverService;

  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {
    this.roles = new CompanyRoleResolverService(prisma);
  }

  async contributorOptions(actorId: string) {
    return this.prisma.$transaction(async tx => {
      const roles = await this.activeRoles(tx, actorId);
      if (!roles.includes("comprehensive_director") && !roles.includes("finance_staff") && !roles.includes("finance_director")) {
        throw new ForbiddenException("当前公司级岗位无权登记垫资到账");
      }
      const [companies, constructionEnterprises] = await Promise.all([
        tx.companyEntity.findMany({
          where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" },
        }),
        tx.businessParty.findMany({
          where: { type: "organization", status: "active" }, select: { id: true, name: true }, orderBy: { name: "asc" },
        }),
      ]);
      return { companies, constructionEnterprises, canRegisterCompanyOwned: roles.includes("finance_director") };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async companyOwnedBankOptions(actorId: string, companyId: string) {
    return this.prisma.$transaction(async tx => {
      if (!(await this.activeRoles(tx, actorId)).includes("finance_director")) {
        throw new ForbiddenException("公司自有本金由财务主管核对登记");
      }
      const rows = await tx.$queryRaw<Array<{ reference: string; occurredAt: Date; amountCents: bigint }>>`
        SELECT bank.reference, bank."occurredAt", bank."amountCents"
        FROM public."jg_registered_fund_verified_own_candidates"(${companyId}) bank
        ORDER BY bank."occurredAt" DESC, bank.reference LIMIT 50
      `;
      return rows.map(row => ({
        value: row.reference, occurredOn: chinaDateOnly(row.occurredAt), amountYuan: businessAmountFromLegacyCents(row.amountCents),
      }));
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  register(actorId: string, input: RegisterFundAccountAdvanceDto) {
    return this.registerReceipt(actorId, { kind: "project_advance", ...this.normalize(input) });
  }

  registerCompanyOwned(actorId: string, input: RegisterCompanyOwnedFundReceiptDto) {
    const ownershipEvidence = input.ownershipEvidence.trim();
    const observationReference = input.observationReference.trim();
    if (!ownershipEvidence || !observationReference || !input.scopeKey.startsWith("company:")) {
      throw new BadRequestException("请选择公司银行入账，并填写自有本金权属的核对依据");
    }
    return this.registerReceipt(actorId, {
      kind: "company_owned", scopeKey: input.scopeKey, expectedRegistrationId: input.expectedRegistrationId,
      idempotencyKey: input.idempotencyKey, ownershipEvidence, observationReference,
    });
  }

  private async registerReceipt(actorId: string, command: (
    | ({ kind: "project_advance" } & ReturnType<FundAccountAdvanceService["normalize"]>)
    | ({ kind: "company_owned" } & RegisterCompanyOwnedFundReceiptDto)
  )) {
    const fingerprint = createHash("sha256").update(JSON.stringify(command)).digest("hex");
    const run = (onlyReplay: boolean) => this.prisma.$transaction(async tx => {
      const account = await tx.registeredFundAccount.findUnique({
        where: { scopeKey: command.scopeKey }, include: { company: { select: { isActive: true, name: true } } },
      });
      if (command.kind === "company_owned") {
        if (!(await this.activeRoles(tx, actorId)).includes("finance_director")) {
          throw new ForbiddenException("公司自有本金由财务主管核对登记");
        }
      } else {
        await this.authorize(tx, actorId, command.scopeKey === "public_cash");
      }
      const replay = await tx.registeredFundAdvanceReceipt.findUnique({
        where: { idempotencyKey: command.idempotencyKey },
        include: { registration: { select: { balanceYuan: true } } },
      });
      if (replay) {
        if (replay.createdByUserId !== actorId || replay.accountId !== account?.id || replay.payloadFingerprint !== fingerprint) {
          throw new ConflictException("同一提交凭据不能用于不同的垫资到账");
        }
        return this.receiptView(replay, replay.registration.balanceYuan!);
      }
      if (onlyReplay) throw new ConflictException("登记状态已变化，请保留原提交凭据核对");
      if (!account) throw rejectedFundAdvanceWithoutWrite("账户余额待核对，请先登记或确认余额后再办理垫资到账");
      if (account.kind === "company" && !account.company?.isActive) {
        throw rejectedFundAdvanceWithoutWrite("所选公司已停用，不能登记新的垫资到账");
      }

      await tx.registeredFundAccount.update({ where: { id: account.id }, data: { writeRevision: { increment: 1 } } });
      if (account.kind === "public_cash") await assertPublicCashCustodian(tx, account.id, actorId);
      const current = await tx.fundAccountBalanceRegistration.findFirst({
        where: { accountId: account.id, status: "confirmed" }, orderBy: { version: "desc" }, include: { sources: true },
      });
      const latest = await tx.fundAccountBalanceRegistration.findFirst({
        where: { accountId: account.id }, orderBy: { version: "desc" }, select: { version: true, status: true },
      });
      if (latest?.status === "pending_review") throw rejectedFundAdvanceWithoutWrite("请先完成该账户的余额更正复核");
      const ownership = command.kind === "company_owned" ? await this.companyBankInflow(tx, command, account.companyEntityId!) : null;
      const request = command.kind === "project_advance" ? command : {
        ...command, projectId: null, contributorKind: "company" as const, contributorId: account.companyEntityId,
        contributorName: null, evidenceReference: command.ownershipEvidence, receivedOn: chinaDateOnly(ownership!.occurredAt),
        amountYuan: businessAmountFromLegacyCents(ownership!.amountCents)!,
      };
      if (request.projectId && !await tx.project.findFirst({ where: { id: request.projectId, isActive: true }, select: { id: true } })) {
        throw new BadRequestException("所选项目不可用，请重新选择");
      }

      const contributor = await this.resolveContributor(tx, request);
      const plan = planRegisteredFundAdvance(current, request.expectedRegistrationId, { ...request, ...contributor });
      const registration = await tx.fundAccountBalanceRegistration.create({ data: {
        accountId: account.id, previousRegistrationId: plan.previousRegistrationId,
        version: latest!.version + 1, kind: "advance_receipt", status: "confirmed",
        balanceYuan: plan.balanceYuan, coveredExecutionIds: plan.coveredExecutionIds, asOfDate: current!.asOfDate,
        evidenceReference: request.evidenceReference, reconciliationNote: "追加已确认的到账本金",
        reason: ownership ? "公司自有本金到账" : "项目垫资到账", idempotencyKey: `fund-advance:${request.idempotencyKey}`, payloadFingerprint: fingerprint,
        createdByUserId: actorId, confirmedByUserId: actorId, confirmedAt: new Date(),
      } });
      const original = await tx.fundAccountSourceBatch.create({ data: { ...plan.originalSource, registrationId: registration.id } });
      if (plan.sources.length) await tx.fundAccountSourceBatch.createMany({
        data: plan.sources.map(source => ({ ...source, registrationId: registration.id })),
      });
      const receipt = await tx.registeredFundAdvanceReceipt.create({ data: {
        ...contributor, contributorKind: request.contributorKind, accountId: account.id,
        registrationId: registration.id, sourceBatchId: original.id, projectId: request.projectId,
        amountYuan: request.amountYuan, receivedOn: request.receivedOn, evidenceReference: request.evidenceReference,
        custodianUserId: account.kind === "public_cash" ? actorId : null, createdByUserId: actorId,
        idempotencyKey: request.idempotencyKey, payloadFingerprint: fingerprint,
      } });
      if (ownership && command.kind === "company_owned") await tx.registeredFundCompanyOwnedReceipt.create({
        data: { receiptId: receipt.id, companyId: account.companyEntityId!, observationId: ownership.id, ownershipEvidence: command.ownershipEvidence },
      });
      await this.audit.record(tx, {
        actorUserId: actorId, action: ownership ? "fund_account.company_owned.receipt" : "fund_account.advance.receipt", businessType: "registered_fund_advance_receipt",
        businessId: receipt.id, metadata: { accountId: account.id, projectId: receipt.projectId, amountYuan: request.amountYuan },
      });
      // Assert the persisted facts while the transaction is still open, before returning a receipt.
      await tx.$executeRaw`
        SET CONSTRAINTS public."FundAccountBalanceRegistration_advance_receipt",
          public."RegisteredFundAdvanceReceipt_registration" IMMEDIATE
      `;
      return this.receiptView(receipt, registration.balanceYuan!);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    try { return await run(false); } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2002", "P2034"].includes(error.code)) return run(true);
      throw error;
    }
  }

  private async companyBankInflow(tx: Tx, input: RegisterCompanyOwnedFundReceiptDto, companyId: string) {
    const [observation] = await tx.$queryRaw<Array<{ id: string; occurredAt: Date; amountCents: bigint }>>`
      SELECT bank.id, bank."occurredAt", bank."amountCents"
      FROM public."jg_registered_fund_verified_own_candidates"(${companyId}) bank
      WHERE bank.reference = ${input.observationReference}
    `;
    if (!observation) {
      throw rejectedFundAdvanceWithoutWrite("该银行入账未核验、不属于该公司或已被认领，请核对原记录");
    }
    return observation;
  }

  private receiptView(
    receipt: Pick<Prisma.RegisteredFundAdvanceReceiptGetPayload<Record<never, never>>, "id" | "registrationId" | "sourceBatchId" | "amountYuan" | "idempotencyKey">,
    balance: Prisma.Decimal,
  ) {
    return {
      id: receipt.id, idempotencyKey: receipt.idempotencyKey, registrationId: receipt.registrationId, sourceBatchId: receipt.sourceBatchId,
      amountYuan: receipt.amountYuan.toFixed(4), registeredBalanceYuan: balance.toFixed(4),
    };
  }

  private activeRoles(tx: Tx, actorId: string) {
    return this.roles.resolveActiveRoleScopesInTransaction(tx, actorId).catch(() => {
      throw new ForbiddenException("当前账号缺少有效公司级资金岗位");
    });
  }

  private async authorize(tx: Tx, actorId: string, isCash: boolean) {
    const roles = await this.activeRoles(tx, actorId);
    const allowed = isCash ? roles.includes("comprehensive_director") :
      roles.includes("finance_staff") || roles.includes("finance_director");
    if (!allowed) throw new ForbiddenException("当前公司级岗位无权登记该账户的垫资到账");
  }

  private normalize(input: RegisterFundAccountAdvanceDto) {
    const evidenceReference = input.evidenceReference.trim();
    if (!evidenceReference) throw new BadRequestException("请填写实际到账核对依据");
    let amountYuan: string | null;
    try {
      amountYuan = normalizeBusinessAmount(input.amountYuan);
      requiredPastChinaDate(input.receivedOn, "到账日期");
    } catch { throw new BadRequestException("请核对实际到账日期和四位精度的到账金额"); }
    if (!amountYuan || amountYuan === "0.0000") throw new BadRequestException("到账金额必须大于零");

    const contributorId = input.contributorId?.trim() || null;
    const contributorName = input.contributorName?.trim() || null;
    switch (input.contributorKind) {
      case "company":
      case "construction_enterprise":
        if (!contributorId || contributorName) throw new BadRequestException("请从资料中选择实际出资单位");
        break;
      case "person":
      case "other":
        if (contributorId || !contributorName) throw new BadRequestException("请填写实际出资方姓名或名称");
        break;
      case "unknown":
        if (contributorId || contributorName) throw new BadRequestException("出资方待核对时请勿填写未经核对的姓名或单位");
        break;
    }
    return {
      scopeKey: input.scopeKey, expectedRegistrationId: input.expectedRegistrationId, idempotencyKey: input.idempotencyKey,
      amountYuan, contributorKind: input.contributorKind, contributorId, contributorName,
      projectId: input.projectId || null, receivedOn: input.receivedOn, evidenceReference,
    };
  }

  private async resolveContributor(tx: Tx, request: ReturnType<FundAccountAdvanceService["normalize"]>) {
    switch (request.contributorKind) {
      case "unknown":
        return { contributorId: null, contributorNameSnapshot: null };
      case "person":
      case "other":
        return { contributorId: randomUUID(), contributorNameSnapshot: request.contributorName };
      case "company": {
        const company = await tx.companyEntity.findFirst({
          where: { id: request.contributorId!, isActive: true }, select: { id: true, name: true },
        });
        if (!company) throw new BadRequestException("所选出资公司不可用，请重新选择");
        return { contributorId: company.id, contributorNameSnapshot: company.name };
      }
      case "construction_enterprise": {
        const party = await tx.businessParty.findFirst({
          where: { id: request.contributorId!, type: "organization", status: "active" }, select: { id: true, name: true },
        });
        if (!party) throw new BadRequestException("所选出资单位不可用，请重新选择");
        return { contributorId: party.id, contributorNameSnapshot: party.name };
      }
    }
  }
}
