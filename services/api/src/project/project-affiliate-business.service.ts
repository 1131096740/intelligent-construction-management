import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  Optional
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { RoleKey } from "@jiangkong/shared-domain";
import { createHash, randomUUID } from "node:crypto";
import { AuditService } from "../audit/audit.service";
import { AuthService } from "../auth/auth.service";
import { snapshotApprovalSignature } from "../approval/approval-signature-snapshot";
import { PrismaService } from "../database/prisma.service";
import {
  acquireFileBusinessBindingTransactionLock,
  hasNonReceiptBusinessFileBinding
} from "../file/file-business-binding";
import { moneyCentsToApi, parseMoneyCentsInput } from "../money/decimal-money";
import type { ConfirmProjectAffiliateBusinessFactDto } from "./dto/confirm-project-affiliate-business-fact.dto";
import {
  PROJECT_AFFILIATE_AMOUNT_NATURES,
  PROJECT_AFFILIATE_BASIS_TYPES,
  PROJECT_AFFILIATE_CONTRACT_TYPES,
  PROJECT_AFFILIATE_ENTRY_KINDS,
  type ProjectAffiliateAmountNature,
  type ProjectAffiliateBasisType,
  type ProjectAffiliateContractType,
  type ProjectAffiliateEntryKind,
  type RecordProjectAffiliateContractFactDto
} from "./dto/record-project-affiliate-contract-fact.dto";
import {
  PROJECT_AFFILIATE_PAYMENT_KINDS,
  type ProjectAffiliatePaymentKind,
  type RecordProjectAffiliatePaymentFactDto
} from "./dto/record-project-affiliate-payment-fact.dto";
import type { RecordProjectAffiliateSettlementFactDto } from "./dto/record-project-affiliate-settlement-fact.dto";
import {
  PROJECT_AFFILIATE_BUSINESS_FACT_TYPES,
  type ProjectAffiliateBusinessFactType,
  type SupplementProjectAffiliateBusinessEvidenceDto
} from "./dto/supplement-project-affiliate-business-evidence.dto";
import { resolveCurrentProjectAffiliate } from "./project-affiliate-subject";

type EffectDirection = "increase" | "decrease";
type AffiliateFactStatus = "pending_confirm" | "confirmed";
type AffiliateFactAction =
  | "confirm"
  | "supplement_evidence"
  | "record_correction"
  | "record_reversal";

interface AffiliateFactConfirmation {
  id: string;
  projectId: string;
  basisType: string;
  status: string;
  confirmedByUserId: string | null;
  confirmationActionId: string | null;
}

interface AffiliateContractFactRow extends AffiliateFactConfirmation {
  ledgerId: string;
  entryKind: string;
  adjustsFactId: string | null;
  effectDirection: string;
  contractType: string;
  externalContractReference: string;
  counterpartyName: string;
  signedAt: Date;
  amountNature: string;
  amountCents: bigint | null;
  advanceAllowed: boolean;
  advanceLimitCents: bigint | null;
  advanceTermsSummary: string | null;
  affiliateAssignmentId: string;
  affiliateBusinessPartyVersionId: string;
  affiliateNameSnapshot: string;
  description: string | null;
  evidenceFileId: string | null;
  documentVersion: number;
  fileContentSha256Snapshot: string | null;
  idempotencyKey: string;
  requestFingerprint: string;
  recordedByUserId: string;
  recordedByRoleKey: string;
  confirmedAt: Date | null;
  confirmationSignatureVersionId: string | null;
  confirmationSignatureFileId: string | null;
  confirmationSignatureSha256: string | null;
  createdAt: Date;
}

interface AffiliateSettlementFactRow extends AffiliateFactConfirmation {
  ledgerId: string;
  contractLedgerId: string;
  entryKind: string;
  adjustsFactId: string | null;
  effectDirection: string;
  counterpartyName: string;
  settledAt: Date;
  periodLabel: string;
  amountCents: bigint;
  affiliateAssignmentId: string;
  affiliateBusinessPartyVersionId: string;
  affiliateNameSnapshot: string;
  description: string | null;
  evidenceFileId: string | null;
  documentVersion: number;
  fileContentSha256Snapshot: string | null;
  idempotencyKey: string;
  requestFingerprint: string;
  recordedByUserId: string;
  recordedByRoleKey: string;
  confirmedAt: Date | null;
  confirmationSignatureVersionId: string | null;
  confirmationSignatureFileId: string | null;
  confirmationSignatureSha256: string | null;
  createdAt: Date;
}

interface AffiliatePaymentFactRow extends AffiliateFactConfirmation {
  ledgerId: string;
  contractLedgerId: string;
  settlementLedgerId: string | null;
  entryKind: string;
  adjustsFactId: string | null;
  effectDirection: string;
  counterpartyName: string;
  paidAt: Date;
  amountCents: bigint;
  paymentKind: string;
  externalPaymentReference: string | null;
  affiliateAssignmentId: string;
  affiliateBusinessPartyVersionId: string;
  affiliateNameSnapshot: string;
  description: string | null;
  evidenceFileId: string | null;
  documentVersion: number;
  fileContentSha256Snapshot: string | null;
  idempotencyKey: string;
  requestFingerprint: string;
  recordedByUserId: string;
  recordedByRoleKey: string;
  confirmedAt: Date | null;
  confirmationSignatureVersionId: string | null;
  confirmationSignatureFileId: string | null;
  confirmationSignatureSha256: string | null;
  createdAt: Date;
}

interface FactDelegate<TRow extends AffiliateFactConfirmation> {
  findUnique(input: unknown): Promise<TRow | null>;
  findFirst(input: unknown): Promise<TRow | null>;
  updateMany(input: unknown): Promise<{ count: number }>;
}

const SETTLEMENT_REQUIRED_CONTRACT_TYPES = new Set<ProjectAffiliateContractType>([
  "material_purchase",
  "equipment_rental",
  "labor_subcontract",
  "professional_subcontract",
  "general_settlement"
]);

