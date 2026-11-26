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
type Operation = Pick<Prisma.MiddlewareParams, "model" | "action">;
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
  "jg_guard_generated_upward_seal_completion_v1",
  "jg_validate_fund_balance_correction_round"
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
