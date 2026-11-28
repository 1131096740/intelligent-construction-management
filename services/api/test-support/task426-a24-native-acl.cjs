"use strict";

const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const nativeOrdinary = require("../prisma/task16-current259-ordinary-archive-acl.requirements.json");
const { CASH_RUNTIME_READS, CASH_WRITER_FUNCTIONS } = require("../prisma/task16-current261-cash-profile.cjs");

const identifier = word => '"' + word + '"';
const relation = table => "public." + identifier(table);
const claimUpdate = ["status", "submittedAt", "approvedAt", "approvalInstanceId", "loanOffsetAmountCents", "companyPayableAmountCents",
  "fundedAmountCents", "costBearingCompanySpecified", "costBearingCompanyEntityId", "updatedAt"];
const attributionInsert = ["id", "projectId", "operatingFactId", "operatingFactProjectId", "sourceDedupKey", "expenseCashCostLinkId",
  "attributedAmountCents", "status", "activeKey", "companyEntityId", "companyEntityVersionId", "companyNameSnapshot",
  "companyCreditCodeSnapshot", "reason", "requestedByUserId", "requestedAt", "revision", "idempotencyKey", "createdAt", "updatedAt"];
const attributionUpdate = ["status", "activeKey", "reviewedByUserId", "reviewedAt", "reviewReason", "revision", "updatedAt"];
const linkedColumns = ["id", "operationalPaymentId", "costImpactId", "amountCents"];
// FileObject INSERT runs the historical correction, direct-review and direct-archive
// invoker triggers before the signature version is written.
const signatureUploadReads = {
  ContractTakeoverCorrection: ["attachmentFileId", "correctionType", "schemaVersion"],
  ContractEconomicReviewFileReference: ["fileId", "objectKey"],
  ContractArchiveFile: ["id", "contractVersionId", "archiveProtocolVersion", "archiveSource"],
  ContractArchiveEvidenceFile: ["fileId", "archiveFileId", "contractVersionId"],
  // HandwrittenSignatureVersion and User bind non-exclusive references. The
  // invoker guard reads each exclusive registry coordinate even for a fresh file.
  // Three migrations promote existing references; task16 appends its
  // separate registered voucher during the exact native archive install.
  PaymentExecution: ["voucherFileId"],
  ProjectExpenseExecution: ["voucherFileId"],
  ProjectFinancingQuota: ["attachmentFileId"],
  RegisteredPaymentVoucher: ["fileId"],
  SettlementRecoveryEntry: ["evidenceFileId"],
  SpotProcurementPaymentExecution: ["voucherFileId"],
  SpotProcurementPaymentAttachment: ["fileId"],
  SpotProcurementPaymentExecutionVoucher: ["fileId"],
  SpotProcurementPaymentInvoice: ["fileId"],
  SpotProcurementReceiptPhoto: ["originalFileId", "watermarkedFileId"],
  SpotProcurementRefund: ["voucherFileId"],
  InvoiceRecord: ["fileId"],
  NoInvoiceConfirmation: ["proofFileId"],
  InvoiceExceptionConfirmation: ["proofFileId"],
  ProjectAffiliateContractFact: ["evidenceFileId"],
  ProjectAffiliateSettlementFact: ["evidenceFileId"],
  ProjectAffiliatePaymentFact: ["evidenceFileId"],
  ProjectAffiliateBusinessEvidence: ["fileId"],
  ContractTakeoverSettlementEvidence: ["fileId"],
  ContractTakeoverExcessEvidence: ["fileId"],
  ContractTakeoverHistoricalPaymentVoucher: ["fileId"],
  ProjectAffiliateCompanyContract: ["fileId"],
  WageApprovedSourceVersion: ["evidenceFileId"],
  InterEntityRelationshipEvidenceClaim: ["fileId"],
  ContractProxyExecution: ["evidenceFileId"],
  UpwardContractAmountRevision: ["evidenceFileId"],
  ContractSignedChange: ["appendixFormalFileId"],
  SignedContractSettlementAttachment: ["fileId"]
};
const functions = [
  'public."appendOperatingFactThroughService"(public."OperatingLedgerFactWritePayloadV2",text,text)',
  'public."appendOperatingImpactThroughService"(public."OperatingLedgerImpactWritePayloadV2",text,text)'
];