@Injectable()
export class ProjectAffiliateBusinessService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional()
    private readonly audit: AuditService = new AuditService(),
    @Optional()
    private readonly auth?: AuthService
  ) {}

  async listFacts(projectId: string, actorUserId: string) {
    return this.prisma.$transaction(async (tx) => {
      await this.requireActiveProject(tx, projectId);
      const roleKeys = await loadActorRoleKeys(tx, actorUserId, projectId);
      const [contracts, settlements, payments, evidence] = await Promise.all([
        tx.projectAffiliateContractFact.findMany({
          where: { projectId },
          orderBy: [{ createdAt: "desc" }, { id: "asc" }]
        }),
        tx.projectAffiliateSettlementFact.findMany({
          where: { projectId },
          orderBy: [{ createdAt: "desc" }, { id: "asc" }]
        }),
        tx.projectAffiliatePaymentFact.findMany({
          where: { projectId },
          orderBy: [{ createdAt: "desc" }, { id: "asc" }]
        }),
        tx.projectAffiliateBusinessEvidence.findMany({
          where: { projectId },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }]
        })
      ]);
      const evidenceByFact = new Map<string, typeof evidence>();
      for (const item of evidence) {
        const key = `${item.businessType}:${item.businessFactId}`;
        evidenceByFact.set(key, [...(evidenceByFact.get(key) ?? []), item]);
      }
      return {
        availableActions: [
          ...(roleKeys.includes("contract_staff")
            ? (["record_contract"] as const)
            : []),
          ...(roleKeys.includes("budget_staff")
            ? (["record_settlement"] as const)
            : []),
          ...(roleKeys.includes("finance_staff") ||
          roleKeys.includes("finance_director")
            ? (["record_payment"] as const)
            : [])
        ],
        contracts: contracts.map((fact) => ({
          ...toContractReadModel(fact, roleKeys),
          supplementalEvidence: evidenceByFact.get(`contract:${fact.id}`) ?? []
        })),
        settlements: settlements.map((fact) => ({
          ...toSettlementReadModel(fact, roleKeys),
          supplementalEvidence: evidenceByFact.get(`settlement:${fact.id}`) ?? []
        })),
        payments: payments.map((fact) => ({
          ...toPaymentReadModel(fact, roleKeys),
          supplementalEvidence: evidenceByFact.get(`payment:${fact.id}`) ?? []
        }))
      };
    });
  }

  async recordContractFact(
    projectId: string,
    actorUserId: string,
    input: RecordProjectAffiliateContractFactDto
  ) {
    const contractType = normalizeContractType(input.contractType);
    const entryKind = normalizeEntryKind(input.entryKind ?? "original");
    const effectDirection = normalizeEffectDirection(entryKind, input.effectDirection);
    const externalContractReference = requiredTrimmed(
      input.externalContractReference,
      "请填写外部合同编号"
    );
    const counterpartyName = requiredTrimmed(input.counterpartyName, "请填写合同相对方");
    const signedAt = parseDate(input.signedAt, "外部合同签订日期不正确，请重新选择");
    const amountNature = normalizeAmountNature(input.amountNature);
    const amountCents =
      amountNature === "fixed"
        ? normalizePositiveMoney(input.amountCents, "固定金额合同金额必须大于零")
        : null;
    const basisType = normalizeBasisType(input.basisType);
    const evidenceFileId = optionalTrimmed(input.evidenceFileId);
    const adjustsFactId = optionalTrimmed(input.adjustsFactId);
    const description = optionalTrimmed(input.description);
    const idempotencyKey = requiredTrimmed(input.idempotencyKey, "请提供挂靠合同登记幂等键");
    const advanceAllowed = input.advanceAllowed === true;
    const advanceLimitCents = advanceAllowed
      ? normalizePositiveMoney(input.advanceLimitCents, "预付款上限必须大于零")
      : null;
    const advanceTermsSummary = advanceAllowed
      ? requiredTrimmed(input.advanceTermsSummary, "请冻结外部合同预付款约定摘要")
      : null;

    assertBasisEvidence(basisType, evidenceFileId, "外部合同");
    assertAdjustmentShape(entryKind, adjustsFactId, "挂靠合同");
    if (amountNature === "uncapped" && input.amountCents !== undefined) {
      throw new BadRequestException("无固定总价合同不得虚构合同金额");
    }
    if (!advanceAllowed && (input.advanceLimitCents !== undefined || input.advanceTermsSummary)) {
      throw new BadRequestException("未约定预付款时不得填写预付款上限或摘要");
    }
    if (contractType === "general_direct_payment" && advanceAllowed) {
      throw new BadRequestException("通用直接付款合同不使用结算前预付款例外");
    }

    const requestFingerprint = fingerprint({
      projectId,
      actorUserId,
      contractType,
      entryKind,
      effectDirection,
      adjustsFactId,
      externalContractReference,
      counterpartyName,
      signedAt: signedAt.toISOString(),
      amountNature,
      amountCents: amountCents?.toString() ?? null,
      advanceAllowed,
      advanceLimitCents: advanceLimitCents?.toString() ?? null,
      advanceTermsSummary,
      basisType,
      evidenceFileId,
      description
    });

    try {
      return await this.prisma.$transaction(async (tx) => {
        const existing = await tx.projectAffiliateContractFact.findUnique({
          where: { idempotencyKey }
        });
        if (existing) {
          assertReplay(existing, projectId, actorUserId, requestFingerprint, "挂靠合同");
          return toContractReadModel(
            existing,
            await loadActorRoleKeys(tx, actorUserId, projectId)
          );
        }

        await this.requireActiveProject(tx, projectId);
        const roleKeys = await loadActorRoleKeys(tx, actorUserId, projectId);
        if (!roleKeys.includes("contract_staff")) {
          throw new ForbiddenException("只有合同人员可以录入挂靠企业对下合同事实");
        }
        const affiliate = await resolveCurrentProjectAffiliate(tx, projectId);
        const target = adjustsFactId
          ? await lockAndLoadContractTarget(tx, projectId, adjustsFactId)
          : null;
        if (target) {
          assertContractAdjustmentTarget(target, {
            contractType,
            externalContractReference,
            counterpartyName,
            amountNature,
            advanceAllowed,
            advanceLimitCents,
            advanceTermsSummary,
            affiliateAssignmentId: affiliate.assignmentId,
            affiliateBusinessPartyVersionId: affiliate.businessPartyVersionId
          });
          await assertAdjustmentCapacity(
            tx.projectAffiliateContractFact,
            target,
            entryKind,
            effectDirection,
            amountCents,
            "挂靠合同"
          );
        }
        const evidence = await validateExclusiveEvidence(
          tx,
          actorUserId,
          evidenceFileId,
          "外部合同"
        );
        const id = randomUUID();
        const created = await tx.projectAffiliateContractFact.create({
          data: {
            id,
            ledgerId: target?.ledgerId ?? id,
            projectId,
            entryKind,
            adjustsFactId,
            effectDirection,
            contractType,
            externalContractReference,
            counterpartyName,
            signedAt,
            amountNature,
            amountCents,
            advanceAllowed,
            advanceLimitCents,
            advanceTermsSummary,
            affiliateAssignmentId: affiliate.assignmentId,
            affiliateBusinessPartyVersionId: affiliate.businessPartyVersionId,
            affiliateNameSnapshot: affiliate.name,
            basisType,
            description,
            evidenceFileId,
            documentVersion: 1,
            fileContentSha256Snapshot: evidence?.contentSha256 ?? null,
            idempotencyKey,
            requestFingerprint,
            recordedByUserId: actorUserId,
            recordedByRoleKey: "contract_staff",
            status: "pending_confirm"
          }
        });
        await this.audit.record(tx, {
          actorUserId,
          action: "project.affiliate_contract_fact.record",
          businessType: "project_affiliate_contract_fact",
          businessId: created.id,
          metadata: {
            projectId,
            ledgerId: created.ledgerId,
            entryKind,
            effectDirection,
            contractType,
            counterpartyName,
            amountCents: amountCents?.toString() ?? null,
            basisType,
            evidenceFileId,
            affiliateAssignmentId: affiliate.assignmentId
          }
        });
        return toContractReadModel(created, roleKeys);
      });
    } catch (error) {
      return this.handleContractUniqueReplay(
        error,
        projectId,
        actorUserId,
        idempotencyKey,
        requestFingerprint
      );
    }
  }

  async getRecordCapability(
    projectId: string,
    actorUserId: string,
    inputBusinessType: unknown,
    inputEntryKind: unknown,
    inputAdjustsFactId: unknown
  ) {
    const businessType = normalizeBusinessType(inputBusinessType);
    const entryKind = normalizeEntryKind(inputEntryKind ?? "original");
    const adjustsFactId = optionalTrimmed(inputAdjustsFactId);
    return this.prisma.$transaction(async (tx) => {
      await this.requireActiveProject(tx, projectId);
      const roleKeys = await loadActorRoleKeys(tx, actorUserId, projectId);
      const originalAllowed =
        (businessType === "contract" && roleKeys.includes("contract_staff")) ||
        (businessType === "settlement" && roleKeys.includes("budget_staff")) ||
        (businessType === "payment" &&
          (roleKeys.includes("finance_staff") || roleKeys.includes("finance_director")));
      let allowed = entryKind === "original" && originalAllowed;
      if (entryKind !== "original" && adjustsFactId) {
        const target = await factDelegate(tx, businessType).findFirst({
          where: { id: adjustsFactId, projectId }
        });
        const requiredAction =
          entryKind === "correction" ? "record_correction" : "record_reversal";
        const targetEntryKind = (target as { entryKind?: string } | null)
          ?.entryKind;
        if (target && targetEntryKind === "original") {
          allowed = availableActions(
            businessType,
            target.status as AffiliateFactStatus,
            target.basisType,
            roleKeys
          ).includes(requiredAction);
        }
      }
      const action = `record_affiliate_${businessType}_fact`;
      return {
        projectId,
        businessType,
        entryKind,
        adjustsFactId: adjustsFactId ?? null,
        availableActions: allowed ? [action] : []
      };
    });
  }

  async getFactCapability(
    projectId: string,
    factId: string,
    actorUserId: string,
    inputBusinessType: unknown
  ) {
    const businessType = normalizeBusinessType(inputBusinessType);
    return this.prisma.$transaction(async (tx) => {
      await this.requireActiveProject(tx, projectId);
      const roleKeys = await loadActorRoleKeys(tx, actorUserId, projectId);
      const fact = await factDelegate(tx, businessType).findFirst({
        where: { id: factId, projectId }
      });
      if (!fact) throw new NotFoundException("挂靠外部事实不存在");
      const factActions = availableActions(
        businessType,
        fact.status as AffiliateFactStatus,
        fact.basisType,
        roleKeys
      );
      return {
        projectId,
        factId,
        businessType,
        availableActions: [
          ...(factActions.includes("confirm") ? ["confirm_affiliate_fact"] : []),
          ...(factActions.includes("supplement_evidence")
            ? ["supplement_affiliate_evidence"]
            : [])
        ]
      };
    });
  }

  async recordSettlementFact(
    projectId: string,
    actorUserId: string,
    input: RecordProjectAffiliateSettlementFactDto
  ) {
    const contractLedgerId = requiredTrimmed(
      input.contractLedgerId,
      "请关联已确认挂靠合同"
    );
    const entryKind = normalizeEntryKind(input.entryKind ?? "original");
    const effectDirection = normalizeEffectDirection(entryKind, input.effectDirection);
    const adjustsFactId = optionalTrimmed(input.adjustsFactId);
    const counterpartyName = requiredTrimmed(input.counterpartyName, "请填写结算相对方");
    const settledAt = parseDate(input.settledAt, "外部结算日期不正确，请重新选择");
    const periodLabel = requiredTrimmed(input.periodLabel, "请填写外部结算期间");
    const amountCents = normalizePositiveMoney(input.amountCents, "外部结算金额必须大于零");
    const basisType = normalizeBasisType(input.basisType);
    const evidenceFileId = optionalTrimmed(input.evidenceFileId);
    const description = optionalTrimmed(input.description);
    const idempotencyKey = requiredTrimmed(input.idempotencyKey, "请提供挂靠结算登记幂等键");
    assertBasisEvidence(basisType, evidenceFileId, "外部结算");
    assertAdjustmentShape(entryKind, adjustsFactId, "挂靠结算");

    const requestFingerprint = fingerprint({
      projectId,
      actorUserId,
      contractLedgerId,
      entryKind,
      effectDirection,
      adjustsFactId,
      counterpartyName,
      settledAt: settledAt.toISOString(),
      periodLabel,
      amountCents: amountCents.toString(),
      basisType,
      evidenceFileId,
      description
    });

    try {
      return await this.prisma.$transaction(async (tx) => {
        const existing = await tx.projectAffiliateSettlementFact.findUnique({
          where: { idempotencyKey }
        });
        if (existing) {
          assertReplay(existing, projectId, actorUserId, requestFingerprint, "挂靠结算");
          return toSettlementReadModel(
            existing,
            await loadActorRoleKeys(tx, actorUserId, projectId)
          );
        }
        await this.requireActiveProject(tx, projectId);
        const roleKeys = await loadActorRoleKeys(tx, actorUserId, projectId);
        if (!roleKeys.includes("budget_staff")) {
          throw new ForbiddenException("只有项目预算人员可以录入挂靠企业对下结算事实");
        }
        const contract = await loadActiveContractLedger(tx, projectId, contractLedgerId);
        if (contract.contractType === "general_direct_payment") {
          throw new BadRequestException("通用直接付款合同不办理结算");
        }
        assertSameCounterparty(contract.counterpartyName, counterpartyName, "结算");
        const target = adjustsFactId
          ? await lockAndLoadSettlementTarget(tx, projectId, adjustsFactId)
          : null;
        if (target) {
          if (
            target.contractLedgerId !== contractLedgerId ||
            target.counterpartyName !== counterpartyName ||
            target.affiliateAssignmentId !== contract.affiliateAssignmentId ||
            target.affiliateBusinessPartyVersionId !==
              contract.affiliateBusinessPartyVersionId
          ) {
            throw new BadRequestException("挂靠结算更正不得改变合同、相对方或挂靠企业主体");
          }
          await assertAdjustmentCapacity(
            tx.projectAffiliateSettlementFact,
            target,
            entryKind,
            effectDirection,
            amountCents,
            "挂靠结算"
          );
        }
        const evidence = await validateExclusiveEvidence(
          tx,
          actorUserId,
          evidenceFileId,
          "外部结算"
        );
        const id = randomUUID();
        const created = await tx.projectAffiliateSettlementFact.create({
          data: {
            id,
            ledgerId: target?.ledgerId ?? id,
            projectId,
            contractLedgerId,
            entryKind,
            adjustsFactId,
            effectDirection,
            counterpartyName,
            settledAt,
            periodLabel,
            amountCents,
            affiliateAssignmentId: contract.affiliateAssignmentId,
            affiliateBusinessPartyVersionId:
              contract.affiliateBusinessPartyVersionId,
            affiliateNameSnapshot: contract.affiliateNameSnapshot,
            basisType,
            description,
            evidenceFileId,
            documentVersion: 1,
            fileContentSha256Snapshot: evidence?.contentSha256 ?? null,
            idempotencyKey,
            requestFingerprint,
            recordedByUserId: actorUserId,
            recordedByRoleKey: "budget_staff",
            status: "pending_confirm"
          }
        });
        await this.audit.record(tx, {
          actorUserId,
          action: "project.affiliate_settlement_fact.record",
          businessType: "project_affiliate_settlement_fact",
          businessId: created.id,
          metadata: {
            projectId,
            ledgerId: created.ledgerId,
            contractLedgerId,
            entryKind,
            effectDirection,
            counterpartyName,
            amountCents: amountCents.toString(),
            basisType,
            evidenceFileId
          }
        });
        return toSettlementReadModel(created, roleKeys);
      });
    } catch (error) {
      return this.handleSettlementUniqueReplay(
        error,
        projectId,
        actorUserId,
        idempotencyKey,
        requestFingerprint
      );
    }
  }

  async recordPaymentFact(
    projectId: string,
    actorUserId: string,
    input: RecordProjectAffiliatePaymentFactDto
  ) {
    const contractLedgerId = requiredTrimmed(
      input.contractLedgerId,
      "请关联已确认挂靠合同"
    );
    const settlementLedgerId = optionalTrimmed(input.settlementLedgerId);
    const entryKind = normalizeEntryKind(input.entryKind ?? "original");
    const effectDirection = normalizeEffectDirection(entryKind, input.effectDirection);
    const adjustsFactId = optionalTrimmed(input.adjustsFactId);
    const counterpartyName = requiredTrimmed(input.counterpartyName, "请填写付款相对方");
    const paidAt = parseDate(input.paidAt, "外部付款日期不正确，请重新选择");
    const amountCents = normalizePositiveMoney(input.amountCents, "外部付款金额必须大于零");
    const paymentKind = normalizePaymentKind(input.paymentKind);
    const externalPaymentReference =
      entryKind === "original"
        ? requiredTrimmed(input.externalPaymentReference, "请填写外部付款唯一流水号")
        : null;
    const basisType = normalizeBasisType(input.basisType);
    const evidenceFileId = optionalTrimmed(input.evidenceFileId);
    const description = optionalTrimmed(input.description);
    const idempotencyKey = requiredTrimmed(input.idempotencyKey, "请提供挂靠付款登记幂等键");
    assertBasisEvidence(basisType, evidenceFileId, "外部付款");
    assertAdjustmentShape(entryKind, adjustsFactId, "挂靠付款");
    if (entryKind !== "original" && input.externalPaymentReference !== undefined) {
      throw new BadRequestException("付款更正或反向记录沿用原流水，不得生成第二个外部流水号");
    }
    if (paymentKind === "normal" && !settlementLedgerId) {
      throw new BadRequestException("正常挂靠付款必须关联已确认合同和已确认结算");
    }
    if ((paymentKind === "advance" || paymentKind === "direct_contract") && settlementLedgerId) {
      throw new BadRequestException("预付款或直接付款不得伪装成结算付款");
    }

    const requestFingerprint = fingerprint({
      projectId,
      actorUserId,
      contractLedgerId,
      settlementLedgerId,
      entryKind,
      effectDirection,
      adjustsFactId,
      counterpartyName,
      paidAt: paidAt.toISOString(),
      amountCents: amountCents.toString(),
      paymentKind,
      externalPaymentReference,
      basisType,
      evidenceFileId,
      description
    });

    try {
      return await this.prisma.$transaction(async (tx) => {
        const existing = await tx.projectAffiliatePaymentFact.findUnique({
          where: { idempotencyKey }
        });
        if (existing) {
          assertReplay(existing, projectId, actorUserId, requestFingerprint, "挂靠付款");
          return toPaymentReadModel(
            existing,
            await loadActorRoleKeys(tx, actorUserId, projectId)
          );
        }
        await this.requireActiveProject(tx, projectId);
        const roleKeys = await loadActorRoleKeys(tx, actorUserId, projectId);
        const recordedByRoleKey = roleKeys.includes("finance_director")
          ? "finance_director"
          : roleKeys.includes("finance_staff")
            ? "finance_staff"
            : null;
        if (!recordedByRoleKey) {
          throw new ForbiddenException("只有财务人员或财务主管可以录入挂靠付款事实");
        }
        const contract = await loadActiveContractLedger(tx, projectId, contractLedgerId, true);
        assertSameCounterparty(contract.counterpartyName, counterpartyName, "付款");
        const settlement = settlementLedgerId
          ? await loadActiveSettlementLedger(tx, projectId, settlementLedgerId)
          : null;
        if (
          settlement &&
          (settlement.contractLedgerId !== contractLedgerId ||
            settlement.counterpartyName !== counterpartyName ||
            settlement.affiliateAssignmentId !== contract.affiliateAssignmentId ||
            settlement.affiliateBusinessPartyVersionId !==
              contract.affiliateBusinessPartyVersionId)
        ) {
          throw new BadRequestException("挂靠付款关联的合同、结算、相对方或挂靠企业主体不一致");
        }
        assertPaymentRoute(contract, paymentKind, settlement);

        const target = adjustsFactId
          ? await lockAndLoadPaymentTarget(tx, projectId, adjustsFactId)
          : null;
        if (target) {
          if (
            target.contractLedgerId !== contractLedgerId ||
            target.settlementLedgerId !== (settlementLedgerId ?? null) ||
            target.counterpartyName !== counterpartyName ||
            target.paymentKind !== paymentKind ||
            target.affiliateAssignmentId !== contract.affiliateAssignmentId ||
            target.affiliateBusinessPartyVersionId !==
              contract.affiliateBusinessPartyVersionId
          ) {
            throw new BadRequestException("挂靠付款更正不得改变合同、结算、付款类型、相对方或主体");
          }
          await assertAdjustmentCapacity(
            tx.projectAffiliatePaymentFact,
            target,
            entryKind,
            effectDirection,
            amountCents,
            "挂靠付款"
          );
        }
        await assertPaymentCapacity(tx, {
          contract,
          settlement,
          paymentKind,
          effectDirection,
          amountCents,
          target
        });
        const evidence = await validateExclusiveEvidence(
          tx,
          actorUserId,
          evidenceFileId,
          "外部付款"
        );
        const id = randomUUID();
        const created = await tx.projectAffiliatePaymentFact.create({
          data: {
            id,
            ledgerId: target?.ledgerId ?? id,
            projectId,
            contractLedgerId,
            settlementLedgerId,
            entryKind,
            adjustsFactId,
            effectDirection,
            counterpartyName,
            paidAt,
            amountCents,
            paymentKind,
            externalPaymentReference,
            affiliateAssignmentId: contract.affiliateAssignmentId,
            affiliateBusinessPartyVersionId:
              contract.affiliateBusinessPartyVersionId,
            affiliateNameSnapshot: contract.affiliateNameSnapshot,
            basisType,
            description,
            evidenceFileId,
            documentVersion: 1,
            fileContentSha256Snapshot: evidence?.contentSha256 ?? null,
            idempotencyKey,
            requestFingerprint,
            recordedByUserId: actorUserId,
            recordedByRoleKey,
            status: "pending_confirm"
          }
        });
        await this.audit.record(tx, {
          actorUserId,
          action: "project.affiliate_payment_fact.record",
          businessType: "project_affiliate_payment_fact",
          businessId: created.id,
          metadata: {
            projectId,
            ledgerId: created.ledgerId,
            contractLedgerId,
            settlementLedgerId,
            entryKind,
            effectDirection,
            paymentKind,
            externalPaymentReference,
            counterpartyName,
            amountCents: amountCents.toString(),
            basisType,
            evidenceFileId,
            paymentSubjectType: "affiliate"
          }
        });
        return toPaymentReadModel(created, roleKeys);
      });
    } catch (error) {
      return this.handlePaymentUniqueReplay(
        error,
        projectId,
        actorUserId,
        idempotencyKey,
        requestFingerprint
      );
    }
  }

  confirmContractFact(
    projectId: string,
    factId: string,
    actorUserId: string,
    input: ConfirmProjectAffiliateBusinessFactDto,
    now: Date = new Date()
  ) {
    return this.confirmFact("contract", projectId, factId, actorUserId, input, now);
  }

  confirmSettlementFact(
    projectId: string,
    factId: string,
    actorUserId: string,
    input: ConfirmProjectAffiliateBusinessFactDto,
    now: Date = new Date()
  ) {
    return this.confirmFact("settlement", projectId, factId, actorUserId, input, now);
  }

  confirmPaymentFact(
    projectId: string,
    factId: string,
    actorUserId: string,
    input: ConfirmProjectAffiliateBusinessFactDto,
    now: Date = new Date()
  ) {
    return this.confirmFact("payment", projectId, factId, actorUserId, input, now);
  }

  async supplementEvidence(
    projectId: string,
    factId: string,
    actorUserId: string,
    input: SupplementProjectAffiliateBusinessEvidenceDto
  ) {
    const businessType = normalizeBusinessType(input.businessType);
    const fileId = requiredTrimmed(input.fileId, "请上传补充外部依据");
    const description = requiredTrimmed(input.description, "请填写补充外部依据说明");
    const idempotencyKey = requiredTrimmed(input.idempotencyKey, "请提供补充依据幂等键");

    try {
      return await this.prisma.$transaction(async (tx) => {
        const replay = await tx.projectAffiliateBusinessEvidence.findUnique({
          where: { idempotencyKey }
        });
        if (replay) {
          if (
            replay.projectId !== projectId ||
            replay.businessType !== businessType ||
            replay.businessFactId !== factId ||
            replay.recordedByUserId !== actorUserId ||
            replay.fileId !== fileId
          ) {
            throw new ConflictException("补充外部依据幂等键已用于不同动作");
          }
          return replay;
        }
        await this.requireActiveProject(tx, projectId);
        const roleKeys = await loadActorRoleKeys(tx, actorUserId, projectId);
        const recordedByRoleKey = requireEvidenceRole(roleKeys, businessType);
        await assertFactExists(tx, businessType, projectId, factId);
        const file = await validateExclusiveEvidence(tx, actorUserId, fileId, "补充外部依据");
        if (!file) {
          throw new InternalServerErrorException("补充外部依据文件未正确加载");
        }
        const fileContentSha256Snapshot = file.contentSha256;
        if (typeof fileContentSha256Snapshot !== "string") {
          throw new InternalServerErrorException("补充外部依据摘要未正确冻结");
        }
        const created = await tx.projectAffiliateBusinessEvidence.create({
          data: {
            projectId,
            businessType,
            businessFactId: factId,
            fileId,
            documentVersion: 1,
            fileContentSha256Snapshot,
            description,
            idempotencyKey,
            recordedByUserId: actorUserId,
            recordedByRoleKey
          }
        });
        await this.audit.record(tx, {
          actorUserId,
          action: "project.affiliate_business_fact.evidence_supplement",
          businessType: `project_affiliate_${businessType}_fact`,
          businessId: factId,
          metadata: {
            projectId,
            businessType,
            fileId,
            fileContentSha256Snapshot,
            evidenceId: created.id
          }
        });
        return created;
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        const replay = await this.prisma.projectAffiliateBusinessEvidence.findUnique({
          where: { idempotencyKey }
        });
        if (
          replay?.projectId === projectId &&
          replay.businessType === businessType &&
          replay.businessFactId === factId &&
          replay.recordedByUserId === actorUserId &&
          replay.fileId === fileId
        ) {
          return replay;
        }
        throw new ConflictException("该外部依据文件已绑定其他项目或业务事实");
      }
      throw error;
    }
  }

  async assertEvidenceUploadAllowed(
    projectId: string,
    factId: string,
    actorUserId: string,
    inputBusinessType: unknown
  ) {
    const businessType = normalizeBusinessType(inputBusinessType);
    return this.prisma.$transaction(async (tx) => {
      await this.requireActiveProject(tx, projectId);
      const roleKeys = await loadActorRoleKeys(tx, actorUserId, projectId);
      requireEvidenceRole(roleKeys, businessType);
      await assertFactExists(tx, businessType, projectId, factId);
      return {
        projectId,
        factId,
        businessType,
        availableActions: ["supplement_evidence"]
      };
    });
  }

  private async confirmFact(
    businessType: ProjectAffiliateBusinessFactType,
    projectId: string,
    factId: string,
    actorUserId: string,
    input: ConfirmProjectAffiliateBusinessFactDto,
    now: Date
  ) {
    const confirmationPassword = requiredTrimmed(
      input.confirmationPassword,
      "请输入当前登录密码"
    );
    const confirmationActionId = requiredTrimmed(
      input.confirmationActionId,
      "请提供外部事实确认幂等键"
    );
    if (!this.auth) {
      throw new Error("Auth service is required to confirm affiliate business fact");
    }
    await this.auth.confirmPassword(actorUserId, confirmationPassword);

    return this.prisma.$transaction(async (tx) => {
      const delegate = factDelegate(tx, businessType);
      const replay = await delegate.findUnique({ where: { confirmationActionId } });
      if (replay) {
        if (
          replay.id !== factId ||
          replay.projectId !== projectId ||
          replay.confirmedByUserId !== actorUserId
        ) {
          throw new ConflictException("外部事实确认幂等键已用于不同动作");
        }
        const roles = await loadActorRoleKeys(tx, actorUserId, projectId);
        return readModelByType(businessType, replay, roles);
      }

      await lockFactForConfirmation(tx, businessType, projectId, factId);
      const fact = await delegate.findFirst({ where: { id: factId, projectId } });
      if (!fact) throw new NotFoundException("待确认挂靠外部事实不存在");
      if (fact.status !== "pending_confirm") {
        throw new BadRequestException("当前挂靠外部事实状态不可确认");
      }
      const roleKeys = await loadActorRoleKeys(tx, actorUserId, projectId);
      assertCanConfirm(businessType, fact.basisType, roleKeys);
      const signature = await snapshotApprovalSignature(tx, actorUserId, {
        required: true
      });
      const updated = await delegate.updateMany({
        where: {
          id: factId,
          projectId,
          status: "pending_confirm",
          confirmationActionId: null
        },
        data: {
          status: "confirmed",
          confirmedByUserId: actorUserId,
          confirmedAt: now,
          confirmationActionId,
          confirmationSignatureVersionId: signature.versionId,
          confirmationSignatureFileId: signature.fileId,
          confirmationSignatureSha256: signature.sha256
        }
      });
      if (updated.count !== 1) {
        throw new ConflictException("挂靠外部事实已被其他操作确认，请刷新后核对");
      }
      const confirmed = await delegate.findUnique({ where: { id: factId } });
      if (!confirmed) {
        throw new InternalServerErrorException("挂靠外部事实确认结果未正确保存");
      }
      await this.audit.record(tx, {
        actorUserId,
        action: `project.affiliate_${businessType}_fact.confirm`,
        businessType: `project_affiliate_${businessType}_fact`,
        businessId: confirmed.id,
        metadata: {
          projectId,
          factId,
          basisType: confirmed.basisType,
          confirmationActionId,
          confirmationSignatureVersionId: signature.versionId,
          confirmedAt: now.toISOString(),
          externalConfirmation: true,
          companyApprovalCreated: false
        }
      });
      return readModelByType(businessType, confirmed, roleKeys);
    });
  }

  private async requireActiveProject(tx: Prisma.TransactionClient, projectId: string) {
    const project = await tx.project.findFirst({
      where: { id: projectId, isActive: true },
      select: { id: true }
    });
    if (!project) {
      throw new NotFoundException("项目不存在或已停用，请刷新后重试");
    }
    return project;
  }

  private async handleContractUniqueReplay(
    error: unknown,
    projectId: string,
    actorUserId: string,
    idempotencyKey: string,
    requestFingerprint: string
  ) {
    if (!isUniqueConstraintError(error)) throw error;
    const existing = await this.prisma.projectAffiliateContractFact.findUnique({
      where: { idempotencyKey }
    });
    if (
      existing?.projectId === projectId &&
      existing.recordedByUserId === actorUserId &&
      existing.requestFingerprint === requestFingerprint
    ) {
      return toContractReadModel(existing, []);
    }
    throw new ConflictException("挂靠合同事实或外部合同编号已登记，请刷新后核对");
  }

  private async handleSettlementUniqueReplay(
    error: unknown,
    projectId: string,
    actorUserId: string,
    idempotencyKey: string,
    requestFingerprint: string
  ) {
    if (!isUniqueConstraintError(error)) throw error;
    const existing = await this.prisma.projectAffiliateSettlementFact.findUnique({
      where: { idempotencyKey }
    });
    if (
      existing?.projectId === projectId &&
      existing.recordedByUserId === actorUserId &&
      existing.requestFingerprint === requestFingerprint
    ) {
      return toSettlementReadModel(existing, []);
    }
    throw new ConflictException("挂靠结算事实已登记，请刷新后核对");
  }

  private async handlePaymentUniqueReplay(
    error: unknown,
    projectId: string,
    actorUserId: string,
    idempotencyKey: string,
    requestFingerprint: string
  ) {
    if (!isUniqueConstraintError(error)) throw error;
    const existing = await this.prisma.projectAffiliatePaymentFact.findUnique({
      where: { idempotencyKey }
    });
    if (
      existing?.projectId === projectId &&
      existing.recordedByUserId === actorUserId &&
      existing.requestFingerprint === requestFingerprint
    ) {
      return toPaymentReadModel(existing, []);
    }
    throw new ConflictException("同一外部付款已登记，不能跨项目或跨业务重复绑定");
  }
}

