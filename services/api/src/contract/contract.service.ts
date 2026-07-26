import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  approvalElapsedHours,
  canRemindApproval,
  suggestedContractSettlementMode,
  isContractSettlementMode,
  type RoleKey
} from "@jiangkong/shared-domain";
import { ApprovalDelegationService } from "../approval/approval-delegation.service";
import { ApprovalFormService } from "../approval/approval-form.service";
import { confirmApprovalSelfReview } from "../approval/approval-self-review";
import { activeApprovalDelegatorIds } from "../approval/active-approval-delegations";
import {
  isGovernedFrozenApprovalNode,
  resolveApprovalReviewIdentity,
  assertActiveApprovalRecipient
} from "../approval/approval-review-identity";
import { snapshotApprovalSignature } from "../approval/approval-signature-snapshot";
import { lockApprovalReviewRow } from "../approval/approval-review-lock";
import { AuditService } from "../audit/audit.service";
import { AuthService } from "../auth/auth.service";
import { ContractNumberingService } from "../contract-workbench/contract-numbering.service";
import { ContractReadinessService } from "../contract-workbench/contract-readiness.service";
import { lockBusinessTemplateVersion } from "../contract-template/contract-template-locks";
import { PrismaService } from "../database/prisma.service";
import { FileService } from "../file/file.service";
import {
  dbMoneyToBigInt,
  formatMoneyCentsAsYuan,
  parseMoneyCentsInput
} from "../money/decimal-money";
import { isWithinPostgresBigIntRange } from "../money/money-storage-range";
import { renderSimplePdf } from "../pdf/simple-pdf";
import { ConfirmContractArchiveDto } from "./dto/confirm-contract-archive.dto";
import { AssignContractApprovalDto } from "./dto/assign-contract-approval.dto";
import {
  CreateContractDraftDto,
  type CreatePaymentTermsStageDto
} from "./dto/create-contract.dto";
import { ReviewContractApprovalDto } from "./dto/review-contract-approval.dto";
import { GenerateContractPdfArchiveDto } from "./dto/generate-contract-pdf-archive.dto";
import { UploadContractArchiveFileDto } from "./dto/upload-contract-archive-file.dto";
import { CreateContractChangeDraftDto } from "./dto/create-contract-change-draft.dto";
import { AbandonContractDraftDto } from "./dto/abandon-contract-draft.dto";
import { CopyContractDraftDto } from "./dto/copy-contract-draft.dto";
import { assertContractChangeContentAllowed } from "./contract-change-policy";
import { evaluateContractIncreaseLimit } from "./contract-change-limit-policy";
import { resolveContractVersionRoot } from "./contract-version-root";
import {
  ContractApprovalRouteService,
  type FrozenNewContractApprovalNode
} from "./contract-approval-route.service";
import {
  ContractFormalFileService,
  ContractGovernanceDenial
} from "./contract-formal-file.service";
import { ContractAuthorizationService } from "./contract-authorization.service";
import { ContractSealService } from "./contract-seal.service";
import { ContractBillLineageService } from "../contract-bill/contract-bill-lineage.service";
import { ContractVersionActivationService } from "./contract-version-activation.service";

interface ContractApprovalAssignment {
  kind: "transfer" | "delegate";
  fromUserId: string;
  fromRoleKey: RoleKey;
  toUserId: string;
}

interface ContractApprovalNode {
  name: string;
  mode: "any";
  roleKeys: RoleKey[];
  approvedRoleKeys?: RoleKey[];
  assignments?: ContractApprovalAssignment[];
  candidateUserIds?: string[];
  candidateUserIdsByRole?: Partial<Record<RoleKey, string[]>>;
  selectedUserId?: string;
}

const CONTRACT_APPROVAL_NODES = [
  {
    name: "董事长/总经理",
    mode: "any",
    roleKeys: ["chairman", "general_manager"]
  }
] satisfies ContractApprovalNode[];

const ENHANCED_CONTRACT_CHANGE_APPROVAL_NODES = [
  { name: "合同部主管", mode: "any", roleKeys: ["contract_director"] },
  { name: "项目经理", mode: "any", roleKeys: ["project_manager"] },
  { name: "财务主管", mode: "any", roleKeys: ["finance_director"] },
  { name: "董事长/总经理", mode: "any", roleKeys: ["chairman", "general_manager"] }
] satisfies ContractApprovalNode[];

const DOWNSTREAM_CONTRACT_OCCUPANCY_STATUSES = [
  "in_approval",
  "approved_pending_seal",
  "in_seal",
  "seal_approved_pending_archive",
  "pending_archive_confirm",
  "effective"
] as const;
const PAYMENT_STAGE_TYPES = new Set(["advance", "progress", "final", "retention", "other"]);
const PAYMENT_STAGE_BASES = new Set([
  "contract_amount",
  "current_settlement",
  "cumulative_settlement",
  "fixed_amount",
  "manual_amount"
]);
const PAYMENT_STAGE_TRIGGER_ANCHORS = new Set([
  "contract_effective",
  "settlement_effective",
  "final_settlement_effective"
]);
const ADVANCE_DEDUCTION_MODES = new Set([
  "none",
  "per_settlement_ratio",
  "after_cumulative_settlement_ratio"
]);
const SETTLEMENT_CONTRACT_TYPES = new Set([
  "material_purchase",
  "equipment_rental",
  "labor_subcontract",
  "professional_subcontract"
]);

