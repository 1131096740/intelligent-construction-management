import { UPWARD_DIRECT_ARCHIVE_AUTHORITY, type UpwardDirectArchiveAuthority } from "../contract/contract-upward-direct-registration";
import { GENERATED_UPWARD_OPERATING_ACTIVATION } from "../contract/contract-generated-upward-operating";
import { nativeGeneratedUpwardOperatingActivation } from "../contract/contract-generated-upward-operating-installation";
import { ServiceUnavailableException } from "@nestjs/common";
import { createBusinessEntryDefinitionRegistry } from "@jiangkong/shared-domain";
import { CONTRACT_SETTLEMENT_MODE_ENTRY_DEFINITION } from "../contract-workbench/contract-business-entry-definition";
import { ContractEconomicReviewController } from "../contract-ledger/contract-economic-review.controller";
import { ContractBillLineageService } from "../contract-bill/contract-bill-lineage.service";
import { BusinessEntryTransactionService } from "../business-entry-definition/business-entry-transaction.service";
import { BUSINESS_ENTRY_DEFINITION_REGISTRY as BUSINESS_ENTRY_DEFINITION_REGISTRY_TOKEN } from "../business-entry-definition/business-entry-definition.service";
import { BUSINESS_ENTRY_TRANSACTION_SCENE_REGISTRY, BUSINESS_ENTRY_TRANSACTION_REGISTRY } from "../business-entry-definition/business-entry-transaction-scene-registry";
import { BUSINESS_ENTRY_SNAPSHOT_STORE, PrismaBusinessEntrySnapshotStore } from "../business-entry-definition/business-entry-definition.snapshot-store";
import { ContractFormalFileService } from "../contract/contract-formal-file.service";
import { ContractAuthorizationService } from "../contract/contract-authorization.service";
import { ContractReadinessService } from "../contract-workbench/contract-readiness.service";
import { ContractEndedApplicationPurgeService } from "../contract-ended-purge/contract-ended-application-purge.service";
import { FileCleanupSeamService } from "../file/file-cleanup-seam.service";
import type { VersionedObjectStorage } from "../file/versioned-object-storage";
import { directPendingInputFromStoredRows } from "./task12-direct-input-persistence.oracle";
import { confirmDirectReviewFromRaw, createDirectReviewFromRaw, directReviewObservedInputs } from "./task12-direct-review-persistence.oracle";
import { ContractEconomicReviewOperatingSourceAdapter } from "../contract-ledger/contract-economic-review-operating-source.adapter";
import { MeController } from "../me/me.controller";
import { MeService } from "../me/me.service";
import { ArchiveController } from "../archive/archive.controller";
import { ArchiveService } from "../archive/archive.service";
import { ContractEconomicReviewService } from "../contract-ledger/contract-economic-review.service";
import { OperatingProjectionService } from "../operating-projection/operating-projection.service";
import { CompanyRoleResolverService } from "../auth/company-role-resolver.service";
import { ClearingReconciliationReaderService } from "../clearing/clearing-reconciliation-reader.service";
import { syntheticOperatingWrite } from "../operating-ledger/operating-precision.persistence.test-support";
import { OperatingLedgerService } from "../operating-ledger/operating-ledger.service";
import { OperatingSourceReplayService } from "../operating-ledger/operating-source-replay.service";
import { OperatingSourceAdapterRegistry } from "../operating-ledger/operating-source-adapter";
import { ContractOperatingSourceAdapter } from "../contract/contract-operating-source.adapter";
import { NON_RECEIPT_FILE_BINDINGS } from "../file/file-business-binding";
import { ContractV2ArchiveService } from "../contract/contract-v2-archive.service";
import { ContractVersionActivationService } from "../contract/contract-version-activation.service";
import { ContractV2SubmissionService } from "../contract/contract-v2-submission.service";
import { ContractApprovalRouteService } from "../contract/contract-approval-route.service";
import { ContractSealService } from "../contract/contract-seal.service";
import { ContractController } from "../contract/contract.controller";
import { apiJsonReplacer } from "../api-json-replacer";
import { ProjectController } from "../project/project.controller";
import { ProjectService } from "../project/project.service";
import { ContractCutoverGuard } from "../contract-cutover/contract-cutover.guard";
import { OperationalWriteFreezeGuard } from "../operational-write-freeze/operational-write-freeze.guard";
import { OperationalWriteFreezeService } from "../operational-write-freeze/operational-write-freeze.service";
import { AccountRateLimitGuard } from "../auth/guards/account-rate-limit.guard";
import { AuthRateLimitService } from "../auth/auth-rate-limit.service";
import { ContractDraftController } from "../contract-workbench/contract-draft.controller";
import { ContractWorkbenchController } from "../contract-workbench/contract-workbench.controller";
import { ContractDraftAggregateService } from "../contract-workbench/contract-draft-aggregate.service";
import { ContractDraftEditLeaseService } from "../contract-workbench/contract-draft-edit-lease.service";
import { ContractWorkbenchService } from "../contract-workbench/contract-workbench.service";
import { PristineDraftDeletionService } from "../contract-workbench/pristine-draft-deletion.service";
import { ContractBillService } from "../contract-bill/contract-bill.service";
import { BusinessPartyService } from "../business-party/business-party.service";
import { ContractService } from "../contract/contract.service";
import { BusinessNumberingService } from "../business-number/business-numbering.service";
import { BusinessEntryDefinitionController } from "../business-entry-definition/business-entry-definition.controller";
import { BusinessEntryDefinitionService } from "../business-entry-definition/business-entry-definition.service";
import { BusinessEntrySceneAuthorizationService } from "../business-entry-definition/business-entry-scene-authorization.service";
import { BusinessEntryExcelService } from "../business-entry-definition/business-entry-excel.service";
import { BUSINESS_ENTRY_ACCESS_REGISTRY, BUSINESS_ENTRY_DEFINITION_REGISTRY } from "../business-entry-definition/business-entry-definition.scene-registry";
import { RetiredWriteEntryGuard } from "../retired-write-entry/retired-write-entry.guard";
import { ContractReadService } from "../contract/contract-read.service";
import { CONTRACT_VERSION_FILE_READ_AUTHORITY } from "../contract/contract-version-file-read-authority";
import { ProjectVisibilityService } from "../auth/project-visibility.service";
import "reflect-metadata";
import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { Test } from "@nestjs/testing";
import { ModuleRef, Reflector } from "@nestjs/core";
import * as bcrypt from "bcryptjs";
import PizZip from "pizzip";
import { Prisma } from "@prisma/client";
import { ApprovalFormController } from "../approval/approval-form.controller";
import { ApprovalFormService } from "../approval/approval-form.service";
import { AuthController } from "../auth/auth.controller";
import { AuthService } from "../auth/auth.service";
import { JwtTokenService } from "../auth/jwt-token.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { PermissionGuard } from "../auth/guards/permission.guard";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../database/prisma.service";
import { FileController } from "../file/file.controller";
import { FileService, PrivateFileStorage } from "../file/file.service";
import { DIRECT_ARCHIVE_EXECUTOR, type DirectArchiveExecutor } from "../contract/contract-direct-archive-executor";
import { GENERATED_ARCHIVE_PREPARATION_READER } from "../contract/contract-generated-archive-preparation";
import { createApiValidationPipe } from "../validation/api-validation";
import { ContractTemplateController } from "./contract-template.controller";
import { ContractTemplateService } from "./contract-template.service";
import { ContractScenarioService } from "./contract-scenario.service";
import { ContractDocumentController } from "../contract-document/contract-document.controller";
import { ContractDocumentService } from "../contract-document/contract-document.service";
import { ContractNegotiationService } from "../contract-document/contract-negotiation.service";
import { ContractDocumentProcessor } from "../contract-document/contract-document.processor";
import { LayoutTemplateService } from "./layout-template.service";

type Row = Record<string, unknown>;
function directCatalogFixtureRow(value: unknown): Row {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("合成direct目录记录必须是对象");
  return value as Row;
}
function fixtureClone<T>(value: T): T {
  if (Prisma.Decimal.isDecimal(value)) return new Prisma.Decimal(value.toString()) as T;
  if (value instanceof Date) return new Date(value.getTime()) as T;
  if (Array.isArray(value)) return value.map(fixtureClone) as T;
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, fixtureClone(item)])) as T;
  return value;
}

function jsonbValue(value: unknown): unknown {
  if (value === Prisma.DbNull || value === Prisma.JsonNull) return null;
  if (Array.isArray(value)) return value.map(jsonbValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, jsonbValue(item)]));
}

const conditionalGlobalCompletionDigest = "2750e0d605ebcfd1942cec9a4914a3d04c23e40d156b6e37baa6c426849e45fd";
const conditionalRetentionCompletionDigest = "aef44aa0aa64a86f2253d8392aa624b082a84eb98579663c3890d878245fee8a";
const conditionalCompletionGuardDigests = [
  conditionalGlobalCompletionDigest, conditionalGlobalCompletionDigest,
  conditionalRetentionCompletionDigest, conditionalRetentionCompletionDigest
];

function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([key, expected]) => {
    if (key === "OR") return (expected as Row[]).some(item => matches(row, item));
    if (key === "AND") return (expected as Row[]).every(item => matches(row, item));
    if (key === "NOT" && expected && typeof expected === "object" && !Array.isArray(expected)) return !matches(row, expected as Row);
    if (["companyEntityId_versionNo", "sourceType_sourceBusinessId", "sourceType_sourceBusinessId_sourceImpactKey", "contractVersionId_side"].includes(key)) return matches(row, expected as Row);
    const value = row[key];
    if (expected && typeof expected === "object" && !Array.isArray(expected)) {
      const rule = expected as Row;
      if ("in" in rule) return (rule.in as unknown[]).includes(value);
      if ("not" in rule) return value !== rule.not;
      if ("equals" in rule) return value === rule.equals;
      if ("lt" in rule) return Number(value) < Number(rule.lt);
      if ("lte" in rule) return Number(value) <= Number(rule.lte);
      if ("gt" in rule) return Number(value) > Number(rule.gt);
      if ("gte" in rule) return Number(value) >= Number(rule.gte);
      throw new Error("合成持久层遇到未登记的查询条件");
    }
    return value === expected;
  });
}

/** Test-only persistence/file adapters. No database driver, SQL or COS fallback. */
export class TemplateSyntheticStore {
  private rows: Record<string, Row[]> = {};
  private queue = Promise.resolve();
  participantProjectionCount = 0;
  // File-boundary observation deliberately survives synthetic DB rollback.
  privateStorageWrites = 0;
  privateStorageDeletes = 0;
  privateStorageReads = 0;
  pinnedPrivateStorageReads = 0;
  directArchiveProofReads = 0;
  versionedStorageCalls = 0;
  pristineReceiptWriteAttempts = 0;
  directPendingActualReads = 0;
  directReviewCommitOutcome: "persist" | "return_without_persisting" = "persist";
  private transactionBindingLockHeld = false;
  private transactionFileLockIds = new Set<string>();
  private transactionTryDenied = false;
  archiveBindingLockResult: "available" | "busy" | "missing" = "available";
  private transactionSealTaskLocked = false;
  archiveCommitOutcome: "persist" | "return_without_persisting" | "throw_after_persisting" = "persist";
  archiveCommitSignalLosses = 0;
  sealCommitOutcome: "persist" | "return_without_persisting" = "persist";