function factDelegate(
  tx: Prisma.TransactionClient,
  businessType: ProjectAffiliateBusinessFactType
): FactDelegate<AffiliateFactConfirmation> {
  if (businessType === "contract") {
    return tx.projectAffiliateContractFact as unknown as FactDelegate<AffiliateFactConfirmation>;
  }
  if (businessType === "settlement") {
    return tx.projectAffiliateSettlementFact as unknown as FactDelegate<AffiliateFactConfirmation>;
  }
  return tx.projectAffiliatePaymentFact as unknown as FactDelegate<AffiliateFactConfirmation>;
}

async function lockFactForConfirmation(
  tx: Prisma.TransactionClient,
  businessType: ProjectAffiliateBusinessFactType,
  projectId: string,
  factId: string
) {
  if (businessType === "contract") {
    return tx.$queryRaw(Prisma.sql`
      SELECT "id" FROM "ProjectAffiliateContractFact"
      WHERE "id" = ${factId} AND "projectId" = ${projectId} FOR UPDATE
    `);
  }
  if (businessType === "settlement") {
    return tx.$queryRaw(Prisma.sql`
      SELECT "id" FROM "ProjectAffiliateSettlementFact"
      WHERE "id" = ${factId} AND "projectId" = ${projectId} FOR UPDATE
    `);
  }
  return tx.$queryRaw(Prisma.sql`
    SELECT "id" FROM "ProjectAffiliatePaymentFact"
    WHERE "id" = ${factId} AND "projectId" = ${projectId} FOR UPDATE
  `);
}

