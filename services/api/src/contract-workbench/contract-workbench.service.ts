import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import { Prisma, type ContractVersion } from "@prisma/client";
import { isDeepStrictEqual } from "node:util";
import {
  CONTRACT_INVOICE_TYPES,
  CONTRACT_TAX_MODES,
  contractInvoiceTypeLabel,
  contractPricingPolicy,
  isContractSettlementMode,
  normalizeTaxRatePercent,
  type ContractBillDefinition,
  type ContractClauseDefinition,
  type ContractFieldDefinition,
  type ContractInvoiceType,
  type ContractTaxFactSource,
  type ContractTaxFactStatus,
  type ContractTaxMode,
  type SupplementChangePolicy
} from "@jiangkong/shared-domain";
import { AuditService } from "../audit/audit.service";
import { assertContractChangeContentAllowed } from "../contract/contract-change-policy";
import {
  loadContractDraftLifecycle,
  lockContractDraftMutationBoundary
} from "../contract/contract-draft-lifecycle";
import { ContractBillLineageService } from "../contract-bill/contract-bill-lineage.service";
import { assertContractBillDerivedUnitPrices } from "../contract-bill/contract-bill-totals";
import { PrismaService } from "../database/prisma.service";
import { ContractReadinessService } from "./contract-readiness.service";
import {
  moneyCentsToApi,
  parseMoneyCents,
  parseMoneyCentsInput
} from "../money/decimal-money";
import type {
  ApplyContractTypeChangeDto,
  ConfirmContractSettlementModeDto,
  CreateDraftCheckpointDto,
  PreviewContractTypeChangeDto,
  SaveContractDraftAggregateDto,
  SaveContractDraftDto,
  SaveContractTaxFactsDto,
  TransferContractDraftDto,
  VoidDraftDto
} from "./dto/contract-workbench.dto";

const EDITABLE_STATUSES = new Set(["draft", "approval_rejected"]);
const PRICING_NATURES = new Set([
  "fixed_total",
  "provisional_total",
  "unit_price",
  "framework"
]);
const AMOUNT_SOURCES = new Set(["bill_sum", "manual"]);
const CHECKPOINT_RETRY_LIMIT = 3;
const PAYMENT_STAGE_TRIGGER_EVENT = "结算归档确认生效";
const SETTLEMENT_CONTRACT_TYPE_KEYS = new Set([
  "material_purchase",
  "equipment_rental",
  "labor_subcontract",
  "professional_subcontract"
]);

interface TemplateSnapshot {
  fieldSchema: ContractFieldDefinition[];
  billSchema: ContractBillDefinition[];
  clauseSchema: ContractClauseDefinition[];
  attachmentSchema: unknown[];
  validationSchema: unknown[];
  supplementChangePolicy?: SupplementChangePolicy;
}

interface BillSnapshot {
  billKey: string;
  name: string;
  amountRole: string;
  pricingMode: string;
  quantityScale: number;
  unitPriceScale: number;
  schemaSnapshot: unknown;
  sourceExcelFileId: string | null;
  revision: number;
  taxInclusiveAmountCents: string;
  taxExclusiveAmountCents: string;
  taxAmountCents: string;
  rows: Array<{
    rowKey: string;
    sortOrder: number;
    itemCode: string | null;
    itemName: string;
    specification: string | null;
    unit: string;
    quantity: string | null;
    unitPrice: string | null;
    taxRate: string | null;
    taxRatePercent?: string | null;
    taxRateSource?: string;
    pricingFactStatus?: string;
    precisionPolicy?: string;
    taxInclusiveAmountCents: string | null;
    taxExclusiveAmountCents: string | null;
    taxAmountCents: string | null;
    taxExclusiveUnitPrice?: string | null;
    isProvisional: boolean;
    settlementBasis: string | null;
    customData: unknown;
  }>;
}

interface CheckpointSnapshot {
  draftData: Record<string, unknown>;
  clauseSnapshot: ContractClauseDefinition[];
  pricingNature: string;
  amountSource: string;
  amountCents: string;
  estimatedAmountCents?: string | null;
  amountAdjustmentReason: string | null;
  layoutTemplateVersionId: string | null;
  taxFacts?: {
    invoiceType: ContractInvoiceType | null;
    taxMode: ContractTaxMode;
    defaultTaxRatePercent: string | null;
    status: ContractTaxFactStatus;
    source: ContractTaxFactSource | null;
  };
  bills: BillSnapshot[];
}