  table(name: string) {
    this.rows[name] ??= [];
    const find = (where?: Row) => this.rows[name].filter(row => matches(row, where));
    return {
      findUnique: async ({ where }: { where: Row }) => fixtureClone(find(where)[0] ?? null),
      findUniqueOrThrow: async ({ where }: { where: Row }) => { const row = find(where)[0]; if (!row) throw new Error("合成持久层未找到唯一记录"); return fixtureClone(row); },
      findFirst: async (args: { where?: Row; orderBy?: Row | Row[] } = {}) => this.sorted(find(args.where), args.orderBy)[0] ?? null,
      findMany: async (args: { where?: Row; orderBy?: Row | Row[] } = {}) => this.sorted(find(args.where), args.orderBy),
      create: async ({ data }: { data: Row }) => {
        if (name === "contractPristineDraftDeletionReceipt") this.pristineReceiptWriteAttempts++;
        const row = { id: randomUUID(), createdAt: new Date(), updatedAt: new Date(), draftRevision: 1, status: "draft", ...(name === "contract" ? { voidedAt: null } : {}), ...(name === "fileObject" ? { purgeReceiptId: null } : {}), ...(name === "contractSealTask" ? { approvedByUserId: null, approvedAt: null, completedByUserId: null, completedAt: null, cancelledByUserId: null, cancelledAt: null, cancellationReason: null } : {}), ...(name === "contractEconomicReview" ? { revision: 1, status: "pending_review", confirmedAt: null, contractReviewedById: null, financeReviewedById: null, frozenSources: null } : {}), ...(name === "contractVersion" ? { baseVersionId: null, firstSubmittedAt: null, effectiveAt: null, documentContentRevision: 1, documentContentFingerprint: null, readinessSnapshot: null, companyEntityId: null, companyEntityNameSnapshot: null, estimatedAmountCents: null, estimatedAmountYuan: null, settlementMode: "none", settlementModeConfirmedAt: null, latestDraftPreviewDocumentId: null } : {}), ...(name === "contractGeneratedDocument" ? { docxFileId: null, pdfFileId: null, errorMessage: null } : {}), ...data };
        this.apply(row, data, name);
        this.rows[name].push(row);
        return fixtureClone(row);
      },
      update: async ({ where, data }: { where: Row; data: Row }) => {
        const row = find(where)[0];
        if (!row) throw new Error("合成持久层未找到待更新记录");
        this.apply(row, data, name);
        return fixtureClone(row);
      },
      updateMany: async ({ where, data }: { where: Row; data: Row }) => {
        const rows = find(where);
        rows.forEach(row => this.apply(row, data, name));
        return { count: rows.length };
      },
      delete: async ({ where }: { where: Row }) => {
        const row = find(where)[0];
        if (!row) throw new Error("合成持久层未找到待移除记录");
        this.rows[name] = this.rows[name].filter(value => value !== row);
        return fixtureClone(row);
      },
      upsert: async ({ where, create, update }: { where: Row; create: Row; update: Row }) => {
        let row = find(where)[0];
        if (row) this.apply(row, update, name);
        else { row = { id: randomUUID(), createdAt: new Date(), updatedAt: new Date(), ...create }; this.rows[name].push(row); }
        return fixtureClone(row);
      },
      deleteMany: async ({ where }: { where?: Row } = {}) => { const selected = find(where); this.rows[name] = this.rows[name].filter(row => !selected.includes(row)); return { count: selected.length }; },
      createMany: async ({ data }: { data: Row[] }) => {
        for (const value of data) {
          const row = {
            id: randomUUID(), createdAt: new Date(), updatedAt: new Date(),
            ...(name === "contractBill" ? { revision: 1, taxInclusiveAmountCents: 0n, taxExclusiveAmountCents: 0n, taxAmountCents: 0n, sourceExcelFileId: null } : {}),
            ...value
          };
          if (name === "contractBillRow") this.apply(row, value, name);
          this.rows[name].push(row);
        }
        return { count: data.length };
      },
      count: async ({ where }: { where?: Row } = {}) => find(where).length
    };
  }

  private sorted(rows: Row[], order?: Row | Row[]) {
    const fields = Array.isArray(order) ? order.flatMap(Object.entries) : Object.entries(order ?? {});
    return fixtureClone(fields.length ? [...rows].sort((a, b) => {
      for (const [key, direction] of fields) {
        const left = a[key], right = b[key];
        const difference = typeof left === "string" && typeof right === "string"
          ? (left < right ? -1 : left > right ? 1 : 0) : Number(left) - Number(right);
        if (difference) return difference * (direction === "desc" ? -1 : 1);
      }
      return 0;
    }) : rows);
  }