async function lockAndLoadContractTarget(
  tx: Prisma.TransactionClient,
  projectId: string,
  factId: string
): Promise<AffiliateContractFactRow> {
  await tx.$queryRaw(Prisma.sql`
    SELECT "id" FROM "ProjectAffiliateContractFact"
    WHERE "id" = ${factId} AND "projectId" = ${projectId} FOR UPDATE
  `);
  const target = await tx.projectAffiliateContractFact.findFirst({
    where: { id: factId, projectId }
  });
  assertOriginalConfirmedTarget(target, "挂靠合同");
  return target as AffiliateContractFactRow;
}

async function lockAndLoadSettlementTarget(
  tx: Prisma.TransactionClient,
  projectId: string,
  factId: string
): Promise<AffiliateSettlementFactRow> {
  await tx.$queryRaw(Prisma.sql`
    SELECT "id" FROM "ProjectAffiliateSettlementFact"
    WHERE "id" = ${factId} AND "projectId" = ${projectId} FOR UPDATE
  `);
  const target = await tx.projectAffiliateSettlementFact.findFirst({
    where: { id: factId, projectId }
  });
  assertOriginalConfirmedTarget(target, "挂靠结算");
  return target as AffiliateSettlementFactRow;
}

async function lockAndLoadPaymentTarget(
  tx: Prisma.TransactionClient,
  projectId: string,
  factId: string
): Promise<AffiliatePaymentFactRow> {
  await tx.$queryRaw(Prisma.sql`
    SELECT "id" FROM "ProjectAffiliatePaymentFact"
    WHERE "id" = ${factId} AND "projectId" = ${projectId} FOR UPDATE
  `);
  const target = await tx.projectAffiliatePaymentFact.findFirst({
    where: { id: factId, projectId }
  });
  assertOriginalConfirmedTarget(target, "挂靠付款");
  return target as AffiliatePaymentFactRow;
}

