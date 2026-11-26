import { Prisma } from "@prisma/client";
import { projectA24SignatureFailure } from "./task426-a24-signature-diagnostic.test-support";

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