function a24ColumnPlan(models, combined342 = false) {
  const full = table => {
    const model = models.find(row => row.name === table);
    assert.ok(model, "NATIVE_A24_REQUIRED_MODEL_" + table);
    return model.fields.filter(field => field.kind !== "object").map(field => field.dbName || field.name);
  };
  const read = {
    ...signatureUploadReads,
    // The 342 cash voucher collision check also selects the receipt photo ID.
    ...(combined342 ? { SpotProcurementReceiptPhoto: ["id", ...signatureUploadReads.SpotProcurementReceiptPhoto] } : {}),
    User: nativeOrdinary.tables.User[0],
    // The login audit uses Prisma create() with its default RETURNING projection.
    AuditLog: nativeOrdinary.tables.AuditLog[0],
    ProjectCloseAggregate: CASH_RUNTIME_READS.ProjectCloseAggregate,
    ProjectCloseImpact: CASH_RUNTIME_READS.ProjectCloseImpact,
    ProjectCloseStageVersion: CASH_RUNTIME_READS.ProjectCloseStageVersion,
    // Project projection preflights both possible restriction-replacement sources.
    ProjectNecessaryExpenseReserveReplacement: ["id", "reserveEntryId", "operatingImpactEntryId", "amountCents"],
    ProjectFundDisputeReplacement: ["id", "disputeEntryId", "operatingImpactEntryId", "amountCents"],
    ...Object.fromEntries([
      "Position", "UserPosition", "Project", "ProjectMember", "ProjectRosterMember", "CompanyEntity",
      "CompanyEntityVersion", "ProjectParticipatingCompany", "BusinessParty", "BusinessPartyVersion", "ProjectAffiliateAssignment",
      "AuthRateLimit", "RefreshToken", "FileObject", "ApprovalFlow", "ApprovalFlowNode", "ApprovalDelegation", "ApprovalInstance",
      "ApprovalActionLog", "HandwrittenSignatureVersion", "BusinessDailySequence", "ExpenseClaim", "ExpenseClaimLine", "ExpenseClaimAttachment",
      "ExpenseClaimEntrySnapshot", "ExpenseClaimPaymentExecution", "GeneralProcurement", "ActualPurchaseBatch", "PdfDocument",
      "ArchiveRecord", "ApprovalFormGenerationClaim", "RegisteredFundAccount", "FundAccountBalanceRegistration", "FundAccountSourceBatch",
      "PublicCashCustody", "RegisteredFundPaymentAllocation", "RegisteredFundTransfer", "RegisteredFundTransferLine",
      "RegisteredOperationalPayment", "RegisteredOperationalPaymentAllocation", "OperatingFact", "OperatingImpactEntry",
      "OperatingCostAttributionConfirmation", "PaymentExecutionRefund", "ProjectFundingAllocation",
      "ClearingCase", "InterEntityRelationshipEntry", "CompanyTransfer", "CompanyTransferEvent",
      "FundMovementRelationshipEntry", "FundExecutionCase", "PaymentExecutionPayerAttestation"
    ].map(table => [table, full(table)])),
    ExpensePublicCashCostLink: linkedColumns
  };
  const insert = {
    ...Object.fromEntries([
      "AuditLog", "AuthRateLimit", "RefreshToken", "FileObject", "ApprovalInstance", "ApprovalActionLog", "HandwrittenSignatureVersion",
      "BusinessDailySequence", "ExpenseClaim", "ExpenseClaimEntrySnapshot", "ExpenseClaimPaymentExecution",
      "FundAccountBalanceRegistration", "FundAccountSourceBatch", "PublicCashCustody", "RegisteredOperationalPayment",
      "RegisteredOperationalPaymentAllocation", "PaymentExecutionRefund", "ExpensePublicCashCostLink"
    ].map(table => [table, full(table)])),
    OperatingCostAttributionConfirmation: attributionInsert,
    // The existing empty-update upsert emits these four INSERT columns.
    ProjectCloseAggregate: CASH_RUNTIME_READS.ProjectCloseAggregate
  };
  const update = {
    User: [...nativeOrdinary.tables.User[2], "signatureFileId"],
    ApprovalInstance: ["currentNodeIndex", "frozenNodes", "status", "updatedAt"],
    AuthRateLimit: full("AuthRateLimit"),
    RefreshToken: ["revokedAt"],
    BusinessDailySequence: ["nextSequence", "updatedAt"],
    ExpenseClaim: claimUpdate,
    ExpenseClaimAttachment: ["stage", "frozenAt"],
    RegisteredFundAccount: ["writeRevision"],
    ProjectCloseAggregate: ["updatedAt"],
    // The funding-duty query locks these reference rows with FOR SHARE.
    ProjectMember: ["createdAt"],
    UserPosition: ["createdAt"],
    Position: ["updatedAt"],
    OperatingCostAttributionConfirmation: attributionUpdate
  };
  // SELECT ... FOR UPDATE in existing approved-file/project authority requires
  // an existing narrow UPDATE ACL. The real immutable file guards still apply.
  update.Project = ["updatedAt"];
  update.HandwrittenSignatureVersion = ["createdAt"];
  update.FileObject = ["storageStatus"];
  const observer = {
    OperatingFact: ["id", "projectId", "sourceType", "sourceBusinessId", "costBearingCompanySubjectId"],
    OperatingImpactEntry: ["id", "factId", "projectId", "sourceType", "sourceBusinessId", "impactKind", "amountCents"],
    ExpenseClaimPaymentExecution: ["id", "expenseClaimId", "amountCents"],
    FundAccountBalanceRegistration: ["id", "accountId", "status", "version", "balanceYuan"],
    FundAccountSourceBatch: ["id", "lineNo", "registrationId"],
    OperatingCostAttributionConfirmation: ["id", "projectId", "operatingFactId", "status"]
  };
  for (const [table, columns] of [...Object.entries(read), ...Object.entries(insert), ...Object.entries(update), ...Object.entries(observer)]) {
    const existing = full(table);
    for (const column of columns) assert.ok(existing.includes(column), "NATIVE_A24_REQUIRED_COLUMN_" + table + "_" + column);
  }
  return { read, insert, update, observer,
    functions: combined342 ? [...functions, ...CASH_WRITER_FUNCTIONS] : functions };
}