function assertOriginalConfirmedTarget(
  target:
    | { entryKind: string; status: string }
    | null,
  label: string
): void {
  if (!target) throw new NotFoundException(`被调整的${label}事实不存在`);
  if (target.entryKind !== "original" || target.status !== "confirmed") {
    throw new BadRequestException(`${label}只能对已确认原始事实追加更正或反向记录`);
  }
}

async function loadActiveContractLedger(
  tx: Prisma.TransactionClient,
  projectId: string,
  ledgerId: string,
  lock = false
) {
  if (lock) {
    await tx.$queryRaw(Prisma.sql`
      SELECT "id" FROM "ProjectAffiliateContractFact"
      WHERE "projectId" = ${projectId}
        AND "ledgerId" = ${ledgerId}
        AND "entryKind" = 'original'
      FOR UPDATE
    `);
  }
  const facts = await tx.projectAffiliateContractFact.findMany({
    where: { projectId, ledgerId, status: "confirmed" },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }]
  });
  const original = facts.find((fact) => fact.entryKind === "original");
  if (!original) throw new BadRequestException("关联挂靠合同不存在或尚未确认");
  if (facts.some((fact) => fact.entryKind === "reversal" && fact.adjustsFactId === original.id)) {
    throw new BadRequestException("关联挂靠合同已反向关闭，不能继续登记业务");
  }
  const netAmountCents =
    original.amountCents === null
      ? null
      : facts.reduce(
          (sum, fact) =>
            fact.amountCents === null
              ? sum
              : sum +
                (fact.effectDirection === "decrease"
                  ? -BigInt(fact.amountCents)
                  : BigInt(fact.amountCents)),
          0n
        );
  if (netAmountCents !== null && netAmountCents <= 0n) {
    throw new BadRequestException("关联挂靠合同有效金额已归零，不能继续登记业务");
  }
  return { ...original, netAmountCents };
}

