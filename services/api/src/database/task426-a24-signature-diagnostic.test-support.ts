import { BadRequestException, ServiceUnavailableException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { projectTask16RegistrationError } from "./task16-registration-error-diagnostic";

const operations = {
  "FileObject.create": "FILE_REGISTER",
  "FileObject.findUnique": "FILE_VERIFY",
  "HandwrittenSignatureVersion.create": "SIGNATURE_VERSION",
  "User.update": "USER_SIGNATURE",
  "AuditLog.create": "AUDIT"
} as const;
const submissionOperations = {
  "undefined.queryRaw": "SUBMISSION_LOCK_OR_SCOPE",
  "ExpenseClaim.findUnique": "SUBMISSION_CLAIM_READ",
  "ExpenseClaim.update": "SUBMISSION_CLAIM_UPDATE",
  "Project.findFirst": "SUBMISSION_PROJECT_READ",
  "Project.findUnique": "SUBMISSION_PROJECT_READ",
  "User.findUnique": "SUBMISSION_ACTOR_READ",
  "User.findMany": "SUBMISSION_APPROVER_READ",
  "UserPosition.findMany": "SUBMISSION_ROLE_READ",
  "Position.findMany": "SUBMISSION_ROLE_READ",
  "ProjectMember.findMany": "SUBMISSION_ROLE_READ",
  "ProjectRosterMember.findMany": "SUBMISSION_ROLE_READ",
  "ApprovalInstance.create": "SUBMISSION_ROUND_CREATE",
  "ExpenseClaimAttachment.updateMany": "SUBMISSION_ATTACHMENT_FREEZE",
  "ExpenseClaimAttachment.findMany": "SUBMISSION_ATTACHMENT_READ",
  "ExpenseClaimLine.findMany": "SUBMISSION_LINE_READ",
  "ExpenseClaimEntrySnapshot.create": "SUBMISSION_SNAPSHOT_CREATE",
  "AuditLog.create": "SUBMISSION_AUDIT",
  "AuditLog.createMany": "SUBMISSION_DUTY_INTENTS"
} as const;
const approvalOperations = {
  "undefined.queryRaw": "APPROVAL_TRANSACTION_QUERY",
  "undefined.executeRaw": "APPROVAL_TRANSACTION_LOCK",
  "ExpenseClaim.findUnique": "APPROVAL_CLAIM_READ",
  "ExpenseClaim.update": "APPROVAL_CLAIM_UPDATE",
  "ExpenseClaimLine.findMany": "APPROVAL_SOURCE_LINES",
  "ApprovalInstance.findFirst": "APPROVAL_SOURCE_ROUND",
  "ApprovalInstance.findUnique": "APPROVAL_ROUND_READ",
  "ApprovalInstance.update": "APPROVAL_ROUND_UPDATE",
  "ApprovalActionLog.findFirst": "APPROVAL_SOURCE_CONFIRMATION",
  "ApprovalActionLog.create": "APPROVAL_REVIEW_AUDIT",
  "ProjectAffiliateAssignment.findFirst": "APPROVAL_SOURCE_AFFILIATE",
  "OperatingFact.findUnique": "APPROVAL_FACT_READ",
  "OperatingImpactEntry.findUnique": "APPROVAL_IMPACT_READ",
  "ProjectCloseAggregate.upsert": "APPROVAL_CLOSE_AGGREGATE",
  "ProjectCloseImpact.findUnique": "APPROVAL_CLOSE_IMPACT_READ",
  "ProjectCloseStageVersion.findMany": "APPROVAL_CLOSE_STAGE_READ",
  "AuditLog.create": "APPROVAL_AUDIT",
  "AuditLog.createMany": "APPROVAL_FUNDING_INTENTS",
  "PdfDocument.findFirst": "APPROVAL_FORM_READ",
  "ApprovalFormGenerationClaim.findUnique": "APPROVAL_FORM_CLAIM_READ",
  "ApprovalFormGenerationClaim.create": "APPROVAL_FORM_CLAIM_CREATE"
} as const;
const cashOperations = {
  "undefined.queryRaw": "CASH_TRANSACTION_QUERY",
  "undefined.executeRaw": "CASH_TRANSACTION_LOCK",
  "ExpenseClaim.findUnique": "CASH_CLAIM_READ",
  "ExpenseClaim.update": "CASH_CLAIM_UPDATE",
  "ExpenseClaimPaymentExecution.findUnique": "CASH_PAYMENT_REPLAY_LOOKUP",
  "ExpenseClaimPaymentExecution.create": "CASH_PAYMENT_CREATE",
  "PaymentExecutionRefund.aggregate": "CASH_REFUND_CAPACITY",
  "PaymentExecutionRefund.create": "CASH_REFUND_CREATE",
  "FileObject.findUnique": "CASH_VOUCHER_READ",
  "FileObject.create": "CASH_VOUCHER_REGISTER",
  "SpotProcurementReceiptPhoto.findFirst": "CASH_RECEIPT_COLLISION",
  "RegisteredFundAccount.findUnique": "CASH_FUND_ACCOUNT_READ",
  "RegisteredFundAccount.update": "CASH_FUND_ACCOUNT_UPDATE",
  "FundAccountBalanceRegistration.findFirst": "CASH_REGISTRATION_READ",
  "FundAccountSourceBatch.findMany": "CASH_SOURCE_BATCH_READ",
  "RegisteredOperationalPayment.findUnique": "CASH_REGISTERED_PAYMENT_READ",
  "RegisteredOperationalPayment.create": "CASH_REGISTERED_PAYMENT_CREATE",
  "RegisteredOperationalPaymentAllocation.createMany": "CASH_SOURCE_ALLOCATION_CREATE",
  "ExpensePublicCashCostLink.findMany": "CASH_COST_LINK_READ",
  "ExpensePublicCashCostLink.createMany": "CASH_COST_LINK_CREATE",
  "OperatingCostAttributionConfirmation.findUnique": "CASH_ATTRIBUTION_REPLAY_LOOKUP",
  "OperatingCostAttributionConfirmation.create": "CASH_ATTRIBUTION_CREATE",
  "OperatingCostAttributionConfirmation.update": "CASH_ATTRIBUTION_UPDATE",
  "AuditLog.create": "CASH_AUDIT"
} as const;
type Operation = Pick<Prisma.MiddlewareParams, "model" | "action"> & { args?: unknown };
const sqlStates = new Set(["42501", "23502", "23503", "23505", "23514", "42P01", "42703", "42883", "55000",
  "25006", "25P02", "40001", "40P01", "55P03", "57014"]);
const routines = new Set([
  "guard_other_binding_from_company_entity_correction",
  "jg_protect_contract_direct_review_file_v1",
  "jg_protect_contract_direct_archive_file_v1",
  "jg_enforce_exclusive_file_business_binding",
  "jg_has_exclusive_file_business_binding",
  "jg_file_business_collision_columns",
  "jg_file_business_binding_columns",
  "jg_file_business_binding_columns_before_signed_settlement",
  "jg_file_business_binding_columns_before_owner_settlement",
  "jg_project_owner_settlement_voucher_bound",
  "jg_guard_generated_upward_seal_completion_v1",
  "jg_validate_fund_balance_correction_round",
  "appendOperatingFactThroughService",
  "appendOperatingImpactThroughService"
]);

function projectFailure(error: unknown, nodes: Readonly<Record<string, string>>, operation?: Operation) {
  const detail = projectTask16RegistrationError(error);
  const operationKey = operation && operation.model + "." + operation.action;
  const node = operationKey && Object.hasOwn(nodes, operationKey) ? nodes[operationKey] : undefined;
  const metadata = detail.serverErrorKind === "KNOWN_REQUEST_ERROR" && error instanceof Prisma.PrismaClientKnownRequestError
    ? error.meta
    : undefined;
  const text = detail.serverErrorKind === "UNKNOWN_REQUEST_ERROR" && error instanceof Prisma.PrismaClientUnknownRequestError
    ? error.message
    : typeof metadata?.message === "string" ? metadata.message : "";
  const textState = /(?:PostgresError\s*\{\s*code:\s*"|\bSQLSTATE[ :]+|\bcode:\s*SqlState\(E?)([0-9A-Z]{5})\b/u.exec(text)?.[1];
  const state = detail.serverSqlState ?? (typeof metadata?.code === "string" ? metadata.code : textState);
  const object = /permission denied for (table|relation|function|sequence) (?:public\.)?\\?"?([a-zA-Z_][a-zA-Z0-9_]{0,95})/u.exec(text);
  const relation = object && (object[1] === "table" || object[1] === "relation") && Object.hasOwn(Prisma.ModelName, object[2])
    ? object[2] : undefined;
  const routine = object?.[1] === "function" && routines.has(object[2]) ? object[2] : undefined;
  return { ...detail, ...(node ? { node } : {}), ...(state && sqlStates.has(state) ? { serverSqlState: state } : {}),
    ...(relation ? { relation } : {}), ...(routine ? { routine } : {}) };
}

/** Project onto fixed labels without returning any engine text or request values. */
export const projectA24SignatureFailure = (error: unknown, operation?: Operation) => projectFailure(error, operations, operation);
export const projectA24SubmissionFailure = (error: unknown, operation?: Operation) => projectFailure(error, submissionOperations, operation);
export const projectA24ApprovalFailure = (error: unknown, operation?: Operation) => projectFailure(error, approvalOperations, operation);
export function projectA24CashFailure(error: unknown, operation?: Operation) {
  const detail = projectFailure(error, cashOperations, operation);
  if (error instanceof ServiceUnavailableException) {
    if (error.message === "已签变更与结算文件绑定暂不可核验，请稍后重试") {
      return { ...detail, node: "CASH_SIGNED_FILE_CATALOG" };
    }
    if (error.message === "付款凭证文件绑定暂不可核验，请稍后重试") {
      return { ...detail, node: "CASH_REGISTERED_VOUCHER_CATALOG" };
    }
  }
  if (error instanceof BadRequestException &&
      error.message === "公共现金经营后果必须关联同一正式实付及无公司资金容器，不能用客户端标记替代") {
    return { ...detail, node: "CASH_OPERATING_SOURCE_AUTHORITY" };
  }
  if (detail.node !== "CASH_TRANSACTION_QUERY") return detail;

  // Prisma middleware receives a prepared Sql object or the tagged template's literal segments.
  const args = operation?.args;
  if (!Array.isArray(args)) return detail;
  const query: unknown = args[0];
  const strings: unknown = Array.isArray(query) ? query
    : query && typeof query === "object" && "strings" in query ? query.strings : undefined;
  const prefix: unknown = Array.isArray(strings) ? strings[0] : undefined;
  if (typeof prefix !== "string" ||
      !prefix.trimStart().startsWith('/* receipt_non_receipt_file_binding */\n      WITH candidates("id") AS (VALUES ')) return detail;
  return { ...detail, node: "CASH_NON_RECEIPT_BINDING" };
}