@Injectable()
export class ContractWorkbenchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly readiness?: ContractReadinessService,
    private readonly lineage: ContractBillLineageService = new ContractBillLineageService()
  ) {}

  async checkReadiness(contractVersionId: string, actorUserId: string) {
    if (!this.readiness) {
      throw new BadRequestException("合同资料检查服务暂不可用，请稍后重试或联系管理员");
    }
    await this.assertNotHistoricalTakeoverVersionId(
      this.prisma,
      contractVersionId,
      actorUserId
    );
    return this.readiness.checkAndStore(contractVersionId, actorUserId);
  }

  async getTransferCapability(contractId: string, actorUserId: string) {
    return this.prisma.$transaction(async (tx) => {
      await this.assertGlobalContractDirector(tx, actorUserId);
      const contract = await tx.contract.findUnique({
        where: { id: contractId },
        select: { id: true, voidedAt: true }
      });
      if (!contract) {
        throw new NotFoundException("未找到合同草稿，请刷新合同工作台后重试");
      }
      const version = await tx.contractVersion.findFirst({
        where: {
          contractId,
          status: { in: [...EDITABLE_STATUSES] }
        },
        select: { id: true },
        orderBy: { versionNo: "desc" }
      });
      return {
        contractId,
        contractVersionId: version?.id ?? null,
        availableActions:
          version && !contract.voidedAt ? ["transfer_contract_draft"] : []
      };
    });
  }

  async listDrafts(actorUserId: string, scope: "my" | "voided") {
    if (scope !== "my" && scope !== "voided") {
      throw new BadRequestException("合同工作台列表范围不正确，请刷新页面后重试");
    }
    const isDirector = await this.hasGlobalContractDirector(this.prisma, actorUserId);
    const versions = await this.prisma.contractVersion.findMany({
      where: { status: { in: [...EDITABLE_STATUSES] } },
      select: { id: true, contractId: true, changeType: true }
    });
    const versionIds = versions.map((version) => version.id);
    const lookupClient = this.historicalTakeoverLookupClient(this.prisma);
    const takeoverRows = lookupClient.contractTakeover && versionIds.length
      ? await lookupClient.contractTakeover.findMany({
          where: { contractVersionId: { in: versionIds } },
          select: { contractVersionId: true }
        })
      : [];
    const takeoverVersionIds = new Set(
      takeoverRows.map((takeover) => takeover.contractVersionId)
    );
    const ordinaryVersions = versions.filter((version) =>
      version.changeType !== "historical_takeover" &&
      !takeoverVersionIds.has(version.id)
    );
    return this.toReadModel(await this.prisma.contract.findMany({
      where: {
        id: {
          in: [...new Set(ordinaryVersions.map((version) => version.contractId))]
        },
        voidedAt: scope === "voided" ? { not: null } : null,
        ...(isDirector ? {} : { ownerUserId: actorUserId })
      },
      orderBy: { updatedAt: "desc" }
    }));
  }

  async getDraft(contractId: string, actorUserId: string) {
    return this.loadDraft(contractId, actorUserId);
  }

  async getDraftFromExactVersion(version: ContractVersion, actorUserId: string) {
    return this.loadDraft(version.contractId, actorUserId, version);
  }

  private async loadDraft(
    contractId: string,
    actorUserId: string,
    exactVersion?: ContractVersion
  ) {
    const contract = await this.prisma.contract.findUnique({ where: { id: contractId } });
    if (!contract) throw new NotFoundException("未找到合同草稿，请刷新合同工作台后重试");
    await this.assertCanView(this.prisma, contract.ownerUserId, actorUserId);
    if (exactVersion && contract.voidedAt) {
      throw new BadRequestException("合同草稿已作废，不能继续办理");
    }

    const version = exactVersion ?? await this.prisma.contractVersion.findFirst({
      where: { contractId, status: { in: [...EDITABLE_STATUSES] } },
      orderBy: { versionNo: "desc" }
    });
    if (!version) throw new NotFoundException("未找到合同草稿版本，请刷新合同工作台后重试");
    await this.assertNotHistoricalTakeoverVersion(
      this.prisma,
      version,
      contract
    );
    if (!EDITABLE_STATUSES.has(version.status)) {
      throw new BadRequestException("合同版本当前不可按草稿办理，请刷新后重试");
    }
    const lifecycle = await loadContractDraftLifecycle(this.prisma, version);
    const lifecycleAction = lifecycle.expectedAction;
    if (!lifecycleAction) {
      throw new BadRequestException("合同版本当前不可按草稿办理，请刷新后重试");
    }

    const [
      bills,
      checkpoints,
      parties,
      documents,
      paymentTerms,
      authorizationLinks,
      formalFiles
    ] = await Promise.all([
      this.prisma.contractBill.findMany({ where: { contractVersionId: version.id } }),
      this.prisma.contractDraftCheckpoint.findMany({
        where: { contractVersionId: version.id },
        orderBy: { sequenceNo: "desc" },
        select: {
          id: true,
          sequenceNo: true,
          name: true,
          snapshot: true,
          createdAt: true
        }
      }),
      this.prisma.contractPartySnapshot.findMany({
        where: { contractVersionId: version.id },
        orderBy: [{ roleKey: "asc" }, { displayOrder: "asc" }]
      }),
      this.loadGeneratedDocumentsForDraft(version),
      this.prisma.paymentTermsVersion.findFirst({
        where: { contractVersionId: version.id },
        select: { id: true, originalText: true }
      }),
      version.contractGovernanceVersion === 1
        ? this.prisma.contractVersionAuthorizationLink.findMany({
            where: { contractVersionId: version.id },
            orderBy: { side: "asc" }
          })
        : Promise.resolve([]),
      version.contractGovernanceVersion === 1
        ? this.prisma.contractFormalFile.findMany({
            where: { contractVersionId: version.id, status: "active" },
            orderBy: { createdAt: "desc" }
          })
        : Promise.resolve([])
    ]);
    const authorizationIds = authorizationLinks
      .map((link) => link.authorizationId)
      .filter((id): id is string => Boolean(id));
    const authorizations = authorizationIds.length
      ? await this.prisma.contractAuthorization.findMany({
          where: { id: { in: authorizationIds } },
          orderBy: { createdAt: "desc" }
        })
      : [];
    const authorizationReuseCandidates = version.contractGovernanceVersion === 1
      ? await this.loadAuthorizationReuseCandidates(version.contractId, version.id)
      : [];
    const paymentStages = paymentTerms
      ? await this.prisma.paymentTermsStage.findMany({
          where: { paymentTermsVersionId: paymentTerms.id },
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            name: true,
            basis: true,
            ratioBps: true,
            triggerEvent: true,
            dueDays: true,
            requiresInvoice: true,
            allowsEarlyPayment: true,
            allowsInstallments: true,
            originalText: true
          }
        })
      : [];
    const rows = bills.length
      ? await this.prisma.contractBillRow.findMany({
          where: { contractBillId: { in: bills.map((bill) => bill.id) } },
          orderBy: [{ contractBillId: "asc" }, { sortOrder: "asc" }]
        })
      : [];
    assertContractBillDerivedUnitPrices(rows);
    const remainderCancellationFacts = await this.lineage.remainderCancellationFacts(
      this.prisma,
      { id: version.id, baseVersionId: version.baseVersionId },
      rows
    );
    const baseVersion = version.baseVersionId
      ? await this.prisma.contractVersion.findUnique({
          where: { id: version.baseVersionId },
          select: { id: true, versionNo: true, status: true, amountCents: true }
        })
      : null;
    const isChangeVersion = version.changeType === "change" || version.changeType === "supplement";
    const isOwner = contract.ownerUserId === actorUserId;
    const isDirectorProxyCleanup =
      !isOwner &&
      lifecycleAction === "delete_pristine_draft" &&
      await this.hasGlobalContractDirector(this.prisma, actorUserId);
    const canExecuteLifecycleAction =
      Boolean(lifecycleAction) && (isOwner || isDirectorProxyCleanup);
    const lifecycleDisabledReasons = lifecycleAction && !canExecuteLifecycleAction
      ? ["只有当前合同经办人可以结束该草稿"]
      : [];
    const changePolicy = isChangeVersion
      ? this.parseTemplateSnapshot(version.templateSnapshot).supplementChangePolicy ?? null
      : null;
    const remainderFacts = [...remainderCancellationFacts.values()].filter(
      (facts) => facts.hasHistoricalOccupancy
    );
    const hasCompleteCancellableRemainder = remainderFacts.some(
      (facts) =>
        facts.canCancel &&
        facts.historicalQuantity !== null &&
        Boolean(facts.expectedOccupancyToken?.trim())
    );
    const remainderActionEnabled =
      isOwner &&
      EDITABLE_STATUSES.has(version.status) &&
      hasCompleteCancellableRemainder;
    const remainderAction = remainderFacts.length
      ? {
          key: "contract-bill.remainder-cancellation",
          label: "取消未实施余量",
          kind: "danger",
          enabled: remainderActionEnabled,
          disabledReason: remainderActionEnabled
            ? null
            : !isOwner
              ? "只有当前合同经办人可以取消未实施余量"
              : !EDITABLE_STATUSES.has(version.status)
                ? "合同版本当前不可编辑"
                : "当前没有事实完整且可取消的未实施余量",
          requiresComment: true,
          requiresPassword: false
        }
      : null;
    return this.toReadModel({
      contractLifecycleStage: lifecycle.contractLifecycleStage,
      contractLifecycleCapabilities: lifecycle.capabilities,
      lifecycleKind: lifecycle.lifecycleKind,
      availableLifecycleActions: lifecycleAction ? [lifecycleAction] : [],
      availableActions: [
        ...(lifecycleAction ? [{
          key: lifecycleAction,
          label: lifecycleAction === "abandon_application" ? "放弃合同申请" : "删除草稿",
          kind: "danger",
          enabled: canExecuteLifecycleAction,
          disabledReason: lifecycleDisabledReasons.length ? lifecycleDisabledReasons.join("；") : null,
          requiresComment:
            lifecycleAction === "abandon_application" || isDirectorProxyCleanup,
          requiresPassword: isDirectorProxyCleanup
        }] : []),
        ...(remainderAction ? [remainderAction] : [])
      ],
      lifecycleBlockers: [...lifecycle.blockers, ...lifecycleDisabledReasons],
      lifecycleUpdatedAt: version.updatedAt?.toISOString() ?? contract.updatedAt?.toISOString() ?? "",
      expectedDraftRevision: version.draftRevision,
      contract,
      version: {
        ...version,
        taxFacts: this.taxFactsReadModel(version)
      },
      change: {
        isChange: isChangeVersion,
        baseVersion,
        changeType: version.changeType,
        changeReason: version.changeReason,
        changeDirection: version.changeDirection,
        changeAmountCents: version.changeAmountCents,
        originalBaseAmountCents: version.originalBaseAmountCents,
        cumulativeIncreaseCents: version.cumulativeIncreaseCents,
        cumulativeDecreaseCents: version.cumulativeDecreaseCents,
        amountLimitType: version.amountLimitType,
        enhancedApproval: false,
        enhancedApprovalReasons: [],
        approvalRouteLabel: version.changeType === "supplement"
          ? "历史路线未冻结"
          : "合同变更",
        approvalRoute: version.changeType === "change"
          ? ["contract_director", "project_manager", "finance_director", "chairman_or_general_manager"]
          : [],
        changePolicy
      },
      settlementMode: {
        value: version.settlementMode,
        source: version.settlementModeSource,
        confirmedAt: version.settlementModeConfirmedAt?.toISOString() ?? null,
        confirmedByUserId: version.settlementModeConfirmedByUserId,
        confirmationRequired: !version.settlementModeConfirmedAt,
        canConfirm: await this.hasGlobalContractDirector(this.prisma, actorUserId)
      },
      readiness: this.readinessFromSnapshot(version.readinessSnapshot),
      governance: version.contractGovernanceVersion === 1
        ? {
            version: 1,
            authorizationLinks,
            authorizations,
            authorizationReuseCandidates,
            formalFiles
          }
        : null,
      bills: bills.map((bill) => ({
        ...bill,
        rows: rows
          .filter((row) => row.contractBillId === bill.id)
          .map((row) => {
            const facts = remainderCancellationFacts.get(row.id);
            if (!facts?.hasHistoricalOccupancy) {
              return {
                ...row,
                unitPrice: this.formatUnitPrice(row.unitPrice),
                taxRatePercent: row.taxRate?.toString() ?? null
              };
            }
            const factsComplete =
              facts.historicalQuantity !== null &&
              Boolean(facts.expectedOccupancyToken?.trim());
            const enabled =
              isOwner &&
              EDITABLE_STATUSES.has(version.status) &&
              facts.canCancel &&
              factsComplete;
            const disabledReason = enabled
              ? null
              : !isOwner
                ? "只有当前合同经办人可以取消未实施余量"
                : !EDITABLE_STATUSES.has(version.status)
                  ? "合同版本当前不可编辑"
                  : facts.disabledReason ?? (
                    factsComplete
                      ? "该清单行当前没有可取消的未实施余量"
                      : "历史结算占用事实不完整，请刷新后重试"
                  );
            return {
              ...row,
              unitPrice: this.formatUnitPrice(row.unitPrice),
              taxRatePercent: row.taxRate?.toString() ?? null,
              availableActions: [{
                key: "contract-bill.remainder-cancellation",
                label: "取消未实施余量",
                kind: "danger",
                enabled,
                disabledReason,
                requiresComment: true,
                requiresPassword: false
              }],
              remainderCancellation: {
                expectedBillRevision: bill.revision,
                expectedDraftRevision: version.draftRevision,
                expectedOccupancyToken: facts.expectedOccupancyToken,
                historicalQuantity: facts.historicalQuantity,
                historicalAmountCents: facts.historicalAmountCents
              }
            };
          })
      })),
      checkpoints,
      parties,
      documents,
      paymentTerms: paymentTerms
        ? { originalText: paymentTerms.originalText, stages: paymentStages }
        : { originalText: "", stages: [] }
    });
  }

  async saveDraft(
    contractVersionId: string,
    actorUserId: string,
    rawInput: unknown
  ) {
    const input = this.parseSaveInput(rawInput);
    return this.prisma.$transaction(async (tx) => {
      const { version, contract } = await this.lockAndReloadOwnedEditableVersion(
        tx,
        contractVersionId,
        actorUserId
      );
      this.assertRevision(version.draftRevision, input.expectedRevision);

      const template = this.parseTemplateSnapshot(version.templateSnapshot);
      const isChangeVersion =
        version.changeType === "change" || version.changeType === "supplement";
      const changeBase = isChangeVersion && version.baseVersionId
        ? await tx.contractVersion.findUnique({ where: { id: version.baseVersionId } })
        : null;
      const companySelection = isChangeVersion
        ? this.companySelectionFromDraft(changeBase?.draftData)
        : input.companyEntityId
          ? await this.lockAndLoadCompanyEntitySelection(tx, input.companyEntityId)
          : this.companySelectionFromDraft(version.draftData);
      if (
        isChangeVersion &&
        input.companyEntityId !== undefined &&
        input.companyEntityId !== companySelection?.id
      ) {
        throw new BadRequestException("合同变更不得修改我方签约主体，如需换主体请新签合同");
      }
      const clientDraftData = { ...input.draftData };
      delete clientDraftData.companyEntitySelection;
      delete clientDraftData.myCompanyEntity;
      delete clientDraftData.workbenchReferences;
      const normalizedClientDraftData = this.normalizeLegacyTemplateFieldLocations(
        clientDraftData,
        template,
        version.draftData
      );
      const storedDraftData = this.withTaxFactMirror({
        ...normalizedClientDraftData,
        ...(this.workbenchReferences(version.draftData)
          ? {
              workbenchReferences:
                this.workbenchReferences(version.draftData)
            }
          : {}),
        ...(companySelection
          ? {
              companyEntitySelection: companySelection,
              myCompanyEntity: companySelection.name
            }
          : {})
      }, input.taxFacts);
      this.validateDraftAgainstTemplate(
        this.withoutWorkbenchReferences(storedDraftData) as Record<string, unknown>,
        input.clauses,
        template,
        changeBase?.draftData
      );
      if (isChangeVersion) {
        if (!changeBase) {
          throw new BadRequestException("合同变更直接来源版本不存在，不能保存草稿");
        }
        assertContractChangeContentAllowed({
          baseDraftData: this.withoutWorkbenchReferences(
            this.withoutTaxFactMirror(changeBase.draftData)
          ) as Prisma.JsonValue,
          candidateDraftData: this.withoutWorkbenchReferences(
            this.withoutTaxFactMirror(storedDraftData)
          ) as Prisma.JsonValue,
          baseClauses: changeBase.clauseSnapshot,
          candidateClauses: input.clauses,
          template
        });
        await this.assertSupplementFixedFactsUnchanged(tx, version, input);
      }
      const bills = await tx.contractBill.findMany({
        where: { contractVersionId }
      });
      const pricedBillIds = bills
        .filter(
          (bill) =>
            bill.amountRole === "included" || bill.amountRole === "provisional"
        )
        .map((bill) => bill.id);
      const pricedRows = pricedBillIds.length
        ? await tx.contractBillRow.findMany({
            where: { contractBillId: { in: pricedBillIds } },
            select: { contractBillId: true }
          })
        : [];
      const pricingPolicy = contractPricingPolicy({
        pricingNature: input.pricingNature,
        amountLimitType: version.amountLimitType,
        hasPricedRows: pricedRows.length > 0
      });
      if (input.amountSource !== pricingPolicy.amountSource) {
        throw new BadRequestException(
          pricingPolicy.kind === "fixed_total_without_bill"
            ? "纯固定总价且无计价清单时，请填写合同含税总价"
            : pricingPolicy.kind === "unlimited_framework"
              ? "无总价框架合同不设合同总价，金额来源必须按清单"
              : "存在计价清单时，合同金额必须来自清单合计"
        );
      }
      const billAmount = this.sumIncludedBills(bills);
      const amountCents = pricingPolicy.kind === "unlimited_framework"
        ? pricingPolicy.contractAmountCents
        : pricingPolicy.kind === "priced_bill"
          ? billAmount
          : this.toCents(input.manualAmountCents, "manualAmountCents");
      const estimatedAmountCents = this.resolveEstimatedAmountCents(
        input.estimatedAmountCents,
        pricingPolicy
      );
      if (isChangeVersion) {
        if (!changeBase || version.changeAmountCents === null || !version.changeDirection) {
          throw new BadRequestException("合同变更金额声明不完整，不能保存草稿");
        }
        const expected = version.changeDirection === "increase"
          ? changeBase.amountCents + version.changeAmountCents
          : version.changeDirection === "decrease"
            ? changeBase.amountCents - version.changeAmountCents
            : changeBase.amountCents;
        if (amountCents !== expected) {
          throw new BadRequestException("合同当前金额必须与已声明的增减金额保持一致");
        }
      }
      const updated = await tx.contractVersion.updateMany({
        where: {
          id: contractVersionId,
          draftRevision: input.expectedRevision,
          status: { in: [...EDITABLE_STATUSES] }
        },
        data: {
          draftData: this.toJson(storedDraftData),
          clauseSnapshot: this.toJson(input.clauses),
          pricingNature: input.pricingNature,
          amountSource: input.amountSource,
          amountCents,
          estimatedAmountCents,
          amountAdjustmentReason: null,
          invoiceType: input.taxFacts.invoiceType,
          taxMode: input.taxFacts.taxMode,
          defaultTaxRatePercent: input.taxFacts.defaultTaxRatePercent === null
            ? null
            : new Prisma.Decimal(input.taxFacts.defaultTaxRatePercent),
          taxFactStatus: "draft",
          taxFactSource: input.taxFacts.source,
          taxFactRevision: { increment: 1 },
          taxFactsFrozenAt: null,
          layoutTemplateVersionId: input.layoutTemplateVersionId ?? null,
          draftRevision: { increment: 1 },
          readinessSnapshot: Prisma.DbNull
        }
      });
      this.assertCas(updated.count);
      if (
        !isChangeVersion &&
        (input.paymentTermsOriginalText !== undefined || input.paymentStages !== undefined)
      ) {
        await this.savePaymentTerms(
          tx,
          version.id,
          contract.contractTypeKey,
          version.settlementMode,
          input
        );
      }
      await this.markOlderSuccessfulDocumentsStale(
        tx,
        contractVersionId,
        input.expectedRevision + 1
      );
      await this.assertEditableParentCas(
        tx,
        version.contractId,
        actorUserId,
        companySelection ?? undefined
      );

      await this.audit.record(tx, {
        actorUserId,
        action: "contract.draft.save",
        businessType: "contract_version",
        businessId: contractVersionId,
        metadata: {
          changedKeys: this.changedKeys(
            version.draftData as Record<string, unknown>,
            storedDraftData
          ),
          amountBeforeCents: version.amountCents.toString(),
          amountAfterCents: amountCents.toString(),
          estimatedAmountBeforeCents:
            version.estimatedAmountCents?.toString() ?? null,
          estimatedAmountAfterCents:
            estimatedAmountCents?.toString() ?? null,
          taxFactsBefore: this.taxFactsAuditSnapshot(version),
          taxFactsAfter: {
            invoiceType: input.taxFacts.invoiceType,
            taxMode: input.taxFacts.taxMode,
            defaultTaxRatePercent: input.taxFacts.defaultTaxRatePercent,
            source: input.taxFacts.source
          },
          revisionBefore: input.expectedRevision,
          revisionAfter: input.expectedRevision + 1
        }
      });
      return this.toReadModel(
        await tx.contractVersion.findUnique({ where: { id: contractVersionId } })
      );
    });
  }

  async prepareAggregateDraftFieldsInTransaction(
    tx: Prisma.TransactionClient,
    version: ContractVersion,
    aggregateInput: SaveContractDraftAggregateDto
  ) {
    const input = this.parseSaveInput({
      expectedRevision: aggregateInput.expectedRevision,
      ...aggregateInput.draft,
      clauses: aggregateInput.draft.clauses.map((clause) => ({ ...clause })),
      taxFacts: { ...aggregateInput.draft.taxFacts },
      paymentTermsOriginalText: aggregateInput.paymentTerms?.originalText,
      paymentStages: aggregateInput.paymentTerms?.stages.map((stage) => ({
        ...stage
      }))
    });
    const template = this.parseTemplateSnapshot(version.templateSnapshot);
    const isChangeVersion =
      version.changeType === "change" || version.changeType === "supplement";
    const changeBase = isChangeVersion && version.baseVersionId
      ? await tx.contractVersion.findUnique({ where: { id: version.baseVersionId } })
      : null;
    const companySelection = isChangeVersion
      ? this.companySelectionFromDraft(changeBase?.draftData)
      : input.companyEntityId
        ? await this.lockAndLoadCompanyEntitySelection(tx, input.companyEntityId)
        : this.companySelectionFromDraft(version.draftData);
    if (
      isChangeVersion &&
      input.companyEntityId !== undefined &&
      input.companyEntityId !== companySelection?.id
    ) {
      throw new BadRequestException("合同变更不得修改我方签约主体，如需换主体请新签合同");
    }
    const clientDraftData = { ...input.draftData };
    delete clientDraftData.companyEntitySelection;
    delete clientDraftData.myCompanyEntity;
    delete clientDraftData.workbenchReferences;
    const normalizedClientDraftData = this.normalizeLegacyTemplateFieldLocations(
      clientDraftData,
      template,
      version.draftData
    );
    const storedDraftData = this.withTaxFactMirror({
      ...normalizedClientDraftData,
      workbenchReferences: {
        selectedNegotiationRoundId:
          aggregateInput.negotiationDocuments.selectedNegotiationRoundId ?? null,
        selectedOfflineRevisionId:
          aggregateInput.negotiationDocuments.selectedOfflineRevisionId ?? null,
        referencedGeneratedDocumentIds:
          aggregateInput.negotiationDocuments.referencedGeneratedDocumentIds
      },
      ...(companySelection
        ? {
            companyEntitySelection: companySelection,
            myCompanyEntity: companySelection.name
          }
        : {})
    }, input.taxFacts);
    this.validateDraftAgainstTemplate(
      this.withoutWorkbenchReferences(storedDraftData) as Record<string, unknown>,
      input.clauses,
      template,
      changeBase?.draftData
    );
    if (isChangeVersion) {
      if (!changeBase) {
        throw new BadRequestException("合同变更直接来源版本不存在，不能保存草稿");
      }
      assertContractChangeContentAllowed({
        baseDraftData: this.withoutWorkbenchReferences(
          this.withoutTaxFactMirror(changeBase.draftData)
        ) as Prisma.JsonValue,
        candidateDraftData: this.withoutWorkbenchReferences(
          this.withoutTaxFactMirror(storedDraftData)
        ) as Prisma.JsonValue,
        baseClauses: changeBase.clauseSnapshot,
        candidateClauses: input.clauses,
        template
      });
      await this.assertSupplementFixedFactsUnchanged(tx, version, input);
    }
    const bills = await tx.contractBill.findMany({
      where: { contractVersionId: version.id }
    });
    const pricedBillIds = bills
      .filter((bill) =>
        bill.amountRole === "included" || bill.amountRole === "provisional"
      )
      .map((bill) => bill.id);
    const pricedRows = pricedBillIds.length
      ? await tx.contractBillRow.findMany({
          where: { contractBillId: { in: pricedBillIds } },
          select: { contractBillId: true }
        })
      : [];
    const pricingPolicy = contractPricingPolicy({
      pricingNature: input.pricingNature,
      amountLimitType: version.amountLimitType,
      hasPricedRows: pricedRows.length > 0
    });
    if (input.amountSource !== pricingPolicy.amountSource) {
      throw new BadRequestException(
        pricingPolicy.kind === "fixed_total_without_bill"
          ? "纯固定总价且无计价清单时，请填写合同含税总价"
          : pricingPolicy.kind === "unlimited_framework"
            ? "无总价框架合同不设合同总价，金额来源必须按清单"
            : "存在计价清单时，合同金额必须来自清单合计"
      );
    }
    const amountCents = pricingPolicy.kind === "unlimited_framework"
      ? pricingPolicy.contractAmountCents
      : pricingPolicy.kind === "priced_bill"
        ? this.sumIncludedBills(bills)
        : this.toCents(input.manualAmountCents, "manualAmountCents");
    const estimatedAmountCents = this.resolveEstimatedAmountCents(
      input.estimatedAmountCents,
      pricingPolicy
    );
    if (isChangeVersion) {
      if (!changeBase || version.changeAmountCents === null || !version.changeDirection) {
        throw new BadRequestException("合同变更金额声明不完整，不能保存草稿");
      }
      const expected = version.changeDirection === "increase"
        ? changeBase.amountCents + version.changeAmountCents
        : version.changeDirection === "decrease"
          ? changeBase.amountCents - version.changeAmountCents
          : changeBase.amountCents;
      if (amountCents !== expected) {
        throw new BadRequestException("合同当前金额必须与已声明的增减金额保持一致");
      }
    }
    const taxChanged =
      version.invoiceType !== input.taxFacts.invoiceType ||
      version.taxMode !== input.taxFacts.taxMode ||
      (version.defaultTaxRatePercent?.toString() ?? null) !==
        input.taxFacts.defaultTaxRatePercent ||
      version.taxFactSource !== input.taxFacts.source;
    const currentDraftFields = this.withoutWorkbenchReferences(version.draftData);
    const nextDraftFields = this.withoutWorkbenchReferences(storedDraftData);
    const workbenchReferencesChanged = !isDeepStrictEqual(
      this.comparableWorkbenchReferences(version.draftData),
      this.comparableWorkbenchReferences(storedDraftData)
    );
    const changed =
      !isDeepStrictEqual(currentDraftFields, nextDraftFields) ||
      !isDeepStrictEqual(version.clauseSnapshot, input.clauses) ||
      version.pricingNature !== input.pricingNature ||
      version.amountSource !== input.amountSource ||
      version.amountCents !== amountCents ||
      version.estimatedAmountCents !== estimatedAmountCents ||
      version.amountAdjustmentReason !==
        (aggregateInput.draft.amountAdjustmentReason ?? null) ||
      version.layoutTemplateVersionId !==
        (input.layoutTemplateVersionId ?? null) ||
      taxChanged;
    return {
      changed,
      workbenchReferencesChanged,
      companySelection,
      amountCents,
      estimatedAmountCents,
      storedDraftData,
      data: {
        draftData: this.toJson(storedDraftData),
        clauseSnapshot: this.toJson(input.clauses),
        pricingNature: input.pricingNature,
        amountSource: input.amountSource,
        amountCents,
        estimatedAmountCents,
        amountAdjustmentReason:
          aggregateInput.draft.amountAdjustmentReason ?? null,
        invoiceType: input.taxFacts.invoiceType,
        taxMode: input.taxFacts.taxMode,
        defaultTaxRatePercent: input.taxFacts.defaultTaxRatePercent === null
          ? null
          : new Prisma.Decimal(input.taxFacts.defaultTaxRatePercent),
        taxFactStatus: "draft",
        taxFactSource: input.taxFacts.source,
        ...(taxChanged ? { taxFactRevision: { increment: 1 } } : {}),
        taxFactsFrozenAt: null,
        layoutTemplateVersionId: input.layoutTemplateVersionId ?? null,
        readinessSnapshot: Prisma.DbNull
      } satisfies Prisma.ContractVersionUpdateManyMutationInput
    };
  }

  private withoutWorkbenchReferences(value: unknown) {
    if (!this.isPlainObject(value)) return value;
    const result = { ...value };
    delete result.workbenchReferences;
    return result;
  }

  private workbenchReferences(value: unknown) {
    if (!this.isPlainObject(value)) return null;
    return this.isPlainObject(value.workbenchReferences)
      ? value.workbenchReferences
      : null;
  }

  private comparableWorkbenchReferences(value: unknown) {
    const references = this.workbenchReferences(value);
    return {
      selectedNegotiationRoundId:
        typeof references?.selectedNegotiationRoundId === "string"
          ? references.selectedNegotiationRoundId
          : null,
      selectedOfflineRevisionId:
        typeof references?.selectedOfflineRevisionId === "string"
          ? references.selectedOfflineRevisionId
          : null,
      referencedGeneratedDocumentIds:
        Array.isArray(references?.referencedGeneratedDocumentIds)
          ? references.referencedGeneratedDocumentIds.filter(
              (item): item is string => typeof item === "string"
            )
          : []
    };
  }

  async replacePaymentTermsInTransaction(
    tx: Prisma.TransactionClient,
    contract: { contractTypeKey: string | null },
    version: ContractVersion,
    paymentTerms: SaveContractDraftAggregateDto["paymentTerms"]
  ) {
    const terms = await tx.paymentTermsVersion.findFirst({
      where: { contractVersionId: version.id }
    });
    if (!terms) {
      if (paymentTerms === null) return { changed: false };
      throw new BadRequestException("合同付款条款版本不存在，不能保存付款条款。");
    }
    const existingStages = await tx.paymentTermsStage.findMany({
      where: { paymentTermsVersionId: terms.id },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }]
    });
    if (paymentTerms === null) {
      if (terms.originalText === "" && existingStages.length === 0) {
        return { changed: false };
      }
      await tx.paymentTermsVersion.update({
        where: { id: terms.id },
        data: { originalText: "" }
      });
      await tx.paymentTermsStage.deleteMany({
        where: { paymentTermsVersionId: terms.id }
      });
      return { changed: true };
    }
    const explicitSettlementMode = isContractSettlementMode(version.settlementMode);
    const effectiveMode = explicitSettlementMode
      ? version.settlementMode
      : contract.contractTypeKey === "generic_contract"
        ? "direct_payment"
        : "settlement_required";
    if (
      !explicitSettlementMode &&
      contract.contractTypeKey !== "generic_contract" &&
      !SETTLEMENT_CONTRACT_TYPE_KEYS.has(contract.contractTypeKey ?? "")
    ) {
      throw new BadRequestException("合同类型不正确，不能保存付款条款");
    }
    const expectedBasis = effectiveMode === "direct_payment"
      ? "contract_amount"
      : "current_settlement";
    if (paymentTerms.stages.some((stage) => stage.basis !== expectedBasis)) {
      throw new BadRequestException(
        effectiveMode === "direct_payment"
          ? "按合同直接付款的付款条款必须按合同金额计算"
          : "需要结算的付款条款必须按当期结算计算"
      );
    }
    const stageData = paymentTerms.stages.map((stage) => ({
      name: stage.name,
      stageType: stage.stageType ?? "progress",
      basis: stage.basis,
      ratioBps: stage.ratioBps ?? null,
      fixedAmountCents:
        stage.fixedAmountCents === undefined ? null : BigInt(stage.fixedAmountCents),
      triggerAnchor: stage.triggerAnchor ??
        (stage.basis === "contract_amount"
          ? "contract_effective"
          : "settlement_effective"),
      triggerEvent: stage.triggerEvent,
      dueDays: stage.dueDays,
      advanceDeductionMode: stage.advanceDeductionMode ?? "none",
      advanceDeductionRatioBps: stage.advanceDeductionRatioBps ?? null,
      advanceDeductionStartRatioBps:
        stage.advanceDeductionStartRatioBps ?? null,
      requiresInvoice: stage.requiresInvoice,
      allowsEarlyPayment: stage.allowsEarlyPayment,
      allowsInstallments: stage.allowsInstallments,
      retentionBps: stage.retentionBps ?? null,
      originalText: stage.originalText
    }));
    const existingComparable = existingStages.map((stage) => ({
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
    }));
    const originalText = paymentTerms.originalText.trim();
    if (
      terms.originalText === originalText &&
      isDeepStrictEqual(existingComparable, stageData)
    ) {
      return { changed: false };
    }
    if (terms.originalText !== originalText) {
      await tx.paymentTermsVersion.update({
        where: { id: terms.id },
        data: { originalText }
      });
    }
    const sharedStageCount = Math.min(existingStages.length, stageData.length);
    for (let index = 0; index < sharedStageCount; index += 1) {
      if (!isDeepStrictEqual(existingComparable[index], stageData[index])) {
        await tx.paymentTermsStage.update({
          where: { id: existingStages[index]!.id },
          data: stageData[index]!
        });
      }
    }
    const removedStages = existingStages.slice(stageData.length);
    if (removedStages.length) {
      await tx.paymentTermsStage.deleteMany({
        where: { id: { in: removedStages.map((stage) => stage.id) } }
      });
    }
    const addedStages = stageData.slice(existingStages.length);
    if (addedStages.length) {
      await tx.paymentTermsStage.createMany({
        data: addedStages.map((stage) => ({
          paymentTermsVersionId: terms.id,
          ...stage
        }))
      });
    }
    return { changed: true };
  }

  async confirmSettlementMode(
    contractVersionId: string,
    actorUserId: string,
    input: ConfirmContractSettlementModeDto
  ) {
    if (!isContractSettlementMode(input?.settlementMode)) {
      throw new BadRequestException("合同结算方式不正确，请重新选择");
    }
    if (!Number.isInteger(input?.expectedRevision) || input.expectedRevision < 1) {
      throw new BadRequestException("合同草稿版本号不正确，请刷新后重试");
    }
    return this.prisma.$transaction(async (tx) => {
      await this.assertGlobalContractDirector(tx, actorUserId);
      const version = await this.lockAndReloadEditableVersion(
        tx,
        contractVersionId,
        "合同草稿当前不可确认结算方式，请刷新后查看最新状态"
      );
      this.assertRevision(version.draftRevision, input.expectedRevision);
      const updated = await tx.contractVersion.updateMany({
        where: {
          id: contractVersionId,
          status: { in: [...EDITABLE_STATUSES] },
          draftRevision: input.expectedRevision
        },
        data: {
          settlementMode: input.settlementMode,
          settlementModeSource: "contract_director",
          settlementModeConfirmedByUserId: actorUserId,
          settlementModeConfirmedAt: new Date(),
          draftRevision: { increment: 1 },
          readinessSnapshot: Prisma.DbNull
        }
      });
      this.assertCas(updated.count);
      const confirmed = await tx.contractVersion.findUnique({
        where: { id: contractVersionId }
      });
      await this.audit.record(tx, {
        actorUserId,
        action: "contract.settlement_mode.confirm",
        businessType: "contract_version",
        businessId: contractVersionId,
        metadata: {
          settlementMode: input.settlementMode,
          previousSettlementMode: version.settlementMode,
          revisionBefore: input.expectedRevision,
          revisionAfter: input.expectedRevision + 1
        }
      });
      return this.toReadModel(confirmed!);
    });
  }

  async createCheckpoint(
    contractVersionId: string,
    actorUserId: string,
    rawInput: unknown
  ) {
    const input = this.parseCheckpointInput(rawInput);
    return this.runSerializableWithRetry(async (tx) => {
      const { version } = await this.lockAndReloadOwnedEditableVersion(
        tx,
        contractVersionId,
        actorUserId
      );
      const existing = await tx.contractDraftCheckpoint.findMany({
        where: { contractVersionId },
        orderBy: { sequenceNo: "desc" }
      });
      const bills = await this.loadBillSnapshots(tx, contractVersionId);
      const sequenceNo = Math.max(0, ...existing.map((row) => row.sequenceNo)) + 1;
      const checkpoint = await tx.contractDraftCheckpoint.create({
        data: {
          contractVersionId,
          sequenceNo,
          name: input.name?.trim() || null,
          snapshot: this.toJson({
            draftData: version.draftData,
            clauseSnapshot: version.clauseSnapshot,
            pricingNature: version.pricingNature,
            amountSource: version.amountSource,
            amountCents: version.amountCents.toString(),
            estimatedAmountCents:
              version.estimatedAmountCents?.toString() ?? null,
            amountAdjustmentReason: version.amountAdjustmentReason,
            layoutTemplateVersionId: version.layoutTemplateVersionId,
            taxFacts: {
              invoiceType: version.invoiceType,
              taxMode: version.taxMode,
              defaultTaxRatePercent: version.defaultTaxRatePercent?.toString() ?? null,
              status: version.taxFactStatus,
              source: version.taxFactSource
            },
            bills
          }),
          createdByUserId: actorUserId
        }
      });
      const obsolete = existing
        .map((row) => row.sequenceNo)
        .sort((a, b) => b - a)
        .slice(4);
      if (obsolete.length) {
        await tx.contractDraftCheckpoint.deleteMany({
          where: { contractVersionId, sequenceNo: { in: obsolete } }
        });
      }
      await this.audit.record(tx, {
        actorUserId,
        action: "contract.draft.checkpoint.create",
        businessType: "contract_version",
        businessId: contractVersionId,
        metadata: { checkpointId: checkpoint.id, sequenceNo }
      });
      return this.toReadModel(checkpoint);
    });
  }

  async restoreCheckpoint(
    contractVersionId: string,
    checkpointId: string,
    actorUserId: string
  ) {
    return this.prisma.$transaction(async (tx) => {
      const { version } = await this.lockAndReloadOwnedEditableVersion(
        tx,
        contractVersionId,
        actorUserId
      );
      const checkpoint = await tx.contractDraftCheckpoint.findUnique({
        where: { id: checkpointId }
      });
      if (!checkpoint || checkpoint.contractVersionId !== contractVersionId) {
        throw new NotFoundException("未找到合同草稿保存点，请刷新后重试");
      }
      const snapshot = this.parseCheckpoint(checkpoint.snapshot);
      if (
        snapshot.estimatedAmountCents !== undefined &&
        snapshot.estimatedAmountCents !== null &&
        (
          version.amountLimitType !== "unlimited" ||
          snapshot.pricingNature !== "framework"
        )
      ) {
        throw new BadRequestException(
          "保存点中的预计发生金额与合同金额性质不一致，不能恢复"
        );
      }
      const checkpointCompanySelection = this.companySelectionFromDraft(snapshot.draftData);
      const restoredCompanySelection = checkpointCompanySelection
        ? await this.lockAndLoadCompanyEntitySelection(tx, checkpointCompanySelection.id)
        : null;
      if (
        checkpointCompanySelection &&
        (
          restoredCompanySelection?.versionId !== checkpointCompanySelection.versionId ||
          restoredCompanySelection.versionNo !== checkpointCompanySelection.versionNo
        )
      ) {
        throw new BadRequestException(
          "保存点中的我方公司主体版本已变更，不能恢复，请重新选择并保存"
        );
      }
      await this.lineage.assertVersionRowsReplaceableByCheckpoint(tx, {
        id: version.id,
        baseVersionId: version.baseVersionId
      });
      const updated = await tx.contractVersion.updateMany({
        where: {
          id: contractVersionId,
          draftRevision: version.draftRevision,
          status: { in: [...EDITABLE_STATUSES] }
        },
        data: {
          draftData: this.toJson(snapshot.draftData),
          clauseSnapshot: this.toJson(snapshot.clauseSnapshot),
          pricingNature: snapshot.pricingNature,
          amountSource: snapshot.amountSource,
          amountCents: parseMoneyCents(snapshot.amountCents, "合同金额"),
          ...(snapshot.estimatedAmountCents === undefined
            ? {}
            : {
                estimatedAmountCents: this.parseNullableMoney(
                  snapshot.estimatedAmountCents,
                  "预计发生金额"
                )
              }),
          amountAdjustmentReason: snapshot.amountAdjustmentReason,
          layoutTemplateVersionId: snapshot.layoutTemplateVersionId,
          ...(snapshot.taxFacts
            ? {
                invoiceType: snapshot.taxFacts.invoiceType,
                taxMode: snapshot.taxFacts.taxMode,
                defaultTaxRatePercent:
                  snapshot.taxFacts.defaultTaxRatePercent === null
                    ? null
                    : new Prisma.Decimal(snapshot.taxFacts.defaultTaxRatePercent),
                taxFactStatus: "draft",
                taxFactSource: snapshot.taxFacts.source,
                taxFactRevision: { increment: 1 },
                taxFactsFrozenAt: null
              }
            : {}),
          draftRevision: { increment: 1 },
          readinessSnapshot: Prisma.DbNull
        }
      });
      this.assertCas(updated.count);
      await this.markOlderSuccessfulDocumentsStale(
        tx,
        contractVersionId,
        version.draftRevision + 1
      );
      await this.assertEditableParentCas(
        tx,
        version.contractId,
        actorUserId,
        restoredCompanySelection
      );
      await this.replaceBillsFromSnapshot(tx, contractVersionId, snapshot.bills, version.contractId, actorUserId);
      await this.audit.record(tx, {
        actorUserId,
        action: "contract.draft.checkpoint.restore",
        businessType: "contract_version",
        businessId: contractVersionId,
        metadata: {
          checkpointId,
          revisionBefore: version.draftRevision,
          revisionAfter: version.draftRevision + 1
        }
      });
      return this.toReadModel(
        await tx.contractVersion.findUnique({ where: { id: contractVersionId } })
      );
    });
  }

  async voidDraft(contractId: string, actorUserId: string, rawInput: unknown) {
    const { reason } = this.parseVoidInput(rawInput);
    return this.runSerializableWithRetry(async (tx) => {
      await this.lockLatestEditableVersionForContract(tx, contractId);
      await this.loadOwnedContract(tx, contractId, actorUserId);
      const updated = await tx.contract.updateMany({
        where: { id: contractId, ownerUserId: actorUserId, voidedAt: null },
        data: { voidedAt: new Date(), voidedReason: reason }
      });
      this.assertLifecycleCas(updated.count);
      await this.audit.record(tx, {
        actorUserId,
        action: "contract.draft.void",
        businessType: "contract",
        businessId: contractId,
        metadata: { reason }
      });
      return this.toReadModel(await tx.contract.findUnique({ where: { id: contractId } }));
    });
  }

  async restoreDraft(contractId: string, actorUserId: string) {
    return this.runSerializableWithRetry(async (tx) => {
      await this.lockLatestEditableVersionForContract(tx, contractId);
      await this.loadOwnedContract(tx, contractId, actorUserId);
      const updated = await tx.contract.updateMany({
        where: { id: contractId, ownerUserId: actorUserId, voidedAt: { not: null } },
        data: { voidedAt: null, voidedReason: null }
      });
      this.assertLifecycleCas(updated.count);
      await this.audit.record(tx, {
        actorUserId,
        action: "contract.draft.restore",
        businessType: "contract",
        businessId: contractId
      });
      return this.toReadModel(await tx.contract.findUnique({ where: { id: contractId } }));
    });
  }

  async transferDraft(
    contractId: string,
    actorUserId: string,
    rawInput: unknown
  ) {
    const input = this.parseTransferInput(rawInput);
    return this.runSerializableWithRetry(async (tx) => {
      await this.assertGlobalContractDirector(tx, actorUserId);
      const version = await this.lockLatestEditableVersionForContract(tx, contractId);
      if (
        input.expectedContractVersionId &&
        version.id !== input.expectedContractVersionId
      ) {
        throw new ConflictException(
          "合同草稿版本已变化，请刷新合同工作台后重试转交"
        );
      }
      const contract = await tx.contract.findUnique({ where: { id: contractId } });
      if (!contract) throw new NotFoundException("未找到合同草稿，请刷新合同工作台后重试");
      const targetUser = await tx.user.findUnique({ where: { id: input.toUserId } });
      if (!targetUser?.isActive) {
        throw new BadRequestException("请选择有效的转交接收人");
      }
      await this.assertTargetInContractProject(tx, contract.projectId, input.toUserId);
      const updated = await tx.contract.updateMany({
        where: {
          id: contractId,
          ownerUserId: contract.ownerUserId,
          voidedAt: null
        },
        data: { ownerUserId: input.toUserId }
      });
      this.assertLifecycleCas(updated.count);
      await this.audit.record(tx, {
        actorUserId,
        action: "contract.draft.transfer",
        businessType: "contract",
        businessId: contractId,
        metadata: {
          fromOwnerUserId: contract.ownerUserId,
          toUserId: input.toUserId
        }
      });
      return this.toReadModel(await tx.contract.findUnique({ where: { id: contractId } }));
    });
  }

  async previewTypeChange(
    contractVersionId: string,
    actorUserId: string,
    rawInput: unknown
  ) {
    const input = this.parseTypeChangeInput(rawInput);
    return this.prisma.$transaction(async (tx) => {
      const { version } = await this.loadOwnedEditableVersion(
        tx,
        contractVersionId,
        actorUserId
      );
      this.assertRevision(version.draftRevision, input.expectedRevision);
      const target = await this.loadPublishedTemplate(
        tx,
        input.targetBusinessTemplateVersionId
      );
      return this.buildTypeChangePreview(
        this.parseTemplateSnapshot(version.templateSnapshot),
        this.versionToTemplate(target)
      );
    });
  }

  async applyTypeChange(
    contractVersionId: string,
    actorUserId: string,
    rawInput: unknown
  ) {
    const input = this.parseApplyTypeChangeInput(rawInput);
    return this.prisma.$transaction(async (tx) => {
      const { version, contract } = await this.lockAndReloadOwnedEditableVersion(
        tx,
        contractVersionId,
        actorUserId
      );
      if (version.changeType === "change" || version.changeType === "supplement") {
        throw new BadRequestException("合同变更不得切换合同类型或业务模板");
      }
      this.assertRevision(version.draftRevision, input.expectedRevision);
      const target = await this.loadPublishedTemplate(
        tx,
        input.targetBusinessTemplateVersionId
      );
      const targetTemplate = this.versionToTemplate(target);
      const currentTemplate = this.parseTemplateSnapshot(version.templateSnapshot);
      const currentData = version.draftData as Record<string, unknown>;
      const oldFields = new Map(currentTemplate.fieldSchema.map((field) => [field.key, field]));
      const targetFields = new Map(
        targetTemplate.fieldSchema.map((field) => [field.key, field])
      );
      const nextData = Object.fromEntries(
        targetTemplate.fieldSchema.map((field) => {
          const old = oldFields.get(field.key);
          return [
            field.key,
            old?.type === field.type && Object.hasOwn(currentData, field.key)
              ? currentData[field.key]
              : field.defaultValue ?? null
          ];
        })
      );
      const preservedStructuralKeys = new Set([
        "contractName",
        "companyEntitySelection",
        "myCompanyEntity",
        "partyValues"
      ]);
      for (const key of preservedStructuralKeys) {
        if (Object.hasOwn(currentData, key)) nextData[key] = currentData[key];
      }
      const removedFields = Object.fromEntries(
        Object.entries(currentData).filter(([key]) => {
          if (preservedStructuralKeys.has(key)) return false;
          const oldField = oldFields.get(key);
          const targetField = targetFields.get(key);
          return !targetField || !oldField || oldField.type !== targetField.type;
        })
      );
      const currentClauses = version.clauseSnapshot as unknown as ContractClauseDefinition[];
      const currentClauseMap = new Map(currentClauses.map((clause) => [clause.key, clause]));
      const targetClauseMap = new Map(
        targetTemplate.clauseSchema.map((clause) => [clause.key, clause])
      );
      const nextClauses = targetTemplate.clauseSchema.map((targetClause) => {
        const currentClause = currentClauseMap.get(targetClause.key);
        return currentClause && this.clauseIsCompatible(currentClause, targetClause)
          ? { ...targetClause, content: currentClause.content }
          : targetClause;
      });
      const removedClauses = currentClauses.filter((currentClause) => {
        const targetClause = targetClauseMap.get(currentClause.key);
        return !targetClause || !this.clauseIsCompatible(currentClause, targetClause);
      });
      const currentBills = await tx.contractBill.findMany({
        where: { contractVersionId }
      });
      const targetBills = new Map(targetTemplate.billSchema.map((bill) => [bill.key, bill]));
      const replacedBills = currentBills.filter((bill) => {
          const targetBill = targetBills.get(bill.billKey);
          return !targetBill || !this.billIsCompatible(bill, targetBill);
        });
      const replacedBillIds = replacedBills.map((bill) => bill.id);
      const replacedBillRows = replacedBillIds.length
        ? await tx.contractBillRow.findMany({
            where: { contractBillId: { in: replacedBillIds } },
            orderBy: [{ contractBillId: "asc" }, { sortOrder: "asc" }]
          })
        : [];
      const removedBills = replacedBills.map((bill) => ({
        ...bill,
        taxInclusiveAmountCents: bill.taxInclusiveAmountCents.toString(),
        taxExclusiveAmountCents: bill.taxExclusiveAmountCents.toString(),
        taxAmountCents: bill.taxAmountCents.toString(),
        rows: replacedBillRows
          .filter((row) => row.contractBillId === bill.id)
          .map((row) => ({
            ...row,
            quantity: row.quantity?.toString() ?? null,
            unitPrice: this.formatUnitPrice(row.unitPrice),
            taxRate: row.taxRate?.toString() ?? null,
            taxRatePercent: row.taxRate?.toString() ?? null,
            taxInclusiveAmountCents: row.taxInclusiveAmountCents?.toString() ?? null,
            taxExclusiveAmountCents: row.taxExclusiveAmountCents?.toString() ?? null,
            taxAmountCents: row.taxAmountCents?.toString() ?? null,
            taxExclusiveUnitPrice:
              row.taxExclusiveUnitPrice?.toFixed(6) ?? null
          }))
      }));
      const retainedKeys = new Set(
        currentBills
          .filter((bill) => {
            const targetBill = targetBills.get(bill.billKey);
            return targetBill && this.billIsCompatible(bill, targetBill);
          })
          .map((bill) => bill.billKey)
      );
      const addedBills = targetTemplate.billSchema.filter(
        (bill) => !retainedKeys.has(bill.key)
      );

      const updated = await tx.contractVersion.updateMany({
        where: {
          id: contractVersionId,
          draftRevision: input.expectedRevision,
          status: { in: [...EDITABLE_STATUSES] }
        },
        data: {
          businessTemplateVersionId: target.id,
          templateSnapshot: this.toJson(targetTemplate),
          draftData: this.toJson(nextData),
          clauseSnapshot: this.toJson(nextClauses),
          draftRevision: { increment: 1 },
          readinessSnapshot: Prisma.DbNull
        }
      });
      this.assertCas(updated.count);
      await this.markOlderSuccessfulDocumentsStale(
        tx,
        contractVersionId,
        input.expectedRevision + 1
      );
      await this.assertEditableParentCas(
        tx,
        contract.id,
        actorUserId,
        this.companySelectionFromDraft(nextData) ?? undefined
      );

      const template = await tx.contractBusinessTemplate.findUnique({
        where: { id: target.templateId }
      });
      if (!template) throw new NotFoundException("未找到业务模板，请重新选择模板");
      await tx.contract.update({
        where: { id: contract.id },
        data: { contractTypeKey: template.contractTypeKey }
      });
      if (replacedBillIds.length) {
        await tx.contractBillRow.deleteMany({
          where: { contractBillId: { in: replacedBillIds } }
        });
        await tx.contractBill.deleteMany({ where: { id: { in: replacedBillIds } } });
      }
      for (const bill of targetTemplate.billSchema.filter((row) =>
        retainedKeys.has(row.key)
      )) {
        await tx.contractBill.updateMany({
          where: { contractVersionId, billKey: bill.key },
          data: this.billDefinitionData(bill)
        });
      }
      if (addedBills.length) {
        await tx.contractBill.createMany({
          data: addedBills.map((bill) => ({
            contractVersionId,
            billKey: bill.key,
            ...this.billDefinitionData(bill)
          }))
        });
      }
      if (version.amountSource === "bill_sum") {
        const finalBills = await tx.contractBill.findMany({
          where: { contractVersionId }
        });
        await tx.contractVersion.update({
          where: { id: contractVersionId },
          data: { amountCents: this.sumIncludedBills(finalBills) }
        });
      }
      await this.audit.record(tx, {
        actorUserId,
        action: "contract.draft.type_change",
        businessType: "contract_version",
        businessId: contractVersionId,
        metadata: {
          fromBusinessTemplateVersionId: version.businessTemplateVersionId,
          toBusinessTemplateVersionId: target.id,
          fromContractTypeKey: contract.contractTypeKey,
          toContractTypeKey: template.contractTypeKey,
          removedSnapshot: this.toJson({
            fields: removedFields,
            clauses: removedClauses,
            bills: removedBills
          }),
          revisionBefore: input.expectedRevision,
          revisionAfter: input.expectedRevision + 1
        }
      });
      return this.toReadModel(
        await tx.contractVersion.findUnique({ where: { id: contractVersionId } })
      );
    });
  }

  private async loadOwnedEditableVersion(
    tx: Prisma.TransactionClient,
    contractVersionId: string,
    actorUserId: string
  ) {
    const version = await tx.contractVersion.findUnique({
      where: { id: contractVersionId }
    });
    if (!version) throw new NotFoundException("未找到合同草稿版本，请刷新合同工作台后重试");
    const contract = await tx.contract.findUnique({ where: { id: version.contractId } });
    if (!contract) throw new NotFoundException("未找到合同草稿，请刷新合同工作台后重试");
    if (contract.ownerUserId !== actorUserId) {
      throw new ForbiddenException("只有合同经办人可以编辑该草稿");
    }
    await this.assertNotHistoricalTakeoverVersion(
      tx,
      version,
      contract
    );
    if (!EDITABLE_STATUSES.has(version.status)) {
      throw new BadRequestException("合同草稿当前不可编辑，请刷新后查看最新状态");
    }
    if (contract.voidedAt) throw new BadRequestException("合同草稿已作废，不能继续编辑");
    return { version, contract };
  }

  private async lockAndReloadOwnedEditableVersion(
    tx: Prisma.TransactionClient,
    contractVersionId: string,
    actorUserId: string
  ) {
    const version = await this.lockAndReloadEditableVersion(
      tx,
      contractVersionId,
      "合同草稿当前不可编辑，请刷新后查看最新状态"
    );
    const contract = await tx.contract.findUnique({
      where: { id: version.contractId }
    });
    if (!contract) {
      throw new NotFoundException("未找到合同草稿，请刷新合同工作台后重试");
    }
    if (contract.ownerUserId !== actorUserId) {
      throw new ForbiddenException("只有合同经办人可以编辑该草稿");
    }
    if (contract.voidedAt) {
      throw new BadRequestException("合同草稿已作废，不能继续编辑");
    }
    return { version, contract };
  }

  private async lockAndReloadEditableVersion(
    tx: Prisma.TransactionClient,
    contractVersionId: string,
    invalidStatusMessage: string
  ) {
    const mutationBoundary = await lockContractDraftMutationBoundary(
      tx,
      contractVersionId
    );
    if (!mutationBoundary) {
      throw new NotFoundException("未找到合同草稿版本，请刷新合同工作台后重试");
    }
    const version = await tx.contractVersion.findUnique({
      where: { id: contractVersionId }
    });
    if (!version) {
      throw new NotFoundException("未找到合同草稿版本，请刷新合同工作台后重试");
    }
    if (mutationBoundary.formalBlockers.length > 0) {
      throw new BadRequestException(
        "合同已存在正式业务事实，不能继续编辑草稿"
      );
    }
    if (!EDITABLE_STATUSES.has(version.status)) {
      throw new BadRequestException(invalidStatusMessage);
    }
    return version;
  }

  private historicalTakeoverLookupClient(client: unknown) {
    return client as {
      contractTakeover?: {
        findUnique(args: {
          where: { contractVersionId: string };
          select: { id: true; contractId: true; projectId: true };
        }): Promise<{ id: string; contractId: string; projectId: string } | null>;
        findMany(args: {
          where: { contractVersionId: { in: string[] } };
          select: { contractVersionId: true };
        }): Promise<Array<{ contractVersionId: string }>>;
      };
      contractVersion?: {
        findUnique(args: {
          where: { id: string };
          select: { id: true; contractId: true; changeType: true };
        }): Promise<{
          id: string;
          contractId: string;
          changeType: string | null;
        } | null>;
      };
      contract?: {
        findUnique(args: {
          where: { id: string };
          select: { id: true; ownerUserId: true; projectId: true };
        }): Promise<{
          id: string;
          ownerUserId: string | null;
          projectId: string;
        } | null>;
      };
    };
  }

  private async assertNotHistoricalTakeoverVersionId(
    client: unknown,
    contractVersionId: string,
    actorUserId: string
  ) {
    const lookupClient = this.historicalTakeoverLookupClient(client);
    if (!lookupClient.contractVersion) return;
    const version = await lookupClient.contractVersion.findUnique({
      where: { id: contractVersionId },
      select: { id: true, contractId: true, changeType: true }
    });
    if (!version) return;
    if (!lookupClient.contract) return;
    const contract = await lookupClient.contract.findUnique({
      where: { id: version.contractId },
      select: { id: true, ownerUserId: true, projectId: true }
    });
    if (!contract) return;
    await this.assertCanView(
      client as PrismaService,
      contract.ownerUserId,
      actorUserId
    );
    await this.assertNotHistoricalTakeoverVersion(client, version, contract);
  }

  private async assertNotHistoricalTakeoverVersion(
    client: unknown,
    version: { id: string; contractId: string; changeType: string | null },
    contract: { id: string; projectId?: string | null }
  ) {
    const lookupClient = this.historicalTakeoverLookupClient(client);
    const takeover = lookupClient.contractTakeover
      ? await lookupClient.contractTakeover.findUnique({
          where: { contractVersionId: version.id },
          select: { id: true, contractId: true, projectId: true }
        })
      : null;
    if (version.changeType !== "historical_takeover" && !takeover) return;

    const relationCoordinatesMatch = Boolean(
      takeover &&
      takeover.contractId === version.contractId &&
      takeover.contractId === contract.id &&
      takeover.projectId === contract.projectId
    );
    const relationCoordinatesDrifted = Boolean(takeover) && !relationCoordinatesMatch;
    throw new BadRequestException({
      statusCode: 400,
      code: "HISTORICAL_TAKEOVER_WORKBENCH_REQUIRED",
      message: "历史接管草稿必须在历史接管工作台办理",
      projectId: relationCoordinatesDrifted
        ? null
        : contract.projectId ?? null,
      takeoverId: relationCoordinatesMatch ? takeover?.id ?? null : null
    });
  }

  private async lockLatestEditableVersionForContract(
    tx: Prisma.TransactionClient,
    contractId: string
  ) {
    const candidate = await tx.contractVersion.findFirst({
      where: {
        contractId,
        status: { in: [...EDITABLE_STATUSES] }
      },
      orderBy: { versionNo: "desc" },
      select: { id: true }
    });
    if (!candidate) {
      throw new BadRequestException(
        "合同没有可编辑的草稿版本，请刷新后重试"
      );
    }
    const version = await this.lockAndReloadEditableVersion(
      tx,
      candidate.id,
      "合同没有可编辑的草稿版本，请刷新后重试"
    );
    if (version.contractId !== contractId) {
      throw new NotFoundException(
        "合同草稿版本与合同不匹配，请刷新合同工作台后重试"
      );
    }
    return version;
  }

  private async loadGeneratedDocumentsForDraft(version: {
    id: string;
    status: string;
    changeType: string | null;
    draftData: Prisma.JsonValue;
  }) {
    const documents = await this.prisma.contractGeneratedDocument.findMany({
      where: { contractVersionId: version.id },
      orderBy: { createdAt: "desc" as const },
      select: {
        id: true,
        purpose: true,
        status: true,
        sourceRevision: true,
        docxFileId: true,
        pdfFileId: true,
        createdAt: true,
        completedAt: true
      }
    });
    const selection = this.companySelectionFromDraft(version.draftData);
    if (
      !selection ||
      version.changeType === "change" ||
      version.changeType === "supplement"
    ) {
      return documents;
    }

    const entity = await this.prisma.companyEntity.findUnique({
      where: { id: selection.id }
    });
    if (
      entity &&
      entity.isActive &&
      entity.dataStatus === "complete" &&
      entity.currentVersionNo === selection.versionNo
    ) {
      return documents;
    }
    return documents.map((document) =>
      ["queued", "processing", "success"].includes(document.status)
        ? { ...document, status: "stale" }
        : document
    );
  }

  private async loadOwnedContract(
    tx: Prisma.TransactionClient,
    contractId: string,
    actorUserId: string
  ) {
    const contract = await tx.contract.findUnique({ where: { id: contractId } });
    if (!contract) throw new NotFoundException("未找到合同草稿，请刷新合同工作台后重试");
    if (contract.ownerUserId !== actorUserId) {
      throw new ForbiddenException("只有合同经办人可以编辑该草稿");
    }
    return contract;
  }

  private async assertTargetInContractProject(
    tx: Prisma.TransactionClient,
    projectId: string,
    targetUserId: string
  ) {
    const [projectPosition, projectMember] = await Promise.all([
      tx.userPosition.findFirst({
        where: { userId: targetUserId, projectId },
        select: { userId: true }
      }),
      tx.projectMember.findFirst({
        where: { userId: targetUserId, projectId },
        select: { userId: true }
      })
    ]);

    if (!projectPosition && !projectMember) {
      throw new BadRequestException("转交接收人不在合同所属项目中");
    }
  }

  private async assertEditableParentCas(
    tx: Prisma.TransactionClient,
    contractId: string,
    actorUserId: string,
    companySelection?: {
      id: string;
      name: string;
    } | null,
  ) {
    const parent = await tx.contract.updateMany({
      where: {
        id: contractId,
        ownerUserId: actorUserId,
        voidedAt: null
      },
      data: {
        ownerUserId: actorUserId,
        ...(companySelection === undefined
          ? {}
          : companySelection
            ? {
                companyEntityId: companySelection.id,
                companyEntityName: companySelection.name
              }
            : {
                companyEntityId: null,
                companyEntityName: null
              })
      }
    });
    if (parent.count !== 1) {
      throw new BadRequestException("合同草稿已变化，请刷新后重试");
    }
  }

  private markOlderSuccessfulDocumentsStale(
    tx: Prisma.TransactionClient,
    contractVersionId: string,
    currentRevision: number
  ) {
    return tx.contractGeneratedDocument.updateMany({
      where: {
        contractVersionId,
        status: "success",
        sourceRevision: { lt: currentRevision }
      },
      data: { status: "stale" }
    });
  }

  private async assertCanView(
    client: PrismaService,
    ownerUserId: string | null,
    actorUserId: string
  ) {
    if (
      ownerUserId !== actorUserId &&
      !(await this.hasGlobalContractDirector(client, actorUserId))
    ) {
      throw new ForbiddenException("当前账号无权查看该合同草稿");
    }
  }

  private async hasGlobalContractDirector(
    client: Pick<PrismaService, "userPosition" | "position">,
    actorUserId: string
  ) {
    if (!client.userPosition || !client.position) return false;
    const userPositions = await client.userPosition.findMany({
      where: { userId: actorUserId, projectId: null }
    });
    if (!userPositions.length) return false;
    const positions = await client.position.findMany({
      where: { id: { in: userPositions.map((row) => row.positionId) } }
    });
    return positions.some((position) => position.key === "contract_director");
  }

  private async assertGlobalContractDirector(
    tx: Prisma.TransactionClient,
    actorUserId: string
  ) {
    if (!(await this.hasGlobalContractDirector(tx, actorUserId))) {
      throw new ForbiddenException("只有合同主管可以执行该操作");
    }
  }

  private parseSaveInput(rawInput: unknown): SaveContractDraftDto {
    const input = this.requireObject(rawInput, "合同草稿保存内容");
    if (
      typeof input.expectedRevision !== "number" ||
      !Number.isInteger(input.expectedRevision) ||
      input.expectedRevision < 1
    ) {
      throw new BadRequestException("合同草稿版本号不正确，请刷新后重试");
    }
    if (!this.isPlainObject(input.draftData)) {
      throw new BadRequestException("合同草稿内容格式不正确，请刷新后重试");
    }
    if (!Array.isArray(input.clauses)) {
      throw new BadRequestException("合同条款内容格式不正确，请刷新后重试");
    }
    const clauses = input.clauses.map((clause, index) =>
      this.parseClause(clause, index)
    );
    if (
      typeof input.pricingNature !== "string" ||
      !PRICING_NATURES.has(input.pricingNature)
    ) {
      throw new BadRequestException("合同计价性质不正确，请重新选择");
    }
    if (
      typeof input.amountSource !== "string" ||
      !AMOUNT_SOURCES.has(input.amountSource)
    ) {
      throw new BadRequestException("合同金额来源不正确，请重新选择");
    }
    if (input.amountSource === "manual" || input.manualAmountCents !== undefined) {
      this.toCents(input.manualAmountCents as string | undefined, "手工合同金额");
    }
    if (input.estimatedAmountCents !== undefined) {
      this.toCents(
        input.estimatedAmountCents as string | undefined,
        "预计发生金额"
      );
    }
    if (
      input.amountAdjustmentReason !== undefined &&
      typeof input.amountAdjustmentReason !== "string"
    ) {
      throw new BadRequestException("合同金额调整原因必须填写文本");
    }
    if (
      input.layoutTemplateVersionId !== undefined &&
      (typeof input.layoutTemplateVersionId !== "string" ||
        !input.layoutTemplateVersionId.trim())
    ) {
      throw new BadRequestException("请选择有效的合同版式");
    }
    if (
      input.paymentTermsOriginalText !== undefined &&
      typeof input.paymentTermsOriginalText !== "string"
    ) {
      throw new BadRequestException("付款条款原文摘要必须是文本。");
    }
    const taxFacts = this.parseTaxFacts(input.taxFacts);
    if (
      input.companyEntityId !== undefined &&
      (typeof input.companyEntityId !== "string" || !input.companyEntityId.trim())
    ) {
      throw new BadRequestException("请选择有效的我方公司主体");
    }
    return {
      expectedRevision: input.expectedRevision as number,
      ...(input.companyEntityId === undefined
        ? {}
        : { companyEntityId: (input.companyEntityId as string).trim() }),
      draftData: { ...(input.draftData as Record<string, unknown>) },
      clauses,
      pricingNature: input.pricingNature as SaveContractDraftDto["pricingNature"],
      amountSource: input.amountSource as SaveContractDraftDto["amountSource"],
      ...(input.manualAmountCents === undefined
        ? {}
        : { manualAmountCents: input.manualAmountCents as string }),
      ...(input.estimatedAmountCents === undefined
        ? {}
        : { estimatedAmountCents: input.estimatedAmountCents as string }),
      ...(input.amountAdjustmentReason === undefined
        ? {}
        : { amountAdjustmentReason: input.amountAdjustmentReason }),
      ...(input.layoutTemplateVersionId === undefined
        ? {}
        : { layoutTemplateVersionId: input.layoutTemplateVersionId }),
      ...(input.paymentTermsOriginalText === undefined
        ? {}
        : { paymentTermsOriginalText: input.paymentTermsOriginalText as string }),
      ...(input.paymentStages === undefined
        ? {}
        : { paymentStages: this.parsePaymentStages(input.paymentStages) }),
      taxFacts
    };
  }

  private resolveEstimatedAmountCents(
    value: string | undefined,
    pricingPolicy: ReturnType<typeof contractPricingPolicy>
  ): bigint | null {
    if (value === undefined) return null;
    if (pricingPolicy.kind !== "unlimited_framework") {
      throw new BadRequestException(
        "预计发生金额仅适用于无固定总价合同"
      );
    }
    return this.toCents(value, "预计发生金额");
  }

  private parseTaxFacts(value: unknown): SaveContractTaxFactsDto {
    const input = this.requireObject(value, "合同税务事实");
    if (
      input.invoiceType !== null &&
      (typeof input.invoiceType !== "string" ||
        !CONTRACT_INVOICE_TYPES.includes(input.invoiceType as ContractInvoiceType))
    ) {
      throw new BadRequestException("发票类型不正确，请重新选择");
    }
    if (
      typeof input.taxMode !== "string" ||
      !CONTRACT_TAX_MODES.includes(input.taxMode as ContractTaxMode)
    ) {
      throw new BadRequestException("合同税率模式不正确，请重新选择");
    }
    if (input.source !== "contract_document") {
      throw new BadRequestException("新合同税务事实来源必须是合同文件明确");
    }
    if (
      input.defaultTaxRatePercent !== null &&
      typeof input.defaultTaxRatePercent !== "string"
    ) {
      throw new BadRequestException("税率必须填写数字");
    }
    let defaultTaxRatePercent: string | null = null;
    if (typeof input.defaultTaxRatePercent === "string") {
      try {
        defaultTaxRatePercent = normalizeTaxRatePercent(
          input.defaultTaxRatePercent
        );
      } catch (error) {
        throw new BadRequestException(
          error instanceof Error ? error.message : "税率格式不正确，请重新填写"
        );
      }
    }
    return {
      invoiceType: input.invoiceType as ContractInvoiceType | null,
      taxMode: input.taxMode as ContractTaxMode,
      defaultTaxRatePercent,
      source: "contract_document"
    };
  }

  private parsePaymentStages(value: unknown): SaveContractDraftDto["paymentStages"] {
    if (!Array.isArray(value)) {
      throw new BadRequestException("付款条款阶段必须是列表。");
    }
    return value.map((stage, index) => {
      const record = this.requireObject(stage, `第 ${index + 1} 条付款条款`);
      if (typeof record.name !== "string" || !record.name.trim()) {
        throw new BadRequestException(`第 ${index + 1} 条付款条款缺少阶段名称。`);
      }
      if (record.basis !== "current_settlement" && record.basis !== "contract_amount") {
        throw new BadRequestException(`第 ${index + 1} 条付款条款的计算基础不正确。`);
      }
      if (
        typeof record.ratioBps !== "number" ||
        !Number.isInteger(record.ratioBps) ||
        record.ratioBps <= 0 ||
        record.ratioBps > 10000
      ) {
        throw new BadRequestException(`第 ${index + 1} 条付款比例必须大于 0 且不超过 100%。`);
      }
      if (
        typeof record.dueDays !== "number" ||
        !Number.isInteger(record.dueDays) ||
        record.dueDays < 0
      ) {
        throw new BadRequestException(`第 ${index + 1} 条付款期限必须是非负天数。`);
      }
      if (typeof record.requiresInvoice !== "boolean") {
        throw new BadRequestException(`第 ${index + 1} 条付款条款缺少是否要求发票。`);
      }
      if (typeof record.allowsInstallments !== "boolean") {
        throw new BadRequestException(`第 ${index + 1} 条付款条款缺少是否允许分次付款。`);
      }
      return {
        name: record.name.trim(),
        basis: record.basis,
        ratioBps: record.ratioBps,
        triggerEvent:
          typeof record.triggerEvent === "string" && record.triggerEvent.trim()
            ? record.triggerEvent.trim()
            : record.basis === "contract_amount"
              ? "合同归档确认生效"
              : PAYMENT_STAGE_TRIGGER_EVENT,
        dueDays: record.dueDays,
        requiresInvoice: record.requiresInvoice,
        allowsInstallments: record.allowsInstallments,
        originalText:
          typeof record.originalText === "string" && record.originalText.trim()
            ? record.originalText.trim()
            : record.basis === "contract_amount"
              ? "合同归档确认生效后按约定比例付款。"
              : PAYMENT_STAGE_TRIGGER_EVENT
      };
    });
  }

  private async savePaymentTerms(
    tx: Prisma.TransactionClient,
    contractVersionId: string,
    contractTypeKey: string | null,
    settlementMode: string | null,
    input: SaveContractDraftDto
  ) {
    const terms = await tx.paymentTermsVersion.findFirst({
      where: { contractVersionId },
      select: { id: true }
    });
    if (!terms) {
      throw new BadRequestException("合同付款条款版本不存在，不能保存付款条款。");
    }

    await tx.paymentTermsVersion.update({
      where: { id: terms.id },
      data: { originalText: input.paymentTermsOriginalText?.trim() ?? "" }
    });
    await tx.paymentTermsStage.deleteMany({
      where: { paymentTermsVersionId: terms.id }
    });
    if (input.paymentStages?.length) {
      const explicitSettlementMode = isContractSettlementMode(settlementMode);
      const effectiveMode = explicitSettlementMode
        ? settlementMode
        : contractTypeKey === "generic_contract"
          ? "direct_payment"
          : "settlement_required";
      if (!explicitSettlementMode &&
        contractTypeKey !== "generic_contract" &&
        !SETTLEMENT_CONTRACT_TYPE_KEYS.has(contractTypeKey ?? "")) {
        throw new BadRequestException("合同类型不正确，不能保存付款条款");
      }
      const expectedBasis = effectiveMode === "direct_payment"
        ? "contract_amount"
        : "current_settlement";
      if (input.paymentStages.some((stage) => stage.basis !== expectedBasis)) {
        throw new BadRequestException(
          explicitSettlementMode
            ? effectiveMode === "direct_payment"
              ? "按合同直接付款的付款条款必须按合同金额计算"
              : "需要结算的付款条款必须按当期结算计算"
            : contractTypeKey === "generic_contract"
              ? "通用合同付款条款必须按合同金额计算"
              : "该合同类型付款条款必须按当期结算计算"
        );
      }
      await tx.paymentTermsStage.createMany({
        data: input.paymentStages.map((stage) => ({
          paymentTermsVersionId: terms.id,
          name: stage.name,
          stageType: "progress",
          basis: stage.basis,
          ratioBps: stage.ratioBps,
          triggerAnchor: stage.basis === "contract_amount"
            ? "contract_effective"
            : "settlement_effective",
          triggerEvent: stage.triggerEvent,
          dueDays: stage.dueDays,
          requiresInvoice: stage.requiresInvoice,
          allowsEarlyPayment: false,
          allowsInstallments: stage.allowsInstallments,
          originalText: stage.originalText
        }))
      });
    }
  }

  private parseTypeChangeInput(rawInput: unknown): PreviewContractTypeChangeDto {
    const input = this.requireObject(rawInput, "合同类型变更内容");
    if (
      typeof input.targetBusinessTemplateVersionId !== "string" ||
      !input.targetBusinessTemplateVersionId.trim()
    ) {
      throw new BadRequestException("请选择目标合同模板");
    }
    if (
      typeof input.expectedRevision !== "number" ||
      !Number.isInteger(input.expectedRevision) ||
      input.expectedRevision < 1
    ) {
      throw new BadRequestException("合同草稿版本号不正确，请刷新后重试");
    }
    return {
      targetBusinessTemplateVersionId: input.targetBusinessTemplateVersionId,
      expectedRevision: input.expectedRevision as number
    };
  }

  private parseApplyTypeChangeInput(rawInput: unknown): ApplyContractTypeChangeDto {
    const input = this.requireObject(rawInput, "合同类型变更确认内容");
    const parsed = this.parseTypeChangeInput(input);
    if (input.confirmed !== true) {
      throw new BadRequestException("请先确认合同类型变更后果");
    }
    return { ...parsed, confirmed: true };
  }

  private parseCheckpointInput(rawInput: unknown): CreateDraftCheckpointDto {
    const input = this.requireObject(rawInput, "合同草稿保存点内容");
    if (input.name !== undefined && typeof input.name !== "string") {
      throw new BadRequestException("保存点名称必须填写文本");
    }
    return input.name === undefined ? {} : { name: input.name };
  }

  private parseVoidInput(rawInput: unknown): VoidDraftDto {
    const input = this.requireObject(rawInput, "合同草稿作废内容");
    if (typeof input.reason !== "string" || !input.reason.trim()) {
      throw new BadRequestException("请填写合同草稿作废原因");
    }
    return { reason: input.reason.trim() };
  }

  private parseTransferInput(rawInput: unknown): TransferContractDraftDto {
    const input = this.requireObject(rawInput, "合同草稿转交内容");
    if (typeof input.toUserId !== "string" || !input.toUserId.trim()) {
      throw new BadRequestException("请选择合同草稿转交接收人");
    }
    if (
      input.expectedContractVersionId !== undefined &&
      (typeof input.expectedContractVersionId !== "string" ||
        !input.expectedContractVersionId.trim())
    ) {
      throw new BadRequestException("合同草稿版本编号不正确，请刷新后重试");
    }
    return {
      toUserId: input.toUserId.trim(),
      ...(typeof input.expectedContractVersionId === "string"
        ? { expectedContractVersionId: input.expectedContractVersionId.trim() }
        : {})
    };
  }

  private parseClause(value: unknown, index: number): ContractClauseDefinition {
    const clause = this.requireObject(value, `第 ${index + 1} 条合同条款`);
    if (
      typeof clause.key !== "string" ||
      !clause.key ||
      typeof clause.title !== "string" ||
      !clause.title ||
      (clause.numberingMode !== "automatic" && clause.numberingMode !== "fixed") ||
      !Object.hasOwn(clause, "content")
    ) {
      throw new BadRequestException(`第 ${index + 1} 条合同条款格式不正确，请刷新后重试`);
    }
    if (clause.required !== undefined && typeof clause.required !== "boolean") {
      throw new BadRequestException(`第 ${index + 1} 条合同条款必填标记不正确`);
    }
    if (
      clause.standardClauseVersionId !== undefined &&
      typeof clause.standardClauseVersionId !== "string"
    ) {
      throw new BadRequestException(
        `第 ${index + 1} 条合同条款引用的标准条款版本不正确`
      );
    }
    return {
      key: clause.key,
      title: clause.title,
      numberingMode: clause.numberingMode,
      content: clause.content,
      ...(clause.required === undefined ? {} : { required: clause.required }),
      ...(clause.standardClauseVersionId === undefined
        ? {}
        : { standardClauseVersionId: clause.standardClauseVersionId })
    };
  }

  private requireObject(value: unknown, label: string): Record<string, unknown> {
    if (!this.isPlainObject(value)) {
      throw new BadRequestException(`${label}格式不正确，请刷新后重试`);
    }
    return value;
  }

  private isPlainObject(value: unknown): value is Record<string, unknown> {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return false;
    }
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  }

  private validateDraftAgainstTemplate(
    draftData: Record<string, unknown>,
    clauses: ContractClauseDefinition[],
    template: TemplateSnapshot,
    directBaseDraftData?: Prisma.JsonValue
  ) {
    const fieldKeys = new Set(template.fieldSchema.map((field) => field.key));
    const structuralKeys = new Set([
      "contractName",
      "myCompanyEntity",
      "companyEntitySelection",
      "fieldValues",
      "partyValues"
    ]);
    const directBase = directBaseDraftData &&
      typeof directBaseDraftData === "object" &&
      !Array.isArray(directBaseDraftData)
      ? directBaseDraftData as Prisma.JsonObject
      : {};
    const invalidField = Object.keys(draftData).find(
      (key) =>
        !fieldKeys.has(key) &&
        !structuralKeys.has(key) &&
        !(
          Object.hasOwn(directBase, key) &&
          isDeepStrictEqual(directBase[key], draftData[key])
        )
    );
    if (invalidField) throw new BadRequestException("合同草稿包含模板外字段，请刷新后重试");
    const fieldValues = draftData.fieldValues === undefined
      ? {}
      : this.requireObject(draftData.fieldValues, "合同专业字段");
    const taxMirrorKeys = new Set(["invoiceType", "taxRatePercent"]);
    const unknownNestedField = Object.keys(fieldValues).find(
      (key) => !fieldKeys.has(key) && !taxMirrorKeys.has(key)
    );
    if (unknownNestedField) {
      throw new BadRequestException(`字段 ${unknownNestedField} 未在合同模板中声明，不能保存`);
    }
    if (draftData.partyValues !== undefined) {
      this.requireObject(draftData.partyValues, "合同主体字段");
    }
    const conflictingField = [...fieldKeys].find(
      (key) =>
        Object.hasOwn(draftData, key) &&
        Object.hasOwn(fieldValues, key) &&
        !isDeepStrictEqual(draftData[key], fieldValues[key])
    );
    if (conflictingField) {
      throw new BadRequestException(`字段 ${conflictingField} 存在冲突值，请保留唯一填写位置`);
    }
    if (
      draftData.contractName !== undefined &&
      typeof draftData.contractName !== "string"
    ) {
      throw new BadRequestException("合同名称必须是文字");
    }
    if (
      draftData.myCompanyEntity !== undefined &&
      typeof draftData.myCompanyEntity !== "string"
    ) {
      throw new BadRequestException("我方签约主体必须是文字");
    }
    for (const field of template.fieldSchema) {
      const value = Object.hasOwn(fieldValues, field.key)
        ? fieldValues[field.key]
        : draftData[field.key];
      if (value === undefined || value === null || value === "") continue;
      const valid = field.type === "boolean"
        ? typeof value === "boolean"
        : field.type === "multi_select"
          ? Array.isArray(value) && value.every((item) => typeof item === "string")
          : field.type === "number" || field.type === "money"
            ? typeof value === "number" ||
              (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value)))
            : typeof value === "string";
      if (!valid) {
        throw new BadRequestException(`字段 ${field.key} 填写类型不正确`);
      }
    }
    const clauseKeys = new Set(template.clauseSchema.map((clause) => clause.key));
    const seen = new Set<string>();
    for (const clause of clauses) {
      if (!clause || typeof clause.key !== "string" || !clauseKeys.has(clause.key)) {
        throw new BadRequestException("合同草稿包含模板外条款，请刷新后重试");
      }
      if (seen.has(clause.key)) {
        throw new BadRequestException("合同草稿包含重复条款，请刷新后重试");
      }
      seen.add(clause.key);
    }
  }

  private parseTemplateSnapshot(value: Prisma.JsonValue): TemplateSnapshot {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new BadRequestException("合同模板快照异常，请重新选择模板后重试");
    }
    const snapshot = value as Record<string, unknown>;
    if (
      !Array.isArray(snapshot.fieldSchema) ||
      !Array.isArray(snapshot.billSchema) ||
      !Array.isArray(snapshot.clauseSchema)
    ) {
      throw new BadRequestException("合同模板快照异常，请重新选择模板后重试");
    }
    return snapshot as unknown as TemplateSnapshot;
  }

  private versionToTemplate(version: {
    fieldSchema: Prisma.JsonValue;
    billSchema: Prisma.JsonValue;
    clauseSchema: Prisma.JsonValue;
    attachmentSchema: Prisma.JsonValue;
    validationSchema: Prisma.JsonValue;
    supplementChangePolicy?: Prisma.JsonValue | null;
  }): TemplateSnapshot {
    return {
      fieldSchema: version.fieldSchema as unknown as ContractFieldDefinition[],
      billSchema: version.billSchema as unknown as ContractBillDefinition[],
      clauseSchema: version.clauseSchema as unknown as ContractClauseDefinition[],
      attachmentSchema: version.attachmentSchema as unknown[],
      validationSchema: version.validationSchema as unknown[],
      supplementChangePolicy: version.supplementChangePolicy as unknown as SupplementChangePolicy
    };
  }

  private async loadPublishedTemplate(
    tx: Prisma.TransactionClient,
    versionId: string
  ) {
    const target = await tx.contractBusinessTemplateVersion.findUnique({
      where: { id: versionId }
    });
    if (!target) throw new NotFoundException("未找到业务模板版本，请重新选择模板");
    if (target.status !== "published") {
      throw new BadRequestException("目标业务模板尚未发布，请选择已发布模板");
    }
    return target;
  }

  private buildTypeChangePreview(current: TemplateSnapshot, target: TemplateSnapshot) {
    const currentFields = new Map(current.fieldSchema.map((field) => [field.key, field]));
    const targetFields = new Map(target.fieldSchema.map((field) => [field.key, field]));
    const currentBills = new Map(current.billSchema.map((bill) => [bill.key, bill]));
    const targetBills = new Map(target.billSchema.map((bill) => [bill.key, bill]));
    return {
      retainedFields: target.fieldSchema
        .filter((field) => currentFields.get(field.key)?.type === field.type)
        .map((field) => field.key),
      removedFields: current.fieldSchema
        .filter((field) => targetFields.get(field.key)?.type !== field.type)
        .map((field) => field.key),
      addedFields: target.fieldSchema
        .filter((field) => currentFields.get(field.key)?.type !== field.type)
        .map((field) => field.key),
      addedDefaults: Object.fromEntries(
        target.fieldSchema
          .filter((field) => currentFields.get(field.key)?.type !== field.type)
          .map((field) => [field.key, field.defaultValue ?? null])
      ),
      removedBills: current.billSchema
        .filter((bill) => {
          const targetBill = targetBills.get(bill.key);
          return !targetBill || !this.billIsCompatible(bill, targetBill);
        })
        .map((bill) => bill.key),
      addedBills: target.billSchema
        .filter((bill) => {
          const currentBill = currentBills.get(bill.key);
          return !currentBill || !this.billIsCompatible(currentBill, bill);
        })
        .map((bill) => bill.key)
    };
  }

  private billIsCompatible(
    current: {
      pricingMode: string;
      quantityScale: number;
      unitPriceScale: number;
      schemaSnapshot?: Prisma.JsonValue;
      columns?: unknown[];
    },
    target: ContractBillDefinition
  ) {
    const currentColumns =
      current.columns ??
      ((current.schemaSnapshot &&
      typeof current.schemaSnapshot === "object" &&
      !Array.isArray(current.schemaSnapshot)
        ? (current.schemaSnapshot as { columns?: unknown[] }).columns
        : []) ??
        []);
    return (
      current.pricingMode === target.pricingMode &&
      current.quantityScale === target.quantityScale &&
      current.unitPriceScale === target.unitPriceScale &&
      JSON.stringify(currentColumns) === JSON.stringify(target.columns)
    );
  }

  private clauseIsCompatible(
    current: ContractClauseDefinition,
    target: ContractClauseDefinition
  ) {
    return (
      current.key === target.key &&
      current.numberingMode === target.numberingMode &&
      current.standardClauseVersionId === target.standardClauseVersionId
    );
  }

  private billDefinitionData(bill: ContractBillDefinition) {
    return {
      name: bill.name,
      amountRole: bill.amountRole,
      pricingMode: bill.pricingMode,
      quantityScale: bill.quantityScale,
      unitPriceScale: bill.unitPriceScale,
      schemaSnapshot: this.toJson({ columns: bill.columns })
    };
  }

  private sumIncludedBills(
    bills: Array<{ amountRole: string; taxInclusiveAmountCents: bigint }>
  ) {
    return bills
      .filter((bill) => bill.amountRole === "included" || bill.amountRole === "provisional")
      .reduce((sum, bill) => sum + bill.taxInclusiveAmountCents, 0n);
  }

  private async loadBillSnapshots(
    tx: Prisma.TransactionClient,
    contractVersionId: string
  ): Promise<BillSnapshot[]> {
    const bills = await tx.contractBill.findMany({ where: { contractVersionId } });
    const rows = bills.length
      ? await tx.contractBillRow.findMany({
          where: { contractBillId: { in: bills.map((bill) => bill.id) } },
          orderBy: [{ contractBillId: "asc" }, { sortOrder: "asc" }]
        })
      : [];
    assertContractBillDerivedUnitPrices(rows);
    return bills.map((bill) => ({
      billKey: bill.billKey,
      name: bill.name,
      amountRole: bill.amountRole,
      pricingMode: bill.pricingMode,
      quantityScale: bill.quantityScale,
      unitPriceScale: bill.unitPriceScale,
      schemaSnapshot: bill.schemaSnapshot,
      sourceExcelFileId: bill.sourceExcelFileId,
      revision: bill.revision,
      taxInclusiveAmountCents: bill.taxInclusiveAmountCents.toString(),
      taxExclusiveAmountCents: bill.taxExclusiveAmountCents.toString(),
      taxAmountCents: bill.taxAmountCents.toString(),
      rows: rows
        .filter((row) => row.contractBillId === bill.id)
        .map((row) => ({
          rowKey: row.rowKey,
          sortOrder: row.sortOrder,
          itemCode: row.itemCode,
          itemName: row.itemName,
          specification: row.specification,
          unit: row.unit,
          quantity: row.quantity?.toString() ?? null,
          unitPrice: this.formatUnitPrice(row.unitPrice),
          taxRate: row.taxRate?.toString() ?? null,
          taxRatePercent: row.taxRate?.toString() ?? null,
          taxRateSource: row.taxRateSource,
          pricingFactStatus: row.pricingFactStatus,
          precisionPolicy: row.precisionPolicy,
          taxInclusiveAmountCents: row.taxInclusiveAmountCents?.toString() ?? null,
          taxExclusiveAmountCents: row.taxExclusiveAmountCents?.toString() ?? null,
          taxAmountCents: row.taxAmountCents?.toString() ?? null,
          taxExclusiveUnitPrice:
            row.taxExclusiveUnitPrice?.toFixed(6) ?? null,
          isProvisional: row.isProvisional,
          settlementBasis: row.settlementBasis,
          customData: row.customData
        }))
    }));
  }

  private parseCheckpoint(value: Prisma.JsonValue): CheckpointSnapshot {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new BadRequestException("合同草稿保存点异常，请重新选择保存点");
    }
    const snapshot = value as unknown as CheckpointSnapshot;
    if (
      !snapshot.draftData ||
      typeof snapshot.draftData !== "object" ||
      !Array.isArray(snapshot.clauseSnapshot) ||
      !Array.isArray(snapshot.bills) ||
      typeof snapshot.amountCents !== "string" ||
      !(
        snapshot.estimatedAmountCents === undefined ||
        snapshot.estimatedAmountCents === null ||
        typeof snapshot.estimatedAmountCents === "string"
      )
    ) {
      throw new BadRequestException("合同草稿保存点异常，请重新选择保存点");
    }
    return snapshot;
  }

  private async replaceBillsFromSnapshot(
    tx: Prisma.TransactionClient,
    contractVersionId: string,
    snapshots: BillSnapshot[],
    contractId?: string,
    actorUserId?: string
  ) {
    const current = await tx.contractBill.findMany({ where: { contractVersionId } });
    const currentRows = current.length
      ? await tx.contractBillRow.findMany({ where: { contractBillId: { in: current.map((bill) => bill.id) } } })
      : [];
    const priorLineage = new Map(currentRows.map((row) => [`${row.contractBillId}:${row.rowKey}`, row.lineageId]));
    if (current.length) {
      await tx.contractBillRow.deleteMany({
        where: { contractBillId: { in: current.map((bill) => bill.id) } }
      });
      await tx.contractBill.deleteMany({ where: { contractVersionId } });
    }
    for (const snapshot of snapshots) {
      const bill = await tx.contractBill.create({
        data: {
          contractVersionId,
          billKey: snapshot.billKey,
          name: snapshot.name,
          amountRole: snapshot.amountRole,
          pricingMode: snapshot.pricingMode,
          quantityScale: snapshot.quantityScale,
          unitPriceScale: snapshot.unitPriceScale,
          schemaSnapshot: this.toJson(snapshot.schemaSnapshot),
          sourceExcelFileId: snapshot.sourceExcelFileId,
          revision: snapshot.revision,
          taxInclusiveAmountCents: parseMoneyCents(
            snapshot.taxInclusiveAmountCents,
            "清单含税金额"
          ),
          taxExclusiveAmountCents: parseMoneyCents(
            snapshot.taxExclusiveAmountCents,
            "清单不含税金额"
          ),
          taxAmountCents: parseMoneyCents(snapshot.taxAmountCents, "清单税额")
        }
      });
      if (snapshot.rows.length) {
        await tx.contractBillRow.createMany({
          data: snapshot.rows.map((row) => {
            const storedRow = { ...row };
            delete storedRow.taxRatePercent;
            delete storedRow.taxRateSource;
            delete storedRow.pricingFactStatus;
            delete storedRow.precisionPolicy;
            return {
              contractBillId: bill.id,
              ...storedRow,
              taxRateSource: row.taxRateSource ?? "version_default",
              pricingFactStatus:
                row.pricingFactStatus ??
                (row.unitPrice !== null && row.taxRate !== null
                  ? "confirmed"
                  : "unconfirmed"),
              precisionPolicy: row.precisionPolicy ?? "legacy",
              taxInclusiveAmountCents: this.parseNullableMoney(
                row.taxInclusiveAmountCents,
                "清单行含税金额"
              ),
              taxExclusiveAmountCents: this.parseNullableMoney(
                row.taxExclusiveAmountCents,
                "清单行不含税金额"
              ),
              taxAmountCents: this.parseNullableMoney(row.taxAmountCents, "清单行税额"),
              customData: this.toJson(row.customData)
            };
          })
        });
        const targets = await tx.contractBillRow.findMany({ where: { contractBillId: bill.id } });
        for (const target of targets) {
          const previousBill = current.find((candidate) => candidate.billKey === snapshot.billKey);
          const lineageId = previousBill ? priorLineage.get(`${previousBill.id}:${target.rowKey}`) : null;
          if (lineageId) {
            await tx.contractBillRow.update({ where: { id: target.id }, data: { lineageId } });
          } else {
            if (!contractId || !actorUserId) continue;
            await this.lineage.bindNewRow(tx, {
              contractId,
              contractVersionId,
              contractBillRowId: target.id,
              actorUserId
            });
          }
        }
      }
    }
  }

  private async runSerializableWithRetry<T>(
    operation: (tx: Prisma.TransactionClient) => Promise<T>
  ): Promise<T> {
    for (let attempt = 1; attempt <= CHECKPOINT_RETRY_LIMIT; attempt += 1) {
      try {
        return await this.prisma.$transaction(operation, {
          isolationLevel: "Serializable"
        });
      } catch (error) {
        if (attempt === CHECKPOINT_RETRY_LIMIT || !this.isRetryableTransactionError(error)) {
          throw error;
        }
      }
    }
    throw new Error("Unreachable checkpoint transaction retry state");
  }

  private isRetryableTransactionError(error: unknown) {
    return (
      error !== null &&
      typeof error === "object" &&
      "code" in error &&
      (error.code === "P2034" || error.code === "P2002")
    );
  }

  private assertRevision(actual: number, expected: number) {
    if (actual !== expected) {
      throw new BadRequestException("合同草稿已被他人更新，请刷新后重新编辑");
    }
  }

  private assertCas(count: number) {
    if (count !== 1) {
      throw new BadRequestException("合同草稿已变化，请刷新后重试");
    }
  }

  private assertLifecycleCas(count: number) {
    if (count !== 1) throw new BadRequestException("合同草稿状态已变化，请刷新后重试");
  }

  private toCents(value: string | undefined, field: string) {
    if (value === undefined) {
      throw new BadRequestException(`${field}必须是大于等于 0 的整数金额`);
    }
    return parseMoneyCentsInput(value, field, `${field}必须是大于等于 0 的整数金额`);
  }

  private changedKeys(before: Record<string, unknown>, after: Record<string, unknown>) {
    return [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(
      (key) => JSON.stringify(before[key]) !== JSON.stringify(after[key])
    );
  }

  private async assertSupplementFixedFactsUnchanged(
    tx: Prisma.TransactionClient,
    version: {
      id: string;
      pricingNature: string;
    },
    input: SaveContractDraftDto
  ) {
    if (input.pricingNature !== version.pricingNature) {
      throw new BadRequestException("合同变更不得修改计价性质");
    }
    if (input.paymentTermsOriginalText !== undefined || input.paymentStages !== undefined) {
      const terms = await tx.paymentTermsVersion.findFirst({
        where: { contractVersionId: version.id },
        orderBy: { versionNo: "desc" },
        select: { id: true, originalText: true }
      });
      if (!terms) throw new BadRequestException("合同变更付款条款快照缺失，不能保存草稿");
      if (
        input.paymentTermsOriginalText !== undefined &&
        input.paymentTermsOriginalText.trim() !== terms.originalText
      ) {
        throw new BadRequestException("合同变更不得修改付款条款原文或结算基础规则");
      }
      const stages = terms
        ? await tx.paymentTermsStage.findMany({
            where: { paymentTermsVersionId: terms.id },
            orderBy: { createdAt: "asc" },
            select: {
              name: true,
              stageType: true,
              basis: true,
              ratioBps: true,
              fixedAmountCents: true,
              triggerAnchor: true,
              triggerEvent: true,
              dueDays: true,
              advanceDeductionMode: true,
              advanceDeductionRatioBps: true,
              advanceDeductionStartRatioBps: true,
              requiresInvoice: true,
              allowsEarlyPayment: true,
              allowsInstallments: true,
              retentionBps: true,
              originalText: true
            }
          })
        : [];
      if (input.paymentStages !== undefined) {
        const incoming = input.paymentStages.map((stage) => ({
          name: stage.name,
          stageType: "progress",
          basis: stage.basis,
          ratioBps: stage.ratioBps,
          fixedAmountCents: null,
          triggerAnchor: stage.basis === "contract_amount"
            ? "contract_effective"
            : "settlement_effective",
          triggerEvent: stage.triggerEvent,
          dueDays: stage.dueDays,
          advanceDeductionMode: "none",
          advanceDeductionRatioBps: null,
          advanceDeductionStartRatioBps: null,
          requiresInvoice: stage.requiresInvoice,
          allowsEarlyPayment: false,
          allowsInstallments: stage.allowsInstallments,
          retentionBps: null,
          originalText: stage.originalText
        }));
        const stored = stages.map((stage) => ({
          ...stage,
          fixedAmountCents: stage.fixedAmountCents?.toString() ?? null
        }));
        if (JSON.stringify(stored) !== JSON.stringify(incoming)) {
          throw new BadRequestException("合同变更不得修改付款条款原文或结算基础规则");
        }
      }
    }
  }

  private withTaxFactMirror(
    draftData: Record<string, unknown>,
    taxFacts: SaveContractTaxFactsDto
  ) {
    const rest = { ...draftData };
    delete rest["invoiceType"];
    delete rest["taxRatePercent"];
    return {
      ...rest,
      fieldValues: {
        ...this.objectValue(draftData["fieldValues"]),
        invoiceType:
          taxFacts.invoiceType === null
            ? null
            : contractInvoiceTypeLabel(taxFacts.invoiceType),
        taxRatePercent: taxFacts.defaultTaxRatePercent
      }
    };
  }

  private normalizeLegacyTemplateFieldLocations(
    draftData: Record<string, unknown>,
    template: TemplateSnapshot,
    persistedDraftData: Prisma.JsonValue
  ) {
    if (
      draftData.fieldValues !== undefined &&
      !this.isPlainObject(draftData.fieldValues)
    ) {
      return draftData;
    }
    const persisted = this.objectValue(persistedDraftData);
    const normalized = { ...draftData };
    const fieldValues = { ...this.objectValue(draftData.fieldValues) };
    let changed = false;
    for (const field of template.fieldSchema) {
      const key = field.key;
      if (!Object.hasOwn(persisted, key) || !Object.hasOwn(normalized, key)) {
        continue;
      }
      if (!Object.hasOwn(fieldValues, key)) {
        fieldValues[key] = normalized[key];
      }
      delete normalized[key];
      changed = true;
    }
    return changed ? { ...normalized, fieldValues } : draftData;
  }

  private companySelectionFromDraft(value: unknown) {
    const draft = this.objectValue(value);
    const selection = this.objectValue(draft["companyEntitySelection"]);
    return typeof selection["id"] === "string" &&
      typeof selection["versionId"] === "string" &&
      typeof selection["versionNo"] === "number" &&
      Number.isInteger(selection["versionNo"]) &&
      typeof selection["name"] === "string" &&
      typeof selection["unifiedSocialCreditCode"] === "string" &&
      (selection["registeredAddress"] === null ||
        typeof selection["registeredAddress"] === "string")
      ? {
          id: selection["id"],
          versionId: selection["versionId"],
          versionNo: selection["versionNo"],
          name: selection["name"],
          unifiedSocialCreditCode: selection["unifiedSocialCreditCode"],
          registeredAddress: selection["registeredAddress"] as string | null
        }
      : null;
  }

  private async lockAndLoadCompanyEntitySelection(
    tx: Prisma.TransactionClient,
    companyEntityId: string
  ) {
    await tx.$queryRaw(Prisma.sql`
      SELECT "id"
      FROM "CompanyEntity"
      WHERE "id" = ${companyEntityId}
      FOR UPDATE
    `);
    const entity = await tx.companyEntity.findUnique({ where: { id: companyEntityId } });
    if (!entity) {
      throw new BadRequestException("未找到所选我方公司主体，请回到基本信息重新选择");
    }
    if (!entity.isActive) {
      throw new BadRequestException("所选我方公司主体已停用，请回到基本信息重新选择");
    }
    if (entity.dataStatus !== "complete") {
      throw new BadRequestException("所选我方公司主体资料待补全，请先到我方公司主体页面完善信用代码");
    }
    const version = await tx.companyEntityVersion.findUnique({
      where: {
        companyEntityId_versionNo: {
          companyEntityId: entity.id,
          versionNo: entity.currentVersionNo
        }
      }
    });
    if (!version || !version.unifiedSocialCreditCode) {
      throw new BadRequestException("我方公司主体版本缺失，请联系合同部核对后重试");
    }
    return {
      id: entity.id,
      versionId: version.id,
      versionNo: version.versionNo,
      name: version.name,
      unifiedSocialCreditCode: version.unifiedSocialCreditCode,
      registeredAddress: version.registeredAddress
    };
  }

  private withoutTaxFactMirror(value: unknown) {
    const record = this.objectValue(value);
    const rest = { ...record };
    const fieldValues = rest["fieldValues"];
    delete rest["invoiceType"];
    delete rest["taxRatePercent"];
    delete rest["fieldValues"];
    const otherFieldValues = { ...this.objectValue(fieldValues) };
    delete otherFieldValues["invoiceType"];
    delete otherFieldValues["taxRatePercent"];
    return {
      ...rest,
      ...(Object.keys(otherFieldValues).length
        ? { fieldValues: otherFieldValues }
        : {})
    };
  }

  private taxFactsAuditSnapshot(value: {
    invoiceType?: string | null;
    taxMode?: string | null;
    defaultTaxRatePercent?: { toString(): string } | null;
    taxFactSource?: string | null;
  }) {
    return {
      invoiceType: value.invoiceType ?? null,
      taxMode: value.taxMode ?? "single_rate",
      defaultTaxRatePercent: value.defaultTaxRatePercent?.toString() ?? null,
      source: value.taxFactSource ?? null
    };
  }

  private taxFactsReadModel(value: {
    invoiceType?: string | null;
    taxMode?: string | null;
    defaultTaxRatePercent?: { toString(): string } | null;
    taxFactStatus?: string | null;
    taxFactSource?: string | null;
    taxFactRevision?: number | null;
    taxFactsFrozenAt?: Date | null;
  }) {
    return {
      invoiceType: (value.invoiceType ?? null) as ContractInvoiceType | null,
      taxMode: (value.taxMode ?? "single_rate") as ContractTaxMode,
      defaultTaxRatePercent: value.defaultTaxRatePercent?.toString() ?? null,
      status: (value.taxFactStatus ?? "unconfirmed") as ContractTaxFactStatus,
      source: (value.taxFactSource ?? null) as ContractTaxFactSource | null,
      revision: value.taxFactRevision ?? 0,
      frozenAt: value.taxFactsFrozenAt?.toISOString() ?? null
    };
  }

  private toJson(value: unknown): Prisma.InputJsonValue {
    return JSON.parse(
      JSON.stringify(value, (_key, item: unknown) =>
        typeof item === "bigint" ? item.toString() : item
      )
    ) as Prisma.InputJsonValue;
  }

  private formatUnitPrice(
    value: { toFixed?: (scale: number) => string; toString: () => string } | null
  ) {
    if (value === null) return null;
    const decimal = new Prisma.Decimal(value.toString());
    return decimal.decimalPlaces() > 2 ? decimal.toString() : decimal.toFixed(2);
  }

  private parseNullableMoney(value: string | null, field: string) {
    return value === null ? null : parseMoneyCents(value, field);
  }

  private toReadModel<T>(value: T): T {
    return this.convertReadValue(value) as T;
  }

  private async loadAuthorizationReuseCandidates(contractId: string, currentVersionId: string) {
    const sourceVersions = await this.prisma.contractVersion.findMany({
      where: {
        contractId,
        id: { not: currentVersionId },
        status: { in: ["effective", "superseded"] }
      },
      select: { id: true, versionNo: true, status: true },
      orderBy: { versionNo: "desc" }
    });
    if (!sourceVersions.length) return [];

    const sourceById = new Map(sourceVersions.map((version) => [version.id, version]));
    const links = await this.prisma.contractVersionAuthorizationLink.findMany({
      where: {
        contractVersionId: { in: sourceVersions.map((version) => version.id) },
        required: true,
        authorizationId: { not: null }
      },
      select: {
        contractVersionId: true,
        side: true,
        authorizationId: true
      }
    });
    const authorizationIds = links
      .map((link) => link.authorizationId)
      .filter((id): id is string => Boolean(id));
    if (!authorizationIds.length) return [];

    const authorizations = await this.prisma.contractAuthorization.findMany({
      where: { id: { in: authorizationIds }, status: "active" }
    });
    const files = await this.prisma.fileObject.findMany({
      where: {
        id: { in: authorizations.map((authorization) => authorization.fileId) },
        storageStatus: "active"
      },
      select: { id: true, storageStatus: true, contentSha256: true }
    });
    const fileById = new Map(files.map((file) => [file.id, file]));
    const authorizationById = new Map(authorizations.map((authorization) => [authorization.id, authorization]));

    return links.flatMap((link) => {
      const source = sourceById.get(link.contractVersionId);
      const authorization = link.authorizationId
        ? authorizationById.get(link.authorizationId)
        : undefined;
      const file = authorization ? fileById.get(authorization.fileId) : undefined;
      const scope = authorization?.scopeSummary ?? "";
      if (
        !source ||
        !authorization ||
        authorization.originContractVersionId !== source.id ||
        authorization.side !== link.side ||
        !["first_party", "counterparty"].includes(link.side) ||
        !file ||
        file.storageStatus !== "active" ||
        !/^[a-f0-9]{64}$/u.test(authorization.contentSha256) ||
        file.contentSha256 !== authorization.contentSha256 ||
        authorization.pageCount < 1 ||
        !["签署", "履行", "变更", "补充协议"].every((keyword) => scope.includes(keyword))
      ) return [];
      return [{
        authorizationId: authorization.id,
        sourceContractVersionId: source.id,
        sourceVersionNo: source.versionNo,
        sourceVersionStatus: source.status,
        side: authorization.side,
        grantorName: authorization.grantorName,
        agentName: authorization.agentName,
        scopeSummary: authorization.scopeSummary,
        contentSha256: authorization.contentSha256,
        pageCount: authorization.pageCount,
        fileStatus: "active" as const
      }];
    });
  }

  private readinessFromSnapshot(snapshot: unknown) {
    const record = this.objectValue(snapshot);
    const blocking = this.readinessEntries(record["blocking"]);
    const warnings = this.readinessEntries(record["warnings"]);
    const blockingMessages =
      blocking.length > 0 ? blocking.map((item) => item.message) : this.readinessMessages(record["blockingMessages"]);
    const warningMessages =
      warnings.length > 0 ? warnings.map((item) => item.message) : this.readinessMessages(record["warningMessages"]);
    const hasSnapshot = Object.keys(record).length > 0;

    return {
      ready: hasSnapshot && blockingMessages.length === 0,
      blockingMessages,
      warningMessages,
      blocking,
      warnings,
      checkedRevision: typeof record["checkedRevision"] === "number" ? record["checkedRevision"] : null
    };
  }

  private readinessEntries(value: unknown) {
    if (!Array.isArray(value)) return [];

    return value.flatMap((item) => {
      const record = this.objectValue(item);
      if (typeof record["message"] !== "string") return [];
      const location = this.readinessLocation(record["location"]);
      return [{
        key: typeof record["key"] === "string" ? record["key"] : "",
        section: typeof record["section"] === "string" ? record["section"] : "",
        message: record["message"],
        ...(location ? { location } : {})
      }];
    });
  }

  private readinessLocation(value: unknown) {
    const record = this.objectValue(value);
    const validSections = new Set([
      "inspection",
      "basic",
      "parties",
      "professional",
      "bill_tax",
      "settlement_payment",
      "clauses",
      "attachments",
      "negotiation_documents",
      "flow_history"
    ]);
    const sectionId = typeof record["sectionId"] === "string"
      ? record["sectionId"]
      : "";
    if (!validSections.has(sectionId)) return null;
    return {
      sectionId,
      ...(typeof record["fieldKey"] === "string"
        ? { fieldKey: record["fieldKey"] }
        : {}),
      ...(typeof record["billKey"] === "string"
        ? { billKey: record["billKey"] }
        : {}),
      ...(typeof record["rowKey"] === "string"
        ? { rowKey: record["rowKey"] }
        : {})
    };
  }

  private readinessMessages(value: unknown) {
    return Array.isArray(value)
      ? value.filter((message): message is string => typeof message === "string")
      : [];
  }

  private objectValue(value: unknown): Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  private convertReadValue(value: unknown): unknown {
    if (typeof value === "bigint") {
      return moneyCentsToApi(value);
    }
    if (value instanceof Prisma.Decimal) {
      return value.toString();
    }
    if (Array.isArray(value)) {
      return value.map((item) => this.convertReadValue(item));
    }
    if (value !== null && typeof value === "object" && !(value instanceof Date)) {
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, this.convertReadValue(item)])
      );
    }
    return value;
  }
}