async function loadActiveSettlementLedger(
  tx: Prisma.TransactionClient,
  projectId: string,
  ledgerId: string
) {
  const facts = await tx.projectAffiliateSettlementFact.findMany({
    where: { projectId, ledgerId, status: "confirmed" },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }]
  });
  const original = facts.find((fact) => fact.entryKind === "original");
  if (!original) throw new BadRequestException("关联挂靠结算不存在或尚未确认");
  if (facts.some((fact) => fact.entryKind === "reversal" && fact.adjustsFactId === original.id)) {
    throw new BadRequestException("关联挂靠结算已反向关闭，不能登记付款");
  }
  const netAmountCents = netMoneyFacts(facts);
  if (netAmountCents <= 0n) {
    throw new BadRequestException("关联挂靠结算有效金额已归零，不能登记付款");
  }
  return { ...original, netAmountCents };
}

function assertContractAdjustmentTarget(
  target: AffiliateContractFactRow,
  input: {
    contractType: ProjectAffiliateContractType;
    externalContractReference: string;
    counterpartyName: string;
    amountNature: ProjectAffiliateAmountNature;
    advanceAllowed: boolean;
    advanceLimitCents: bigint | null;
    advanceTermsSummary: string | null;
    affiliateAssignmentId: string;
    affiliateBusinessPartyVersionId: string;
  }
) {
  if (
    target.contractType !== input.contractType ||
    target.externalContractReference !== input.externalContractReference ||
    target.counterpartyName !== input.counterpartyName ||
    target.amountNature !== input.amountNature ||
    target.advanceAllowed !== input.advanceAllowed ||
    target.advanceLimitCents !== input.advanceLimitCents ||
    target.advanceTermsSummary !== input.advanceTermsSummary ||
    target.affiliateAssignmentId !== input.affiliateAssignmentId ||
    target.affiliateBusinessPartyVersionId !==
      input.affiliateBusinessPartyVersionId
  ) {
    throw new BadRequestException("挂靠合同更正不得改变合同类型、编号、相对方、预付款约定或主体");
  }
}

async function assertAdjustmentCapacity(
  delegate: {
    findMany(input: unknown): Promise<Array<{
      entryKind: string;
      effectDirection: string;
      amountCents: bigint | null;
    }>>;
  },
  target: { id: string; amountCents: bigint | null },
  entryKind: ProjectAffiliateEntryKind,
  effectDirection: EffectDirection,
  amountCents: bigint | null,
  label: string
) {
  const adjustments = await delegate.findMany({
    where: {
      adjustsFactId: target.id,
      status: { in: ["pending_confirm", "confirmed"] }
    },
    select: { entryKind: true, effectDirection: true, amountCents: true }
  });
  if (entryKind === "reversal" && adjustments.some((item) => item.entryKind === "reversal")) {
    throw new ConflictException(`${label}原始事实只能反向一次`);
  }
  if (target.amountCents === null) {
    if (entryKind === "correction") {
      throw new BadRequestException(`无固定金额${label}不支持金额 delta 更正，只能追加说明证据或反向`);
    }
    return;
  }
  const current = adjustments.reduce(
    (sum, item) =>
      item.amountCents === null
        ? sum
        : sum +
          (item.effectDirection === "decrease"
            ? -BigInt(item.amountCents)
            : BigInt(item.amountCents)),
    BigInt(target.amountCents)
  );
  if (entryKind === "reversal" && amountCents !== current) {
    throw new BadRequestException(`${label}反向金额必须等于当前有效金额`);
  }
  const next =
    entryKind === "reversal"
      ? 0n
      : current + (effectDirection === "decrease" ? -(amountCents ?? 0n) : amountCents ?? 0n);
  if (next < 0n) throw new BadRequestException(`${label}累计减少金额不能超过原始有效金额`);
}