@Injectable()
export class ContractService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService = new AuditService(),
    @Optional()
    private readonly auth?: AuthService,
    @Optional()
    private readonly delegations?: ApprovalDelegationService,
    @Optional()
    private readonly files?: FileService,
    @Optional()
    private readonly approvalForms?: ApprovalFormService,
    @Optional()
    private readonly readiness?: ContractReadinessService,
    // Retained for constructor compatibility while legacy numbering administration
    // is still available for historic records; new contracts use daily numbering on save.
    @Optional()
    private readonly numbering?: ContractNumberingService,
    @Optional()
    private readonly approvalRoutes?: ContractApprovalRouteService,
    @Optional()
    private readonly formalFiles?: ContractFormalFileService,
    @Optional()
    private readonly authorizations?: ContractAuthorizationService,
    @Optional()
    private readonly seals?: ContractSealService,
    private readonly lineage: ContractBillLineageService = new ContractBillLineageService(),
    private readonly activation: ContractVersionActivationService = new ContractVersionActivationService()
  ) {}

  async createDraft(input: CreateContractDraftDto, actorUserId: string) {
    const normalizedPaymentStages = this.normalizePaymentStages(input.paymentStages);
    if (Boolean(input.businessScenarioId) !== Boolean(input.scenarioTemplateMappingId)) {
      throw new BadRequestException("业务场景与场景模板映射必须同时选择或同时留空");
    }
    return this.prisma.$transaction(async (tx) => {
      const [project] = await tx.$queryRaw<Array<{ id: string; isActive: boolean }>>(Prisma.sql`
        SELECT "id", "isActive" FROM "Project"
        WHERE "id" = ${input.projectId}
        FOR UPDATE
      `);
      if (!project?.isActive) {
        throw new BadRequestException("项目不存在或已停用，不能新建合同草稿");
      }
      const lockedTemplate = await lockBusinessTemplateVersion(
        tx,
        input.businessTemplateVersionId
      );
      const templateVersion = lockedTemplate?.version;

      if (!templateVersion) {
        throw new Error("未找到所选合同模板，请重新选择后再新建合同");
      }

      if (templateVersion.status !== "published") {
        throw new Error("所选合同模板尚未发布，不能用于新建合同");
      }
      const template = lockedTemplate.template;
      if (!template) {
        throw new Error("未找到合同模板主信息，请重新选择模板后重试");
      }
      if (template.contractTypeKey !== input.contractTypeKey) {
        throw new BadRequestException("所选模板与合同类型不一致，请重新选择匹配的模板");
      }

      let scenarioSnapshot: Prisma.InputJsonValue | undefined;
      if (input.businessScenarioId && input.scenarioTemplateMappingId) {
        const [scenario] = await tx.$queryRaw<
          Array<NonNullable<Awaited<ReturnType<typeof tx.contractBusinessScenario.findUnique>>>>
        >(Prisma.sql`
          SELECT * FROM "ContractBusinessScenario"
          WHERE "id" = ${input.businessScenarioId}
          FOR UPDATE
        `);
        const [mapping] = await tx.$queryRaw<
          Array<NonNullable<Awaited<ReturnType<typeof tx.contractScenarioTemplateMapping.findUnique>>>>
        >(Prisma.sql`
          SELECT * FROM "ContractScenarioTemplateMapping"
          WHERE "id" = ${input.scenarioTemplateMappingId}
          FOR UPDATE
        `);
        if (!scenario?.active || !mapping?.active) {
          throw new BadRequestException("所选业务场景或模板映射已停用，请重新选择");
        }
        if (
          mapping.businessScenarioId !== scenario.id ||
          mapping.contractTypeKey !== input.contractTypeKey ||
          mapping.businessTemplateVersionId !== templateVersion.id
        ) {
          throw new BadRequestException("所选业务场景、合同类型与模板版本不是同一精确映射");
        }
        scenarioSnapshot = {
          scenario: {
            id: scenario.id,
            code: scenario.code,
            name: scenario.name,
            description: scenario.description,
            revision: scenario.revision
          },
          mapping: {
            id: mapping.id,
            revision: mapping.revision,
            reason: mapping.reason,
            contractTypeKey: mapping.contractTypeKey,
            businessTemplateVersionId: mapping.businessTemplateVersionId
          }
        } as Prisma.InputJsonValue;
      }

      // 模板快照：将模板五类 schema 整体冻结到合同版本中。
      const templateSnapshot = {
        fieldSchema: templateVersion.fieldSchema,
        billSchema: templateVersion.billSchema,
        clauseSchema: templateVersion.clauseSchema,
        attachmentSchema: templateVersion.attachmentSchema,
        validationSchema: templateVersion.validationSchema,
        supplementChangePolicy: templateVersion.supplementChangePolicy
      };
      const suggestedSettlementMode = suggestedContractSettlementMode({
        contractTypeKey: input.contractTypeKey,
        hasBill: Array.isArray(templateVersion.billSchema) && templateVersion.billSchema.length > 0
      });
      const expectedProgressBasis = suggestedSettlementMode === "direct_payment"
        ? "contract_amount"
        : "current_settlement";
      if (normalizedPaymentStages.some((stage) =>
        stage.stageType === "progress" && stage.basis !== expectedProgressBasis
      )) {
        throw new BadRequestException(
          suggestedSettlementMode === "direct_payment"
            ? "系统建议按合同直接付款，普通付款阶段必须按合同金额计算"
            : "系统建议需要结算，普通付款阶段必须按当期结算计算"
        );
      }

      // 从 fieldSchema 中初始化 draftData（每个字段取 defaultValue，否则为 null）。
      const fields = (templateVersion.fieldSchema as Array<{ key: string; defaultValue?: unknown }>) ?? [];
      const draftData: Record<string, unknown> = {};
      for (const field of fields) {
        draftData[field.key] = field.defaultValue ?? null;
      }

      // clauseSnapshot 初始化为模板 clauseSchema 中的所有条款定义。
      const clauseSnapshot = (templateVersion.clauseSchema as unknown[]) ?? [];

      // 生成临时编号：草稿-YYYYMMDD-<8位数字>
      const now = new Date();
      const datePart = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
      const randomPart = Math.floor(Math.random() * 100_000_000).toString().padStart(8, "0");
      const temporaryCode = `草稿-${datePart}-${randomPart}`;

      const contract = await tx.contract.create({
        data: {
          projectId: input.projectId,
          contractTypeKey: input.contractTypeKey,
          ownerUserId: actorUserId,
          businessScenarioId: input.businessScenarioId ?? null,
          scenarioTemplateMappingId: input.scenarioTemplateMappingId ?? null,
          scenarioSnapshot,
          name: "",
          counterparty: "",
          code: null,
          temporaryCode
        }
      });

      const version = await tx.contractVersion.create({
        data: {
          contractId: contract.id,
          versionNo: 1,
          changeType: "original",
          status: "draft",
          taxFactStatus: "draft",
          contractGovernanceVersion: 1,
          amountCents: 0n,
          amountLimitType: input.amountLimitType ?? "capped",
          settlementMode: suggestedSettlementMode,
          settlementModeSource: "rule",
          businessTemplateVersionId: input.businessTemplateVersionId,
          draftData: draftData as never,
          templateSnapshot: templateSnapshot as never,
          clauseSnapshot: clauseSnapshot as never
        }
      });

      // 每个 bill 定义创建对应的 ContractBill，金额列保持默认 0。
      const bills = (templateVersion.billSchema as Array<{
        key: string;
        name: string;
        amountRole: string;
        pricingMode: string;
        quantityScale: number;
        unitPriceScale: number;
        columns: unknown[];
      }>) ?? [];

      if (bills.length > 0) {
        await tx.contractBill.createMany({
          data: bills.map((bill) => ({
            contractVersionId: version.id,
            billKey: bill.key,
            name: bill.name,
            amountRole: bill.amountRole,
            pricingMode: "tax_inclusive",
            quantityScale: 2,
            unitPriceScale: 2,
            schemaSnapshot: { columns: bill.columns } as never
          }))
        });
      }

      // 创建空的付款条款版本（无阶段），兼容后续审批流。
      const terms = await tx.paymentTermsVersion.create({
        data: {
          contractId: contract.id,
          contractVersionId: version.id,
          versionNo: 1,
          status: "draft",
          originalText: input.paymentTermsOriginalText?.trim() ?? ""
        }
      });
      const paymentStages = normalizedPaymentStages.map((stage) => ({
        ...stage,
        paymentTermsVersionId: terms.id
      }));
      if (paymentStages.length > 0) {
        await tx.paymentTermsStage.createMany({ data: paymentStages });
      }

      await this.audit.record(tx, {
        actorUserId,
        action: "contract.draft.create",
        businessType: "contract",
        businessId: contract.id,
        metadata: {
          temporaryCode,
          projectId: input.projectId,
          contractTypeKey: input.contractTypeKey,
          businessTemplateVersionId: input.businessTemplateVersionId,
          businessScenarioId: input.businessScenarioId ?? null,
          scenarioTemplateMappingId: input.scenarioTemplateMappingId ?? null
        }
      });

      return { contract, version: { ...version, amountCents: String(version.amountCents ?? 0n) }, terms };
    });
  }

  async copyAbandonedDraft(
    sourceVersionId: string,
    actorUserId: string,
    input: CopyContractDraftDto
  ) {
    return this.prisma.$transaction(async (tx) => {
      const [locked] = await tx.$queryRaw<Array<{
        id: string;
        contractId: string;
        status: string;
        changeType: string;
        versionNo: number;
        updatedAt: Date;
      }>>(Prisma.sql`
        SELECT "id", "contractId", "status", "changeType", "versionNo", "updatedAt"
        FROM "ContractVersion"
        WHERE "id" = ${sourceVersionId}
        FOR UPDATE
      `);
      if (!locked) throw new NotFoundException("未找到来源合同草稿");
      const sourceContract = await tx.contract.findUnique({ where: { id: locked.contractId } });
      if (!sourceContract || sourceContract.ownerUserId !== actorUserId) {
        throw new ForbiddenException("只能复制本人已放弃的合同草稿");
      }
      if (locked.status !== "abandoned") {
        throw new ConflictException("只有已放弃的合同草稿可以复制为新草稿");
      }
      if (locked.changeType !== "original" || locked.versionNo !== 1) {
        throw new ConflictException("合同变更不能复制为独立合同，请从当前有效合同发起新变更");
      }
      if (locked.updatedAt.toISOString() !== input.expectedUpdatedAt) {
        throw new ConflictException("来源合同草稿已变化，请刷新台账后重试");
      }
      const source = await tx.contractVersion.findUnique({ where: { id: sourceVersionId } });
      if (!source) throw new NotFoundException("未找到来源合同草稿");
      const project = await tx.project.findUnique({ where: { id: sourceContract.projectId } });
      if (!project?.isActive) throw new ConflictException("来源合同所属项目已停用，不能复制");

      const now = new Date();
      const datePart = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
      const randomPart = Math.floor(Math.random() * 100_000_000).toString().padStart(8, "0");
      const contract = await tx.contract.create({
        data: {
          projectId: sourceContract.projectId,
          source: "system",
          name: `${sourceContract.name || "未命名合同"}（副本）`,
          counterparty: sourceContract.counterparty,
          companyEntityId: sourceContract.companyEntityId,
          companyEntityName: sourceContract.companyEntityName,
          contractTypeKey: sourceContract.contractTypeKey,
          ownerUserId: actorUserId,
          businessScenarioId: sourceContract.businessScenarioId,
          scenarioTemplateMappingId: sourceContract.scenarioTemplateMappingId,
          scenarioSnapshot: sourceContract.scenarioSnapshot ?? undefined,
          temporaryCode: `草稿-${datePart}-${randomPart}`
        }
      });
      const version = await tx.contractVersion.create({
        data: {
          contractId: contract.id,
          versionNo: 1,
          changeType: "original",
          status: "draft",
          amountCents: source.amountCents,
          amountLimitType: source.amountLimitType,
          businessTemplateVersionId: source.businessTemplateVersionId,
          layoutTemplateVersionId: source.layoutTemplateVersionId,
          pricingNature: source.pricingNature,
          amountSource: source.amountSource,
          amountAdjustmentReason: source.amountAdjustmentReason,
          invoiceType: source.invoiceType,
          taxMode: source.taxMode,
          defaultTaxRatePercent: source.defaultTaxRatePercent,
          taxFactStatus: "draft",
          taxFactSource: source.taxFactSource,
          taxFactExplanation: source.taxFactExplanation,
          contractGovernanceVersion: 1,
          companyEntityIdSnapshot: source.companyEntityIdSnapshot,
          companyEntityVersionId: source.companyEntityVersionId,
          companyEntityNameSnapshot: source.companyEntityNameSnapshot,
          companyEntityCreditCodeSnapshot: source.companyEntityCreditCodeSnapshot,
          companyEntityRegisteredAddressSnapshot: source.companyEntityRegisteredAddressSnapshot,
          draftData: source.draftData as Prisma.InputJsonValue,
          templateSnapshot: source.templateSnapshot as Prisma.InputJsonValue,
          clauseSnapshot: source.clauseSnapshot as Prisma.InputJsonValue,
          copiedFromContractVersionId: source.id
        }
      });

      const [sourceTerms, sourceBills, sourceParties] = await Promise.all([
        tx.paymentTermsVersion.findFirst({ where: { contractVersionId: source.id }, orderBy: { versionNo: "desc" } }),
        tx.contractBill.findMany({ where: { contractVersionId: source.id }, orderBy: { createdAt: "asc" } }),
        tx.contractPartySnapshot.findMany({ where: { contractVersionId: source.id }, orderBy: { displayOrder: "asc" } })
      ]);
      if (sourceTerms) {
        const terms = await tx.paymentTermsVersion.create({
          data: { contractId: contract.id, contractVersionId: version.id, versionNo: 1, status: "draft", originalText: sourceTerms.originalText }
        });
        const stages = await tx.paymentTermsStage.findMany({ where: { paymentTermsVersionId: sourceTerms.id } });
        if (stages.length) await tx.paymentTermsStage.createMany({
          data: stages.map((stage) => ({
            paymentTermsVersionId: terms.id,
            name: stage.name,
            stageType: stage.stageType,
            basis: stage.basis,
            ratioBps: stage.ratioBps,
            fixedAmountCents: stage.fixedAmountCents,
            triggerAnchor: stage.triggerAnchor,
            triggerEvent: stage.triggerEvent,
            dueDays: stage.dueDays,
            advanceDeductionMode: stage.advanceDeductionMode,
            advanceDeductionRatioBps: stage.advanceDeductionRatioBps,
            advanceDeductionStartRatioBps: stage.advanceDeductionStartRatioBps,
            requiresInvoice: stage.requiresInvoice,
            allowsEarlyPayment: stage.allowsEarlyPayment,
            allowsInstallments: stage.allowsInstallments,
            retentionBps: stage.retentionBps,
            originalText: stage.originalText
          }))
        });
      }
      for (const sourceBill of sourceBills) {
        const bill = await tx.contractBill.create({
          data: {
            contractVersionId: version.id,
            billKey: sourceBill.billKey,
            name: sourceBill.name,
            amountRole: sourceBill.amountRole,
            pricingMode: sourceBill.pricingMode,
            quantityScale: sourceBill.quantityScale,
            unitPriceScale: sourceBill.unitPriceScale,
            schemaSnapshot: sourceBill.schemaSnapshot as Prisma.InputJsonValue,
            revision: 1,
            taxInclusiveAmountCents: sourceBill.taxInclusiveAmountCents,
            taxExclusiveAmountCents: sourceBill.taxExclusiveAmountCents,
            taxAmountCents: sourceBill.taxAmountCents
          }
        });
        const rows = await tx.contractBillRow.findMany({ where: { contractBillId: sourceBill.id }, orderBy: { sortOrder: "asc" } });
        if (rows.length) await tx.contractBillRow.createMany({
          data: rows.map((row) => ({
            contractBillId: bill.id,
            rowKey: row.rowKey,
            sortOrder: row.sortOrder,
            itemCode: row.itemCode,
            itemName: row.itemName,
            specification: row.specification,
            unit: row.unit,
            quantity: row.quantity,
            unitPrice: row.unitPrice,
            taxRate: row.taxRate,
            taxRateSource: row.taxRateSource,
            pricingFactStatus: row.pricingFactStatus,
            precisionPolicy: row.precisionPolicy,
            taxInclusiveAmountCents: row.taxInclusiveAmountCents,
            taxExclusiveAmountCents: row.taxExclusiveAmountCents,
            taxAmountCents: row.taxAmountCents,
            isProvisional: row.isProvisional,
            settlementBasis: row.settlementBasis,
            customData: row.customData as Prisma.InputJsonValue
          }))
        });
        const targets = await tx.contractBillRow.findMany({
          where: { contractBillId: bill.id },
          orderBy: [{ sortOrder: "asc" }, { id: "asc" }]
        });
        const targetByKey = new Map(targets.map((row) => [row.rowKey, row]));
        for (const source of rows) {
          await this.lineage.cloneOneToOne(tx, {
            contractId: contract.id,
            fromContractVersionId: sourceBill.contractVersionId,
            toContractVersionId: version.id,
            source,
            target: targetByKey.get(source.rowKey)!,
            actorUserId
          });
        }
      }
      if (sourceParties.length) await tx.contractPartySnapshot.createMany({
        data: sourceParties.map((party) => ({
          contractVersionId: version.id,
          roleKey: party.roleKey,
          displayOrder: party.displayOrder,
          businessPartyVersionId: party.businessPartyVersionId,
          snapshot: party.snapshot as Prisma.InputJsonValue
        }))
      });
      await this.audit.record(tx, {
        actorUserId,
        action: "contract.draft.copy",
        businessType: "contract",
        businessId: contract.id,
        metadata: { copiedFromContractVersionId: source.id, projectId: contract.projectId }
      });
      return { contract, version: { ...version, amountCents: String(version.amountCents) } };
    });
  }

  async createChangeDraft(
    effectiveVersionId: string,
    input: CreateContractChangeDraftDto,
    actorUserId: string
  ) {
    if (input.changeType !== "change") {
      throw new BadRequestException("新建流程仅支持合同变更；历史补充协议仅保留只读查看");
    }
    const reason = input.changeReason?.trim();
    if (!reason) throw new BadRequestException("合同变更必须填写变更原因");
    if (!new Set(["increase", "decrease", "unchanged"]).has(input.changeDirection)) {
      throw new BadRequestException("合同变更方向不在支持范围内");
    }
    const changeAmountCents = parseMoneyCentsInput(
      input.changeAmountCents,
      "变更金额",
      "变更金额必须是大于等于 0 的整数"
    );
    if (input.changeDirection === "unchanged" && changeAmountCents !== 0n) {
      throw new BadRequestException("金额不变的合同变更，其变更金额必须为 0");
    }
    if (input.changeDirection !== "unchanged" && changeAmountCents <= 0n) {
      throw new BadRequestException("合同增减金额必须大于 0");
    }
    return this.prisma.$transaction(async (tx) => {
      const target = await tx.contractVersion.findUnique({ where: { id: effectiveVersionId } });
      if (!target) throw new BadRequestException("未找到要变更的已生效合同版本");
      const [contract] = await tx.$queryRaw<
        Array<NonNullable<Awaited<ReturnType<typeof tx.contract.findUnique>>>>
      >(Prisma.sql`SELECT * FROM "Contract" WHERE "id" = ${target.contractId} FOR UPDATE`);
      if (!contract || contract.voidedAt) {
        throw new BadRequestException("合同不存在或已作废，不能发起变更");
      }
      if (contract.ownerUserId && contract.ownerUserId !== actorUserId) {
        throw new BadRequestException("只有合同经办人可以发起合同变更");
      }
      const latest = await tx.contractVersion.findFirst({
        where: { contractId: contract.id, status: "effective" },
        orderBy: { versionNo: "desc" }
      });
      if (!latest || latest.id !== effectiveVersionId) {
        throw new BadRequestException("只能从当前最新生效合同版本发起变更");
      }
      const latestVersion = await tx.contractVersion.findFirst({
        where: { contractId: contract.id },
        orderBy: { versionNo: "desc" },
        select: { versionNo: true }
      });
      const activeChange = await tx.contractVersion.findFirst({
        where: {
          contractId: contract.id,
          changeType: { not: "original" },
          status: {
            in: [
              "draft", "in_approval", "approval_rejected", "approved_pending_seal",
              "in_seal", "seal_approved_pending_archive", "pending_archive_confirm"
            ]
          }
        },
        select: { id: true }
      });
      if (activeChange) throw new BadRequestException("当前生效版本已有进行中的合同变更");

      const lineage = await tx.contractVersion.findMany({
        where: { contractId: contract.id },
        orderBy: { versionNo: "asc" }
      });
      const rootResolution = resolveContractVersionRoot(lineage);
      if (!rootResolution.ok) throw new BadRequestException(rootResolution.reason);
      const root = rootResolution.root;
      const originalBaseAmountCents = root.changeType === "historical_takeover"
        ? root.originalBaseAmountCents
        : root.amountCents;
      const unlimitedFramework = latest.pricingNature === "framework" &&
        latest.amountLimitType === "unlimited";
      if (root.changeType === "historical_takeover" && originalBaseAmountCents === null) {
        throw new BadRequestException(
          "历史合同尚未确认历史变更基线，请先由合同部主管补录后再发起合同变更"
        );
      }
      const historicalPositiveIncreaseCents =
        (root.changeType === "historical_takeover" ? root.cumulativeIncreaseCents : 0n) +
        lineage.reduce((sum, item) =>
          item.baseVersionId !== null &&
          (item.changeType === "change" || item.changeType === "supplement") &&
          (item.status === "effective" || item.status === "superseded") &&
          item.effectiveAt !== null &&
          item.changeDirection === "increase" &&
          (item.changeAmountCents ?? 0n) > 0n
            ? sum + item.changeAmountCents!
            : sum, 0n);

      const [parties, bills, sourceTerms] = await Promise.all([
        tx.contractPartySnapshot.findMany({
          where: { contractVersionId: latest.id },
          orderBy: [{ roleKey: "asc" }, { displayOrder: "asc" }]
        }),
        tx.contractBill.findMany({ where: { contractVersionId: latest.id } }),
        tx.paymentTermsVersion.findFirst({
          where: { contractVersionId: latest.id },
          orderBy: { versionNo: "desc" }
        })
      ]);
      const preparedSource = this.prepareChangeDraftSource({
        contract,
        latest,
        parties,
        bills,
        sourceTerms
      });
      if (!preparedSource.ok) {
        throw new BadRequestException(preparedSource.reason);
      }

      const amountLimitType = latest.amountLimitType;
      const nextAmountCents = input.changeDirection === "increase"
        ? latest.amountCents + changeAmountCents
        : input.changeDirection === "decrease"
          ? latest.amountCents - changeAmountCents
          : latest.amountCents;
      if (nextAmountCents < 0n) throw new BadRequestException("合同减项金额不能超过当前合同金额");
      const baseVersionId = latest.id;
      const cumulativeIncreaseCents = historicalPositiveIncreaseCents +
        (input.changeDirection === "increase" ? changeAmountCents : 0n);
      const cumulativeDecreaseCents = latest.cumulativeDecreaseCents +
        (input.changeDirection === "decrease" ? changeAmountCents : 0n);
      if (
        !isWithinPostgresBigIntRange(nextAmountCents) ||
        !isWithinPostgresBigIntRange(cumulativeIncreaseCents) ||
        !isWithinPostgresBigIntRange(cumulativeDecreaseCents)
      ) {
        throw new BadRequestException("合同变更金额累计后超出系统可保存范围");
      }
      const nextVersionNo = (latestVersion?.versionNo ?? latest.versionNo) + 1;

      const version = await tx.contractVersion.create({
        data: {
          contractId: contract.id,
          versionNo: nextVersionNo,
          changeType: input.changeType,
          status: "draft",
          amountCents: nextAmountCents,
          baseVersionId,
          supersedesVersionId: null,
          changeReason: reason,
          changeDirection: input.changeDirection,
          changeAmountCents,
          originalBaseAmountCents: unlimitedFramework
            ? originalBaseAmountCents ?? 0n
            : originalBaseAmountCents,
          cumulativeIncreaseCents,
          cumulativeDecreaseCents,
          amountLimitType,
          settlementMode: latest.settlementMode,
          settlementModeSource: latest.settlementMode === null
            ? null
            : "inherited",
          settlementModeConfirmedByUserId: latest.settlementModeConfirmedByUserId,
          settlementModeConfirmedAt: latest.settlementModeConfirmedAt,
          businessTemplateVersionId: latest.businessTemplateVersionId,
          layoutTemplateVersionId: latest.layoutTemplateVersionId,
          pricingNature: latest.pricingNature,
          amountSource: latest.amountSource,
          amountAdjustmentReason: latest.amountAdjustmentReason,
          invoiceType: latest.invoiceType,
          taxMode: latest.taxMode,
          defaultTaxRatePercent: latest.defaultTaxRatePercent,
          taxFactStatus: "draft",
          contractGovernanceVersion: 1,
          taxFactSource: latest.taxFactSource,
          taxFactExplanation: latest.taxFactExplanation,
          taxFactEvidenceFileId: latest.taxFactEvidenceFileId,
          taxFactRevision: latest.taxFactRevision,
          taxFactsFrozenAt: null,
          companyEntityIdSnapshot: latest.companyEntityIdSnapshot,
          companyEntityVersionId: latest.companyEntityVersionId,
          companyEntityNameSnapshot: latest.companyEntityNameSnapshot,
          companyEntityCreditCodeSnapshot: latest.companyEntityCreditCodeSnapshot,
          companyEntityRegisteredAddressSnapshot:
            latest.companyEntityRegisteredAddressSnapshot,
          draftData: preparedSource.templateSnapshotSynthesized
            ? { historicalTakeover: true }
            : latest.draftData as Prisma.InputJsonValue,
          templateSnapshot: preparedSource.templateSnapshot,
          clauseSnapshot: preparedSource.templateSnapshotSynthesized
            ? []
            : latest.clauseSnapshot as Prisma.InputJsonValue
        }
      });

      if (preparedSource.parties.length) {
        await tx.contractPartySnapshot.createMany({
          data: preparedSource.parties.map((party) => ({
            contractVersionId: version.id,
            roleKey: party.roleKey,
            displayOrder: party.displayOrder,
            businessPartyVersionId: party.businessPartyVersionId,
            snapshot: party.snapshot as Prisma.InputJsonValue
          }))
        });
      }

      for (const bill of bills) {
        const clonedBill = await tx.contractBill.create({
          data: {
            contractVersionId: version.id,
            billKey: bill.billKey,
            name: bill.name,
            amountRole: bill.amountRole,
            pricingMode: bill.pricingMode,
            quantityScale: bill.quantityScale,
            unitPriceScale: bill.unitPriceScale,
            schemaSnapshot: bill.schemaSnapshot as Prisma.InputJsonValue,
            sourceExcelFileId: null,
            revision: bill.revision,
            taxInclusiveAmountCents: bill.taxInclusiveAmountCents,
            taxExclusiveAmountCents: bill.taxExclusiveAmountCents,
            taxAmountCents: bill.taxAmountCents
          }
        });
        const rows = await tx.contractBillRow.findMany({
          where: { contractBillId: bill.id },
          orderBy: [{ sortOrder: "asc" }, { id: "asc" }]
        });
        if (rows.length) {
          await tx.contractBillRow.createMany({
            data: rows.map((row) => ({
              contractBillId: clonedBill.id,
              rowKey: row.rowKey,
              sortOrder: row.sortOrder,
              itemCode: row.itemCode,
              itemName: row.itemName,
              specification: row.specification,
              unit: row.unit,
              quantity: row.quantity,
              unitPrice: row.unitPrice,
              taxRate: row.taxRate,
              taxRateSource: row.taxRateSource,
              pricingFactStatus: row.pricingFactStatus,
              precisionPolicy: row.precisionPolicy,
              taxInclusiveAmountCents: row.taxInclusiveAmountCents,
              taxExclusiveAmountCents: row.taxExclusiveAmountCents,
              taxAmountCents: row.taxAmountCents,
              isProvisional: row.isProvisional,
              settlementBasis: row.settlementBasis,
              customData: row.customData as Prisma.InputJsonValue
            }))
          });
          const targets = await tx.contractBillRow.findMany({
            where: { contractBillId: clonedBill.id },
            orderBy: [{ sortOrder: "asc" }, { id: "asc" }]
          });
          const targetByKey = new Map(targets.map((row) => [row.rowKey, row]));
          for (const source of rows) {
            await this.lineage.cloneOneToOne(tx, {
              contractId: contract.id,
              fromContractVersionId: bill.contractVersionId,
              toContractVersionId: version.id,
              source,
              target: targetByKey.get(source.rowKey)!,
              actorUserId
            });
          }
        }
      }

      if (sourceTerms) {
        const terms = await tx.paymentTermsVersion.create({
          data: {
            contractId: contract.id,
            contractVersionId: version.id,
            versionNo: nextVersionNo,
            status: "draft",
            originalText: sourceTerms.originalText
          }
        });
        const stages = await tx.paymentTermsStage.findMany({
          where: { paymentTermsVersionId: sourceTerms.id },
          orderBy: { createdAt: "asc" }
        });
        if (stages.length) {
          await tx.paymentTermsStage.createMany({
            data: stages.map((stage) => ({
              paymentTermsVersionId: terms.id,
              name: stage.name,
              stageType: stage.stageType,
              basis: stage.basis,
              ratioBps: stage.ratioBps,
              fixedAmountCents: stage.fixedAmountCents,
              triggerAnchor: stage.triggerAnchor,
              triggerEvent: stage.triggerEvent,
              dueDays: stage.dueDays,
              advanceDeductionMode: stage.advanceDeductionMode,
              advanceDeductionRatioBps: stage.advanceDeductionRatioBps,
              advanceDeductionStartRatioBps: stage.advanceDeductionStartRatioBps,
              requiresInvoice: stage.requiresInvoice,
              allowsEarlyPayment: stage.allowsEarlyPayment,
              allowsInstallments: stage.allowsInstallments,
              retentionBps: stage.retentionBps,
              originalText: stage.originalText
            }))
          });
        }
      }

      await this.audit.record(tx, {
        actorUserId,
        action: "contract.change_draft.create",
        businessType: "contract_version",
        businessId: version.id,
        metadata: {
          contractId: contract.id,
          baseVersionId,
          changeDirection: input.changeDirection,
          changeAmountCents: changeAmountCents.toString(),
          contractCode: contract.code,
          sourceType: preparedSource.sourceType,
          historicalFactsSynthesized: preparedSource.historicalFactsSynthesized
        }
      });
      return this.changeVersionProjection(version);
    });
  }

  async abandonDraft(
    contractVersionId: string,
    actorUserId: string,
    input: AbandonContractDraftDto
  ) {
    const reason = input.reason?.trim() ?? "";
    if (input.action === "abandon_application" && !reason) {
      throw new BadRequestException("放弃合同申请必须填写原因");
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const [locked] = await tx.$queryRaw<Array<{
          id: string;
          contractId: string;
          versionNo: number;
          changeType: string;
          status: string;
          draftRevision: number;
          abandonedAt: Date | null;
          abandonedByUserId: string | null;
          abandonReason: string | null;
          ownerUserId: string | null;
        }>>(Prisma.sql`
          SELECT
            v."id", v."contractId", v."versionNo", v."changeType", v."status",
            v."draftRevision", v."abandonedAt", v."abandonedByUserId", v."abandonReason",
            c."ownerUserId"
          FROM "Contract" c
          JOIN "ContractVersion" v ON v."contractId" = c."id"
          WHERE v."id" = ${contractVersionId}
          FOR UPDATE OF c, v
        `);
        if (!locked) {
          throw new NotFoundException("未找到合同草稿，请刷新合同工作台后重试");
        }
        if (locked.ownerUserId !== actorUserId) {
          throw new ForbiddenException("只有当前合同经办人可以删除草稿或放弃申请");
        }
        if (locked.abandonedAt || locked.status === "abandoned") {
          const terminalAction = locked.abandonReason
            ? "abandon_application"
            : "delete_pristine_draft";
          return {
            contractVersionId: locked.id,
            status: "abandoned",
            lifecycleKind: terminalAction === "delete_pristine_draft"
              ? "pristine_draft"
              : "approval_draft",
            action: terminalAction,
            abandonedAt: locked.abandonedAt,
            abandonedByUserId: locked.abandonedByUserId,
            reason: locked.abandonReason,
            idempotent: true
          };
        }
        if (!new Set(["draft", "approval_rejected"]).has(locked.status)) {
          throw new ConflictException("合同状态已变化，请刷新页面后按当前状态处理");
        }
        if (locked.draftRevision !== input.expectedRevision) {
          throw new ConflictException("合同草稿已被更新，请刷新后再处理");
        }

        // 固定读取顺序：审批 -> 正式文件 -> 授权 -> 用章/归档 -> 下游业务。
        const approvalInstances = await tx.approvalInstance.findMany({
          where: { businessType: "contract_version", businessId: locked.id },
          orderBy: { createdAt: "asc" },
          select: { id: true }
        });
        const approvalActionCount = approvalInstances.length
          ? await tx.approvalActionLog.count({
              where: { approvalInstanceId: { in: approvalInstances.map((item) => item.id) } }
            })
          : 0;
        const formalFileCount = await tx.contractFormalFile.count({
          where: { contractVersionId: locked.id }
        });
        const authorizationCount = await tx.contractAuthorization.count({
          where: { originContractVersionId: locked.id }
        });
        const authorizationLinkCount = await tx.contractVersionAuthorizationLink.count({
          where: { contractVersionId: locked.id, authorizationId: { not: null } }
        });
        const sealTaskCount = await tx.contractSealTask.count({
          where: { contractVersionId: locked.id }
        });
        const archiveFileCount = await tx.contractArchiveFile.count({
          where: { contractVersionId: locked.id }
        });
        const settlementCount = await tx.settlement.count({
          where: { contractVersionId: locked.id }
        });
        const paymentRequestCount = await tx.paymentRequest.count({
          where: { contractVersionId: locked.id }
        });

        const blockers = [
          ...(locked.changeType !== "original" || locked.versionNo !== 1 ? ["合同变更或派生版本"] : []),
          ...(locked.status !== "draft" ? ["合同曾进入审批"] : []),
          ...(approvalInstances.length || approvalActionCount ? ["存在审批记录"] : []),
          ...(formalFileCount ? ["存在正式合同文件"] : []),
          ...(authorizationCount || authorizationLinkCount ? ["存在授权委托书"] : []),
          ...(sealTaskCount ? ["存在用印记录"] : []),
          ...(archiveFileCount ? ["存在归档记录"] : []),
          ...(settlementCount ? ["存在关联结算"] : []),
          ...(paymentRequestCount ? ["存在关联付款"] : [])
        ];
        const expectedAction = blockers.length === 0
          ? "delete_pristine_draft"
          : "abandon_application";
        if (input.action !== expectedAction) {
          throw new ConflictException(
            expectedAction === "delete_pristine_draft"
              ? "当前合同仍是纯净草稿，请刷新后使用“删除草稿”"
              : `当前合同已留下业务记录，只能放弃申请：${blockers.join("、")}`
          );
        }

        const now = new Date();
        const updated = await tx.contractVersion.updateMany({
          where: {
            id: locked.id,
            status: locked.status,
            draftRevision: input.expectedRevision,
            abandonedAt: null
          },
          data: {
            status: "abandoned",
            abandonedAt: now,
            abandonedByUserId: actorUserId,
            abandonReason: expectedAction === "abandon_application" ? reason : null,
            draftRevision: { increment: 1 }
          }
        });
        if (updated.count !== 1) {
          throw new ConflictException("合同草稿已被其他操作更新，请刷新后重试");
        }

        await tx.contractGeneratedDocument.updateMany({
          where: { contractVersionId: locked.id, status: { in: ["queued", "processing"] } },
          data: { status: "stale", completedAt: now, errorMessage: null }
        });
        await tx.contractFormalFile.updateMany({
          where: { contractVersionId: locked.id, status: "active" },
          data: {
            status: "invalidated",
            invalidatedAt: now,
            invalidationReason: "合同申请已放弃，文件作为历史证据保留"
          }
        });
        await tx.contractAuthorization.updateMany({
          where: { originContractVersionId: locked.id, status: "active" },
          data: {
            status: "invalidated",
            invalidatedAt: now,
            invalidationReason: "合同申请已放弃，授权文件作为历史证据保留"
          }
        });

        await this.audit.record(tx, {
          actorUserId,
          action: expectedAction === "delete_pristine_draft"
            ? "contract.draft.delete"
            : "contract.application.abandon",
          businessType: "contract_version",
          businessId: locked.id,
          metadata: {
            lifecycleKind: expectedAction === "delete_pristine_draft"
              ? "pristine_draft"
              : "approval_draft",
            previousStatus: locked.status,
            blockers,
            reason: expectedAction === "abandon_application" ? reason : null
          }
        });

        return {
          contractVersionId: locked.id,
          status: "abandoned",
          lifecycleKind: expectedAction === "delete_pristine_draft"
            ? "pristine_draft"
            : "approval_draft",
          action: expectedAction,
          abandonedAt: now,
          abandonedByUserId: actorUserId,
          reason: expectedAction === "abandon_application" ? reason : null,
          blockers,
          idempotent: false
        };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof ConflictException ||
          error instanceof ForbiddenException || error instanceof NotFoundException) {
        throw error;
      }
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
        throw new ConflictException("合同草稿正在被其他操作处理，请刷新后重试");
      }
      throw error;
    }
  }

  private prepareChangeDraftSource(input: {
    contract: {
      source: string;
      contractTypeKey: string | null;
      companyEntityName: string | null;
      counterparty: string;
    };
    latest: {
      templateSnapshot: Prisma.JsonValue;
      companyEntityIdSnapshot: string | null;
      companyEntityVersionId: string | null;
      companyEntityNameSnapshot: string | null;
      companyEntityCreditCodeSnapshot: string | null;
    };
    parties: Array<{
      roleKey: string;
      displayOrder: number;
      businessPartyVersionId: string | null;
      snapshot: Prisma.JsonValue;
    }>;
    bills: Array<{
      billKey: string;
      name: string;
      amountRole: string;
      pricingMode: string;
      quantityScale: number;
      unitPriceScale: number;
      schemaSnapshot: Prisma.JsonValue;
    }>;
    sourceTerms: { id: string } | null;
  }) {
    const sourceType = input.contract.source === "historical_takeover"
      ? "historical_takeover"
      : "system";
    if (!input.contract.contractTypeKey?.trim()) {
      return {
        ok: false as const,
        reason: sourceType === "historical_takeover"
          ? "历史接管合同缺少合同类型，需先完成历史事实补齐后再发起合同变更"
          : "当前生效合同缺少合同类型，不能发起合同变更"
      };
    }
    if (!input.sourceTerms) {
      return { ok: false as const, reason: "当前生效合同缺少付款条款快照，不能发起合同变更" };
    }

    let historicalFactsSynthesized = false;
    let templateSnapshotSynthesized = false;
    let templateSnapshot = this.sanitizedTemplateSnapshot(input.latest.templateSnapshot);
    if (!templateSnapshot) {
      if (sourceType !== "historical_takeover") {
        return {
          ok: false as const,
          reason: "当前生效合同的模板快照不完整，不能发起合同变更"
        };
      }
      templateSnapshot = this.historicalTemplateSnapshot(input.bills);
      historicalFactsSynthesized = true;
      templateSnapshotSynthesized = true;
    }

    const parties = input.parties.flatMap((party) => {
      const snapshot = this.sanitizedPartySnapshot(party.snapshot);
      return snapshot ? [{ ...party, snapshot }] : [];
    });
    const requiredPartyNames = {
      party_a: input.contract.companyEntityName?.trim() ?? "",
      party_b: input.contract.counterparty?.trim() ?? ""
    };
    const hasCompleteFrozenCompany = [
      input.latest.companyEntityIdSnapshot,
      input.latest.companyEntityVersionId,
      input.latest.companyEntityNameSnapshot,
      input.latest.companyEntityCreditCodeSnapshot
    ].every((value) => typeof value === "string" && value.trim().length > 0);
    for (const [roleKey, name] of Object.entries(requiredPartyNames)) {
      if (roleKey === "party_a" && hasCompleteFrozenCompany) continue;
      if (parties.some((party) => party.roleKey === roleKey)) continue;
      if (sourceType !== "historical_takeover") {
        return {
          ok: false as const,
          reason: "当前生效合同缺少完整签约主体快照，不能发起合同变更"
        };
      }
      if (!name) {
        return {
          ok: false as const,
          reason: `历史接管合同缺少已确认的${roleKey === "party_a" ? "甲方" : "乙方"}名称，需先完成历史事实补齐后再发起合同变更`
        };
      }
      parties.push({
        roleKey,
        displayOrder: 1,
        businessPartyVersionId: null,
        snapshot: { name, attachments: [] }
      });
      historicalFactsSynthesized = true;
    }

    return {
      ok: true as const,
      sourceType,
      historicalFactsSynthesized,
      templateSnapshotSynthesized,
      templateSnapshot,
      parties
    };
  }

  private sanitizedTemplateSnapshot(value: Prisma.JsonValue): Prisma.InputJsonValue | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const snapshot = value as Prisma.JsonObject;
    if (
      !Array.isArray(snapshot.fieldSchema) ||
      !Array.isArray(snapshot.billSchema) ||
      !Array.isArray(snapshot.clauseSchema) ||
      !Array.isArray(snapshot.attachmentSchema) ||
      !Array.isArray(snapshot.validationSchema)
    ) {
      return null;
    }
    const policy = snapshot.supplementChangePolicy;
    const safePolicy = policy && typeof policy === "object" && !Array.isArray(policy)
      ? policy as Prisma.JsonObject
      : null;
    return {
      fieldSchema: this.stripPrivateFileReferences(snapshot.fieldSchema),
      billSchema: this.stripPrivateFileReferences(snapshot.billSchema),
      clauseSchema: this.stripPrivateFileReferences(snapshot.clauseSchema),
      attachmentSchema: this.stripPrivateFileReferences(snapshot.attachmentSchema),
      validationSchema: this.stripPrivateFileReferences(snapshot.validationSchema),
      ...(safePolicy &&
      safePolicy.version === 1 &&
      Array.isArray(safePolicy.editableFieldKeys) &&
      Array.isArray(safePolicy.editableClauseKeys) &&
      Array.isArray(safePolicy.coreClauseKeys)
        ? {
            supplementChangePolicy: {
              version: 1,
              editableFieldKeys: safePolicy.editableFieldKeys.filter(
                (key): key is string => typeof key === "string"
              ),
              editableClauseKeys: safePolicy.editableClauseKeys.filter(
                (key): key is string => typeof key === "string"
              ),
              coreClauseKeys: safePolicy.coreClauseKeys.filter(
                (key): key is string => typeof key === "string"
              )
            }
          }
        : {})
    } as Prisma.InputJsonValue;
  }

  private historicalTemplateSnapshot(
    bills: Array<{
      billKey: string;
      name: string;
      amountRole: string;
      pricingMode: string;
      quantityScale: number;
      unitPriceScale: number;
      schemaSnapshot: Prisma.JsonValue;
    }>
  ): Prisma.InputJsonValue {
    return {
      fieldSchema: [],
      billSchema: bills.map((bill) => {
        const schema = bill.schemaSnapshot &&
          typeof bill.schemaSnapshot === "object" &&
          !Array.isArray(bill.schemaSnapshot)
          ? bill.schemaSnapshot as Prisma.JsonObject
          : {};
        const columns = Array.isArray(schema.columns)
          ? schema.columns.flatMap((column) => {
              if (!column || typeof column !== "object" || Array.isArray(column)) return [];
              const item = column as Prisma.JsonObject;
              if (
                typeof item.key !== "string" ||
                typeof item.label !== "string" ||
                !["text", "number", "boolean"].includes(String(item.type))
              ) {
                return [];
              }
              return [{
                key: item.key,
                label: item.label,
                type: item.type as string,
                ...(typeof item.required === "boolean" ? { required: item.required } : {})
              }];
            })
          : [];
        return {
          key: bill.billKey,
          name: bill.name,
          amountRole: bill.amountRole,
          pricingMode: bill.pricingMode,
          quantityScale: bill.quantityScale,
          unitPriceScale: bill.unitPriceScale,
          columns
        };
      }),
      clauseSchema: [],
      attachmentSchema: [],
      validationSchema: []
    } as Prisma.InputJsonValue;
  }

  private sanitizedPartySnapshot(value: Prisma.JsonValue): Prisma.InputJsonValue | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const snapshot = value as Prisma.JsonObject;
    if (typeof snapshot.name !== "string" || !snapshot.name.trim()) return null;
    const optionalText = (key: string) =>
      typeof snapshot[key] === "string" && snapshot[key].trim()
        ? { [key]: snapshot[key].trim() }
        : {};
    return {
      name: snapshot.name.trim(),
      ...optionalText("unifiedSocialCreditCode"),
      ...optionalText("legalRepresentative"),
      ...optionalText("address"),
      ...optionalText("contactName"),
      ...optionalText("contactPhone"),
      attachments: []
    };
  }

  private stripPrivateFileReferences(value: Prisma.JsonValue): Prisma.JsonValue {
    if (Array.isArray(value)) {
      return value.map((item) => this.stripPrivateFileReferences(item));
    }
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value)
          .filter(([key, item]) =>
            item !== undefined &&
            key !== "submissionSnapshot" &&
            key !== "internalReviewDocument" &&
            !/fileIds?$/i.test(key)
          )
          .map(([key, item]) => [
            key,
            this.stripPrivateFileReferences(item as Prisma.JsonValue)
          ])
      );
    }
    return value;
  }

  async changeEligibility(effectiveVersionId: string) {
    const target = await this.prisma.contractVersion.findUnique({
      where: { id: effectiveVersionId },
      select: { id: true, contractId: true }
    });
    if (!target) throw new BadRequestException("未找到合同版本，请刷新后重试");
    const [currentEffective, activeChange] = await Promise.all([
      this.prisma.contractVersion.findFirst({
        where: { contractId: target.contractId, status: "effective" },
        orderBy: { versionNo: "desc" }
      }),
      this.prisma.contractVersion.findFirst({
        where: {
          contractId: target.contractId,
          changeType: { not: "original" },
          status: {
            in: [
              "draft", "in_approval", "approval_rejected", "approved_pending_seal",
              "in_seal", "seal_approved_pending_archive", "pending_archive_confirm"
            ]
          }
        },
        orderBy: { versionNo: "desc" }
      })
    ]);
    let sourceBlocker: string | null = null;
    if (currentEffective?.id === effectiveVersionId && !activeChange) {
      const contract = await this.prisma.contract.findUnique({
        where: { id: target.contractId }
      });
      if (!contract || contract.voidedAt) {
        sourceBlocker = "合同不存在或已作废，不能发起变更";
      } else {
        const [parties, bills, sourceTerms] = await Promise.all([
          this.prisma.contractPartySnapshot.findMany({
            where: { contractVersionId: currentEffective.id },
            orderBy: [{ roleKey: "asc" }, { displayOrder: "asc" }]
          }),
          this.prisma.contractBill.findMany({
            where: { contractVersionId: currentEffective.id }
          }),
          this.prisma.paymentTermsVersion.findFirst({
            where: { contractVersionId: currentEffective.id },
            orderBy: { versionNo: "desc" }
          })
        ]);
        const prepared = this.prepareChangeDraftSource({
          contract,
          latest: currentEffective,
          parties,
          bills,
          sourceTerms
        });
        sourceBlocker = prepared.ok ? null : prepared.reason;
        if (!sourceBlocker) {
          const lineage = await this.prisma.contractVersion.findMany({
            where: { contractId: target.contractId },
            orderBy: { versionNo: "asc" }
          });
          const rootResolution = resolveContractVersionRoot(lineage);
          if (!rootResolution.ok) {
            sourceBlocker = rootResolution.reason;
          } else if (rootResolution.root.changeType === "historical_takeover" && rootResolution.root.originalBaseAmountCents === null) {
            sourceBlocker = "历史合同尚未确认历史变更基线，请先由合同部主管补录后再发起合同变更";
          }
        }
      }
    }
    const eligible =
      currentEffective?.id === effectiveVersionId && !activeChange && !sourceBlocker;
    return {
      eligible,
      reason: eligible
        ? null
        : activeChange
          ? "当前合同已有进行中的变更"
          : currentEffective?.id !== effectiveVersionId
            ? "所选版本不是当前最新生效版本"
            : sourceBlocker,
      currentEffective: currentEffective ? this.changeVersionProjection(currentEffective) : null,
      activeChange: activeChange ? this.changeVersionProjection(activeChange) : null
    };
  }

  private changeVersionProjection(version: {
    id: string;
    contractId: string;
    versionNo: number;
    changeType: string;
    status: string;
    amountCents: bigint;
    baseVersionId: string | null;
    supersedesVersionId: string | null;
    changeReason: string | null;
    changeDirection: string | null;
    changeAmountCents: bigint | null;
    originalBaseAmountCents: bigint | null;
    cumulativeIncreaseCents: bigint;
    cumulativeDecreaseCents: bigint;
    amountLimitType: string;
  }) {
    const route = version.changeType === "change"
      ? ENHANCED_CONTRACT_CHANGE_APPROVAL_NODES
      : version.changeType === "original"
        ? CONTRACT_APPROVAL_NODES
        : [];
    return {
      id: version.id,
      contractId: version.contractId,
      versionNo: version.versionNo,
      changeType: version.changeType,
      status: version.status,
      amountCents: version.amountCents.toString(),
      baseVersionId: version.baseVersionId,
      supersedesVersionId: version.supersedesVersionId,
      changeReason: version.changeReason,
      changeDirection: version.changeDirection,
      changeAmountCents: version.changeAmountCents?.toString() ?? null,
      originalBaseAmountCents: version.originalBaseAmountCents?.toString() ?? null,
      cumulativeIncreaseCents: version.cumulativeIncreaseCents.toString(),
      cumulativeDecreaseCents: version.cumulativeDecreaseCents.toString(),
      amountLimitType: version.amountLimitType,
      enhancedApproval: false,
      enhancedApprovalReasons: [],
      approvalRouteLabel: version.changeType === "supplement"
        ? "历史路线未冻结"
        : version.changeType === "change"
          ? "合同变更"
          : "原合同",
      approvalRoute: route.map((node) => ({ name: node.name, mode: node.mode, roleKeys: node.roleKeys }))
    };
  }

  async uploadArchiveFile(
    contractVersionId: string,
    actorUserId: string,
    input: UploadContractArchiveFileDto
  ) {
    const governed = await this.prisma.contractVersion?.findUnique({
      where: { id: contractVersionId },
      select: { contractGovernanceVersion: true }
    });
    if (governed?.contractGovernanceVersion === 1) {
      throw new BadRequestException("新合同请上传双方最终签署 PDF，不能使用旧归档入口");
    }
    return this.prisma.$transaction(async (tx) => {
      const version = await tx.contractVersion.findUnique({
        where: { id: contractVersionId }
      });

      if (!version) {
        throw new Error("未找到合同版本，请刷新合同台账后重试");
      }

      if (version.status !== "seal_approved_pending_archive") {
        throw new Error("当前合同尚不能上传签字归档文件，请先完成合同审批和用章审批");
      }

      if (!this.files) {
        throw new Error("合同归档文件服务暂不可用，请稍后重试或联系管理员");
      }
      await this.files.assertCanDownloadFile(tx, input.fileId, actorUserId);

      const archiveFile = await tx.contractArchiveFile.create({
        data: {
          contractVersionId: version.id,
          fileId: input.fileId,
          uploadedByUserId: actorUserId,
          status: "pending_confirm"
        }
      });

      await tx.contractVersion.update({
        where: { id: version.id },
        data: { status: "pending_archive_confirm" }
      });

      await this.audit.record(tx, {
        actorUserId,
        action: "contract.archive.upload",
        businessType: "contract_version",
        businessId: version.id,
        metadata: {
          fileId: input.fileId,
          archiveFileId: archiveFile.id
        }
      });

      return archiveFile;
    });
  }

  async submitApproval(
    contractVersionId: string,
    actorUserId: string,
    rawInput?: unknown
  ) {
    // The controller keeps accepting the legacy body during the staged client rollout.
    // New contracts no longer read a number-rule selection at submission time.
    void rawInput;
    void this.numbering;
    try {
      return await this.prisma.$transaction(async (tx) => {
        const contractLocks = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
          SELECT c."id"
          FROM "Contract" c
          INNER JOIN "ContractVersion" cv ON cv."contractId" = c."id"
          WHERE cv."id" = ${contractVersionId}
          FOR UPDATE OF c
        `);
        if (contractLocks.length !== 1) {
          throw new Error("未找到要提交审批的合同版本，请刷新合同后重试");
        }
        const [version] = await tx.$queryRaw<
          Array<NonNullable<Awaited<ReturnType<typeof tx.contractVersion.findUnique>>>>
        >(Prisma.sql`
          SELECT *
          FROM "ContractVersion"
          WHERE "id" = ${contractVersionId}
          FOR UPDATE
        `);
        if (!version) throw new Error("未找到要提交审批的合同版本，请刷新合同后重试");
        if (version.status !== "draft") {
          throw new BadRequestException("当前合同版本不在草稿状态，不能重复提交审批");
        }

        const contract = await tx.contract.findUnique({
          where: { id: version.contractId }
        });
        if (!contract) throw new Error("未找到合同主信息，请刷新合同后重试");
        if (contract.voidedAt) throw new Error("作废合同不能提交审批，请重新选择有效合同");
        if (contract.ownerUserId && contract.ownerUserId !== actorUserId) {
          throw new Error("只有合同经办人可以提交该合同审批");
        }
        if (version.changeType === "supplement") {
          throw new BadRequestException("历史补充协议仅保留只读查看，不能重新提交");
        }
        if (version.settlementMode !== undefined && (
          !isContractSettlementMode(version.settlementMode) ||
          !version.settlementModeConfirmedAt
        )) {
          throw new BadRequestException(
            "合同结算方式尚未由合同部主管确认，不能提交审批"
          );
        }
        if (isContractSettlementMode(version.settlementMode)) {
          const terms = await tx.paymentTermsVersion.findFirst({
            where: { contractVersionId: version.id },
            select: { id: true }
          });
          if (terms) {
            const stages = await tx.paymentTermsStage.findMany({
              where: { paymentTermsVersionId: terms.id },
              select: { stageType: true, basis: true }
            });
            const expectedBasis = version.settlementMode === "direct_payment"
              ? "contract_amount"
              : "current_settlement";
            if (stages.some((stage) =>
              stage.stageType === "progress" && stage.basis !== expectedBasis
            )) {
              throw new BadRequestException(
                "付款条款与已确认的合同结算方式不一致，请保存草稿后再提交审批"
              );
            }
          }
        }
        await this.assertChangeAmountProjection(tx, version);
        const projectLocks = await tx.$queryRaw<Array<{ id: string; isActive: boolean }>>(Prisma.sql`
          SELECT "id", "isActive"
          FROM "Project"
          WHERE "id" = ${contract.projectId}
          FOR UPDATE
        `);
        if (projectLocks.length !== 1 || projectLocks[0]?.isActive !== true) {
          throw new BadRequestException("合同所属项目不存在或已停用，不能提交审批");
        }
        const governedCompanySnapshot = version.contractGovernanceVersion === 1 &&
          contract.ownerUserId &&
          version.changeType !== "change" &&
          version.changeType !== "supplement"
          ? await this.lockCompanyEntityForSubmission(tx, version, contract)
          : null;
        let governanceSubmissionSnapshot: Prisma.JsonValue | null = null;
        if (version.contractGovernanceVersion === 1) {
          if (!this.formalFiles || !this.authorizations) {
            throw new Error("合同签前治理服务暂不可用，请稍后重试或联系管理员");
          }
          await tx.$queryRaw(Prisma.sql`
            SELECT a."id" FROM "ContractAuthorization" a
            WHERE a."originContractVersionId" = ${version.id} FOR UPDATE
          `);
          await tx.$queryRaw(Prisma.sql`
            SELECT f."id" FROM "ContractFormalFile" f
            WHERE f."contractVersionId" = ${version.id} FOR UPDATE
          `);
          const formalFileSnapshot = await this.formalFiles.freeze(tx, version);
          const authorizationSnapshot = await this.authorizations.freeze(tx, version);
          governanceSubmissionSnapshot = {
            version: 1,
            authorizations: authorizationSnapshot,
            formalFile: formalFileSnapshot
          } as unknown as Prisma.JsonValue;
        }
        const requiresReadiness = Boolean(contract.ownerUserId);
        const formalCode = contract.code;
        let readinessSnapshot = version.readinessSnapshot;
        let templateSnapshot = version.templateSnapshot;
        if (requiresReadiness) {
          if (!this.readiness) {
            throw new Error("合同提交审批服务暂不可用，请稍后重试或联系管理员");
          }
          const readiness = await this.readiness.check(tx, version, contract, true);
          if (readiness.blocking.length > 0) {
            throw new BadRequestException({
              message: "合同资料尚未满足提交审批条件，请按阻断项补齐后再提交",
              readiness
            });
          }
          readinessSnapshot = readiness as unknown as Prisma.JsonValue;
        }

        await this.assertOwnerContractQuota(tx, contract.projectId, contract.id, version);

        if (requiresReadiness) {
          const submissionSnapshot = await this.readiness!.freeze(tx, version);
          templateSnapshot = {
            ...(version.templateSnapshot as Prisma.JsonObject),
            submissionSnapshot
          } as unknown as Prisma.JsonValue;
        }

        const companySnapshot = version.contractGovernanceVersion === 1
          ? governedCompanySnapshot
          : !contract.ownerUserId ||
              version.changeType === "change" ||
              version.changeType === "supplement"
            ? null
            : await this.lockCompanyEntityForSubmission(tx, version, contract);

        if (governanceSubmissionSnapshot && requiresReadiness) {
          const existingTemplate = templateSnapshot as Prisma.JsonObject;
          templateSnapshot = {
            ...existingTemplate,
            submissionSnapshot: {
              ...((existingTemplate.submissionSnapshot as Prisma.JsonObject | undefined) ?? {}),
              governance: governanceSubmissionSnapshot
            }
          } as unknown as Prisma.JsonValue;
        }

        const frozenNodes = await this.approvalNodesForSubmission(
          tx,
          version,
          contract,
          actorUserId
        );

        if (requiresReadiness && contract.source === "system" && !formalCode) {
          throw new BadRequestException("合同尚未生成正式编号，请先成功保存草稿后再提交审批");
        }

        const submitted = await tx.contractVersion.updateMany({
          where: {
            id: version.id,
            status: "draft",
            draftRevision: version.draftRevision
          },
          data: {
            status: "in_approval",
            taxFactStatus: "frozen",
            taxFactsFrozenAt: new Date(),
            ...(companySnapshot ?? {}),
            ...(requiresReadiness
              ? {
                  readinessSnapshot: readinessSnapshot as Prisma.InputJsonValue,
                  templateSnapshot: templateSnapshot as Prisma.InputJsonValue,
                  clauseSnapshot: version.clauseSnapshot as Prisma.InputJsonValue
                }
              : {})
          }
        });
        if (submitted.count !== 1) {
          throw new Error("合同提交审批时数据已变化，请刷新合同后重试");
        }
        const parentGate = await tx.contract.updateMany({
          where: {
            id: contract.id,
            ownerUserId: contract.ownerUserId,
            voidedAt: null
          },
          data: {
            ownerUserId: contract.ownerUserId,
            ...(formalCode ? { code: formalCode } : {})
          }
        });
        if (parentGate.count !== 1) {
          throw new Error("合同提交审批时数据已变化，请刷新合同后重试");
        }

        await tx.approvalInstance.create({
          data: {
            flowType: "contract.approve",
            businessType: "contract_version",
            businessId: version.id,
            status: "in_progress",
            currentNodeIndex: 0,
            frozenNodes: frozenNodes as unknown as Prisma.InputJsonValue,
            applicantUserId: actorUserId
          }
        });

        await this.audit.record(tx, {
          actorUserId,
          action: "contract.approval.submit",
          businessType: "contract_version",
          businessId: version.id,
          metadata: {
            fromStatus: version.status,
            toStatus: "in_approval",
            formalCode,
            draftRevision: version.draftRevision,
            ...(governanceSubmissionSnapshot
              ? { governanceSubmissionSnapshot }
              : {}),
            ...(requiresReadiness
              ? {
                  submissionSnapshot: (templateSnapshot as Prisma.JsonObject)
                    .submissionSnapshot
                }
              : {})
          }
        });

        return {
          ...version,
          amountCents: String(version.amountCents ?? 0n),
          status: "in_approval",
          readinessSnapshot,
          templateSnapshot,
          formalCode
        };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "P2002"
      ) {
        throw new BadRequestException("正式合同编号已存在，请刷新后重新提交或选择其他编号");
      }
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        (error.code === "P2034" ||
          (error.code === "P2010" &&
            "meta" in error &&
            error.meta !== null &&
            typeof error.meta === "object" &&
            "code" in error.meta &&
            error.meta.code === "40001"))
      ) {
        throw new BadRequestException("合同审批资料正在被更新，请稍后刷新并重新提交");
      }
      if (error instanceof ContractGovernanceDenial) {
        await this.prisma.$transaction((tx) => this.audit.record(tx, {
          actorUserId,
          action: error.action,
          businessType: "contract_version",
          businessId: contractVersionId,
          metadata: { reason: error.message }
        }));
      }
      throw error;
    }
  }

  private async assertOwnerContractQuota(
    tx: Prisma.TransactionClient,
    projectId: string,
    currentContractId: string,
    version: {
      amountCents: bigint;
      pricingNature: string;
      amountLimitType: string;
    }
  ) {
    const requestedAmountCents = dbMoneyToBigInt(version.amountCents, "合同金额");
    if (version.pricingNature === "framework" && version.amountLimitType === "unlimited") {
      return;
    }
    if (requestedAmountCents <= 0n) {
      throw new BadRequestException("合同金额必须大于 0，不能提交零金额或负数合同审批");
    }

    const ownerContracts = await tx.projectOwnerContract.findMany({
      where: { projectId, status: "effective", voidedAt: null },
      select: { amountCents: true }
    });
    const ownerQuotaCents = sumBigInt(ownerContracts.map((contract) => contract.amountCents));

    const projectContracts = await tx.contract.findMany({
      where: {
        projectId,
        voidedAt: null
      },
      select: { id: true }
    });
    const contractIds = projectContracts.map((contract) => contract.id);
    const occupyingVersions = contractIds.length
      ? await tx.contractVersion.findMany({
          where: {
            contractId: { in: contractIds },
            status: { in: [...DOWNSTREAM_CONTRACT_OCCUPANCY_STATUSES] }
          },
          select: {
            contractId: true,
            versionNo: true,
            amountCents: true
          }
        })
      : [];
    const contractOccupancies = maxContractOccupancies(occupyingVersions);
    const hasCurrentOccupancy = contractOccupancies.some(
      (version) => version.contractId === currentContractId
    );
    const occupiedCents =
      sumBigInt(
        contractOccupancies.map((version) =>
          version.contractId === currentContractId
            ? maxBigInt(version.amountCents, requestedAmountCents)
            : version.amountCents
        )
      ) + (hasCurrentOccupancy ? 0n : requestedAmountCents);

    if (ownerQuotaCents <= 0n || occupiedCents > ownerQuotaCents) {
      throw new BadRequestException("业主主合同额度不足");
    }
  }

  private async lockCompanyEntityForSubmission(
    tx: Prisma.TransactionClient,
    version: { draftData: Prisma.JsonValue },
    contract: { companyEntityId: string | null }
  ) {
    const draft = this.jsonObject(version.draftData);
    const selection = this.jsonObject(draft["companyEntitySelection"]);
    const selectedId = typeof selection["id"] === "string" ? selection["id"] : null;
    const selectedVersionNo = typeof selection["versionNo"] === "number" &&
      Number.isInteger(selection["versionNo"])
      ? selection["versionNo"]
      : null;
    if (!selectedId || selectedVersionNo === null || contract.companyEntityId !== selectedId) {
      throw new BadRequestException("我方公司主体选择尚未同步，请回到基本信息重新选择并保存");
    }
    await tx.$queryRaw(Prisma.sql`
      SELECT "id"
      FROM "CompanyEntity"
      WHERE "id" = ${selectedId}
      FOR UPDATE
    `);
    const entity = await tx.companyEntity.findUnique({ where: { id: selectedId } });
    if (!entity) {
      throw new BadRequestException("未找到所选我方公司主体，请回到基本信息重新选择");
    }
    if (!entity.isActive) {
      throw new BadRequestException("所选我方公司主体已停用，请回到基本信息重新选择");
    }
    if (entity.dataStatus !== "complete") {
      throw new BadRequestException("所选我方公司主体资料待补全，请先到我方公司主体页面完善信用代码");
    }
    if (entity.currentVersionNo !== selectedVersionNo) {
      throw new BadRequestException("所选我方公司主体资料已更新，请回到基本信息同步最新版本后重试");
    }
    const entityVersion = await tx.companyEntityVersion.findUnique({
      where: {
        companyEntityId_versionNo: {
          companyEntityId: selectedId,
          versionNo: selectedVersionNo
        }
      }
    });
    if (!entityVersion || !entityVersion.unifiedSocialCreditCode) {
      throw new BadRequestException("我方公司主体版本缺失，请联系合同部核对后重试");
    }
    return {
      companyEntityIdSnapshot: entityVersion.companyEntityId,
      companyEntityVersionId: entityVersion.id,
      companyEntityNameSnapshot: entityVersion.name,
      companyEntityCreditCodeSnapshot: entityVersion.unifiedSocialCreditCode,
      companyEntityRegisteredAddressSnapshot: entityVersion.registeredAddress
    };
  }

  private jsonObject(value: unknown): Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
  }

  private async assertChangeAmountProjection(
    tx: Prisma.TransactionClient,
    version: {
      id: string;
      changeType: string;
      baseVersionId: string | null;
      changeDirection: string | null;
      changeAmountCents: bigint | null;
      amountCents: bigint;
      contractId: string;
      pricingNature: string;
      amountLimitType: string;
      companyEntityIdSnapshot: string | null;
      companyEntityVersionId: string | null;
      companyEntityNameSnapshot: string | null;
      companyEntityCreditCodeSnapshot: string | null;
      companyEntityRegisteredAddressSnapshot: string | null;
      draftData: Prisma.JsonValue;
      clauseSnapshot: Prisma.JsonValue;
      templateSnapshot: Prisma.JsonValue;
    }
  ) {
    if (version.changeType !== "change" && version.changeType !== "supplement") return;
    if (!version.baseVersionId || !version.changeDirection || version.changeAmountCents === null) {
      throw new BadRequestException("合同变更金额声明不完整，不能提交审批");
    }
    const lineage = await tx.$queryRaw<Array<NonNullable<Awaited<ReturnType<typeof tx.contractVersion.findUnique>>>>>(Prisma.sql`
      SELECT * FROM "ContractVersion"
      WHERE "contractId" = ${version.contractId}
      ORDER BY "versionNo" ASC
      FOR UPDATE
    `);
    const base = lineage.find((item) => item.id === version.baseVersionId);
    if (!base) throw new BadRequestException("合同变更直接来源版本不存在，不能提交审批");
    const expected = version.changeDirection === "increase"
      ? base.amountCents + version.changeAmountCents
      : version.changeDirection === "decrease"
        ? base.amountCents - version.changeAmountCents
        : base.amountCents;
    if (version.amountCents !== expected) {
      throw new BadRequestException("合同当前金额与已声明变更金额不一致，请恢复清单或金额后再提交审批");
    }
    const subjectKeys = [
      "companyEntityIdSnapshot",
      "companyEntityVersionId",
      "companyEntityNameSnapshot",
      "companyEntityCreditCodeSnapshot",
      "companyEntityRegisteredAddressSnapshot"
    ] as const;
    for (const key of subjectKeys) {
      if (version[key] !== base[key]) {
        throw new ContractGovernanceDenial(
          "合同变更不能替换我方签约主体，需要变更主体时必须新签合同",
          "contract.change.subject_snapshot.denied"
        );
      }
    }

    const rootResolution = resolveContractVersionRoot(lineage);
    if (!rootResolution.ok) {
      throw new ContractGovernanceDenial(
        rootResolution.reason,
        "contract.change.limit.denied"
      );
    }
    const root = rootResolution.root;
    const historicalPositiveIncreaseCents =
      (root.changeType === "historical_takeover" ? root.cumulativeIncreaseCents : 0n) +
      lineage.reduce((sum, item) =>
        item.baseVersionId !== null && item.id !== version.id &&
        (item.changeType === "change" || item.changeType === "supplement") &&
        (item.status === "effective" || item.status === "superseded") &&
        item.effectiveAt !== null && item.changeDirection === "increase" &&
        (item.changeAmountCents ?? 0n) > 0n
          ? sum + item.changeAmountCents!
          : sum, 0n);
    const originalAmountCents = root.changeType === "historical_takeover"
      ? root.originalBaseAmountCents
      : root.amountCents;
    const limit = evaluateContractIncreaseLimit({
      originalAmountCents,
      historicalPositiveIncreaseCents,
      proposedChangeCents: version.changeDirection === "increase"
        ? version.changeAmountCents
        : -version.changeAmountCents,
      unlimitedFramework: version.pricingNature === "framework" &&
        version.amountLimitType === "unlimited"
    });
    if (!limit.allowed) {
      throw new ContractGovernanceDenial(
        limit.reason ?? "合同变更暂不能提交",
        "contract.change.limit.denied"
      );
    }
    const template = version.templateSnapshot as unknown as {
      fieldSchema: Array<{ key: string; label: string; type: "text" }>;
      clauseSchema: Array<{
        key: string;
        title: string;
        numberingMode: "automatic";
        content: unknown;
      }>;
      supplementChangePolicy?: {
        version: 1;
        editableFieldKeys: string[];
        editableClauseKeys: string[];
        coreClauseKeys: string[];
      };
    };
    if (!Array.isArray(template.fieldSchema) || !Array.isArray(template.clauseSchema)) {
      throw new BadRequestException("合同变更模板快照异常，不能提交审批");
    }
    assertContractChangeContentAllowed({
      baseDraftData: base.draftData,
      candidateDraftData: version.draftData,
      baseClauses: base.clauseSnapshot,
      candidateClauses: version.clauseSnapshot,
      template
    });
  }

  async reviewApproval(
    contractVersionId: string,
    actorUserId: string,
    input: ReviewContractApprovalDto
  ) {
    if (
      !["approve", "reject", "reject_previous", "return_to_applicant"].includes(
        input.decision
      )
    ) {
      throw new Error("不支持的合同审批处理方式，请刷新页面后重试");
    }
    requireApprovalCommentForReturn(input.decision, input.comment);

    let completedInstanceId: string | undefined;
    const result = await this.prisma.$transaction(async (tx) => {
      await lockApprovalReviewRow(tx, Prisma.sql`
        SELECT "id" FROM "ContractVersion" WHERE "id" = ${contractVersionId} FOR UPDATE
      `);
      const version = await tx.contractVersion.findUnique({
        where: { id: contractVersionId }
      });

      if (!version) {
        throw new Error("未找到合同版本，请刷新合同台账后重试");
      }

      if (version.status !== "in_approval") {
        throw new Error("当前合同已离开审批中，不能继续处理审批");
      }

      await lockApprovalReviewRow(tx, Prisma.sql`
        SELECT "id" FROM "ApprovalInstance"
        WHERE "businessType" = 'contract_version'
          AND "businessId" = ${version.id}
          AND "flowType" = 'contract.approve'
          AND "status" = 'in_progress'
        FOR UPDATE
      `);

      const instance = await tx.approvalInstance.findFirst({
        where: {
          businessType: "contract_version",
          businessId: version.id,
          flowType: "contract.approve",
          status: "in_progress"
        }
      });

      if (!instance) {
        throw new Error("未找到进行中的合同审批流程，请刷新后重试");
      }

      const nodes = instance.frozenNodes as unknown as ContractApprovalNode[];
      const currentNode = nodes[instance.currentNodeIndex];

      if (!currentNode) {
        throw new Error("当前合同审批节点异常，请刷新后重试");
      }

      const actorRoleKeys = await this.loadActorRoleKeys(tx, actorUserId, version.contractId);
      const identityNode = input.decision === "approve"
        ? currentNode
        : { ...currentNode, approvedRoleKeys: [] };
      let identity = resolveApprovalReviewIdentity({
        node: identityNode,
        actorUserId,
        actorRoleKeys
      });
      if (!identity) {
        const delegatorIds = this.delegations
          ? await this.delegations.activeDelegatorIds(tx, actorUserId)
          : await activeApprovalDelegatorIds(tx, actorUserId);
        const activeDelegators = await Promise.all(delegatorIds.map(async (userId) => ({
          userId,
          roleKeys: await this.loadActorRoleKeys(tx, userId, version.contractId)
        })));
        identity = resolveApprovalReviewIdentity({ node: identityNode, actorUserId, actorRoleKeys, activeDelegators });
      }
      if (!identity) {
        throw new Error("当前账号无权处理该合同审批节点");
      }
      const approvedRoleKey = identity.approvedRoleKey;
      const signature = await snapshotApprovalSignature(tx, actorUserId, {
        required: input.decision === "approve" && isGovernedFrozenApprovalNode(currentNode)
      });

      const selfReview = await confirmApprovalSelfReview({
        applicantUserId: instance.applicantUserId,
        actorUserId,
        actorRoleKeys: identity.representedUserId === actorUserId &&
          !identity.viaAssignment
          ? Array.from(new Set([...actorRoleKeys, approvedRoleKey]))
          : actorRoleKeys,
        approvedRoleKey,
        representedUserId: identity.representedUserId,
        viaAssignment: identity.viaAssignment,
        selfReviewReason: input.selfReviewReason,
        confirmationPassword: input.confirmationPassword,
        confirmPassword: this.auth
          ? (password) => this.auth!.confirmPassword(actorUserId, password)
          : undefined
      });

      if (input.decision === "reject_previous") {
        if (instance.currentNodeIndex === 0) {
          throw new Error("当前已是第一个审批节点，不能退回上一节点");
        }

        const previousNodeIndex = instance.currentNodeIndex - 1;
        const nextNodes = nodes.map((node, index) =>
          index === previousNodeIndex || index === instance.currentNodeIndex
            ? { ...node, approvedRoleKeys: [] }
            : node
        );
        const updated = await tx.contractVersion.update({
          where: { id: version.id },
          data: { status: "in_approval" }
        });

        await tx.approvalInstance.update({
          where: { id: instance.id },
          data: {
            currentNodeIndex: previousNodeIndex,
            frozenNodes: nextNodes as unknown as Prisma.InputJsonValue,
            status: "in_progress"
          }
        });

        await tx.approvalActionLog.create({
          data: {
            approvalInstanceId: instance.id,
            action: "reject_previous",
            actorUserId,
            comment: input.comment?.trim() || undefined,
            approvedRoleKey,
            representedUserId: identity.representedUserId,
            ...(selfReview.isSelfReview ? { metadata: selfReview.metadata } : {})
          }
        });

        await this.audit.record(tx, {
          actorUserId,
          action: "contract.approval.reject_previous",
          businessType: "contract_version",
          businessId: version.id,
          metadata: {
            fromStatus: version.status,
            toStatus: "in_approval",
            fromNodeName: currentNode.name,
            toNodeName: nextNodes[previousNodeIndex].name,
            approvedRoleKey,
            ...selfReview.metadata
          }
        });

        return updated;
      }

      if (input.decision === "return_to_applicant") {
        const updated = await tx.contractVersion.update({
          where: { id: version.id },
          data: {
            status: "draft",
            taxFactStatus: "draft",
            taxFactsFrozenAt: null
          }
        });

        await tx.approvalInstance.update({
          where: { id: instance.id },
          data: { status: "returned_to_applicant" }
        });

        await tx.approvalActionLog.create({
          data: {
            approvalInstanceId: instance.id,
            action: "return_to_applicant",
            actorUserId,
            comment: input.comment?.trim() || undefined,
            approvedRoleKey,
            representedUserId: identity.representedUserId,
            ...(selfReview.isSelfReview ? { metadata: selfReview.metadata } : {})
          }
        });

        await this.audit.record(tx, {
          actorUserId,
          action: "contract.approval.return_to_applicant",
          businessType: "contract_version",
          businessId: version.id,
          metadata: {
            fromStatus: version.status,
            toStatus: "draft",
            nodeName: currentNode.name,
            approvedRoleKey,
            ...selfReview.metadata
          }
        });

        return updated;
      }

      const isFinalApproval =
        input.decision === "approve" && instance.currentNodeIndex === nodes.length - 1;
      const nextStatus = input.decision === "approve"
        ? isFinalApproval ? "approved_pending_seal" : "in_approval"
        : "approval_rejected";
      const updated = await tx.contractVersion.update({
        where: { id: version.id },
        data:
          nextStatus === "approval_rejected"
            ? {
                status: nextStatus,
                taxFactStatus: "draft",
                taxFactsFrozenAt: null
              }
            : { status: nextStatus }
      });

      await tx.approvalInstance.update({
        where: { id: instance.id },
        data: {
          currentNodeIndex: input.decision === "approve" ? instance.currentNodeIndex + 1 : instance.currentNodeIndex,
          status: input.decision === "approve"
            ? isFinalApproval ? "approved" : "in_progress"
            : "rejected"
        }
      });

      await tx.approvalActionLog.create({
        data: {
          approvalInstanceId: instance.id,
          action: input.decision === "approve" ? "approve" : "reject",
          actorUserId,
          comment: input.comment?.trim() || undefined,
          approvedRoleKey,
          representedUserId: identity.representedUserId,
          ...(input.decision === "approve" && isGovernedFrozenApprovalNode(currentNode)
            ? {
                signatureFileIdSnapshot: signature.fileId,
                signatureSha256Snapshot: signature.sha256,
                signatureVersionIdSnapshot: signature.versionId
              }
            : {}),
          ...(selfReview.isSelfReview ? { metadata: selfReview.metadata } : {})
        }
      });

      if (isFinalApproval) {
        if (version.contractGovernanceVersion === 1) {
          if (!this.seals) {
            throw new Error("合同用章任务服务暂不可用，请稍后重试或联系管理员");
          }
          await this.seals.ensurePendingTask(
            tx,
            updated,
            instance.id,
            instance.applicantUserId,
            actorUserId
          );
        }
        completedInstanceId = instance.id;
      }

      await this.audit.record(tx, {
        actorUserId,
        action:
          input.decision === "approve" ? "contract.approval.approve" : "contract.approval.reject",
        businessType: "contract_version",
        businessId: version.id,
        metadata: {
          fromStatus: version.status,
          toStatus: nextStatus,
          nodeName: currentNode.name,
          approvedRoleKey,
          ...selfReview.metadata
        }
      });

      return updated;
    });

    if (completedInstanceId) {
      try {
        await this.approvalForms?.generateForInstance(completedInstanceId, actorUserId);
      } catch (error) {
        await this.audit.record(this.prisma, {
          actorUserId,
          action: "contract.approval_form.generate_failed",
          businessType: "contract_version",
          businessId: contractVersionId,
          metadata: {
            approvalInstanceId: completedInstanceId,
            errorType: error instanceof Error ? error.name : "UnknownError",
            retryAvailable: true
          }
        });
      }
    }

    return result;
  }

  private approvalNodesForVersion(version: {
    changeType: string;
    amountLimitType: string;
    changeAmountCents: bigint | null;
    originalBaseAmountCents: bigint | null;
    cumulativeIncreaseCents: bigint;
    cumulativeDecreaseCents: bigint;
  }): ContractApprovalNode[] {
    if (version.changeType === "original") return CONTRACT_APPROVAL_NODES.map((node) => ({ ...node }));
    if (version.changeType === "change") {
      return ENHANCED_CONTRACT_CHANGE_APPROVAL_NODES.map((node) => ({ ...node }));
    }
    return CONTRACT_APPROVAL_NODES.map((node) => ({ ...node }));
  }

  private async approvalNodesForSubmission(
    tx: Prisma.TransactionClient,
    version: Parameters<ContractService["approvalNodesForVersion"]>[0],
    contract: {
      id: string;
      projectId: string;
      contractTypeKey: string | null;
      ownerUserId: string | null;
    },
    actorUserId: string
  ): Promise<ContractApprovalNode[] | FrozenNewContractApprovalNode[]> {
    if (version.changeType === "change") {
      if (!this.approvalRoutes) {
        throw new Error("合同变更审批路线服务暂不可用，请稍后重试或联系管理员");
      }
      return this.approvalRoutes.freezeContractChangeRoute(
        tx,
        {
          id: contract.id,
          projectId: contract.projectId,
          contractTypeKey: contract.contractTypeKey
        },
        actorUserId
      );
    }
    if (!contract.ownerUserId) return this.approvalNodesForVersion(version);
    if (version.changeType !== "original") return this.approvalNodesForVersion(version);
    if (!this.approvalRoutes) {
      throw new Error("新合同审批路线服务暂不可用，请稍后重试或联系管理员");
    }
    return this.approvalRoutes.freezeNewContractRoute(
      tx,
      {
        id: contract.id,
        projectId: contract.projectId,
        contractTypeKey: contract.contractTypeKey
      },
      actorUserId
    );
  }

  // 申请人撤回进行中的合同审批：版本退回 draft 以便修改后重新提交（同一版本，不新建版本）。
  async withdrawApproval(contractVersionId: string, actorUserId: string) {
    return this.prisma.$transaction(async (tx) => {
      const version = await tx.contractVersion.findUnique({
        where: { id: contractVersionId }
      });

      if (!version) {
        throw new Error("未找到要撤回的合同审批任务，请刷新审批中心后重试");
      }

      if (version.status !== "in_approval") {
        throw new Error("当前合同已离开审批中，不能撤回审批");
      }

      const instance = await tx.approvalInstance.findFirst({
        where: {
          businessType: "contract_version",
          businessId: version.id,
          flowType: "contract.approve",
          status: "in_progress"
        }
      });

      if (!instance) {
        throw new Error("未找到进行中的合同审批流程，请刷新审批中心后重试");
      }

      if (instance.applicantUserId !== actorUserId) {
        throw new Error("只有合同审批申请人可以撤回审批");
      }

      const updated = await tx.contractVersion.update({
        where: { id: version.id },
        data: {
          status: "draft",
          taxFactStatus: "draft",
          taxFactsFrozenAt: null
        }
      });

      await tx.approvalInstance.update({
        where: { id: instance.id },
        data: { status: "withdrawn" }
      });

      await tx.approvalActionLog.create({
        data: {
          approvalInstanceId: instance.id,
          action: "withdraw",
          actorUserId
        }
      });

      await this.audit.record(tx, {
        actorUserId,
        action: "contract.approval.withdraw",
        businessType: "contract_version",
        businessId: version.id,
        metadata: {
          fromStatus: version.status,
          toStatus: "draft",
          applicantUserId: instance.applicantUserId
        }
      });

      return updated;
    });
  }

  // 超时催办：申请人督促当前冻结节点（董事长/总经理）处理；是否超时/重复节流由 shared-domain 判定。
  async remindApproval(
    contractVersionId: string,
    actorUserId: string,
    now: Date = new Date()
  ) {
    return this.prisma.$transaction(async (tx) => {
      const version = await tx.contractVersion.findUnique({
        where: { id: contractVersionId }
      });

      if (!version) {
        throw new Error("未找到要催办的合同审批任务，请刷新审批中心后重试");
      }

      if (version.status !== "in_approval") {
        throw new Error("当前合同不在审批中，不能发起催办");
      }

      const instance = await tx.approvalInstance.findFirst({
        where: {
          businessType: "contract_version",
          businessId: version.id,
          flowType: "contract.approve",
          status: "in_progress"
        }
      });

      if (!instance) {
        throw new Error("未找到进行中的合同审批流程，请刷新审批中心后重试");
      }

      if (instance.applicantUserId !== actorUserId) {
        throw new Error("只有合同审批申请人可以发起催办");
      }

      const lastRemind = await tx.approvalActionLog.findFirst({
        where: { approvalInstanceId: instance.id, action: "remind" },
        orderBy: { createdAt: "desc" }
      });

      // 催办不改写实例（不影响 updatedAt），仅记动作日志；超时与重复节流见 shared-domain。
      if (
        !canRemindApproval({
          status: instance.status,
          lastActivityAt: instance.updatedAt,
          lastRemindedAt: lastRemind?.createdAt ?? null,
          now
        })
      ) {
        throw new Error("当前合同审批还未达到催办时间，请稍后再试");
      }

      const nodes = instance.frozenNodes as unknown as typeof CONTRACT_APPROVAL_NODES;
      const currentNode = nodes[instance.currentNodeIndex];

      const log = await tx.approvalActionLog.create({
        data: {
          approvalInstanceId: instance.id,
          action: "remind",
          actorUserId
        }
      });

      await this.audit.record(tx, {
        actorUserId,
        action: "contract.approval.remind",
        businessType: "contract_version",
        businessId: version.id,
        metadata: {
          approvalInstanceId: instance.id,
          currentNodeIndex: instance.currentNodeIndex,
          nodeName: currentNode?.name,
          overdueHours: Math.floor(approvalElapsedHours(instance.updatedAt, now))
        }
      });

      return log;
    });
  }

  transferApproval(
    contractVersionId: string,
    actorUserId: string,
    input: AssignContractApprovalDto
  ) {
    return this.assignApproval("transfer", contractVersionId, actorUserId, input);
  }

  delegateApproval(
    contractVersionId: string,
    actorUserId: string,
    input: AssignContractApprovalDto
  ) {
    return this.assignApproval("delegate", contractVersionId, actorUserId, input);
  }

  async approveSeal(contractVersionId: string, actorUserId: string) {
    const governed = await this.prisma.contractVersion?.findUnique({
      where: { id: contractVersionId },
      select: { contractGovernanceVersion: true }
    });
    if (governed?.contractGovernanceVersion === 1) {
      throw new Error("受治理合同请使用用章确认入口");
    }
    return this.updateVersionStatus({
      contractVersionId,
      expectedStatus: "approved_pending_seal",
      nextStatus: "seal_approved_pending_archive",
      actorUserId,
      action: "contract.seal.approve"
    });
  }

  async confirmArchiveFile(
    contractVersionId: string,
    actorUserId: string,
    input: ConfirmContractArchiveDto
  ) {
    const governed = await this.prisma.contractVersion?.findUnique({
      where: { id: contractVersionId },
      select: { contractGovernanceVersion: true }
    });
    if (governed?.contractGovernanceVersion === 1) {
      throw new BadRequestException("新合同请在双方最终版中确认归档，不能使用旧归档入口");
    }
    if (!input.confirmationPassword?.trim()) {
      throw new Error("确认合同归档需要当前登录密码");
    }

    if (!this.auth) {
      throw new Error("当前密码校验服务暂不可用，请稍后重试或联系管理员");
    }

    await this.auth.confirmPassword(actorUserId, input.confirmationPassword);

    return this.prisma.$transaction(async (tx) => {
      const target = await tx.contractVersion.findUnique({
        where: { id: contractVersionId }
      });
      if (!target) {
        throw new Error("未找到合同版本，请刷新合同台账后重试");
      }
      if (typeof (tx as { $queryRaw?: unknown }).$queryRaw === "function") {
        await tx.$queryRaw(Prisma.sql`
          SELECT "id" FROM "Contract" WHERE "id" = ${target.contractId} FOR UPDATE
        `);
      }
      const version = await tx.contractVersion.findUnique({ where: { id: contractVersionId } });
      if (!version) throw new Error("未找到合同版本，请刷新合同台账后重试");

      if (version.status !== "pending_archive_confirm") {
        throw new Error("当前合同版本尚不能确认归档，请先完成用印并上传已签署合同归档文件");
      }

      const archiveFile = await tx.contractArchiveFile.findFirst({
        where: {
          id: input.archiveFileId,
          contractVersionId: version.id
        }
      });

      if (!archiveFile) {
        throw new Error("未找到待确认的合同归档文件，请刷新后重试");
      }

      if (archiveFile.status !== "pending_confirm") {
        throw new Error("该合同归档文件已处理，不能重复确认");
      }

      await this.assertStructuredSettlementPaymentStage(
        tx,
        version.id,
        version.contractId
      );

      const confirmedAt = new Date();
      await tx.contractArchiveFile.update({
        where: { id: archiveFile.id },
        data: {
          confirmedByUserId: actorUserId,
          confirmedAt,
          status: "confirmed"
        }
      });

      const { effectiveVersion, supersededVersionId } = await this.activation.activate(tx, {
        contractVersionId: version.id,
        actorUserId,
        effectiveAt: confirmedAt
      });

      await this.audit.record(tx, {
        actorUserId,
        action: "contract.archive.confirm",
        businessType: "contract_version",
        businessId: version.id,
        metadata: {
          archiveFileId: archiveFile.id,
          ...(supersededVersionId ? { supersedesVersionId: supersededVersionId } : {})
        }
      });

      return effectiveVersion;
    });
  }

  private async assertStructuredSettlementPaymentStage(
    tx: Prisma.TransactionClient,
    contractVersionId: string,
    contractId: string
  ) {
    const contract = await tx.contract.findUnique({
      where: { id: contractId },
      select: { contractTypeKey: true }
    });
    const contractTypeKey = contract?.contractTypeKey?.trim() ?? "";
    const isGenericContract = contractTypeKey === "generic_contract";
    if (!isGenericContract && !SETTLEMENT_CONTRACT_TYPES.has(contractTypeKey)) {
      throw new BadRequestException("合同类型不在支持范围内，不能确认归档生效");
    }

    const terms = await tx.paymentTermsVersion.findFirst({
      where: { contractVersionId },
      select: { id: true }
    });
    if (!terms) {
      throw new BadRequestException(
        isGenericContract
          ? "通用合同付款条款还未结构化，不能确认归档生效。请先维护可执行的直接付款阶段。"
          : "合同付款条款还未结构化，不能确认归档生效。请先维护结算款、付款比例、付款期限和发票要求。"
      );
    }

    const stages = await tx.paymentTermsStage.findMany({
      where: { paymentTermsVersionId: terms.id },
      select: {
        id: true,
        stageType: true,
        basis: true,
        ratioBps: true,
        fixedAmountCents: true,
        triggerAnchor: true,
        dueDays: true
      }
    });
    const directStages = stages.filter((stage) => stage.stageType !== "advance");
    const hasValidStage = isGenericContract
      ? directStages.length > 0 && directStages.every((stage) => {
          const hasValidRatio =
            stage.ratioBps !== null &&
            Number.isInteger(stage.ratioBps) &&
            stage.ratioBps > 0 &&
            stage.ratioBps <= 10000;
          const hasValidFixedAmount =
            stage.fixedAmountCents !== null && stage.fixedAmountCents > 0n;
          return (
            stage.basis === "contract_amount" &&
            stage.triggerAnchor === "contract_effective" &&
            hasValidRatio !== hasValidFixedAmount &&
            Number.isSafeInteger(stage.dueDays) &&
            stage.dueDays >= 0
          );
        })
      : stages.some(
          (stage) =>
            stage.basis === "current_settlement" &&
            stage.ratioBps !== null &&
            stage.ratioBps > 0
        );
    if (!hasValidStage) {
      throw new BadRequestException(
        isGenericContract
          ? "通用合同付款条款缺少可执行的直接付款阶段，不能确认归档生效。请维护非预付款、按合同金额计算且以合同生效为触发点的付款阶段。"
          : "合同付款条款缺少结算款阶段，不能确认归档生效。请先维护结算款、付款比例、付款期限和发票要求。"
      );
    }
  }

  private normalizePaymentStages(
    stages: CreatePaymentTermsStageDto[] | undefined
  ): Array<Omit<Prisma.PaymentTermsStageCreateManyInput, "paymentTermsVersionId">> {
    if (stages === undefined) return [];
    if (!Array.isArray(stages) || stages.length === 0) {
      throw new BadRequestException(
        "付款条款至少要维护一条结算款、付款比例、付款期限和发票要求。"
      );
    }

    return stages.map((stage, index) => this.normalizePaymentStage(stage, index));
  }

  private normalizePaymentStage(
    stage: CreatePaymentTermsStageDto,
    index: number
  ): Omit<Prisma.PaymentTermsStageCreateManyInput, "paymentTermsVersionId"> {
    if (!stage || typeof stage !== "object") {
      throw new BadRequestException(`第 ${index + 1} 条付款条款格式不正确。`);
    }
    if (!stage.name?.trim()) {
      throw new BadRequestException(`第 ${index + 1} 条付款条款缺少阶段名称。`);
    }
    const stageType = stage.stageType ?? "progress";
    if (!PAYMENT_STAGE_TYPES.has(stageType)) {
      throw new BadRequestException(`第 ${index + 1} 条付款条款类型不在支持范围内。`);
    }
    if (!PAYMENT_STAGE_BASES.has(stage.basis)) {
      throw new BadRequestException(`第 ${index + 1} 条付款依据不在支持范围内。`);
    }
    if (
      stage.ratioBps !== undefined &&
      (!Number.isInteger(stage.ratioBps) || stage.ratioBps < 0 || stage.ratioBps > 10000)
    ) {
      throw new BadRequestException(`第 ${index + 1} 条付款比例必须在 0% 到 100% 之间。`);
    }
    let fixedAmountCents: bigint | undefined;
    if (stage.fixedAmountCents !== undefined) {
      fixedAmountCents = parseMoneyCentsInput(
        stage.fixedAmountCents,
        "固定金额",
        `第 ${index + 1} 条固定金额必须大于 0。`
      );
      if (fixedAmountCents <= 0n) {
        throw new BadRequestException(`第 ${index + 1} 条固定金额必须大于 0。`);
      }
    }
    const triggerAnchor = stage.triggerAnchor ?? "settlement_effective";
    if (!PAYMENT_STAGE_TRIGGER_ANCHORS.has(triggerAnchor)) {
      throw new BadRequestException(`第 ${index + 1} 条付款触发节点不在支持范围内。`);
    }
    if (!stage.triggerEvent?.trim()) {
      throw new BadRequestException(`第 ${index + 1} 条付款条款缺少触发说明。`);
    }
    if (
      !Number.isSafeInteger(stage.dueDays) ||
      stage.dueDays < 0 ||
      stage.dueDays > 2_147_483_647
    ) {
      throw new BadRequestException(`第 ${index + 1} 条付款期限必须是非负天数。`);
    }
    const advanceDeductionMode = stage.advanceDeductionMode ?? "none";
    if (!ADVANCE_DEDUCTION_MODES.has(advanceDeductionMode)) {
      throw new BadRequestException(`第 ${index + 1} 条预付款扣回方式不在支持范围内。`);
    }
    for (const [field, label] of [
      ["requiresInvoice", "是否要求发票"],
      ["allowsEarlyPayment", "是否允许提前付款"],
      ["allowsInstallments", "是否允许分次付款"]
    ] as const) {
      if (typeof stage[field] !== "boolean") {
        throw new BadRequestException(`第 ${index + 1} 条付款条款缺少${label}。`);
      }
    }

    return {
      name: stage.name.trim(),
      stageType,
      basis: stage.basis,
      ratioBps: stage.ratioBps,
      fixedAmountCents,
      triggerAnchor,
      triggerEvent: stage.triggerEvent.trim(),
      dueDays: stage.dueDays,
      advanceDeductionMode,
      advanceDeductionRatioBps: stage.advanceDeductionRatioBps,
      advanceDeductionStartRatioBps: stage.advanceDeductionStartRatioBps,
      requiresInvoice: stage.requiresInvoice,
      allowsEarlyPayment: stage.allowsEarlyPayment,
      allowsInstallments: stage.allowsInstallments,
      retentionBps: stage.retentionBps,
      originalText: stage.originalText?.trim() || stage.triggerEvent.trim()
    };
  }

  async generatePdfArchive(
    contractVersionId: string,
    actorUserId: string,
    input: GenerateContractPdfArchiveDto = {}
  ) {
    if (!this.files) {
      throw new Error("合同归档 PDF 服务暂不可用，请稍后重试或联系管理员");
    }

    const templateKey = input.templateKey ?? "contract_archive";
    const departmentScope = input.departmentScope ?? "contract";
    const source = await this.prisma.$transaction(async (tx) => {
      const version = await tx.contractVersion.findUnique({
        where: { id: contractVersionId }
      });

      if (!version) {
        throw new Error("未找到合同版本，请刷新合同台账后重试");
      }

      if (version.status !== "effective") {
        throw new Error("当前合同版本尚未生效，暂不能生成归档 PDF");
      }

      const contract = await tx.contract.findUnique({ where: { id: version.contractId } });

      if (!contract) {
        throw new Error("未找到合同主数据，请刷新合同台账后重试");
      }

      const existingPdf = await tx.pdfDocument.findFirst({
        where: {
          businessType: "contract_version",
          businessId: version.id,
          templateKey
        }
      });

      if (existingPdf) {
        throw new Error("合同归档 PDF 已生成，请勿重复生成");
      }

      return { contract, version };
    });
    const buffer = renderSimplePdf([
      "合同归档单",
      `合同编号：${source.contract.code}`,
      `合同名称：${source.contract.name}`,
      `相对方：${source.contract.counterparty}`,
      `版本号：${source.version.versionNo}`,
      `合同金额：${this.formatYuan(source.version.amountCents)} 元`,
      `归档模板：${templateKey}`,
      `生成时间：${new Date().toISOString()}`
    ]);
    const file = await this.files.uploadPrivateFile({
      originalName: `${source.contract.code}-v${source.version.versionNo}-${templateKey}.pdf`,
      mimeType: "application/pdf",
      sizeBytes: buffer.length,
      uploadedByUserId: actorUserId,
      buffer
    });

    return this.prisma.$transaction(async (tx) => {
      const pdfDocument = await tx.pdfDocument.create({
        data: {
          businessType: "contract_version",
          businessId: source.version.id,
          fileId: file.id,
          templateKey
        }
      });
      const archiveRecord = await tx.archiveRecord.create({
        data: {
          businessType: "contract_version",
          businessId: source.version.id,
          fileId: file.id,
          departmentScope
        }
      });

      await this.audit.record(tx, {
        actorUserId,
        action: "contract.pdf_archive.generate",
        businessType: "contract_version",
        businessId: source.version.id,
        metadata: {
          code: source.contract.code,
          pdfDocumentId: pdfDocument.id,
          archiveRecordId: archiveRecord.id,
          fileId: file.id,
          templateKey,
          departmentScope
        }
      });

      return { pdfDocument, archiveRecord };
    });
  }

  private async updateVersionStatus(input: {
    contractVersionId: string;
    expectedStatus: string;
    nextStatus: string;
    actorUserId: string;
    action: string;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const version = await tx.contractVersion.findUnique({
        where: { id: input.contractVersionId }
      });

      if (!version) {
        throw new Error("未找到要用章确认的合同版本，请刷新合同台账后重试");
      }

      if (version.status !== input.expectedStatus) {
        throw new Error("当前合同尚不能用章确认，请先完成合同审批");
      }

      const updated = await tx.contractVersion.update({
        where: { id: version.id },
        data: { status: input.nextStatus }
      });

      await this.audit.record(tx, {
        actorUserId: input.actorUserId,
        action: input.action,
        businessType: "contract_version",
        businessId: version.id,
        metadata: {
          fromStatus: version.status,
          toStatus: input.nextStatus
        }
      });

      return updated;
    });
  }

  private async loadActorRoleKeys(
    tx: {
      contract: { findUnique(input: unknown): Promise<{ projectId: string } | null> };
      userPosition: {
        findMany(input: unknown): Promise<Array<{ positionId: string; projectId: string | null }>>;
      };
      projectMember: { findMany(input: unknown): Promise<Array<{ positionKey: string }>> };
      position: { findMany(input: unknown): Promise<Array<{ id: string; key: string }>> };
    },
    actorUserId: string,
    contractId: string
  ): Promise<RoleKey[]> {
    const contract = await tx.contract.findUnique({ where: { id: contractId } });

    if (!contract) {
      throw new Error("未找到合同主信息，请刷新合同后重试");
    }

    const [globalPositions, projectPositions, projectMembers] = await Promise.all([
      tx.userPosition.findMany({ where: { userId: actorUserId, projectId: null } }),
      tx.userPosition.findMany({ where: { userId: actorUserId, projectId: contract.projectId } }),
      tx.projectMember.findMany({ where: { userId: actorUserId, projectId: contract.projectId } })
    ]);
    const positionIds = Array.from(
      new Set([...globalPositions, ...projectPositions].map((position) => position.positionId))
    );
    const positions = positionIds.length
      ? await tx.position.findMany({ where: { id: { in: positionIds } } })
      : [];
    const positionKeys = positions.map((position) => position.key as RoleKey);
    const memberKeys = projectMembers.map((member) => member.positionKey as RoleKey);

    return Array.from(new Set([...positionKeys, ...memberKeys]));
  }

  private formatCents(value: bigint) {
    return `${formatMoneyCentsAsYuan(dbMoneyToBigInt(value, "合同金额"))} CNY`;
  }

  private formatYuan(value: bigint) {
    return this.formatCents(value).replace(" CNY", "");
  }

  private async assignApproval(
    kind: ContractApprovalAssignment["kind"],
    contractVersionId: string,
    actorUserId: string,
    input: AssignContractApprovalDto
  ) {
    if (!input.toUserId || input.toUserId === actorUserId) {
      throw new Error("请选择有效的审批接收人，不能选择当前操作人");
    }

    return this.prisma.$transaction(async (tx) => {
      await lockApprovalReviewRow(tx, Prisma.sql`SELECT "id" FROM "ContractVersion" WHERE "id" = ${contractVersionId} FOR UPDATE`);
      const version = await tx.contractVersion.findUnique({
        where: { id: contractVersionId }
      });

      if (!version) {
        throw new Error("未找到要处理的合同审批任务，请刷新审批中心后重试");
      }

      if (version.status !== "in_approval") {
        throw new Error("当前合同不在审批中，不能转交或委托审批");
      }

      await lockApprovalReviewRow(tx, Prisma.sql`
        SELECT "id" FROM "ApprovalInstance" WHERE "businessType" = 'contract_version'
          AND "businessId" = ${version.id} AND "flowType" = 'contract.approve'
          AND "status" = 'in_progress' FOR UPDATE
      `);

      const instance = await tx.approvalInstance.findFirst({
        where: {
          businessType: "contract_version",
          businessId: version.id,
          flowType: "contract.approve",
          status: "in_progress"
        }
      });

      if (!instance) {
        throw new Error("未找到进行中的合同审批流程，请刷新审批中心后重试");
      }

      const nodes = instance.frozenNodes as unknown as ContractApprovalNode[];
      const currentNode = nodes[instance.currentNodeIndex];

      if (!currentNode) {
        throw new Error("当前合同审批节点异常，请刷新后重试");
      }

      const actorRoleKeys = await this.loadActorRoleKeys(tx, actorUserId, version.contractId);
      let identity = resolveApprovalReviewIdentity({ node: currentNode, actorUserId, actorRoleKeys });
      if (!identity) {
        const delegatorIds = this.delegations
          ? await this.delegations.activeDelegatorIds(tx, actorUserId)
          : await activeApprovalDelegatorIds(tx, actorUserId);
        const activeDelegators = await Promise.all(delegatorIds.map(async (userId) => ({
          userId,
          roleKeys: await this.loadActorRoleKeys(tx, userId, version.contractId)
        })));
        identity = resolveApprovalReviewIdentity({ node: currentNode, actorUserId, actorRoleKeys, activeDelegators });
      }
      if (!identity) {
        throw new Error("当前账号无权转交或委托该合同审批节点");
      }
      const fromRoleKey = identity.approvedRoleKey;
      await assertActiveApprovalRecipient(tx, input.toUserId);

      const nextNodes = [...nodes];
      const nextAssignments = [
        ...(currentNode.assignments ?? []).filter(
          (assignment) =>
            !(
              assignment.kind === kind &&
              assignment.fromUserId === identity.representedUserId &&
              assignment.fromRoleKey === fromRoleKey
            )
        ),
        { kind, fromUserId: identity.representedUserId, fromRoleKey, toUserId: input.toUserId }
      ];
      nextNodes[instance.currentNodeIndex] = { ...currentNode, assignments: nextAssignments };

      const updated = await tx.approvalInstance.update({
        where: { id: instance.id },
        data: { frozenNodes: nextNodes as unknown as Prisma.InputJsonValue }
      });

      await tx.approvalActionLog.create({
        data: {
          approvalInstanceId: instance.id,
          action: kind,
          actorUserId,
          approvedRoleKey: fromRoleKey,
          representedUserId: identity.representedUserId,
          metadata: {
            kind,
            fromUserId: identity.representedUserId,
            toUserId: input.toUserId,
            fromRoleKey
          }
        }
      });

      if (kind === "delegate") {
        const startsAt = new Date();
        await tx.approvalDelegation.create({
          data: {
            fromUserId: identity.representedUserId,
            toUserId: input.toUserId,
            startsAt,
            // ponytail: 临时台账窗口；全局委托管理上线后由其维护 endsAt。
            endsAt: new Date(startsAt.getTime() + 30 * 24 * 60 * 60 * 1000)
          }
        });
      }

      await this.audit.record(tx, {
        actorUserId,
        action: `contract.approval.${kind}`,
        businessType: "contract_version",
        businessId: version.id,
        metadata: {
          nodeName: currentNode.name,
          fromRoleKey,
          toUserId: input.toUserId
        }
      });

      return updated;
    });
  }
}

function requireApprovalCommentForReturn(decision: ReviewContractApprovalDto["decision"], comment?: string) {
  if (decision !== "approve" && !comment?.trim()) {
    throw new Error("请填写审批意见，说明驳回或退回原因");
  }
}

function sumBigInt(values: Array<bigint>): bigint {
  return values.reduce<bigint>(
    (total, value) => total + dbMoneyToBigInt(value, "合同金额"),
    0n
  );
}

function maxBigInt(left: bigint, right: bigint): bigint {
  const normalizedLeft = dbMoneyToBigInt(left, "合同金额");
  const normalizedRight = dbMoneyToBigInt(right, "合同金额");
  return normalizedLeft > normalizedRight ? normalizedLeft : normalizedRight;
}

function maxContractOccupancies<T extends { contractId: string; amountCents: bigint }>(
  versions: T[]
): T[] {
  return Array.from(
    versions.reduce((maxByContract, version) => {
      const current = maxByContract.get(version.contractId);
      if (
        !current ||
        dbMoneyToBigInt(version.amountCents, "合同金额") >
          dbMoneyToBigInt(current.amountCents, "合同金额")
      ) {
        maxByContract.set(version.contractId, version);
      }
      return maxByContract;
    }, new Map<string, T>()).values()
  );
}