  private apply(row: Row, data: Row, tableName: string) {
    // Match Prisma's declared Decimal scalar conversion at this synthetic boundary.
    const model = Prisma.dmmf.datamodel.models.find(model => model.name[0].toLowerCase() + model.name.slice(1) === tableName);
    const decimals = new Set(model?.fields.filter(field => field.kind === "scalar" && field.type === "Decimal").map(field => field.name));
    for (const [key, value] of Object.entries(data)) {
      row[key] = value && typeof value === "object" && "increment" in value
        ? Number(row[key]) + Number((value as Row).increment)
        : value !== null && value !== undefined && decimals.has(key) ? new Prisma.Decimal(String(value))
        : /Schema$|Report$|^sampleData$|^inputSnapshot$/u.test(key) ? jsonbValue(value)
        : value;
    }
    if (tableName === "contractVersion" && row.signingSubjectType === "draft_unconfirmed") {
      // Independent literal oracle: 20261106090000 ContractVersion_signing_subject_check.
      if (row.numericProtocolVersion !== 2 || !["draft", "abandoned"].includes(String(row.status)) || row.firstSubmittedAt != null || row.effectiveAt != null || [row.affiliateAssignmentId, row.affiliateBusinessPartyVersionId, row.affiliateNameSnapshot, row.affiliateCreditCodeSnapshot].some(value => value != null)) {
        throw new Error("合成持久层拒绝未确认签约主体进入正式状态");
      }
    }
    if (tableName === "contractSealTask") {
      // Literal oracle from 20260717130000 migration, not Prisma's String type.
      const approved = row.approvedByUserId != null && row.approvedAt != null;
      const unapproved = row.approvedByUserId == null && row.approvedAt == null;
      const completed = row.completedByUserId != null && row.completedAt != null;
      const uncompleted = row.completedByUserId == null && row.completedAt == null;
      const uncancelled = row.cancelledByUserId == null && row.cancelledAt == null && row.cancellationReason == null;
      const valid = row.status === "pending_approval" && unapproved && uncompleted && uncancelled ||
        row.status === "in_seal" && approved && uncompleted && uncancelled ||
        row.status === "completed" && approved && completed && uncancelled ||
        row.status === "cancelled" && (approved || unapproved) && (completed || uncompleted) && row.cancelledByUserId != null && row.cancelledAt != null && typeof row.cancellationReason === "string" && row.cancellationReason.trim().length > 0;
      if (!valid) throw new Error("合成持久层拒绝违反ContractSealTask现有CHECK的状态事实");
    }
    if (tableName === "contractArchiveFile" && row.archiveProtocolVersion === 2) {
      // Fake DB RETURNING contract only: different opaque values deliberately
      // do not implement PostgreSQL JSONB canonical serialization/digest.
      const e = row.authoritySnapshot as Row;
      const basis = e.sourceBasis as Row;
      const subjects = basis.subjects as Row;
      const relationship = (subjects.signingIdentity as Row)?.relationship;
      if (relationship === "outside" || relationship === "upward") {
        const version = (this.rows.contractVersion ?? []).find(item => item.id === row.contractVersionId);
        const expectedSubject = relationship === "outside" ? "affiliate" : "upward";
        if (version?.signingSubjectType !== expectedSubject || version.status !== "seal_approved_pending_archive") {
          throw new Error("合成生成归档必须使用当前待归档版本和双方关系");
        }
      } else {
        const participation = subjects.participation as Row;
        const actualParticipant = (this.rows.projectParticipatingCompany ?? []).find(p => p.id === participation.id);
        if (!actualParticipant || !(actualParticipant.effectiveFrom instanceof Date) || participation.effectiveFrom !== actualParticipant.effectiveFrom.toISOString().slice(0, 10)) throw new Error("合成归档Date列来源必须保日期域，不能用ISO瞬间替代");
      }
      // Finite independent structure oracle from c579 manifest's word/pdf
      // paths, not a SQL interpreter or an implementation of PG digest.
      const round = (this.rows.approvalInstance ?? []).find(item => item.id === row.approvalInstanceId);
      const frozen = Array.isArray(round?.frozenNodes) ? (round.frozenNodes[0] as Row)?.submissionSnapshot as Row : undefined;
      const originalRefs = Array.isArray(frozen?.files) ? frozen.files as Row[] : [];
      const word = originalRefs.filter(ref => ref.mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
      const pdf = originalRefs.filter(ref => ref.mimeType === "application/pdf");
      const evidence = basis.versionEvidence as Row;
      const pair = evidence.generatedDocumentFiles as Row;
      const generated = (this.rows.contractGeneratedDocument ?? []).find(item => item.id === evidence.generatedDocumentId);
      if (!pair || Array.isArray(pair) || Object.keys(pair).sort().join(",") !== "pdf,word" || originalRefs.length !== 2 || word.length !== 1 || pdf.length !== 1 || !generated || generated.id !== frozen?.generatedDocumentId || generated.docxFileId !== word[0].fileId || generated.pdfFileId !== pdf[0].fileId || generated.docxFileId === generated.pdfFileId || JSON.stringify(jsonbValue(pair.word)) !== JSON.stringify(jsonbValue(word[0])) || JSON.stringify(jsonbValue(pair.pdf)) !== JSON.stringify(jsonbValue(pdf[0]))) throw new Error("合成持久边界拒绝非当前唯一Word/PDF完整对象引用");
      const consequence = e.operatingConsequence as Row;
      const projectState = (this.rows.project ?? []).find(item => item.id === e.projectId);
      const effectiveDate = projectState?.operatingLedgerEffectiveDate;
      const expectedProjectDate = effectiveDate instanceof Date ? effectiveDate.toISOString().slice(0, 10) : null;
      if (consequence.operatingLedgerEffectiveDateSnapshot !== expectedProjectDate) throw new Error("合成持久边界拒绝Project DATE快照瞬间或错误日期，须保原Date列日期/null");

      row.authoritySha256 = "a".repeat(64);
      row.fileManifestSha256 = "c".repeat(64);
      row.authoritySnapshot = { ...e, sourceBasisSha256: "b".repeat(64), fileManifestSha256: "c".repeat(64),
        operatingConsequence: { ...consequence, expectedSource: consequence.expectedSource ? { ...consequence.expectedSource as Row, sourceBasisSha256: "b".repeat(64) } : null } };
    }
    row.updatedAt = new Date();
  }

  readonly prisma = {
    upwardContractAmountRevision: this.table("upwardContractAmountRevision"),
    contractBankVerificationRequest: this.table("contractBankVerificationRequest"),
    contractProxyExecution: this.table("contractProxyExecution"),
    upwardReceiptMatch: this.table("upwardReceiptMatch"),
    expenseClaim: this.table("expenseClaim"),
    projectExpenseRequest: this.table("projectExpenseRequest"),
    settlementSignedDocumentGenerationClaim: this.table("settlementSignedDocumentGenerationClaim"),
    settlementTemplate: this.table("settlementTemplate"),
    settlementTemplateVersion: this.table("settlementTemplateVersion"),
    spotProcurementVersion: this.table("spotProcurementVersion"),

    clearingCase: this.table("clearingCase"),
    clearingEventVersion: this.table("clearingEventVersion"),
    clearingReconciliationRevision: this.table("clearingReconciliationRevision"),
    clearingReconciliationCoverage: this.table("clearingReconciliationCoverage"),
    clearingReconciliationResolution: this.table("clearingReconciliationResolution"),
    clearingReconciliationResolutionLine: this.table("clearingReconciliationResolutionLine"),
    clearingReconciliationDefinitionReversal: this.table("clearingReconciliationDefinitionReversal"),
    affiliateClearingAuthorityVersion: this.table("affiliateClearingAuthorityVersion"),
    projectNecessaryExpenseReserveReplacement: this.table("projectNecessaryExpenseReserveReplacement"),
    projectFundDisputeReplacement: this.table("projectFundDisputeReplacement"),
    interEntityRelationshipEntry: this.table("interEntityRelationshipEntry"),
    companyTransfer: this.table("companyTransfer"),
    companyTransferEvent: this.table("companyTransferEvent"),
    authRateLimit: this.table("authRateLimit"),
    user: this.table("user"), userPosition: this.table("userPosition"), position: this.table("position"),
    project: this.table("project"), projectRosterMember: this.table("projectRosterMember"),
    companyEntity: this.table("companyEntity"), companyEntityVersion: this.table("companyEntityVersion"),
    projectParticipatingCompany: this.table("projectParticipatingCompany"),
    projectMember: this.table("projectMember"), refreshToken: this.table("refreshToken"), auditLog: this.table("auditLog"),
    fileObject: this.table("fileObject"), contractLayoutTemplate: this.table("contractLayoutTemplate"),
    contractLayoutTemplateVersion: this.table("contractLayoutTemplateVersion"), contractLayoutPreviewJob: this.table("contractLayoutPreviewJob"),
    contractScenarioTemplateMapping: this.table("contractScenarioTemplateMapping"),
    standardClause: this.table("standardClause"), standardClauseVersion: this.table("standardClauseVersion"),
    contractBusinessTemplate: this.table("contractBusinessTemplate"), contractBusinessTemplateVersion: this.table("contractBusinessTemplateVersion"),
    contractOfflineRevision: this.table("contractOfflineRevision"), contractDocumentComparison: this.table("contractDocumentComparison"),
    contractNegotiationRound: this.table("contractNegotiationRound"), contractDocumentDifference: this.table("contractDocumentDifference"),
    // Explicitly empty adjacent-domain bindings for the real private-file policy.
    approvalActionLog: this.table("approvalActionLog"),
    approvalInstance: this.table("approvalInstance"),
    approvalDelegation: this.table("approvalDelegation"),
    handwrittenSignatureVersion: this.table("handwrittenSignatureVersion"),
    contractArchiveFile: this.table("contractArchiveFile"), archiveRecord: this.table("archiveRecord"),
    contractArchiveEvidenceFile: this.table("contractArchiveEvidenceFile"),
    contractEconomicReview: this.table("contractEconomicReview"),
    contractEconomicSettlementCoverage: this.table("contractEconomicSettlementCoverage"),
    projectAffiliateContractFact: this.table("projectAffiliateContractFact"), projectAffiliateSettlementFact: this.table("projectAffiliateSettlementFact"),
    generalProcurement: this.table("generalProcurement"),
    invoiceExceptionConfirmation: this.table("invoiceExceptionConfirmation"),
    invoiceRecord: this.table("invoiceRecord"),
    noInvoiceConfirmation: this.table("noInvoiceConfirmation"),
    paymentExecution: this.table("paymentExecution"),
    projectNecessaryExpenseReserveEntry: this.table("projectNecessaryExpenseReserveEntry"),
    projectFundDisputeEntry: this.table("projectFundDisputeEntry"),
    paymentRequest: this.table("paymentRequest"),
    pdfDocument: this.table("pdfDocument"),
    settlement: this.table("settlement"),
    settlementArchiveFile: this.table("settlementArchiveFile"),
    settlementDraft: this.table("settlementDraft"),
    spotProcurementPaymentInvoice: this.table("spotProcurementPaymentInvoice"),
    spotProcurementReceiptPhoto: this.table("spotProcurementReceiptPhoto"),
    spotProcurementRefund: this.table("spotProcurementRefund"),
    spotProcurementAttachment: this.table("spotProcurementAttachment"),
    spotProcurementPayment: this.table("spotProcurementPayment"),
    spotProcurementDiscrepancy: this.table("spotProcurementDiscrepancy"),
    spotProcurementPaymentExecutionVoucher: this.table("spotProcurementPaymentExecutionVoucher"),
    spotProcurementPaymentExecution: this.table("spotProcurementPaymentExecution"),
    contractDraftEditLease: this.table("contractDraftEditLease"),
    contractDraftSaveRequest: this.table("contractDraftSaveRequest"),
    contractDraftSubmissionRequest: this.table("contractDraftSubmissionRequest"),
    contractDraftAttachment: this.table("contractDraftAttachment"),
    contractDraftCheckpoint: this.table("contractDraftCheckpoint"),
    paymentTermsVersion: this.table("paymentTermsVersion"),
    paymentTermsStage: this.table("paymentTermsStage"),
    contractVersionAuthorizationLink: this.table("contractVersionAuthorizationLink"),
    contractFormalFile: this.table("contractFormalFile"), contractTakeover: this.table("contractTakeover"),
    contractAuthorization: this.table("contractAuthorization"),
    businessEntrySubmissionSnapshot: this.table("businessEntrySubmissionSnapshot"),
    contractSealTask: this.table("contractSealTask"),
    contractVersionCodeAllocation: this.table("contractVersionCodeAllocation"),
    businessDailySequence: this.table("businessDailySequence"),
    contractNumberTombstone: this.table("contractNumberTombstone"),
    contractDraftDeletionReceipt: this.table("contractDraftDeletionReceipt"),
    contractDraftDeletionCodeTombstone: this.table("contractDraftDeletionCodeTombstone"),
    businessParty: this.table("businessParty"), businessPartyVersion: this.table("businessPartyVersion"),
    projectAffiliateAssignment: this.table("projectAffiliateAssignment"),
    operatingFact: this.table("operatingFact"), operatingImpactEntry: this.table("operatingImpactEntry"),
    projectCloseAggregate: this.table("projectCloseAggregate"), projectCloseImpact: this.table("projectCloseImpact"), projectCloseStageVersion: this.table("projectCloseStageVersion"),
    contractBusinessScenario: this.table("contractBusinessScenario"),
    contract: this.table("contract"), contractPartySnapshot: this.table("contractPartySnapshot"), contractBill: this.table("contractBill"), contractBillRow: this.table("contractBillRow"),
    contractSettlementProcess: this.table("contractSettlementProcess"),
    contractBillRowLineage: this.table("contractBillRowLineage"),
    contractBillRowTransition: this.table("contractBillRowTransition"),
    settlementImport: this.table("settlementImport"),
    contractEndedApplicationPurgeReceipt: this.table("contractEndedApplicationPurgeReceipt"),
    contractEndedApplicationRetentionPolicy: this.table("contractEndedApplicationRetentionPolicy"),
    contractPristineDraftDeletionReceipt: this.table("contractPristineDraftDeletionReceipt"),
    contractVersion: this.table("contractVersion"), contractGeneratedDocument: this.table("contractGeneratedDocument"),
    $executeRawUnsafe: async (statement: string) => { if (statement !== "SET TRANSACTION READ ONLY") throw new Error("合成只读事务拒绝未知语句"); return 0; },
    $executeRaw: async (query: Prisma.Sql): Promise<number> => {
      const text = query.strings.join("?").replace(/\s+/gu, " ").trim();
      if (!['SELECT pg_advisory_xact_lock(hashtextextended(?, 0))', 'SELECT 1 FROM "ProjectCloseAggregate" WHERE "projectId" = ? FOR UPDATE'].includes(text) || query.values.length !== 1 || typeof query.values[0] !== "string") throw new Error("合成经营锁拒绝未知形状");
      return 1;
    },
    // Only explicitly registered business/file lock and read projections are modeled.
    // This does not connect to a database or execute SQL; every other query is rejected.
    $queryRaw: async (queryInput: Prisma.Sql | TemplateStringsArray, ...bindings: unknown[]): Promise<Row[]> => {
      const query = "strings" in queryInput ? queryInput : Prisma.sql(queryInput, ...bindings);
      const text = query.strings.join("?").replace(/\s+/gu, " ").trim();
      if (text.startsWith("/* contract_upward_archive_projection_probe_v2 */")) return [{ status: "absent", projectionOid: null, closureOid: null }];
      if (text === 'UPDATE public."ContractVersion" SET "originalSignedNumber" = ? WHERE "id" = ? AND "contractId" = ? RETURNING "id", "originalSignedNumber"') {
        if (query.values.length !== 3 || (query.values[0] !== null && typeof query.values[0] !== "string") || typeof query.values[1] !== "string" || typeof query.values[2] !== "string") throw new Error("合成原号写入拒绝未知参数");
        const row = await this.table("contractVersion").findFirst({ where: { id: query.values[1], contractId: query.values[2] } });
        if (!row) return [];
        await this.table("contractVersion").update({ where: { id: row.id }, data: { originalSignedNumber: query.values[0] } });
        return [{ id: row.id, originalSignedNumber: query.values[0] }];
      }
      if (text.startsWith("/* contract_economic_review_file_reference_catalog */ WITH scope AS")) {
        if (query.values.length!==1||!["ticket","cleanup"].includes(String(query.values[0]))) throw new Error("合成206目录用途不匹配");
        const bound=await this.table("directReviewExpectedBinding").count();
        return [{state:bound===1?"ready":"legacy"}];
      }
      if (text.startsWith("/* contract_economic_review_file_reference_migration */ SELECT EXISTS") ||
          text.startsWith("/* contract_economic_review_file_reference_completed_206 */")) {
        if (query.values.length!==1||query.values[0]!=="20261109110000_contract_direct_review_retention_v1") throw new Error("合成206迁移范围不匹配");
        const complete=await this.table("directReviewExpectedBinding").count()===1;
        return text.includes("completed_206")?[{completed:complete}]:[{applied:complete}];
      }
      if (text.startsWith('/* contract_direct_archive_proof_catalog_v1 */ SELECT')) {
        if (query.values.length) throw new Error("合成208只接受固定目录查询");
        return (await this.table("directArchiveRecoveryRoutine").findMany()).map(row => directCatalogFixtureRow(row.snapshot));
      }
      if (text === 'SELECT public.jg_contract_direct_archive_proof_v1(?::pg_catalog.text) AS proof') {
        if (query.values.length !== 1 || typeof query.values[0] !== "string") throw new Error("合成208只接受原归档ID");
        this.directArchiveProofReads++;
        const observed = await this.table("directArchiveRecoveryObservation").findMany({ where: { archiveId: query.values[0] } });
        return observed.length ? observed.map(row => ({ proof: row.proof })) : [{ proof: null }];
      }
      if (text.startsWith("/* contract_direct_outside_operating_archive_read_v2 */ WITH")) {
        if (query.values.length !== 1 || typeof query.values[0] !== "string") throw new Error("合成经营直签只接受原归档ID");
        const observed = await this.table("directOutsideOperatingArchiveProof").findFirst({ where: { archiveId: query.values[0] } });
        return observed?.qualified === true ? [{ routineOid: "30000", ownerOid: "9001", namespaceOid: "2200",
          completionOid: "29901", databaseOid: "13000", currentRoleOid: "7001", sessionRoleOid: "7001",
          backendPid: 71201, transactionId: "500001", envelope: { proof: observed.proof, originals: observed.originals } }] : [];
      }
      if (text.startsWith("/* contract_generated_upward_operating_installation_v1 */ SELECT")) {
        if (!isDeepStrictEqual(query.values, [...conditionalCompletionGuardDigests, conditionalGlobalCompletionDigest])) {
          throw new Error("合成对上经营目录只接受固定完成守卫摘要");
        }
        return (await this.table("generatedUpwardOperatingCatalog").findMany()).map(row => directCatalogFixtureRow(row.snapshot));
      }
      if (text.startsWith('/* contract_direct_archive_dispatch_catalog_v1 */ WITH')) {
        if (query.values.length !== 10 || query.values.some(value => typeof value !== "string" || !value.startsWith("public.jg_"))) throw new Error("合成214只接受固定目录例程");
        const bindings = await this.table("directArchiveDispatchBinding").findMany();
        const observations = await this.table("directArchiveDispatchActual").findMany();
        return bindings.flatMap(binding => observations.map(actual => ({ binding: binding.snapshot, actual: actual.snapshot })));
      }
      if (text.startsWith('/* contract_direct_archive_dispatch_probe_v1 */ SELECT')) {
        if (query.values.length) throw new Error("合成214发现查询不接受调用者");
        const probe = await this.table("directArchiveDispatchProbe").findMany();
        return probe.length ? probe.map(row => directCatalogFixtureRow(row.snapshot)) :
          [{ relationOid: null, slotTriggerCount: 0, bindingRoutineCount: 0 }];
      }
      if (text.startsWith('/* contract_direct_archive_writer_probe_v1 */ SELECT')) {
        if (query.values.length) throw new Error("合成210发现查询不接受调用者");
        const probe = await this.table("directArchiveWriterProbe").findMany();
        return probe.length ? probe.map(row => directCatalogFixtureRow(row.snapshot)) : [{ routineCount: 0, parentGuardCount: 0, transitionGuardCount: 0 }];
      }
      if (text.startsWith('/* contract_direct_archive_completion_probe_v1 */ SELECT')) {
        if (query.values.length) throw new Error("合成217发现查询不接受调用者");
        const probe = await this.table("directArchiveCompletionProbe").findMany();
        return probe.length ? probe.map(row => directCatalogFixtureRow(row.snapshot)) :
          [{ relationOid: null, routineCount: 0, triggerCount: 0 }];
      }
      if (text.startsWith('/* contract_direct_archive_completion_catalog_v1 */ WITH')) {
        if (!isDeepStrictEqual(query.values, conditionalCompletionGuardDigests)) {
          throw new Error("合成217目录查询只接受固定完成守卫摘要");
        }
        const installed = await this.table("directArchiveCompletionBinding").findMany();
        const actual = await this.table("directArchiveCompletionActual").findMany();
        if (await this.table("directArchiveDispatchBinding").count() !== 1) return [];
        return installed.flatMap(binding => actual.map(observed => ({ binding: binding.snapshot, actual: observed.snapshot })));
      }
      if (text.startsWith("/* contract_direct_pending_collision_execute_overlay_v1 */ WITH wanted")) {
        if (query.values.length !== 3 || typeof query.values[0] !== "string" || query.values[1] !== "9912"
          || typeof query.values[2] !== "string") throw new Error("合成碰撞增量目录参数不匹配");
        const signatures: unknown = JSON.parse(query.values[0]);
        if (!Array.isArray(signatures) || signatures.length !== 24) throw new Error("合成碰撞增量必须核全部24项");
        const proofs = await this.table("directPendingCollisionOverlayProof").findMany();
        return proofs.map(row => ({ proof: row.snapshot }));
      }
      if (text.startsWith("/* contract_direct_outside_operating_executor_admission_v2 */ SELECT")) {
        const privateChain = text.split("/* contract_direct_outside_operating_private_chain_v2 */")[1];
        if (privateChain) {
          const observed = await this.table("directOutsideOperatingPrivateRoutine").findMany();
          if (observed.some(row => row.readFailed === true)) throw new Error("合成私有经营依据目录读取失败");
          const expected = [...privateChain.matchAll(/\('(public\.jg_[^']+)', '([a-f0-9]{64})','pg_catalog\.[^']+',ARRAY\[([^\]]*)\]/gu)];
          if (expected.length !== 8 || observed.length !== expected.length || expected.some(([, signature, bodySha256, callers]) => {
            const row = observed.find(item => item.signature === signature);
            const executeRoles = [...callers.matchAll(/b\."(issuer|executor)OwnerOid"/gu)].map(match => match[1] + "Owner");
            return row?.bodySha256 !== bodySha256 || JSON.stringify(row.executeRoles) !== JSON.stringify(executeRoles);
          })) return [];
        }
        return (await this.table("directArchiveNativeAdmission").findMany()).flatMap(row => {
          const snapshot = directCatalogFixtureRow(row.snapshot);
          return snapshot.outsideOperatingExecutorQualified === true
            ? [{ qualified: true, backendPid: snapshot.backendPid, transactionId: snapshot.transactionId }] : [];
        });
      }
      if (text.startsWith("/* contract_direct_native_probe_v1 */ SELECT")) {
        return [{ readable: await this.table("directArchiveNativeAdmission").count() > 0 }];
      }
      if (text.startsWith("/* contract_direct_native_admission_v1 */ WITH recipe")) {
        const roleInheritance = await this.table("directArchiveUntrustedFileRoleInheritance").count();
        if (roleInheritance && text.includes("pg_catalog.pg_has_role(file_actor.id,dedicated.id,'MEMBER')")) return [];
        const unexpectedRole = await this.table("directArchiveUnexpectedRoleInheritance").count();
        if (unexpectedRole && text.includes("pg_catalog.pg_has_role(untrusted.oid,dedicated.id,'MEMBER')")) return [];
        return (await this.table("directArchiveNativeAdmission").findMany()).map(row => directCatalogFixtureRow(row.snapshot));
      }
      if (text.startsWith('/* contract_direct_archive_generation_catalog_v1 */ WITH')) {
        const legacy = query.values.length === 1 && query.values[0] === "29901";
        const native = query.values.length === 3 && query.values[0] === "9912" && query.values[1] === "9912" && query.values[2] === "29901";
        if (!legacy && !native) throw new Error("合成原件版本目录只接受已核对的217关系和实际执行所有者");
        return (await this.table("directArchiveGenerationCatalog").findMany()).map(row => directCatalogFixtureRow(row.snapshot));
      }
      if (text === 'SELECT public.jg_read_contract_direct_archive_generations_v1(?::pg_catalog.text) AS proof') {
        if (query.values.length !== 1 || typeof query.values[0] !== "string") throw new Error("合成原件版本只读取一个归档标识");
        const proof = await this.table("directArchiveGenerationProof").findFirst({ where: { archiveId: query.values[0] } });
        return [{ proof: proof?.snapshot ?? null }];
      }
      if (text.startsWith('/* contract_direct_archive_retention_catalog_v1 */ WITH')) {
        if (query.values.length) throw new Error("合成209目录查询不接受调用者");
        const bindings = await this.table("directArchiveRetentionBinding").findMany();
        const observations = await this.table("directArchiveRetentionActual").findMany();
        if (await this.table("directArchiveTransitionBinding").count() !== 1) return [];
        return bindings.flatMap(binding => observations.map(actual => ({ binding: binding.snapshot, actual: actual.snapshot })));
      }
      if (text.startsWith('/* contract_direct_archive_retention_probe_v1 */ SELECT')) {
        if (query.values.length) throw new Error("合成209发现查询不接受调用者");
        const probe = await this.table("directArchiveRetentionProbe").findMany();
        return probe.length ? probe.map(row => directCatalogFixtureRow(row.snapshot)) : [{ relationOid: null, routineCount: 0, triggerCount: 0 }];
      }
      if (text.startsWith('/* contract_direct_archive_transition_probe */ SELECT')) {
        if (query.values.length) throw new Error("合成207发现查询不接受调用者");
        const probe = await this.table("directArchiveTransitionProbe").findMany();
        return probe.length ? probe.map(row => directCatalogFixtureRow(row.snapshot)) : [{ relationOid: null, guardRoutineCount: 0 }];
      }
      if (text.startsWith('/* contract_direct_archive_transition_binding */ WITH')) {
        if (query.values.length) throw new Error("合成207绑定查询不接受调用者");
        const bindings = await this.table("directArchiveTransitionBinding").findMany();
        const observations = await this.table("directArchiveTransitionActual").findMany();
        if (await this.table("directPendingInstalledBinding").count() !== 1 || await this.table("directReviewExpectedBinding").count() !== 1) return [];
        return bindings.flatMap(binding => observations.map(actual => ({ binding: binding.snapshot, actual: actual.snapshot })));
      }
      if (text.startsWith("/* contract_direct_review_history_v1 */ SELECT")) {
        const [projectId,...reviewIds]=query.values;
        if (typeof projectId!=="string"||!reviewIds.length||!reviewIds.every(id=>typeof id==="string")) throw new Error("合成206历史来源范围不匹配");
        const reviews=await this.table("contractEconomicReview").findMany({where:{id:{in:reviewIds},projectId,status:"confirmed"}});
        return (await this.table("contractEconomicReviewFileReference").findMany({where:{reviewId:{in:reviews.map(row=>row.id)}}}))
          .sort((left,right)=>String(left.reviewId).localeCompare(String(right.reviewId))||String(left.sourceRef).localeCompare(String(right.sourceRef))||Number(left.displayOrder)-Number(right.displayOrder));
      }
      if (text.startsWith("/* contract_economic_review_legacy_cleanup_key */ SELECT")) {
        const [id,objectKey]=query.values;
        if (query.values.length!==2||typeof id!=="string"||typeof objectKey!=="string") throw new Error("合成旧清理定位不匹配");
        const candidates=await this.table("fileObject").findMany({where:{objectKey}});
        return [{exact:candidates.length===1&&candidates[0].id===id}];
      }
      if (text.startsWith("/* contract_economic_review_cleanup_cohort */ SELECT")) {
        if (!query.values.length||!query.values.every(value=>typeof value==="string")) throw new Error("合成206文件清理锁范围不匹配");
        return (await this.table("fileObject").findMany({where:{objectKey:{in:query.values}}})).sort((a,b)=>String(a.id).localeCompare(String(b.id)));
      }
      if (text.startsWith("/* contract_economic_review_cleanup_key */ SELECT")) {
        if (query.values.length!==1||typeof query.values[0]!=="string") throw new Error("合成206文件清理对象键不匹配");
        return [{locked:true}];
      }
      if (text.startsWith("/* contract_economic_review_cleanup_cohort_recheck */ SELECT")) {
        if (!query.values.length||!query.values.every(value=>typeof value==="string")) throw new Error("合成206文件清理范围不匹配");
        const cohort=await this.table("fileObject").findMany({where:{objectKey:{in:query.values}}});
        return [{ids:cohort.map(file=>file.id).sort()}];
      }
      if (text.startsWith("/* contract_economic_review_cleanup_retention */ SELECT")) {
        const keys=[...new Set(query.values)];
        if (!keys.length||!keys.every(key=>typeof key==="string")||query.values.length!==keys.length*2) throw new Error("合成206留存对象键范围不匹配");
        const refs=await this.table("contractEconomicReviewFileReference").findMany({where:{objectKey:{in:keys}}});
        const files=await this.table("fileObject").findMany({where:{objectKey:{in:keys}}});
        const current=await this.table("contractDraftAttachment").findMany({where:{slotKey:"direct_signed_originals_v1",fileId:{in:files.map(file=>file.id)}}});
        return [...refs.map(ref=>({fileId:ref.fileId,objectKey:ref.objectKey})), ...files.filter(file=>current.some(row=>row.fileId===file.id)).map(file=>({fileId:file.id,objectKey:file.objectKey}))];
      }
      if (text.startsWith("/* contract_economic_review_ticket_orphaned_proof */ WITH candidates")) {
        const [id, key, repeatedKey] = query.values;
        if (query.values.length !== 3 || typeof id !== "string" || typeof key !== "string" || key !== repeatedKey) {
          throw new Error("合成206孤立文件核对参数不正确");
        }
        const aliases = await this.table("fileObject").findMany({ where: { objectKey: key } });
        const ids = new Set([id, ...aliases.map(row => row.id)]);
        const refs = await this.table("contractEconomicReviewFileReference").findMany();
        const reviews = await this.table("contractEconomicReview").findMany({ where: { status: "confirmed" } });
        const retainedAlias = refs.some(row => row.objectKey === key || ids.has(row.fileId));
        const confirmedWithoutReference = reviews.some(row => Array.isArray(row.frozenSources) && row.frozenSources.some(source => {
          const frozen = source as { directInput?: { Q?: { signedFiles?: Array<{ fileId: string }> } } } | null;
          const files = frozen?.directInput?.Q?.signedFiles;
          return Array.isArray(files) && files.some(file => file && ids.has(file.fileId));
        }));
        return [{ retainedAlias, confirmedWithoutReference }];
      }
      if (text.startsWith("/* contract_economic_review_ticket_references */ SELECT")) {
        if (query.values.length!==1||typeof query.values[0]!=="string") throw new Error("合成206下载范围不匹配");
        const linked=await this.table("contractEconomicReviewFileReference").findMany({where:{fileId:query.values[0]}});
        const refs=await this.table("contractEconomicReviewFileReference").findMany();
        const rows: Row[]=[];
        for (const ref of refs.filter(row=>linked.some(target=>target.reviewId===row.reviewId&&target.sourceRef===row.sourceRef))) {
          const parent=await this.table("contractEconomicReview").findUnique({where:{id:ref.reviewId}});
          rows.push({...ref,projectId:parent?.projectId,status:parent?.status,confirmedAt:parent?.confirmedAt,frozenSources:parent?.frozenSources});
        }
        return rows.sort((left,right)=>String(left.reviewId).localeCompare(String(right.reviewId))||String(left.sourceRef).localeCompare(String(right.sourceRef))||Number(left.displayOrder)-Number(right.displayOrder));
      }
      if (text === 'SELECT "applicationRoleOid"::text AS "applicationRoleOid", "databaseOid"::text AS "databaseOid", "anchorOwnerOid"::text AS "anchorOwnerOid", "bindings" FROM public.jg_contract_direct_review_retention_binding_v1 WHERE "protocolVersion"=1') {
        if (query.values.length) throw new Error("合成206预期绑定不接受调用者");
        return (await this.table("directReviewExpectedBinding").findMany()).map(row=>directCatalogFixtureRow(row.snapshot));
      }
      if (text.startsWith("/* contract_direct_review_retention_catalog_v1 */ WITH requested_routines AS") && text.endsWith("AS actual")) {
        if (query.values.length!==5 || !query.values.every(value=>Array.isArray(value))) throw new Error("合成206当前目录参数不匹配");
        return (await this.table("directReviewActualCatalog").findMany()).map(row=>({actual:row.snapshot}));
      }
      if (text.startsWith('SELECT c."id" AS "contractId", cv."id" AS "versionId", cv."draftRevision", q.input FROM public."ContractVersion"')
          && /AND cv\."id" IN \(\?(?:,\?)*\)$/u.test(text)) {
        const [projectId,...versionIds]=query.values;
        if (typeof projectId!=="string"||versionIds.length<1||versionIds.length>2||!versionIds.every(id=>typeof id==="string")) throw new Error("合成206来源坐标参数不正确");
        return directReviewObservedInputs(this,projectId,versionIds);
      }
      if (text.startsWith('INSERT INTO public."ContractEconomicReview" ("id","projectId","leftSourceRef","rightSourceRef","leftFingerprint","rightFingerprint","relation","coverage","reason",')
          && text.endsWith('::jsonb) RETURNING "id"')) return createDirectReviewFromRaw(this,query.values);
      if (text === 'SELECT "directSourcePins" FROM public."ContractEconomicReview" WHERE "id"=?') {
        if (query.values.length!==1||typeof query.values[0]!=="string") throw new Error("合成206持久复核坐标不匹配");
        const review=await this.table("contractEconomicReview").findUnique({where:{id:query.values[0]}});
        return review?[{directSourcePins:review.directSourcePins??null}]:[];
      }
      if (/^SELECT f\."id" FROM public\."FileObject" f WHERE f\."id" IN \(\?(?:,\?)*\) AND f\."storageStatus"='active' AND f\."purgeReceiptId" IS NULL ORDER BY f\."id" COLLATE "C" FOR UPDATE NOWAIT$/u.test(text)) {
        const fault=await this.table("directReviewSyntheticLockFailure").findFirst({where:{stage:"file_row"}});
        if (fault) throw new Prisma.PrismaClientKnownRequestError("合成206文件行锁故障", {code:"P2010",clientVersion:"5.22.0",meta:{code:fault.sqlState}});
        const ids=query.values;
        if (!ids.every(id=>typeof id==="string") || !isDeepStrictEqual(ids,[...new Set(ids)].sort())) throw new Error("合成206只能按序取真实F");
        const locked: Row[]=[];
        for(const id of ids) {
          const file=await this.table("fileObject").findUnique({where:{id}});
          if(file?.storageStatus==="active"&&!file.purgeReceiptId) { this.transactionFileLockIds.add(id); locked.push({id}); }
        }
        return locked;
      }
      if (text === `UPDATE public."ContractEconomicReview" SET "status"='confirmed',"revision"="revision"+1,"contractReviewedById"=?,"confirmedAt"=?,"frozenSources"=?::jsonb WHERE "id"=? AND "revision"=? AND "status"='pending_review' RETURNING "id"`) {
        const fault=await this.table("directReviewSyntheticLockFailure").findFirst({where:{stage:"terminal_key"}});
        if (fault) throw new Prisma.PrismaClientKnownRequestError("合成206存储键锁故障", {code:"P2010",clientVersion:"5.22.0",meta:{code:fault.sqlState}});
        return confirmDirectReviewFromRaw(this,query.values,this.transactionFileLockIds);
      }
      if (text.startsWith("/* contract_direct_archive_intent_source_v1 */ WITH relation_specs")) {
        if (query.values.length !== 1 || query.values[0] !== "9001") throw new Error("合成221只观察已绑定安装身份");
        const observation = await this.table("directArchiveNativeIntentCatalog").findMany();
        const identity = { databaseOid: "13000", sessionRoleOid: "7001", currentRoleOid: "7001", backendPid: 71201, transactionId: "500001" };
        return observation.length ? observation.map(row => ({ ...identity, ...directCatalogFixtureRow(row.snapshot) })) :
          [{ ...identity, relationCount: 0, routineCount: 0, triggerCount: 0, privateSource: false }];
      }
      if (text.startsWith("/* contract_direct_archive_source_scope_v1 */ WITH required_reads")) {
        if (query.values.length !== 5 || query.values.some(value => typeof value !== "string")) throw new Error("合成218只接受绑定原合同坐标");
        const [completionOid, versionId, contractId, projectId, actor] = query.values;
        const completionRows = await this.table("directArchiveCompletionActual").findMany();
        const completion = completionRows.length === 1 ? directCatalogFixtureRow(completionRows[0].snapshot) : null;
        const version = await this.table("contractVersion").findUnique({ where: { id: versionId } });
        const contract = await this.table("contract").findUnique({ where: { id: contractId } });
        const project = await this.table("project").findUnique({ where: { id: projectId } });
        if (!completion || completion.relationOid !== completionOid || !version || version.contractId !== contractId ||
          !contract || contract.projectId !== projectId || contract.ownerUserId !== actor || contract.voidedAt ||
          !project?.isActive || project.operatingLedgerEffectiveDate) return [];
        const input = await directPendingInputFromStoredRows(this, String(versionId));
        if (input.state !== "complete") return [];
        const projectContracts = await this.table("contract").findMany({ where: { projectId } });
        const affiliateFact = await this.table("projectAffiliateContractFact").findFirst({ where: { projectId } });
        const reviews = await this.table("contractEconomicReview").findMany({ where: { projectId } });
        const ref = `contract:${contractId}`;
        const injected = await this.table("directArchiveSourceScopeObservation").findFirst();
        return [{
          completionOid, versionId, contractId, projectId, sourceRevision: version.draftRevision, inputSha256: input.inputSha256,
          databaseOid: completion.databaseOid, sessionRoleOid: completion.sessionRoleOid, currentRoleOid: completion.currentRoleOid,
          backendPid: completion.backendPid, transactionId: completion.transactionId, completeReads: true,
          otherContract: projectContracts.some(row => row.id !== contractId && row.voidedAt == null),
          affiliateFact: !!affiliateFact, relatedReview: reviews.some(row => row.leftSourceRef === ref || row.rightSourceRef === ref),
          ...(injected ? directCatalogFixtureRow(injected.snapshot) : {})
        }];
      }
      if (text === 'SELECT public.jg_contract_direct_pending_input_v1(?::text) AS "input"') {
        if (query.values.length !== 1 || typeof query.values[0] !== "string") throw new Error("合成工厂仅接受真实V定位");
        return [{ input: await directPendingInputFromStoredRows(this, query.values[0]) }];
      }
      if (/^SELECT "id", "mimeType", "uploadedByUserId", "storageStatus" FROM "FileObject" WHERE "id" IN \(\?(?:,\?)*\) ORDER BY "id" FOR UPDATE$/u.test(text)) {
        if (!this.transactionBindingLockHeld || !query.values.length || query.values.some(value => typeof value !== "string") || new Set(query.values).size !== query.values.length) throw new Error("合成附件锁必须G后按真实fileIds取F");
        for (const id of query.values) this.transactionFileLockIds.add(String(id));
        return this.table("fileObject").findMany({ where: { id: { in: query.values } }, orderBy: { id: "asc" } });
      }
      if (/^SELECT "id", "status" FROM "BusinessParty" WHERE "id" IN \(\?(?:,\?)*\) ORDER BY "id" FOR UPDATE$/u.test(text)) {
        if (!query.values.length || query.values.some(value => typeof value !== "string") || new Set(query.values).size !== query.values.length) throw new Error("合成单位锁参数不正确");
        return this.table("businessParty").findMany({ where: { id: { in: query.values } }, orderBy: { id: "asc" } });
      }
      if (createHash("sha256").update(text.replace(/\(VALUES \(\?\)(?:,\(\?\))*\)/u, "(VALUES (?))")).digest("hex") === "e7790890300fd3cf5aea96a7d0f7772e942b4b4e60084c2856a4697dcacb2a0f") {
        if (!this.transactionBindingLockHeld || !query.values.length || query.values.length > 20 || query.values.some(value => typeof value !== "string")) throw new Error("合成排他绑定查询参数不符");
        return query.values.filter(id => NON_RECEIPT_FILE_BINDINGS.some(binding => binding.table !== "ContractDraftAttachment" && (this.rows[binding.table[0].toLowerCase()+binding.table.slice(1)] ?? []).some(row => binding.columns.some(column => row[column] === id))) || (this.rows.fileObject ?? []).some(row => (row.id === id && row.supersedesFileObjectId != null) || row.supersedesFileObjectId === id)).map(fileId => ({ fileId }));
      }
      if (text === 'SELECT v."id", v."contractId", c."projectId", c."name", c."code", c."ownerUserId", v."changeType", v."status", v."draftRevision", v."firstSubmittedAt", v."effectiveAt", v."baseVersionId", v."supersedesVersionId", v."copiedFromContractVersionId", v."draftData" FROM "ContractVersion" v JOIN "Contract" c ON c."id" = v."contractId" WHERE v."id" = ? FOR UPDATE OF c, v') {
        if (query.values.length !== 1 || typeof query.values[0] !== "string") throw new Error("合成纯净草稿锁参数不符");
        const version = await this.table("contractVersion").findUnique({ where: { id: query.values[0] } });
        const contract = version ? await this.table("contract").findUnique({ where: { id: version.contractId } }) : null;
        return version && contract ? [{ ...version, projectId: contract.projectId, name: contract.name, code: contract.code, ownerUserId: contract.ownerUserId }] : [];
      }
      if (createHash("sha256").update(text).digest("hex") === "d37faf51311c85bdc9cdab66b2241b9a8c1b5c1edb9313f4325a45e83d33089c") {
        if (query.values.length !== 1 || typeof query.values[0] !== "string") throw new Error("合成放弃合同锁参数不符");
        const version = await this.table("contractVersion").findUnique({ where: { id: query.values[0] } });
        const contract = version ? await this.table("contract").findUnique({ where: { id: version.contractId } }) : null;
        return version && contract ? [{ ...version, ownerUserId: contract.ownerUserId, hasHistoricalTakeoverRelation: !!await this.table("contractTakeover").findFirst({ where: { contractVersionId: version.id } }) }] : [];
      }
      if (/^SELECT "id", "contractId", "originalSignedNumber" FROM public\."ContractVersion" WHERE \("id", "contractId"\) IN \(\(\?,\?\)(?:,\(\?,\?\))*\)$/u.test(text)) {
        if (!query.values.length || query.values.length > 60 || query.values.length % 2 || query.values.some(value => typeof value !== "string")) throw new Error("合成原号批读参数不符");
        const rows: Row[] = [];
        for (let offset = 0; offset < query.values.length; offset += 2) {
          const row = await this.table("contractVersion").findFirst({ where: { id: query.values[offset], contractId: query.values[offset+1] } });
          if (row) rows.push({ id: row.id, contractId: row.contractId, originalSignedNumber: Object.hasOwn(row,"originalSignedNumber") ? row.originalSignedNumber : null });
        }
        return rows;
      }
      if (text === 'SELECT a."id" FROM "ContractAuthorization" a WHERE a."originContractVersionId" = ? FOR UPDATE' || text === 'SELECT f."id" FROM "ContractFormalFile" f WHERE f."contractVersionId" = ? FOR UPDATE') {
        if (query.values.length !== 1 || typeof query.values[0] !== "string") throw new Error("合成签前资料锁参数不符");
        return text.includes('"ContractAuthorization"') ? this.table("contractAuthorization").findMany({ where: { originContractVersionId: query.values[0] } }) : this.table("contractFormalFile").findMany({ where: { contractVersionId: query.values[0] } });
      }
      if (text === 'SELECT "id", "originalSignedNumber" FROM public."ContractVersion" WHERE "id" = ? AND "contractId" = ?') {
        if (query.values.length !== 2 || query.values.some(value => typeof value !== "string")) throw new Error("合成原号读取拒绝未知参数");
        const row = await this.table("contractVersion").findFirst({ where: { id: query.values[0], contractId: query.values[1] } });
        // The SQL-only nullable column defaults to NULL on a newly inserted row.
        return row ? [{ id: row.id, originalSignedNumber: Object.prototype.hasOwnProperty.call(row, "originalSignedNumber") ? row.originalSignedNumber : null }] : [];
      }
      if (createHash("sha256").update(text).digest("hex") === "759ac2f23aeb713d616a888b9129c67acbde8e334a7858815017dd0dee7f0700") {
        if (query.values.length) throw new Error("合成目录解析前提读取拒绝客户端参数");
        return (await this.table("directPendingDeparseEnvironment").findMany()).map(row => directCatalogFixtureRow(row.snapshot));
      }
      if (createHash("sha256").update(text).digest("hex") === "677a5926e59660841b1b15160d2443dd53b40f158edeb5bce57b396b51479431") {
        if (query.values.length) throw new Error("合成binding目录查询不接受调用者身份参数");
        const catalog = await this.table("directPendingBindingCatalog").findMany();
        return [{ catalog: catalog.length === 1 ? catalog[0].snapshot : { bindingRelationOid: null } }];
      }
      if (createHash("sha256").update(text).digest("hex") === "f73d0ed8464e6cc277833f00165f776a82109721e384d77c3367983025169cbb") {
        if (query.values.length) throw new Error("合成expected binding仅允许原固定协议读取");
        return (await this.table("directPendingInstalledBinding").findMany()).map(row => directCatalogFixtureRow(row.snapshot));
      }
      if (createHash("sha256").update(text).digest("hex") === "8777b4ead52c63de9bf8f83e9a288ea7df6f635d4c2416cb2f055095cfa5de81") {
        if (query.values.length !== 1 || typeof query.values[0] !== "string") throw new Error("合成actual目录仅允许精确policy参数");
        const request = directCatalogFixtureRow(JSON.parse(query.values[0]));
        const installed = await this.table("directPendingInstalledBinding").findMany();
        const expected = installed.length === 1 ? directCatalogFixtureRow(installed[0].snapshot) : null;
        if (!expected || directCatalogFixtureRow(request.recipe).recipeVersion !== "contract-direct-pending-input-v1/1" || !isDeepStrictEqual(request.fileCallerOids, expected.fileCallerOids)) throw new Error("合成actual目录不得用当前role反填expected");
        const observations = await this.table("directPendingActualCatalog").findMany({ orderBy: { observationOrder: "asc" } });
        const index = this.directPendingActualReads++;
        if (!observations.length) return [];
        const actual = directCatalogFixtureRow(observations[Math.min(index, observations.length-1)].snapshot);
        return [{ actual: { registeredFileBinding: { alias: null, voucher: null, voucherGuard: null, fileTrigger: null }, ...actual } }];
      }
      if (text === 'SELECT pg_advisory_xact_lock( ?::int, ?::int )::text AS "lockResult"') {
        if (query.values.length !== 2 || query.values[0] !== 190731 || query.values[1] !== 13) throw new Error("合成文件绑定锁不接受其它namespace/key");
        if (this.transactionSealTaskLocked) throw new Error("合成新归档拒绝阻塞式global锁，须F后try且失败退出");
        this.transactionBindingLockHeld = true;
        return [{ lockResult: "" }];
      }
      if (text === 'SELECT "id" FROM "ContractSealTask" WHERE "id" = ? FOR UPDATE') this.transactionSealTaskLocked = true;
      // Final bounded oracle: complete sorted F first, then nonblocking G;
      // never start a distinct F lock after G or continue after a false try.
      if (this.transactionTryDenied) throw new Error("合成归档拒绝try锁失败后仍在原事务查询");
      if (this.transactionSealTaskLocked && text === 'SELECT "id" FROM "FileObject" WHERE "id" = ? FOR UPDATE') {
        if (typeof query.values[0] !== "string") throw new Error("归档文件锁身份不符");
        if (this.transactionBindingLockHeld && !this.transactionFileLockIds.has(query.values[0])) throw new Error("合成归档拒绝全局锁后新增FileObject锁");
        this.transactionFileLockIds.add(query.values[0]);
      }
      if (text === 'SELECT pg_try_advisory_xact_lock( ?::int, ?::int ) AS "acquired"') {
        if (query.values.length !== 2 || query.values[0] !== 190731 || query.values[1] !== 13 || !this.transactionSealTaskLocked || !this.transactionFileLockIds.size) throw new Error("合成归档try锁须在原F锁后且使用同一双int身份");
        if (this.archiveBindingLockResult === "missing") { this.transactionTryDenied = true; return []; }
        if (this.archiveBindingLockResult === "busy") { this.transactionTryDenied = true; return [{ acquired: false }]; }
        this.transactionBindingLockHeld = true;
        return [{ acquired: true }];
      }

      if (text === "SELECT DISTINCT up.\"projectId\" FROM \"UserPosition\" up JOIN \"Position\" p ON p.id=up.\"positionId\" JOIN \"User\" u ON u.id=up.\"userId\" WHERE u.\"isActive\"=TRUE AND up.\"userId\"=? AND up.\"projectId\" IS NOT NULL AND p.key IN ('finance_staff','finance_director') UNION SELECT pm.\"projectId\" FROM \"ProjectMember\" pm JOIN \"User\" u ON u.id=pm.\"userId\" WHERE u.\"isActive\"=TRUE AND pm.\"userId\"=? AND pm.\"positionKey\" IN ('finance_staff','finance_director')") {
        const actor = query.values[0];
        if (typeof actor !== "string" || query.values[1] !== actor) throw new Error("合成财务项目查询身份不一致");
        if (!(await this.prisma.user.findUnique({ where: { id: actor } }))?.isActive) return [];
        const positions = await this.prisma.position.findMany({ where: { key: { in: ["finance_staff", "finance_director"] } } });
        const assignments = await this.prisma.userPosition.findMany({ where: { userId: actor, projectId: { not: null }, positionId: { in: positions.map(row => row.id) } } });
        const members = await this.prisma.projectMember.findMany({ where: { userId: actor, positionKey: { in: ["finance_staff", "finance_director"] } } });
        return [...new Set([...assignments, ...members].map(row => row.projectId))].map(projectId => ({ projectId }));
      }
      if (text === "SELECT CURRENT_TIMESTAMP AS \"readAt\", set_config('statement_timeout', ?, true)") {
        if (query.values.length !== 1 || !/^\d+$/u.test(String(query.values[0]))) throw new Error("合成读取时点参数不符");
        return [{ readAt: new Date() }];
      }

      if (createHash("sha256").update(text).digest("hex") === "41b7ac454fb4d84f2eb267002707a2aed9169da8fe3b575fbabc6d618d8d5e62") {
        if (query.values.length !== 7 || typeof query.values[0] !== "string") throw new Error("合成限制读取预算参数不符");
        const restrictions = (this.rows.operatingFact ?? []).filter(row => row.projectId === query.values[0] && ["project_necessary_expense_reserve_entry", "project_fund_dispute_entry"].includes(String(row.sourceType)));
        if (restrictions.length) throw new Error("本合同合成读取未登记限制快照来源");
        return [{ replacementCount: 0n, snapshotBytes: 0n, maxSnapshotBytes: 0 }];
      }
      if (createHash("sha256").update(text).digest("hex") === "0dca1ffc31a615edbf215e15be8da59a2f7333e1cdd7d87043f6efc1cf30d251") {
        const [projectId, cutoffAt, readAt] = query.values;
        if (query.values.length !== 9 || typeof projectId !== "string" || !(cutoffAt instanceof Date) || !(readAt instanceof Date)) throw new Error("合成经营读取预算参数不符");
        const facts = (this.rows.operatingFact ?? []).filter(row => row.projectId === projectId && row.status === "confirmed" && Number(row.occurredAt) <= cutoffAt.getTime() && Number(row.confirmedAt) <= readAt.getTime() && Number(row.createdAt) <= readAt.getTime());
        if (facts.some(row => ["project_necessary_expense_reserve_entry", "project_fund_dispute_entry"].includes(String(row.sourceType)))) throw new Error("本合同合成预算未声明限制替代目标");
        const ids = new Set(facts.map(row => row.id));
        const impacts = (this.rows.operatingImpactEntry ?? []).filter(row => ids.has(row.factId) && Number(row.createdAt) <= readAt.getTime());
        const bytes = Buffer.byteLength(JSON.stringify([...facts, ...impacts], (_key, value) => typeof value === "bigint" ? value.toString() : value));
        return [{ workFactCount: BigInt(facts.length), workImpactCount: BigInt(impacts.length), workBytes: BigInt(bytes), targetCount: 0n }];
      }
      if (/^SELECT \* FROM public\."appendOperating(?:Fact|Impact)ThroughService"\(/u.test(text)) {
        const write = syntheticOperatingWrite(query);
        const table = write.kind === "Fact" ? this.prisma.operatingFact : this.prisma.operatingImpactEntry;
        const row = await table.create({ data: write.row });
        return [{ id: row.id, projectId: write.row.projectId, sourceType: write.row.sourceType, sourceBusinessId: write.row.sourceBusinessId, createdAt: row.createdAt }];
      }
      // Existing audit/approval participant projection, with only its bound
      // contract-list arity normalized for exact synthetic dispatch.
      const participantParams = /^SELECT DISTINCT v\."contractId" FROM "ContractVersion" v WHERE v\."contractId" IN \((\?(?:,\?)*)\)/u.exec(text);
      if (participantParams && createHash("sha256").update(text.replace(participantParams[1], "?")).digest("hex") === "d600870300bbe7561e1b2c5b09efb160a203677722461258a58711490198d01d") {
        this.participantProjectionCount += 1;
        const count = participantParams[1].split(",").length;
        const contractIds = query.values.slice(0, count);
        const [actorId, ...actorChecks] = query.values.slice(count);
        if (query.values.length !== count + 4 || contractIds.some(id => typeof id !== "string") || typeof actorId !== "string" || !actorChecks.every(value => value === actorId)) throw new Error("合成参与读取投影参数不符");
        const audits = await this.prisma.auditLog.findMany({ where: { actorUserId: actorId } });
        const matched = [];
        for (const contractId of contractIds) {
          const versions = await this.prisma.contractVersion.findMany({ where: { contractId } });
          const ids = versions.map(version => version.id);
          const approvals = await this.prisma.approvalInstance.findMany({ where: { businessType: "contract_version", businessId: { in: ids } } });
          const actions = await this.prisma.approvalActionLog.findMany({ where: { approvalInstanceId: { in: approvals.map(approval => approval.id) } } });
          const participated = audits.some(audit => audit.businessType === "contract" && audit.businessId === contractId && ["contract.draft.create", "contract.draft.copy"].includes(String(audit.action)) || audit.businessType === "contract_version" && ids.includes(audit.businessId) && audit.action === "contract.change_draft.create") || approvals.some(approval => approval.applicantUserId === actorId) || actions.some(action => ["approve", "reject", "reject_previous", "return_to_applicant", "transfer", "delegate"].includes(String(action.action)) && (action.actorUserId === actorId || action.representedUserId === actorId));
          if (participated) matched.push({ contractId });
        }
        return matched;
      }
      if (text === "INSERT INTO \"BusinessDailySequence\" (\"prefix\", \"businessDate\", \"nextSequence\", \"updatedAt\") VALUES (?, ?, 2, CURRENT_TIMESTAMP) ON CONFLICT (\"prefix\", \"businessDate\") DO UPDATE SET \"nextSequence\" = \"BusinessDailySequence\".\"nextSequence\" + 1, \"updatedAt\" = CURRENT_TIMESTAMP RETURNING \"nextSequence\" - 1 AS \"sequence\"") {
        const [prefix, businessDate] = query.values;
        if (query.values.length !== 2 || prefix !== "HT" || typeof businessDate !== "string" || !/^\d{8}$/u.test(businessDate)) throw new Error("合成合同编号投影参数不符");
        const row = await this.prisma.businessDailySequence.upsert({ where: { prefix, businessDate }, create: { prefix, businessDate, nextSequence: 2 }, update: { nextSequence: { increment: 1 } } });
        return [{ sequence: Number(row.nextSequence) - 1 }];
      }
      // Evaluate only the exact approval-assignment SQL emitted by the real route.
      const projectProjection = (count: number, actor: boolean) => `WITH members AS MATERIALIZED ( SELECT pm."projectId", pm."userId", pm."positionKey" AS "roleKey", u."isActive" AS "userIsActive" FROM "ProjectMember" pm INNER JOIN "User" u ON u."id" = pm."userId" WHERE pm."projectId" = ? AND u."isActive" = TRUE AND pm."positionKey" IN (${Array(count).fill("?").join(",")}) ${actor ? 'AND pm."userId" = ? ' : ''}FOR SHARE OF pm, u ), positions AS MATERIALIZED ( SELECT up."projectId", up."userId", p."key" AS "roleKey", u."isActive" AS "userIsActive" FROM "UserPosition" up INNER JOIN "Position" p ON p."id" = up."positionId" INNER JOIN "User" u ON u."id" = up."userId" WHERE up."projectId" = ? AND u."isActive" = TRUE AND p."key" IN (${Array(count).fill("?").join(",")}) ${actor ? 'AND up."userId" = ? ' : ''}FOR SHARE OF up, p, u ) SELECT * FROM members UNION SELECT * FROM positions`;
      const projectShape = [[1, true], [2, false]].find(([count, actor]) => {
        const locked = projectProjection(Number(count), Boolean(actor));
        return text === locked || text === locked.replace("FOR SHARE OF pm, u ", "").replace("FOR SHARE OF up, p, u ", "");
      });
      if (projectShape) {
        const count = Number(projectShape[0]), actor = Boolean(projectShape[1]);
        const width = 1 + count + Number(actor);
        if (query.values.length !== width * 2 || query.values.slice(0, width).some((v, i) => v !== query.values[width + i])) throw new Error("合成职责投影参数不符");
        const projectId = query.values[0], roles = query.values.slice(1, count + 1), actorId = actor ? query.values[count + 1] : undefined;
        const positions = await this.prisma.position.findMany();
        const members = (await this.prisma.projectMember.findMany({ where: { projectId } })).map(row => ({ userId: row.userId, roleKey: row.positionKey }));
        const assignments = (await this.prisma.userPosition.findMany({ where: { projectId } })).map(row => ({ userId: row.userId, roleKey: positions.find(p => p.id === row.positionId)?.key }));
        const users = await this.prisma.user.findMany();
        return [...members, ...assignments].filter(row => roles.includes(row.roleKey as string) && (!actor || row.userId === actorId) && users.some(u => u.id === row.userId && u.isActive === true)).map(row => ({ projectId, userId: row.userId, roleKey: row.roleKey, userIsActive: true }));
      }
      const applicantSql = 'SELECT up."userId", p."key" AS "roleKey" FROM "UserPosition" up INNER JOIN "Position" p ON p."id" = up."positionId" INNER JOIN "User" u ON u."id" = up."userId" WHERE up."projectId" IS NULL AND up."userId" = ? AND p."key" IN (\'contract_director\', \'contract_staff\') AND u."isActive" = TRUE FOR SHARE OF up, p, u';
      const liveGlobalShape = [1, 2, 3].find(count => {
        const read = `SELECT up."userId", p."key" AS "roleKey" FROM "UserPosition" up INNER JOIN "Position" p ON p."id" = up."positionId" INNER JOIN "User" u ON u."id" = up."userId" WHERE up."projectId" IS NULL AND up."userId" = ? AND u."isActive" = TRUE AND p."key" IN (${Array(count).fill("?").join(",")})`;
        return text === read || text === read + " FOR SHARE OF up, p, u";
      });
      if (liveGlobalShape) {
        if (query.values.length !== liveGlobalShape + 1) throw new Error("合成当前职责参数不符");
        const users = await this.prisma.user.findMany(), positions = await this.prisma.position.findMany();
        const actorId = query.values[0], roles = query.values.slice(1);
        return (await this.prisma.userPosition.findMany({ where: { userId: actorId, projectId: null } })).flatMap(row => {
          const position = positions.find(p => p.id === row.positionId);
          return position && roles.includes(String(position.key)) && users.some(u => u.id === row.userId && u.isActive === true) ? [{ userId: row.userId, roleKey: position.key }] : [];
        });
      }
      const candidateSql = 'SELECT up."userId", p."key" AS "roleKey" FROM "UserPosition" up INNER JOIN "Position" p ON p."id" = up."positionId" INNER JOIN "User" u ON u."id" = up."userId" WHERE up."projectId" IS NULL AND u."isActive" = TRUE AND p."key" IN ( \'contract_director\', \'material_director\', \'comprehensive_director\', \'finance_director\', \'chairman\', \'general_manager\' ) FOR SHARE OF up, p, u';
      if (text === applicantSql || text === candidateSql) {
        if (query.values.length !== (text === applicantSql ? 1 : 0)) throw new Error("合成全局职责参数不符");
        const positions = await this.prisma.position.findMany(), users = await this.prisma.user.findMany();
        const roles = text === applicantSql ? ["contract_staff", "contract_director"] : ["contract_director", "material_director", "comprehensive_director", "finance_director", "chairman", "general_manager"];
        return (await this.prisma.userPosition.findMany({ where: { projectId: null } })).flatMap(row => {
          const position = positions.find(p => p.id === row.positionId);
          return position && roles.includes(String(position.key)) && users.some(u => u.id === row.userId && u.isActive === true) && (text !== applicantSql || row.userId === query.values[0]) ? [{ userId: row.userId, roleKey: position.key }] : [];
        });
      }
      if (text.startsWith("/* registered_payment_voucher_catalog */")) {
        if (query.values.length || (this.rows.registeredPaymentVoucher ?? []).length) throw new Error("合成实付凭证目录未登记当前关系");
        return [{ state: "absent" }];
      }
      // Fixed FileService referenced-file projection. All declared adjacent
      // binding relations begin empty in this synthetic store; actual stored
      // references and replacement links are evaluated, never guessed unbound.
      if (createHash("sha256").update(text).digest("hex") === "d5b16e3a5f1b898c6514727442b7b8b02ff1f4d3e351f67db1cf33a6affa1b20") {
        const id = query.values[0];
        if (typeof id !== "string" || query.values.length !== 75 || !query.values.every(value => value === id)) throw new Error("合成文件引用参数不符");
        const bound = NON_RECEIPT_FILE_BINDINGS.filter(binding => binding.table !== "ContractDraftAttachment").some(binding => (this.rows[binding.table[0].toLowerCase() + binding.table.slice(1)] ?? []).some(row => binding.columns.some(column => row[column] === id)));
        const replacement = (this.rows.fileObject ?? []).some(row => row.supersedesFileObjectId === id || row.id === id && row.supersedesFileObjectId != null);
        const directRetained = text.includes(`"slotKey" = 'direct_signed_originals_v1'`) && (this.rows.contractDraftAttachment ?? []).some(row => row.fileId === id && row.slotKey === "direct_signed_originals_v1");
        return [{ referenced: directRetained || bound || replacement }];
      }
      const id = query.values[0];
      if (text === 'SELECT "id", "status" FROM "BusinessParty" WHERE "id" IN (?) ORDER BY "id" FOR UPDATE' && query.values.length === 1) return this.prisma.businessParty.findMany({ where: { id } });
      if (text === `SELECT "id" FROM "ApprovalInstance" WHERE "businessType" = 'contract_version' AND "businessId" = ? AND "flowType" = 'contract.approve' AND ( "id" = ? OR "status" = 'in_progress' ) ORDER BY "id" FOR UPDATE`) {
        if (query.values.length !== 2) throw new Error("合成审批锁参数不符");
        return this.prisma.approvalInstance.findMany({ where: { businessType: "contract_version", businessId: id, flowType: "contract.approve", OR: [{ id: query.values[1] }, { status: "in_progress" }] } });
      }
      if (text === 'SELECT "id" FROM "ProjectParticipatingCompany" WHERE "projectId" = ? AND "companyEntityId" = ? ORDER BY "id" FOR SHARE') {
        if (query.values.length !== 2 || query.values.some(value => typeof value !== "string")) throw new Error("合成公司参与关系锁参数不符");
        return this.prisma.projectParticipatingCompany.findMany({ where: { projectId: id, companyEntityId: query.values[1] } });
      }
      if (typeof id !== "string" || !query.values.every(value => value === id)) throw new Error(`合成投影参数未登记 sha=${createHash("sha256").update(text).digest("hex")} count=${query.values.length}`);
      if (['SELECT "id" FROM "ContractVersion" WHERE "id" = ? FOR UPDATE',
        'SELECT "id" FROM public."ContractVersion" WHERE "id" = ? FOR UPDATE'].includes(text)) return this.prisma.contractVersion.findMany({ where: { id } });
      if (['SELECT "id" FROM "Contract" WHERE "id" = ? FOR UPDATE',
        'SELECT "id" FROM public."Contract" WHERE "id" = ? FOR UPDATE'].includes(text)) return this.prisma.contract.findMany({ where: { id } });
      if (text === 'SELECT "id", "contractId", "status", "contractGovernanceVersion", "numericProtocolVersion" FROM "ContractVersion" WHERE "id" = ? FOR UPDATE') return this.prisma.contractVersion.findMany({ where: { id } });
      if (text === `SELECT "id", "contractVersionId", "approvalInstanceId", "handlerUserId", "status" FROM "ContractSealTask" WHERE "contractVersionId" = ? AND "status" <> 'cancelled' ORDER BY "createdAt" DESC LIMIT 1 FOR UPDATE`) return (await this.prisma.contractSealTask.findMany({ where: { contractVersionId: id, status: { not: "cancelled" } }, orderBy: { createdAt: "desc" } })).slice(0, 1);
      if (text === 'SELECT "id" FROM "CompanyEntity" WHERE "id" = ? FOR UPDATE') return this.prisma.companyEntity.findMany({ where: { id } });
      if (text === 'SELECT "id" FROM "ApprovalInstance" WHERE "id" = ? FOR UPDATE') return this.prisma.approvalInstance.findMany({ where: { id } });
      if (text === 'SELECT "id" FROM "ContractSealTask" WHERE "id" = ? FOR UPDATE') return this.prisma.contractSealTask.findMany({ where: { id } });
      if (text === 'SELECT "id" FROM "ApprovalDelegation" WHERE "id" = ? FOR SHARE') return this.prisma.approvalDelegation.findMany({ where: { id } });
      if (['SELECT "id", "isActive" FROM "User" WHERE "id" = ? FOR SHARE', 'SELECT "id", "isActive" FROM "User" WHERE "id" = ?'].includes(text)) return this.prisma.user.findMany({ where: { id } });
      if (text === 'SELECT "id", "isActive", "name" FROM "User" WHERE "id" = ? FOR UPDATE') return this.prisma.user.findMany({ where: { id } });
      if (text === `SELECT "id", "fileId", "contentSha256" FROM "HandwrittenSignatureVersion" WHERE "userId" = ? AND "source" = 'canvas' ORDER BY "createdAt" DESC, "id" DESC LIMIT 1 FOR UPDATE`) return (await this.prisma.handwrittenSignatureVersion.findMany({ where: { userId: id, source: "canvas" }, orderBy: { createdAt: "desc" } })).slice(0, 1);
      if (text === 'SELECT "id", "contentSha256", "storageStatus" FROM "FileObject" WHERE "id" = ? FOR UPDATE') return this.prisma.fileObject.findMany({ where: { id } });
      if (text === `SELECT a."actorUserId" FROM "ContractVersion" v JOIN "AuditLog" a ON (v."baseVersionId" IS NOT NULL AND a."businessType" = 'contract_version' AND a."businessId" = v."id" AND a."action" = 'contract.change_draft.create') OR (v."baseVersionId" IS NULL AND a."businessType" = 'contract' AND a."businessId" = v."contractId" AND a."action" IN ('contract.draft.create', 'contract.draft.copy')) WHERE v."id" = ? ORDER BY a."id"`) {
      const version = await this.prisma.contractVersion.findUnique({ where: { id } });
        if (!version || version.baseVersionId !== null) throw new Error("本合成来源投影仅登记原合同");
        return (await this.prisma.auditLog.findMany({ where: { businessType: "contract", businessId: version.contractId, action: { in: ["contract.draft.create", "contract.draft.copy"] } } })).map(row => ({ actorUserId: row.actorUserId }));
      }
      if (['SELECT "id" FROM "Project" WHERE "id" = ? FOR UPDATE',
        'SELECT "id" FROM public."Project" WHERE "id" = ? FOR UPDATE'].includes(text)) return this.prisma.project.findMany({ where: { id } });
      if (text === 'SELECT "id", "isActive" FROM "Project" WHERE "id" = ? FOR UPDATE') { const project = await this.prisma.project.findUnique({ where: { id } }); return project ? [project] : []; }
      // FileService's real referenced-predecessor cleanup path. Model only the
      // exact lock and positive generated-document reference facts of this fake;
      // orphan/unmodeled references remain refused, never guessed false.
      if (text === 'SELECT "id" FROM "FileObject" WHERE "id" = ? FOR UPDATE') {
        const file = await this.prisma.fileObject.findUnique({ where: { id } });
        return file ? [{ id: file.id }] : [];
      }
      if (createHash("sha256").update(text).digest("hex") === "9e5581891d6da3266df4f8d8f74e654da7036f7f480db9216b09fbcc69b19203") {
        if (query.values.length !== 73) throw new Error("合成文件引用投影参数不符");
        const documents = await this.prisma.contractGeneratedDocument.findMany();
        if (!documents.some(document => document.docxFileId === id || document.pdfFileId === id)) throw new Error("合成文件引用投影仅支持已生成文书的正引用事实");
        return [{ referenced: true }];
      }
      if (text === 'SELECT "id" FROM "ContractGeneratedDocument" WHERE "id" = ? FOR UPDATE') return this.prisma.contractGeneratedDocument.findMany({ where: { id } });
      if (text === 'SELECT "id" FROM "FileObject" WHERE "id" = ? FOR SHARE') return this.prisma.fileObject.findMany({ where: { id } });
      const version = await this.prisma.contractVersion.findUnique({ where: { id } });
      if (text === 'SELECT c.* FROM "Contract" c INNER JOIN "ContractVersion" cv ON cv."contractId" = c."id" WHERE cv."id" = ? FOR UPDATE OF c') {
        const contract = version ? await this.prisma.contract.findUnique({ where: { id: version.contractId } }) : null;
        return contract ? [contract] : [];
      }
      if (text === 'SELECT cv.*, EXISTS ( SELECT 1 FROM "ContractTakeover" takeover WHERE takeover."contractVersionId" = cv."id" ) AS "hasHistoricalTakeoverRelation" FROM "ContractVersion" cv WHERE cv."id" = ? FOR UPDATE OF cv') return version ? [{ ...version, hasHistoricalTakeoverRelation: false }] : [];
      if (text === 'SELECT EXISTS ( SELECT 1 FROM "ContractFormalFile" f WHERE f."contractVersionId" = ? AND f."purpose" = \'mutually_signed_final\' AND f."status" = \'active\' ) AS "hasSignedFormalFile", EXISTS ( SELECT 1 FROM "ContractSealTask" s WHERE s."contractVersionId" = ? AND s."status" <> \'cancelled\' ) AS "hasActiveSealTask", EXISTS ( SELECT 1 FROM "ContractArchiveFile" a WHERE a."contractVersionId" = ? ) AS "hasArchiveFile", EXISTS ( SELECT 1 FROM "Settlement" st WHERE st."contractVersionId" = ? ) AS "hasSettlement", EXISTS ( SELECT 1 FROM "PaymentRequest" p WHERE p."contractVersionId" = ? ) AS "hasPaymentRequest"') return [{ hasSignedFormalFile: false, hasActiveSealTask: false, hasArchiveFile: false, hasSettlement: false, hasPaymentRequest: false }];
      if (text === "SELECT \"contractVersionId\" FROM \"ContractDraftEditLease\" WHERE \"contractVersionId\" = ? FOR UPDATE") return this.prisma.contractDraftEditLease.findMany({ where: { contractVersionId: id } });
      if (text === "SELECT \"id\" FROM \"ContractBill\" WHERE \"contractVersionId\" = ? ORDER BY \"id\" FOR UPDATE") return this.prisma.contractBill.findMany({ where: { contractVersionId: id } });
      if (text === "SELECT r.\"id\" FROM \"ContractBillRow\" r JOIN \"ContractBill\" b ON b.\"id\" = r.\"contractBillId\" WHERE b.\"contractVersionId\" = ? ORDER BY r.\"id\" FOR UPDATE") { const bills = await this.prisma.contractBill.findMany({ where: { contractVersionId: id } }); return this.prisma.contractBillRow.findMany({ where: { contractBillId: { in: bills.map(bill => bill.id) } } }); }
      if (text === "SELECT \"id\" FROM \"ContractPartySnapshot\" WHERE \"contractVersionId\" = ? ORDER BY \"id\" FOR UPDATE") return this.prisma.contractPartySnapshot.findMany({ where: { contractVersionId: id } });
      if (text === "SELECT \"id\" FROM \"PaymentTermsVersion\" WHERE \"contractVersionId\" = ? ORDER BY \"id\" FOR UPDATE") return this.prisma.paymentTermsVersion.findMany({ where: { contractVersionId: id } });
      if (text === "SELECT s.\"id\" FROM \"PaymentTermsStage\" s JOIN \"PaymentTermsVersion\" t ON t.\"id\" = s.\"paymentTermsVersionId\" WHERE t.\"contractVersionId\" = ? ORDER BY s.\"id\" FOR UPDATE") { const terms = await this.prisma.paymentTermsVersion.findMany({ where: { contractVersionId: id } }); return this.prisma.paymentTermsStage.findMany({ where: { paymentTermsVersionId: { in: terms.map(term => term.id) } } }); }
      if (text === 'SELECT p."key" FROM "UserPosition" up JOIN "Position" p ON p."id"=up."positionId" JOIN "User" u ON u."id"=up."userId" WHERE up."userId"=? AND up."projectId" IS NULL AND u."isActive"=TRUE') {
        const user = await this.prisma.user.findUnique({ where: { id } });
        if (!user?.isActive) return [];
        const assignments = await this.prisma.userPosition.findMany({ where: { userId: id, projectId: null } });
        const positions = await this.prisma.position.findMany({ where: { id: { in: assignments.map(row => row.positionId) } } });
        return positions.map(position => ({ key: position.key }));
      }
      throw new Error("合成持久层拒绝未登记的锁投影：" + text);
    },
    $transaction: async <T>(work: (client: unknown) => Promise<T>): Promise<T> => {
      const previous = this.queue;
      let release!: () => void;
      this.queue = new Promise<void>(resolve => { release = resolve; });
      await previous;
      const snapshot = fixtureClone(this.rows);
      this.transactionBindingLockHeld = false;
      this.transactionSealTaskLocked = false;
      this.transactionFileLockIds = new Set();
      this.transactionTryDenied = false;
      let committed = false;
      try {
        const result = await work(this.prisma);
        if (this.sealCommitOutcome === "return_without_persisting" && (this.rows.contractSealTask ?? []).some(task => task.status === "completed" && !(snapshot.contractSealTask ?? []).some(old => old.id === task.id && old.status === "completed"))) this.rows = snapshot;

        if ((this.rows.contractArchiveFile?.length ?? 0) > (snapshot.contractArchiveFile?.length ?? 0)) {
          if (this.archiveCommitOutcome === "return_without_persisting") this.rows = snapshot;
          if (this.archiveCommitOutcome === "throw_after_persisting") {
            committed = true;
            this.archiveCommitSignalLosses++;
            throw new Error("合成归档已提交，返回信号丢失");
          }
        }
        if (this.directReviewCommitOutcome==="return_without_persisting" &&
          (this.rows.contractEconomicReviewFileReference?.length??0)>(snapshot.contractEconomicReviewFileReference?.length??0)) this.rows=snapshot;
        return result;
      }
      catch (error) { if (!committed) this.rows = snapshot; throw error; }
      finally { this.transactionBindingLockHeld = false; this.transactionSealTaskLocked = false; this.transactionFileLockIds = new Set(); this.transactionTryDenied = false; release(); }
    }
  };
}

export function syntheticWordSource(includeSignatures = false) {
  const zip = new PizZip();
  zip.file("[Content_Types].xml", '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file("_rels/.rels", '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="doc" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  const paragraphs = ["合同名称：合成工程合同", "甲方：合成甲方公司", "乙方：合成乙方公司", "编号：{草稿编号}", "{文档水印}", "交货地点：合成工地", "手工条款：本项普通约定按原文保留。"];
  if (includeSignatures) paragraphs.push("甲方签章：合成甲方公司", "乙方签章：合成乙方公司");
  zip.file("word/document.xml", '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' + paragraphs.map(text => '<w:p><w:r><w:rPr><w:rFonts w:ascii="Times New Roman" w:eastAsia="仿宋_GB2312"/><w:sz w:val="28"/></w:rPr><w:t xml:space="preserve">' + text + '</w:t></w:r></w:p>').join("") + '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr></w:body></w:document>');
  return zip.generate({ type: "nodebuffer" });
}

export async function createTemplateTestServer(options: { draftWorkbench?: boolean; realNegotiationReads?: boolean; legacyWorkbenchReads?: boolean; economicReviewReads?: boolean; generatedArchivePreparation?: boolean; generatedApprovalPdf?: boolean;
  upwardDirectArchiveAuthority?: (store: TemplateSyntheticStore, storage: PrivateFileStorage) => UpwardDirectArchiveAuthority;
  directArchiveExecutor?: (store: TemplateSyntheticStore, storage: PrivateFileStorage) => DirectArchiveExecutor } = {}) {
  const store = new TemplateSyntheticStore();
  const actors = [
    { id: "director", name: "合成合同主管", phone: "13800001101", role: "contract_director" },
    { id: "staff", name: "合成合同员", phone: "13800001102", role: "contract_staff" },
    { id: "technical", name: "合成技术管理员", phone: "13800001103", role: "super_admin" },
    { id: "employee", name: "合成普通员工", phone: "13800001104", role: "employee" },
    { id: "finance", name: "合成财务经办人", phone: "13800001105", role: "finance_staff" },
    { id: "manager", name: "合成项目经理", phone: "13800001106", role: "employee" }
  ];
  const password = "Synthetic-Template-Only-2026!";
  for (const actor of actors) {
    await store.prisma.user.create({ data: { ...actor, isActive: true, mustChangePassword: false, sessionVersion: 0, passwordHash: await bcrypt.hash(password, 4) } });
    if (!await store.prisma.position.findUnique({ where: { id: actor.role } })) await store.prisma.position.create({ data: { id: actor.role, key: actor.role } });
    if (actor.role !== "employee") await store.prisma.userPosition.create({ data: { userId: actor.id, positionId: actor.role, projectId: null } });
  }
  const objects = new Map<string, Buffer>();
  let failNextRead = false;
  const storage = {
    bucketName: () => "synthetic-private-no-network",
    write: async (key: string, value: Buffer) => { store.privateStorageWrites += 1; objects.set(key, Buffer.from(value)); },
    read: async (key: string) => { store.privateStorageReads++; if (failNextRead) { failNextRead = false; throw new Error("合成私有存储单次读取故障"); } const value = objects.get(key); if (!value) throw new Error("合成私有文件不存在"); return Buffer.from(value); },
    readVerifiedVersion: async (input: Parameters<PrivateFileStorage["readVerifiedVersion"]>[0]) => {
      store.pinnedPrivateStorageReads++;
      const version = await store.table("syntheticPrivateFileVersion").findFirst({ where: {
        bucket: input.bucket, objectKey: input.objectKey,
        ...(input.expectedGeneration === undefined ? {} : { objectGeneration: input.expectedGeneration })
      } });
      const readable = input.expectedGeneration === undefined || version?.unavailableByVersion !== true;
      const buffer = readable && version && typeof version.base64 === "string" ? Buffer.from(version.base64, "base64") : null;
      if (!buffer || buffer.length !== input.sizeBytes || createHash("sha256").update(buffer).digest("hex") !== input.contentSha256) {
        throw new ServiceUnavailableException("资料文件版本或完整性暂无法核对，请保留原件");
      }
      return { buffer, objectGeneration: version?.objectGeneration };
    },
    delete: async (key: string) => { store.privateStorageDeletes++; objects.delete(key); }
  } as unknown as PrivateFileStorage;
  const versionedStorage: VersionedObjectStorage = {
    listObjectVersions: async () => { store.versionedStorageCalls++; throw new Error("本公开负控不允许访问版本存储"); },
    deleteObjectVersion: async () => { store.versionedStorageCalls++; throw new Error("本公开负控不允许删除版本存储"); },
    isConverged: async () => { store.versionedStorageCalls++; throw new Error("本公开负控不允许访问版本存储"); }
  };
  const prisma = store.prisma as unknown as PrismaService;
  const audit = new AuditService(prisma);
  const tokens = new JwtTokenService();
  const auth = new AuthService(prisma, tokens, audit);
  const module = await Test.createTestingModule({ controllers: [...(options.draftWorkbench ? [ContractDraftController, ContractController, ProjectController, ArchiveController, MeController, ...(options.legacyWorkbenchReads ? [ContractWorkbenchController] : []), ...(options.economicReviewReads ? [ContractEconomicReviewController] : [])] : []), BusinessEntryDefinitionController, AuthController, FileController, ContractTemplateController, ContractDocumentController,
    ...(options.generatedApprovalPdf ? [ApprovalFormController] : [])], providers: [
    { provide: PrismaService, useValue: prisma }, { provide: AuditService, useValue: audit },
    { provide: PrivateFileStorage, useValue: storage }, MeService, ProjectVisibilityService, ContractReadService,
    ...(options.generatedArchivePreparation ? [{ provide: GENERATED_ARCHIVE_PREPARATION_READER, useValue: storage }] : []),
    ...(options.upwardDirectArchiveAuthority ? [{ provide: UPWARD_DIRECT_ARCHIVE_AUTHORITY, useValue: options.upwardDirectArchiveAuthority(store, storage) }] : []),
    ...(options.directArchiveExecutor ? [{ provide: DIRECT_ARCHIVE_EXECUTOR, useValue: options.directArchiveExecutor(store, storage) }] : []),
    { provide: CONTRACT_VERSION_FILE_READ_AUTHORITY, useExisting: ContractReadService },
    { provide: FileService, useFactory: (moduleRef: ModuleRef) => new FileService(prisma, audit, storage, undefined, undefined, moduleRef), inject: [ModuleRef] },
    ...(options.generatedApprovalPdf ? [{
      provide: ApprovalFormService, useFactory: (files: FileService) => new ApprovalFormService(prisma, files, audit, auth),
      inject: [FileService]
    }] : []),
    { provide: ContractDocumentService, useFactory: (files: FileService) => new ContractDocumentService(prisma, audit, files, new BusinessNumberingService()), inject: [FileService] },
    { provide: ContractNegotiationService, useFactory: (files: FileService) => options.realNegotiationReads ? new ContractNegotiationService(prisma, audit, files, auth) : {}, inject: [FileService] }, { provide: AuthService, useValue: auth },
    LayoutTemplateService, ContractTemplateService, { provide: ContractScenarioService, useValue: {} },
    ...(options.draftWorkbench ? [
      { provide: ContractDraftAggregateService, useFactory: (files: FileService, executor?: DirectArchiveExecutor, upward?: UpwardDirectArchiveAuthority) => new ContractDraftAggregateService(prisma, new ContractWorkbenchService(prisma, audit, new ContractReadinessService(prisma)), new ContractBillService(prisma, audit), new BusinessPartyService(prisma, audit), files, audit, executor, upward), inject: [FileService, { token: DIRECT_ARCHIVE_EXECUTOR, optional: true }, { token: UPWARD_DIRECT_ARCHIVE_AUTHORITY, optional: true }] },
      { provide: ContractDraftEditLeaseService, useFactory: () => new ContractDraftEditLeaseService(prisma, auth, audit) },
      // Real creation and read-only project choices join the same guarded workbench seam.
      { provide: ContractFormalFileService, useFactory: (files: FileService) => new ContractFormalFileService(prisma, audit, files), inject: [FileService] },
      { provide: ContractAuthorizationService, useFactory: (formal: ContractFormalFileService) => new ContractAuthorizationService(prisma, formal, audit), inject: [ContractFormalFileService] },
      ArchiveService, ContractApprovalRouteService, BusinessNumberingService, ContractV2SubmissionService, ContractV2ArchiveService, ContractVersionActivationService,
      { provide: GENERATED_UPWARD_OPERATING_ACTIVATION, useValue: nativeGeneratedUpwardOperatingActivation },
      OperatingLedgerService,
      { provide: OperatingSourceAdapterRegistry, useFactory: () => new OperatingSourceAdapterRegistry([new ContractOperatingSourceAdapter(), new ContractEconomicReviewOperatingSourceAdapter()]) },
      OperatingSourceReplayService, ContractEconomicReviewService, OperatingProjectionService, CompanyRoleResolverService, ClearingReconciliationReaderService,
      { provide: ContractSealService, useFactory: () => new ContractSealService(prisma, audit, undefined, auth) },
      { provide: ContractService, useFactory: () => new ContractService(prisma, audit) },
      ...(options.legacyWorkbenchReads ? [
        ContractWorkbenchService, ContractReadinessService, ContractBillLineageService, BusinessEntryTransactionService,
        { provide: BUSINESS_ENTRY_DEFINITION_REGISTRY_TOKEN, useValue: createBusinessEntryDefinitionRegistry([CONTRACT_SETTLEMENT_MODE_ENTRY_DEFINITION]) },
        { provide: BUSINESS_ENTRY_TRANSACTION_SCENE_REGISTRY, useValue: BUSINESS_ENTRY_TRANSACTION_REGISTRY },
        { provide: BUSINESS_ENTRY_SNAPSHOT_STORE, useClass: PrismaBusinessEntrySnapshotStore }
      ] : [{ provide: ContractWorkbenchService, useFactory: () => new ContractWorkbenchService(prisma, audit, new ContractReadinessService(prisma)) }]),
      { provide: ProjectService, useFactory: () => new ProjectService(prisma, audit, auth) }, { provide: PristineDraftDeletionService, useFactory: () => new PristineDraftDeletionService(prisma, new FileCleanupSeamService(prisma), versionedStorage) },
      { provide: ContractEndedApplicationPurgeService, useFactory: () => new ContractEndedApplicationPurgeService(prisma, new FileCleanupSeamService(prisma), versionedStorage) }
    ] : []),
    // Only the real template scene is exercised; unrelated domains and Excel are not invoked.
    { provide: BusinessEntryExcelService, useValue: {} },
    { provide: BusinessEntryDefinitionService, useFactory: (templates: ContractTemplateService, layouts: LayoutTemplateService, visibility: ProjectVisibilityService) => {
      const authority = new BusinessEntrySceneAuthorizationService({} as never, {} as never, {} as never, {} as never, templates, layouts, {} as never, {} as never, {} as never, prisma, {} as never);
      return new BusinessEntryDefinitionService(BUSINESS_ENTRY_DEFINITION_REGISTRY, BUSINESS_ENTRY_ACCESS_REGISTRY, visibility, {} as never, prisma, authority);
    }, inject: [ContractTemplateService, LayoutTemplateService, ProjectVisibilityService] }
  ] }).compile();
  const files = module.get(FileService);
  const layouts = module.get(LayoutTemplateService);
  const documents = module.get(ContractDocumentService);
  if (module.get(CONTRACT_VERSION_FILE_READ_AUTHORITY) !== module.get(ContractReadService)) throw new Error("合同文件读取权威必须复用同一只读服务");
  const app = module.createNestApplication({ logger: options.draftWorkbench ? ["error"] : false });
  app.getHttpAdapter().getInstance().set("json replacer", apiJsonReplacer);
  app.useGlobalPipes(createApiValidationPipe());
  app.useGlobalGuards(new JwtAuthGuard(new Reflector(), tokens, prisma), new RetiredWriteEntryGuard(), new OperationalWriteFreezeGuard(new OperationalWriteFreezeService()), new AccountRateLimitGuard(new AuthRateLimitService(prisma)), new PermissionGuard(new Reflector(), prisma), new ContractCutoverGuard(new Reflector()));
  await app.listen(0, "127.0.0.1");
  return { app, store, actors, password, files, layouts, documents, failNextPrivateRead: () => { failNextRead = true; }, templates: module.get(ContractTemplateService), moduleRef: module.get(ModuleRef), processor: new ContractDocumentProcessor(prisma, files, audit) };
}