function assertPaymentRoute(
  contract: { contractType: string; advanceAllowed: boolean },
  paymentKind: ProjectAffiliatePaymentKind,
  settlement: { id: string } | null
) {
  if (contract.contractType === "general_direct_payment") {
    if (paymentKind !== "direct_contract" || settlement) {
      throw new BadRequestException("通用直接付款合同只能登记不关联结算的直接付款");
    }
    return;
  }
  if (SETTLEMENT_REQUIRED_CONTRACT_TYPES.has(contract.contractType as ProjectAffiliateContractType)) {
    if (paymentKind === "normal" && !settlement) {
      throw new BadRequestException("前五类正常挂靠付款必须关联已确认结算");
    }
    if (paymentKind === "advance" && !contract.advanceAllowed) {
      throw new BadRequestException("外部合同未冻结预付款约定，不能在结算前登记预付款");
    }
    if (paymentKind === "direct_contract") {
      throw new BadRequestException("前五类合同不能绕过结算登记直接付款");
    }
  }
}

async function assertPaymentCapacity(
  tx: Prisma.TransactionClient,
  input: {
    contract: {
      ledgerId: string;
      amountNature: string;
      netAmountCents: bigint | null;
      advanceLimitCents: bigint | null;
    };
    settlement: { ledgerId: string; netAmountCents: bigint } | null;
    paymentKind: ProjectAffiliatePaymentKind;
    effectDirection: EffectDirection;
    amountCents: bigint;
    target: AffiliatePaymentFactRow | null;
  }
) {
  const where =
    input.paymentKind === "normal" && input.settlement
      ? { settlementLedgerId: input.settlement.ledgerId }
      : { contractLedgerId: input.contract.ledgerId, paymentKind: input.paymentKind };
  const facts = await tx.projectAffiliatePaymentFact.findMany({
    where: {
      ...where,
      status: { in: ["pending_confirm", "confirmed"] }
    },
    select: {
      id: true,
      entryKind: true,
      effectDirection: true,
      amountCents: true
    }
  });
  const current = netMoneyFacts(facts);
  const delta = input.effectDirection === "decrease" ? -input.amountCents : input.amountCents;
  const next = input.target ? current + delta : current + input.amountCents;
  const limit =
    input.paymentKind === "normal"
      ? input.settlement?.netAmountCents ?? null
      : input.paymentKind === "advance"
        ? input.contract.advanceLimitCents
        : input.contract.amountNature === "fixed"
          ? input.contract.netAmountCents
          : null;
  if (next < 0n) throw new BadRequestException("挂靠付款累计更正后金额不能小于零");
  if (limit !== null && next > limit) {
    throw new BadRequestException("挂靠付款累计金额超过外部合同或结算冻结的有效上限");
  }
}

function netMoneyFacts(
  facts: ReadonlyArray<{ effectDirection: string; amountCents: bigint }>
): bigint {
  return facts.reduce(
    (sum, fact) =>
      sum +
      (fact.effectDirection === "decrease"
        ? -BigInt(fact.amountCents)
        : BigInt(fact.amountCents)),
    0n
  );
}

async function validateExclusiveEvidence(
  tx: Prisma.TransactionClient,
  actorUserId: string,
  fileId: string | undefined,
  label: string
) {
  if (!fileId) return null;
  await acquireFileBusinessBindingTransactionLock(tx);
  if (await hasNonReceiptBusinessFileBinding(tx, [fileId])) {
    throw new ConflictException(`${label}文件已绑定其他项目或业务事实，不能重复使用`);
  }
  const file = await tx.fileObject.findUnique({
    where: { id: fileId },
    select: {
      id: true,
      uploadedByUserId: true,
      storageStatus: true,
      contentSha256: true
    }
  });
  if (!file) throw new NotFoundException(`${label}依据文件不存在，请重新上传`);
  if (file.uploadedByUserId !== actorUserId) {
    throw new BadRequestException(`只能使用本人上传的${label}依据文件`);
  }
  if (
    file.storageStatus !== "active" ||
    typeof file.contentSha256 !== "string" ||
    file.contentSha256.length !== 64
  ) {
    throw new BadRequestException(`${label}依据文件尚未完成有效性校验`);
  }
  return file;
}

async function assertFactExists(
  tx: Prisma.TransactionClient,
  businessType: ProjectAffiliateBusinessFactType,
  projectId: string,
  factId: string
) {
  const fact =
    businessType === "contract"
      ? await tx.projectAffiliateContractFact.findFirst({
          where: { id: factId, projectId },
          select: { id: true }
        })
      : businessType === "settlement"
        ? await tx.projectAffiliateSettlementFact.findFirst({
            where: { id: factId, projectId },
            select: { id: true }
          })
        : await tx.projectAffiliatePaymentFact.findFirst({
            where: { id: factId, projectId },
            select: { id: true }
          });
  if (!fact) throw new NotFoundException("待补充依据的挂靠外部事实不存在");
}

async function loadActorRoleKeys(
  tx: Pick<Prisma.TransactionClient, "userPosition" | "projectMember" | "position">,
  actorUserId: string,
  projectId: string
): Promise<RoleKey[]> {
  const [globalPositions, projectPositions, projectMembers] = await Promise.all([
    tx.userPosition.findMany({ where: { userId: actorUserId, projectId: null } }),
    tx.userPosition.findMany({ where: { userId: actorUserId, projectId } }),
    tx.projectMember.findMany({ where: { userId: actorUserId, projectId } })
  ]);
  const positionIds = [
    ...new Set(
      [...globalPositions, ...projectPositions].map((position) => position.positionId)
    )
  ];
  const positions = positionIds.length
    ? await tx.position.findMany({ where: { id: { in: positionIds } } })
    : [];
  return [
    ...new Set([
      ...positions.map((position) => position.key as RoleKey),
      ...projectMembers.map((member) => member.positionKey as RoleKey)
    ])
  ];
}

function assertCanConfirm(
  businessType: ProjectAffiliateBusinessFactType,
  basisType: string,
  roleKeys: readonly RoleKey[]
) {
  if (businessType === "contract") {
    if (!roleKeys.includes("contract_director")) {
      throw new ForbiddenException("只有合同主管可以确认挂靠企业对下合同事实");
    }
    return;
  }
  if (businessType === "settlement") {
    if (!roleKeys.includes("budget_staff")) {
      throw new ForbiddenException("只有项目预算人员可以确认挂靠企业对下结算事实");
    }
    return;
  }
  const writtenAllowed =
    roleKeys.includes("finance_staff") || roleKeys.includes("finance_director");
  if (
    (basisType === "written" && !writtenAllowed) ||
    (basisType === "oral" && !roleKeys.includes("finance_director"))
  ) {
    throw new ForbiddenException(
      basisType === "oral"
        ? "口头通知的挂靠付款必须由财务主管确认"
        : "只有财务人员或财务主管可以确认书面挂靠付款事实"
    );
  }
}

function requireEvidenceRole(
  roleKeys: readonly RoleKey[],
  businessType: ProjectAffiliateBusinessFactType
): string {
  if (businessType === "contract") {
    if (roleKeys.includes("contract_director")) return "contract_director";
    if (roleKeys.includes("contract_staff")) return "contract_staff";
  } else if (businessType === "settlement") {
    if (roleKeys.includes("budget_staff")) return "budget_staff";
  } else {
    if (roleKeys.includes("finance_director")) return "finance_director";
    if (roleKeys.includes("finance_staff")) return "finance_staff";
  }
  throw new ForbiddenException("当前岗位不能为该挂靠外部事实补充依据");
}

