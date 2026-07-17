import { BadRequestException, Injectable, Optional } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { approvalElapsedHours, canRemindApproval, type RoleKey } from "@jiangkong/shared-domain";
import { ApprovalDelegationService } from "../approval/approval-delegation.service";
import { ApprovalFormService } from "../approval/approval-form.service";
import { confirmApprovalSelfReview } from "../approval/approval-self-review";
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
import { SubmitContractApprovalDto } from "./dto/submit-contract-approval.dto";
import { UploadContractArchiveFileDto } from "./dto/upload-contract-archive-file.dto";
import { CreateContractChangeDraftDto } from "./dto/create-contract-change-draft.dto";
import { evaluateContractChangeApproval } from "./contract-change-approval";
import { assertContractChangeContentAllowed } from "./contract-change-policy";

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
    @Optional()
    private readonly numbering?: ContractNumberingService
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
          amountCents: 0n,
          amountLimitType: input.amountLimitType ?? "capped",
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

  async createChangeDraft(
    effectiveVersionId: string,
    input: CreateContractChangeDraftDto,
    actorUserId: string
  ) {
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
      const originalBaseAmountCents = latest.originalBaseAmountCents ?? latest.amountCents;
      const cumulativeIncreaseCents = latest.cumulativeIncreaseCents +
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
          originalBaseAmountCents,
          cumulativeIncreaseCents,
          cumulativeDecreaseCents,
          amountLimitType,
          businessTemplateVersionId: latest.businessTemplateVersionId,
          layoutTemplateVersionId: latest.layoutTemplateVersionId,
          pricingNature: latest.pricingNature,
          amountSource: latest.amountSource,
          amountAdjustmentReason: latest.amountAdjustmentReason,
          invoiceType: latest.invoiceType,
          taxMode: latest.taxMode,
          defaultTaxRatePercent: latest.defaultTaxRatePercent,
          taxFactStatus: "draft",
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
    const route = this.approvalNodesForVersion(version);
    const approval = evaluateContractChangeApproval(version);
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
      enhancedApproval: approval.enhanced,
      enhancedApprovalReasons: approval.reasons,
      approvalRoute: route.map((node) => ({ name: node.name, mode: node.mode, roleKeys: node.roleKeys }))
    };
  }

  async uploadArchiveFile(
    contractVersionId: string,
    actorUserId: string,
    input: UploadContractArchiveFileDto
  ) {
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
    try {
      return await this.prisma.$transaction(async (tx) => {
        const [version] = await tx.$queryRaw<
          Array<NonNullable<Awaited<ReturnType<typeof tx.contractVersion.findUnique>>>>
        >(Prisma.sql`
          SELECT *
          FROM "ContractVersion"
          WHERE "id" = ${contractVersionId}
          FOR UPDATE
        `);
        if (!version) throw new Error("未找到要提交审批的合同版本，请刷新合同后重试");

        const contract = await tx.contract.findUnique({
          where: { id: version.contractId }
        });
        if (!contract) throw new Error("未找到合同主信息，请刷新合同后重试");
        if (contract.voidedAt) throw new Error("作废合同不能提交审批，请重新选择有效合同");
        if (contract.ownerUserId && contract.ownerUserId !== actorUserId) {
          throw new Error("只有合同经办人可以提交该合同审批");
        }
        await this.assertChangeAmountProjection(tx, version);

        const input = contract.ownerUserId ? this.parseSubmissionInput(rawInput) : null;
        let formalCode = contract.code;
        let readinessSnapshot = version.readinessSnapshot;
        let templateSnapshot = version.templateSnapshot;
        if (input) {
          if (!this.readiness || !this.numbering) {
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

        await this.assertOwnerContractQuota(tx, contract.projectId, contract.id, version.amountCents);

        if (input) {
          formalCode = await this.numbering!.allocate(
            tx,
            input.numberRuleId,
            contract,
            actorUserId,
            input
          );
          const submissionSnapshot = await this.readiness!.freeze(tx, version);
          templateSnapshot = {
            ...(version.templateSnapshot as Prisma.JsonObject),
            submissionSnapshot
          } as unknown as Prisma.JsonValue;
        }

        const companySnapshot = !contract.ownerUserId ||
          version.changeType === "change" ||
          version.changeType === "supplement"
          ? null
          : await this.lockCompanyEntityForSubmission(tx, version, contract);

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
            ...(input
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
            frozenNodes: this.approvalNodesForVersion(version) as unknown as Prisma.InputJsonValue,
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
            ...(input
              ? {
                  numberRuleId: input.numberRuleId,
                  ...(input.overrideReason
                    ? { overrideReason: input.overrideReason }
                    : {}),
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
      });
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "P2002"
      ) {
        throw new BadRequestException("正式合同编号已存在，请刷新后重新提交或选择其他编号");
      }
      throw error;
    }
  }

  private async assertOwnerContractQuota(
    tx: Prisma.TransactionClient,
    projectId: string,
    currentContractId: string,
    amountCents: bigint
  ) {
    const requestedAmountCents = dbMoneyToBigInt(amountCents, "合同金额");
    if (requestedAmountCents <= 0n) {
      throw new BadRequestException("合同金额必须大于 0，不能提交零金额或负数合同审批");
    }

    await tx.$queryRaw(Prisma.sql`
      SELECT "id"
      FROM "Project"
      WHERE "id" = ${projectId}
      FOR UPDATE
    `);

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
      changeType: string;
      baseVersionId: string | null;
      changeDirection: string | null;
      changeAmountCents: bigint | null;
      amountCents: bigint;
      draftData: Prisma.JsonValue;
      clauseSnapshot: Prisma.JsonValue;
      templateSnapshot: Prisma.JsonValue;
    }
  ) {
    if (version.changeType !== "change" && version.changeType !== "supplement") return;
    if (!version.baseVersionId || !version.changeDirection || version.changeAmountCents === null) {
      throw new BadRequestException("合同变更金额声明不完整，不能提交审批");
    }
    const base = await tx.contractVersion.findUnique({
      where: { id: version.baseVersionId }
    });
    if (!base) throw new BadRequestException("合同变更直接来源版本不存在，不能提交审批");
    const expected = version.changeDirection === "increase"
      ? base.amountCents + version.changeAmountCents
      : version.changeDirection === "decrease"
        ? base.amountCents - version.changeAmountCents
        : base.amountCents;
    if (version.amountCents !== expected) {
      throw new BadRequestException("合同当前金额与已声明变更金额不一致，请恢复清单或金额后再提交审批");
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

  private parseSubmissionInput(rawInput: unknown): SubmitContractApprovalDto {
    if (!rawInput || typeof rawInput !== "object" || Array.isArray(rawInput)) {
      throw new BadRequestException("提交合同审批前请先选择编号规则");
    }
    const input = rawInput as Record<string, unknown>;
    if (typeof input.numberRuleId !== "string" || !input.numberRuleId.trim()) {
      throw new BadRequestException("提交合同审批前请先选择编号规则");
    }
    if (
      input.formalCodeOverride !== undefined &&
      (typeof input.formalCodeOverride !== "string" ||
        !input.formalCodeOverride.trim())
    ) {
      throw new BadRequestException("正式合同编号不能为空");
    }
    if (
      input.overrideReason !== undefined &&
      (typeof input.overrideReason !== "string" || !input.overrideReason.trim())
    ) {
      throw new BadRequestException("调整正式合同编号时请填写原因");
    }
    return {
      numberRuleId: input.numberRuleId.trim(),
      ...(input.formalCodeOverride === undefined
        ? {}
        : { formalCodeOverride: input.formalCodeOverride.trim() }),
      ...(input.overrideReason === undefined
        ? {}
        : { overrideReason: input.overrideReason.trim() })
    };
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
      const version = await tx.contractVersion.findUnique({
        where: { id: contractVersionId }
      });

      if (!version) {
        throw new Error("未找到合同版本，请刷新合同台账后重试");
      }

      if (version.status !== "in_approval") {
        throw new Error("当前合同已离开审批中，不能继续处理审批");
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
        throw new Error("未找到进行中的合同审批流程，请刷新后重试");
      }

      const nodes = instance.frozenNodes as unknown as ContractApprovalNode[];
      const currentNode = nodes[instance.currentNodeIndex];

      if (!currentNode) {
        throw new Error("当前合同审批节点异常，请刷新后重试");
      }

      const actorRoleKeys = await this.loadActorRoleKeys(tx, actorUserId, version.contractId);
      let approvedRoleKey =
        currentNode.roleKeys.find((role) => actorRoleKeys.includes(role)) ??
        currentNode.assignments?.find((assignment) => assignment.toUserId === actorUserId)
          ?.fromRoleKey;

      if (!approvedRoleKey) {
        approvedRoleKey = await this.resolveDelegatedRoleKey(
          tx,
          actorUserId,
          version.contractId,
          currentNode.roleKeys
        );
      }

      if (!approvedRoleKey) {
        throw new Error("当前账号无权处理该合同审批节点");
      }

      const selfReview = await confirmApprovalSelfReview({
        applicantUserId: instance.applicantUserId,
        actorUserId,
        actorRoleKeys,
        approvedRoleKey,
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
          ...(selfReview.isSelfReview ? { metadata: selfReview.metadata } : {})
        }
      });

      if (isFinalApproval) {
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
      await this.approvalForms
        ?.generateForInstance(completedInstanceId, actorUserId)
        .catch(() => undefined);
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
    const nodes = evaluateContractChangeApproval(version).enhanced
      ? ENHANCED_CONTRACT_CHANGE_APPROVAL_NODES
      : CONTRACT_APPROVAL_NODES;
    return nodes.map((node) => ({ ...node }));
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

      await this.assertStructuredSettlementPaymentStage(tx, version.id);

      const confirmedAt = new Date();
      await tx.contractArchiveFile.update({
        where: { id: archiveFile.id },
        data: {
          confirmedByUserId: actorUserId,
          confirmedAt,
          status: "confirmed"
        }
      });

      let supersededVersionId: string | null = null;
      if (version.changeType === "change" || version.changeType === "supplement") {
        if (!version.baseVersionId) {
          throw new BadRequestException("合同变更缺少直接来源版本，不能确认归档");
        }
        const predecessor = await tx.contractVersion.findUnique({
          where: { id: version.baseVersionId }
        });
        if (
          !predecessor ||
          predecessor.contractId !== version.contractId ||
          predecessor.status !== "effective"
        ) {
          throw new BadRequestException("被替代合同版本已不是当前生效版本，请刷新后重试");
        }
        const latestEffective = await tx.contractVersion.findFirst({
          where: { contractId: version.contractId, status: "effective" },
          orderBy: { versionNo: "desc" },
          select: { id: true }
        });
        if (latestEffective?.id !== predecessor.id) {
          throw new BadRequestException("只能让当前最新生效版本的直接变更版本生效");
        }
        await tx.contractVersion.update({
          where: { id: predecessor.id },
          data: { status: "superseded" }
        });
        await tx.paymentTermsVersion.updateMany({
          where: { contractVersionId: predecessor.id, status: "effective" },
          data: { status: "superseded" }
        });
        supersededVersionId = predecessor.id;
      }

      const effectiveVersion = await tx.contractVersion.update({
        where: { id: version.id },
        data: {
          status: "effective",
          taxFactStatus: "confirmed",
          effectiveAt: confirmedAt,
          ...(supersededVersionId ? { supersedesVersionId: supersededVersionId } : {})
        }
      });

      await tx.paymentTermsVersion.updateMany({
        where: { contractVersionId: version.id },
        data: { status: "effective" }
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
    contractVersionId: string
  ) {
    const terms = await tx.paymentTermsVersion.findFirst({
      where: { contractVersionId },
      select: { id: true }
    });
    if (!terms) {
      throw new BadRequestException(
        "合同付款条款还未结构化，不能确认归档生效。请先维护结算款、付款比例、付款期限和发票要求。"
      );
    }

    const stage = await tx.paymentTermsStage.findFirst({
      where: {
        paymentTermsVersionId: terms.id,
        basis: "current_settlement",
        ratioBps: { gt: 0 }
      },
      select: { id: true }
    });
    if (!stage) {
      throw new BadRequestException(
        "合同付款条款缺少结算款阶段，不能确认归档生效。请先维护结算款、付款比例、付款期限和发票要求。"
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

  // 常驻委托台账消费：本人岗位/节点指派都不命中时，看是否有在窗口内的委托人持有该节点角色。
  private async resolveDelegatedRoleKey(
    tx: Prisma.TransactionClient,
    actorUserId: string,
    contractId: string,
    nodeRoleKeys: RoleKey[]
  ): Promise<RoleKey | undefined> {
    if (!this.delegations) {
      return undefined;
    }

    const delegatorIds = await this.delegations.activeDelegatorIds(tx, actorUserId);

    for (const delegatorId of delegatorIds) {
      const delegatorRoleKeys = await this.loadActorRoleKeys(tx, delegatorId, contractId);
      const match = nodeRoleKeys.find((role) => delegatorRoleKeys.includes(role));

      if (match) {
        return match;
      }
    }

    return undefined;
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
      const version = await tx.contractVersion.findUnique({
        where: { id: contractVersionId }
      });

      if (!version) {
        throw new Error("未找到要处理的合同审批任务，请刷新审批中心后重试");
      }

      if (version.status !== "in_approval") {
        throw new Error("当前合同不在审批中，不能转交或委托审批");
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

      const nodes = instance.frozenNodes as unknown as ContractApprovalNode[];
      const currentNode = nodes[instance.currentNodeIndex];

      if (!currentNode) {
        throw new Error("当前合同审批节点异常，请刷新后重试");
      }

      const actorRoleKeys = await this.loadActorRoleKeys(tx, actorUserId, version.contractId);
      const fromRoleKey = currentNode.roleKeys.find((role) => actorRoleKeys.includes(role));

      if (!fromRoleKey) {
        throw new Error("当前账号无权转交或委托该合同审批节点");
      }

      const nextNodes = [...nodes];
      const nextAssignments = [
        ...(currentNode.assignments ?? []).filter(
          (assignment) =>
            !(
              assignment.kind === kind &&
              assignment.fromUserId === actorUserId &&
              assignment.fromRoleKey === fromRoleKey
            )
        ),
        { kind, fromUserId: actorUserId, fromRoleKey, toUserId: input.toUserId }
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
          actorUserId
        }
      });

      if (kind === "delegate") {
        const startsAt = new Date();
        await tx.approvalDelegation.create({
          data: {
            fromUserId: actorUserId,
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
