import { ServiceUnavailableException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { projectA24ApprovalFailure, projectA24CashFailure, projectA24SignatureFailure,
  projectA24SubmissionFailure } from "./task426-a24-signature-diagnostic.test-support";

const clientVersion = "test";

it("projects the Prisma engine SQLSTATE, signed upload node and known relation", () => {
  const failure = new Prisma.PrismaClientUnknownRequestError(
    'PostgresError { code: "42501", message: "permission denied for table ContractTakeoverCorrection", severity: "ERROR" }',
    { clientVersion }
  );
  expect(projectA24SignatureFailure(failure, { model: "FileObject", action: "create" })).toEqual({
    serverErrorKind: "UNKNOWN_REQUEST_ERROR", serverSqlState: "42501", node: "FILE_REGISTER", relation: "ContractTakeoverCorrection"
  });
});

it("recognizes a known Prisma code and a fixed denied routine", () => {
  const failure = new Prisma.PrismaClientKnownRequestError("internal", {
    code: "P2010", clientVersion,
    meta: { code: "42501", message: "permission denied for function public.jg_file_business_collision_columns" }
  });
  expect(projectA24SignatureFailure(failure, { model: "HandwrittenSignatureVersion", action: "create" })).toEqual({
    serverErrorKind: "KNOWN_REQUEST_ERROR", serverPrismaCode: "P2010", serverSqlState: "42501",
    routine: "jg_file_business_collision_columns", node: "SIGNATURE_VERSION"
  });
});

it("drops arbitrary error strings and unrelated Prisma operations", () => {
  const failure = new Prisma.PrismaClientUnknownRequestError(
    'PostgresError { code: "ABCDE", message: "permission denied for function jg_secret_token postgresql://private" }',
    { clientVersion }
  );
  expect(projectA24SignatureFailure(failure, { model: "RefreshToken", action: "create" })).toEqual({
    serverErrorKind: "UNKNOWN_REQUEST_ERROR"
  });
});

it("isolates a submission permission failure to the attachment freeze node", () => {
  const failure = new Prisma.PrismaClientUnknownRequestError(
    'PostgresError { code: "42501", message: "permission denied for table ExpenseClaimAttachment" }',
    { clientVersion }
  );
  const operation = { model: "ExpenseClaimAttachment", action: "updateMany" } as const;
  expect(projectA24SubmissionFailure(failure, operation)).toEqual({
    serverErrorKind: "UNKNOWN_REQUEST_ERROR", serverSqlState: "42501", node: "SUBMISSION_ATTACHMENT_FREEZE",
    relation: "ExpenseClaimAttachment"
  });
  expect(projectA24SignatureFailure(failure, operation)).not.toHaveProperty("node");
});

it("isolates a final approval failure to the proved project-close operation", () => {
  const failure = new Prisma.PrismaClientUnknownRequestError(
    'PostgresError { code: "42501", message: "permission denied for relation ProjectCloseAggregate" }',
    { clientVersion }
  );
  const operation = { model: "ProjectCloseAggregate", action: "upsert" } as const;
  expect(projectA24ApprovalFailure(failure, operation)).toEqual({
    serverErrorKind: "UNKNOWN_REQUEST_ERROR", serverSqlState: "42501", node: "APPROVAL_CLOSE_AGGREGATE",
    relation: "ProjectCloseAggregate"
  });
  expect(projectA24SubmissionFailure(failure, operation)).not.toHaveProperty("node");
});

it("projects the cash voucher collision lookup without returning query or request values", () => {
  const failure = new Prisma.PrismaClientUnknownRequestError(
    'PostgresError { code: "42501", message: "permission denied for table SpotProcurementReceiptPhoto" } postgresql://private token=private',
    { clientVersion }
  );
  const operation = { model: "SpotProcurementReceiptPhoto", action: "findFirst" } as const;
  expect(projectA24CashFailure(failure, operation)).toEqual({
    serverErrorKind: "UNKNOWN_REQUEST_ERROR", serverSqlState: "42501", node: "CASH_RECEIPT_COLLISION",
    relation: "SpotProcurementReceiptPhoto"
  });
  expect(projectA24ApprovalFailure(failure, operation)).not.toHaveProperty("node");
});

it("projects the known raw voucher-collision shape without returning SQL or bindings", () => {
  const failure = new Prisma.PrismaClientKnownRequestError("raw failure", {
    clientVersion, code: "P2010",
    meta: { code: "42501", message: "permission denied for function jg_project_owner_settlement_voucher_bound" }
  });
  const prefix = '/* receipt_non_receipt_file_binding */\n      WITH candidates("id") AS (VALUES ';
  const query = Prisma.sql([prefix, ") SELECT"], "private-file-id");
  const operation = { model: undefined, action: "queryRaw" } as const;
  expect(projectA24CashFailure(failure, { ...operation, args: [query] })).toEqual({
    serverPrismaCode: "P2010", serverErrorKind: "KNOWN_REQUEST_ERROR", serverSqlState: "42501",
    node: "CASH_NON_RECEIPT_BINDING", routine: "jg_project_owner_settlement_voucher_bound"
  });
  expect(projectA24CashFailure(failure, { ...operation, args: [["SELECT ", ""], prefix] }))
    .toHaveProperty("node", "CASH_TRANSACTION_QUERY");
});

it("distinguishes fixed catalog refusals from unrelated 503 errors without returning error text", () => {
  const project = (message: string) => projectA24CashFailure(new ServiceUnavailableException(message));
  expect(project("已签变更与结算文件绑定暂不可核验，请稍后重试")).toEqual({
    serverErrorKind: "OTHER_NATIVE_ERROR", node: "CASH_SIGNED_FILE_CATALOG"
  });
  expect(project("付款凭证文件绑定暂不可核验，请稍后重试")).toEqual({
    serverErrorKind: "OTHER_NATIVE_ERROR", node: "CASH_REGISTERED_VOUCHER_CATALOG"
  });
  expect(project("付款凭证文件绑定暂不可核验，请稍后重试 private-value")).toEqual({
    serverErrorKind: "OTHER_NATIVE_ERROR"
  });
});