function availableActions(
  businessType: ProjectAffiliateBusinessFactType,
  status: AffiliateFactStatus,
  basisType: string,
  roleKeys: readonly RoleKey[]
): AffiliateFactAction[] {
  const actions: AffiliateFactAction[] = [];
  const canSupplement =
    (businessType === "contract" &&
      (roleKeys.includes("contract_staff") || roleKeys.includes("contract_director"))) ||
    (businessType === "settlement" && roleKeys.includes("budget_staff")) ||
    (businessType === "payment" &&
      (roleKeys.includes("finance_staff") || roleKeys.includes("finance_director")));
  const canRecordAdjustment =
    (businessType === "contract" && roleKeys.includes("contract_staff")) ||
    (businessType === "settlement" && roleKeys.includes("budget_staff")) ||
    (businessType === "payment" &&
      (roleKeys.includes("finance_staff") || roleKeys.includes("finance_director")));
  if (canSupplement) actions.push("supplement_evidence");
  if (status === "pending_confirm") {
    try {
      assertCanConfirm(businessType, basisType, roleKeys);
      actions.unshift("confirm");
    } catch (error) {
      if (!(error instanceof ForbiddenException)) throw error;
    }
  } else if (canRecordAdjustment) {
    actions.push("record_correction", "record_reversal");
  }
  return actions;
}

function toContractReadModel(
  fact: AffiliateContractFactRow,
  roleKeys: readonly RoleKey[]
) {
  const actions = availableActions(
    "contract",
    fact.status as AffiliateFactStatus,
    fact.basisType,
    roleKeys
  );
  return {
    ...fact,
    amountCents: fact.amountCents === null ? null : moneyCentsToApi(fact.amountCents),
    advanceLimitCents:
      fact.advanceLimitCents === null ? null : moneyCentsToApi(fact.advanceLimitCents),
    availableActions:
      fact.entryKind === "original"
        ? actions
        : actions.filter(
            (action) =>
              action !== "record_correction" && action !== "record_reversal"
          )
  };
}

function toSettlementReadModel(
  fact: AffiliateSettlementFactRow,
  roleKeys: readonly RoleKey[]
) {
  const actions = availableActions(
    "settlement",
    fact.status as AffiliateFactStatus,
    fact.basisType,
    roleKeys
  );
  return {
    ...fact,
    amountCents: moneyCentsToApi(fact.amountCents),
    availableActions:
      fact.entryKind === "original"
        ? actions
        : actions.filter(
            (action) =>
              action !== "record_correction" && action !== "record_reversal"
          )
  };
}

function toPaymentReadModel(
  fact: AffiliatePaymentFactRow,
  roleKeys: readonly RoleKey[]
) {
  const actions = availableActions(
    "payment",
    fact.status as AffiliateFactStatus,
    fact.basisType,
    roleKeys
  );
  return {
    ...fact,
    amountCents: moneyCentsToApi(fact.amountCents),
    paymentSubjectType: "affiliate" as const,
    companyCashExecutionAllowed: false,
    availableActions:
      fact.entryKind === "original"
        ? actions
        : actions.filter(
            (action) =>
              action !== "record_correction" && action !== "record_reversal"
          )
  };
}

function readModelByType(
  businessType: ProjectAffiliateBusinessFactType,
  fact: AffiliateFactConfirmation,
  roleKeys: readonly RoleKey[]
) {
  if (businessType === "contract") {
    return toContractReadModel(fact as AffiliateContractFactRow, roleKeys);
  }
  if (businessType === "settlement") {
    return toSettlementReadModel(fact as AffiliateSettlementFactRow, roleKeys);
  }
  return toPaymentReadModel(fact as AffiliatePaymentFactRow, roleKeys);
}

function assertReplay(
  existing: {
    projectId: string;
    recordedByUserId: string;
    requestFingerprint: string;
  },
  projectId: string,
  actorUserId: string,
  requestFingerprint: string,
  label: string
) {
  if (
    existing.projectId !== projectId ||
    existing.recordedByUserId !== actorUserId ||
    existing.requestFingerprint !== requestFingerprint
  ) {
    throw new ConflictException(`${label}登记幂等键已用于不同请求`);
  }
}

function assertBasisEvidence(
  basisType: ProjectAffiliateBasisType,
  evidenceFileId: string | undefined,
  label: string
) {
  if (basisType === "written" && !evidenceFileId) {
    throw new BadRequestException(`书面依据的${label}必须上传依据文件`);
  }
}

function assertAdjustmentShape(
  entryKind: ProjectAffiliateEntryKind,
  adjustsFactId: string | undefined,
  label: string
) {
  if (entryKind === "original" && adjustsFactId) {
    throw new BadRequestException(`原始${label}不能关联被调整事实`);
  }
  if (entryKind !== "original" && !adjustsFactId) {
    throw new BadRequestException(`${label}更正或反向记录必须关联已确认原始事实`);
  }
}

function assertSameCounterparty(
  expected: string,
  actual: string,
  businessLabel: string
) {
  if (expected !== actual) {
    throw new BadRequestException(
      `${businessLabel}对象必须与挂靠企业对下合同相对方完全一致`
    );
  }
}

function normalizeContractType(value: unknown): ProjectAffiliateContractType {
  if (
    typeof value !== "string" ||
    !(PROJECT_AFFILIATE_CONTRACT_TYPES as readonly string[]).includes(value)
  ) {
    throw new BadRequestException("挂靠对下合同类型不正确");
  }
  return value as ProjectAffiliateContractType;
}

function normalizeAmountNature(value: unknown): ProjectAffiliateAmountNature {
  if (
    typeof value !== "string" ||
    !(PROJECT_AFFILIATE_AMOUNT_NATURES as readonly string[]).includes(value)
  ) {
    throw new BadRequestException("合同金额性质不正确");
  }
  return value as ProjectAffiliateAmountNature;
}

function normalizeBasisType(value: unknown): ProjectAffiliateBasisType {
  if (
    typeof value !== "string" ||
    !(PROJECT_AFFILIATE_BASIS_TYPES as readonly string[]).includes(value)
  ) {
    throw new BadRequestException("挂靠外部事实依据类型不正确");
  }
  return value as ProjectAffiliateBasisType;
}

function normalizeEntryKind(value: unknown): ProjectAffiliateEntryKind {
  if (
    typeof value !== "string" ||
    !(PROJECT_AFFILIATE_ENTRY_KINDS as readonly string[]).includes(value)
  ) {
    throw new BadRequestException("挂靠外部事实追加类型不正确");
  }
  return value as ProjectAffiliateEntryKind;
}

function normalizeEffectDirection(
  entryKind: ProjectAffiliateEntryKind,
  value: unknown
): EffectDirection {
  if (entryKind === "original") return "increase";
  if (entryKind === "reversal") return "decrease";
  if (value !== "increase" && value !== "decrease") {
    throw new BadRequestException("更正事实必须明确增加或减少方向");
  }
  return value;
}

function normalizePaymentKind(value: unknown): ProjectAffiliatePaymentKind {
  if (
    typeof value !== "string" ||
    !(PROJECT_AFFILIATE_PAYMENT_KINDS as readonly string[]).includes(value)
  ) {
    throw new BadRequestException("挂靠付款类型不正确");
  }
  return value as ProjectAffiliatePaymentKind;
}

function normalizeBusinessType(value: unknown): ProjectAffiliateBusinessFactType {
  if (
    typeof value !== "string" ||
    !(PROJECT_AFFILIATE_BUSINESS_FACT_TYPES as readonly string[]).includes(value)
  ) {
    throw new BadRequestException("挂靠外部事实类型不正确");
  }
  return value as ProjectAffiliateBusinessFactType;
}

function normalizePositiveMoney(value: unknown, message: string): bigint {
  const cents = parseMoneyCentsInput(value as string, "金额", message);
  if (cents <= 0n) throw new BadRequestException(message);
  return cents;
}

function parseDate(value: unknown, message: string): Date {
  if (typeof value !== "string" || !value.trim()) throw new BadRequestException(message);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new BadRequestException(message);
  return parsed;
}

function requiredTrimmed(value: unknown, message: string): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) throw new BadRequestException(message);
  return normalized;
}

function optionalTrimmed(value: unknown): string | undefined {
  return typeof value === "string" ? value.trim() || undefined : undefined;
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}