function renderA24FixtureAcl(plan, app, observer) {
  for (const role of [app, observer]) assert.match(role, /^jg_[a-zA-Z0-9_]+$/u);
  assert.notEqual(app, observer);
  const grant = (operation, scope, role) => Object.entries(scope).map(([table, columns]) =>
    `GRANT ${operation} (${columns.map(identifier).join(", ")}) ON ${relation(table)} TO ${identifier(role)};`).join("\n");
  return [
    grant("SELECT", plan.read, app), grant("INSERT", plan.insert, app), grant("UPDATE", plan.update, app),
    grant("SELECT", plan.observer, observer), `GRANT DELETE ON public."AuthRateLimit" TO ${identifier(app)};`,
    ...plan.functions.map(routine => `GRANT EXECUTE ON FUNCTION ${routine} TO ${identifier(app)};`)
  ].join("\n");
}

function readSignatureExclusiveClosure(app) {
  assert.match(app, /^jg_[a-zA-Z0-9_]+$/u);
  return `SELECT jsonb_agg(jsonb_build_array(binding."tableName",binding."columnName",
    pg_catalog.has_column_privilege('${app}',pg_catalog.to_regclass(
      pg_catalog.format('%I.%I','public',binding."tableName")),binding."columnName",'SELECT'))
    ORDER BY binding."tableName" COLLATE "C",binding."columnName" COLLATE "C")
    FROM public.jg_file_business_collision_columns() binding WHERE binding."exclusive";`;
}

function verifySignatureExclusiveClosure(rows) {
  assert.ok(Array.isArray(rows) && rows.length === 33, "NATIVE_A24_SIGNATURE_REGISTRY_COUNT");
  const coordinates = rows.map(([table, column]) => [table, column]);
  const sha256 = createHash("sha256").update(JSON.stringify(coordinates)).digest("hex");
  assert.equal(sha256, "3305b51a2313daaff09fa8c7065dddd1d2622c30d61144a5456ed8b29906ea5a",
    "NATIVE_A24_SIGNATURE_REGISTRY_DRIFT");
  assert.ok(rows.every(row => row[2] === true), "NATIVE_A24_SIGNATURE_REGISTRY_SELECT_DENIED");
  return { count: rows.length, sha256, allSelectGranted: true };
}

function readA24LegacyWriterAcl(app, observer) {
  for (const role of [app, observer]) assert.match(role, /^jg_[a-zA-Z0-9_]+$/u);
  assert.notEqual(app, observer);
  const signatures = CASH_WRITER_FUNCTIONS.map(signature => "('" + signature + "')").join(", ");
  return `SELECT jsonb_build_object('routines', count(*), 'restricted', coalesce(bool_and(
    routine.prosecdef AND routine.proowner = (SELECT datdba FROM pg_database WHERE datname = current_database())
    AND routine.proconfig = ARRAY['search_path=pg_catalog, public']
    AND has_function_privilege('${app}', routine.oid, 'EXECUTE')
    AND NOT has_function_privilege('${app}', routine.oid, 'EXECUTE WITH GRANT OPTION')
    AND NOT has_function_privilege('${observer}', routine.oid, 'EXECUTE')
    AND NOT EXISTS (
      SELECT FROM aclexplode(COALESCE(routine.proacl, acldefault('f', routine.proowner))) acl WHERE acl.grantee = 0
    )), false),
    'directWritesDenied',
      NOT has_any_column_privilege('${app}', 'public."OperatingFact"'::regclass, 'INSERT,UPDATE,REFERENCES')
      AND NOT has_any_column_privilege('${app}', 'public."OperatingImpactEntry"'::regclass, 'INSERT,UPDATE,REFERENCES')
      AND NOT has_table_privilege('${app}', 'public."OperatingFact"'::regclass, 'DELETE,TRUNCATE,TRIGGER')
      AND NOT has_table_privilege('${app}', 'public."OperatingImpactEntry"'::regclass, 'DELETE,TRUNCATE,TRIGGER'))
  FROM (VALUES ${signatures}) expected(signature)
  JOIN pg_proc routine ON routine.oid = to_regprocedure(expected.signature);`;
}

module.exports = { a24ColumnPlan, renderA24FixtureAcl, readSignatureExclusiveClosure, verifySignatureExclusiveClosure, readA24LegacyWriterAcl };
