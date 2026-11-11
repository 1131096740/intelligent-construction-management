import { createHash } from "node:crypto";
import {
  cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync,
  statSync, writeFileSync
} from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { join } from "node:path";
import { withGuaranteedCleanup } from "./money-bigint-live-verification";

const localRequire = createRequire(__filename);
const runnerPath = join(
  process.cwd(),
  "prisma/run-project-financing-quota-concurrency-local.cjs"
);

describe("project financing quota PostgreSQL runner", () => {

  const firstFailure = {
    status: "captured",
    sqlState: "P0001",
    reason: "ARCHIVE_APPLICATION_QUALIFICATION_REQUIRED"
  };
  const scopedPrefix = "JG-PFQ|jg-pfq-first-migrate|" +
    "jiangkong_project_financing_quota_concurrency|13|";
  const hundredArgumentCall = "pg_catalog.jsonb_build_object(" + Array(100).fill("text").join(", ") + ")";
  const overArgumentCall = "pg_catalog.jsonb_build_object(" + Array(101).fill("text").join(", ") + ")";
  const permittedMessage = "function sha256(unknown) is not unique";
  const exactByteMessage = permittedMessage + " ".repeat(4096 - Buffer.byteLength(permittedMessage));
  const exactMultibyteMessage = permittedMessage + "密" +
    " ".repeat(4096 - Buffer.byteLength(permittedMessage) - Buffer.byteLength("密"));
  type FirstFailureScenario = {
    name: string;
    logs: string;
    stdout?: string;
    logBytes?: number;
    logsFailed?: boolean;
    existingEvidence?: boolean;
    cleanupFailed?: boolean;
    postgres: {
      status: string;
      sqlState?: string;
      reason?: string;
      diagnostic?: { messageClass: string; functionCall?: string; functionName?: string; operatorCall?: string };
    };
  };
  it.each<FirstFailureScenario>([
    {
      name: "a PG16 controlled binary operator ambiguity",
      logs: scopedPrefix + "42725|ERROR:  operator is not unique: unknown -> unknown\n",
      postgres: { status: "captured", sqlState: "42725", reason: "POSTGRES_ERROR",
        diagnostic: { messageClass: "OPERATOR_AMBIGUOUS", operatorCall: "unknown -> unknown" } }
    },
    ...["=", "<>", ">", "->", "->>", "#>", "#>>", "-", "||", "~"].map(operator => ({
      name: "a PG16 binary operator literal " + operator,
      logs: scopedPrefix + "42725|ERROR:  operator is not unique: unknown " + operator + " unknown at character 42\n",
      postgres: { status: "captured", sqlState: "42725", reason: "POSTGRES_ERROR",
        diagnostic: { messageClass: "OPERATOR_AMBIGUOUS", operatorCall: "unknown " + operator + " unknown" } }
    })),
    {
      name: "a PG16 binary operator with fixed multiword and array operand types",
      logs: scopedPrefix + "42725|ERROR:  operator is not unique: timestamp without time zone = pg_catalog.text[]\n",
      postgres: { status: "captured", sqlState: "42725", reason: "POSTGRES_ERROR",
        diagnostic: { messageClass: "OPERATOR_AMBIGUOUS", operatorCall: "timestamp without time zone = pg_catalog.text[]" } }
    },
    ...["unknown + unknown", "unknown public.-> unknown", 'unknown "->" unknown', "secret = unknown",
      "public.secret = unknown", "-> unknown", "unknown ->", "unknown -> unknown; SELECT secret",
      "unknown -> unknown -- secret", "unknown -> unknown/*secret*/", "https://secret -> unknown",
      "unknown -> unknown\u0000", "unknown -> unknown\u001b[31m", "unknown -> unknown at character 0",
      "unknown -> unknown at character 1 at character 2", "unknown - unknown - unknown"].map(signature => ({
        name: "rejects an unsafe PG16 binary operator signature " + JSON.stringify(signature),
        logs: scopedPrefix + "42725|ERROR:  operator is not unique: " + signature + "\n",
        postgres: { status: "captured", sqlState: "42725", reason: "POSTGRES_ERROR" }
      })),
    ...[
      { label: "unknown primary", logs: scopedPrefix + "42725|ERROR:  private unknown ambiguity\n", postgres: { status: "captured", sqlState: "42725", reason: "POSTGRES_ERROR" } },
      { label: "aborted primary", logs: scopedPrefix + "25P02|ERROR:  current transaction is aborted\n", postgres: { status: "primary-not-retained" } }
    ].map(first => ({
      name: "a PG16 binary operator cannot replace " + first.label,
      logs: first.logs + scopedPrefix + "42725|ERROR:  operator is not unique: unknown -> unknown\n",
      postgres: first.postgres
    })),
    {
      name: "a PG16 server-position suffix on the controlled signature",
      logs: scopedPrefix + "42725|ERROR:  function sha256(unknown) is not unique at character 42\n",
      postgres: { status: "captured", sqlState: "42725", reason: "POSTGRES_ERROR",
        diagnostic: { messageClass: "FUNCTION_CALL_AMBIGUOUS", functionCall: "sha256(unknown)" } }
    },
    ...[
      ['function name "sha256" is not unique at character 1', "FUNCTION_NAME_AMBIGUOUS"],
      ['more than one function named "public.digest" at character 2147483647', "REGPROC_NAME_AMBIGUOUS"]
    ].map(([message, messageClass]) => ({
      name: "a PG16 position-suffix name class " + messageClass,
      logs: scopedPrefix + "42725|ERROR:  " + message + "\n",
      postgres: { status: "captured", sqlState: "42725", reason: "POSTGRES_ERROR",
        diagnostic: { messageClass, functionName: messageClass === "REGPROC_NAME_AMBIGUOUS" ? "public.digest" : "sha256" } }
    })),
    ...["0", "01", "+1", "-1", "2147483648", "99999999999", "１", "1 at character 2", "1 ", "1; SELECT secret"]
      .map(position => ({
        name: "rejects a malformed PG16 position-suffix " + JSON.stringify(position),
        logs: scopedPrefix + "42725|ERROR:  function sha256(unknown) is not unique at character " + position + "\n",
        postgres: { status: "captured", sqlState: "42725", reason: "POSTGRES_ERROR" }
      })),
    {
      name: "the PG16 maximum hundred standard arguments",
      logs: scopedPrefix + "42725|ERROR:  function " + hundredArgumentCall + " is not unique\n",
      postgres: { status: "captured", sqlState: "42725", reason: "POSTGRES_ERROR",
        diagnostic: { messageClass: "FUNCTION_CALL_AMBIGUOUS", functionCall: hundredArgumentCall } }
    },
    {
      name: "no partial diagnostic beyond the PG16 argument bound",
      logs: scopedPrefix + "42725|ERROR:  function " + overArgumentCall + " is not unique\n",
      postgres: { status: "captured", sqlState: "42725", reason: "POSTGRES_ERROR" }
    },
    ...[exactByteMessage, exactByteMessage + " ", exactMultibyteMessage, exactMultibyteMessage + "密"]
      .map((message, index) => ({
        name: "no truncation or trimming of a bounded adversarial message " + index,
        logs: scopedPrefix + "42725|ERROR:  " + message + "\n",
        postgres: { status: "captured", sqlState: "42725", reason: "POSTGRES_ERROR" }
      })),
    {
      name: "the last permitted log line without expanding the window",
      logs: "unrelated record\n".repeat(255) + scopedPrefix + "42725|ERROR:  " + permittedMessage + "\n",
      postgres: { status: "captured", sqlState: "42725", reason: "POSTGRES_ERROR",
        diagnostic: { messageClass: "FUNCTION_CALL_AMBIGUOUS", functionCall: "sha256(unknown)" } }
    },
    {
      name: "the exact combined byte window without trimming it",
      stdout: "synthetic stdout",
      logBytes: 128 * 1024,
      logs: scopedPrefix + "42725|ERROR:  " + permittedMessage + "\n",
      postgres: { status: "captured", sqlState: "42725", reason: "POSTGRES_ERROR",
        diagnostic: { messageClass: "FUNCTION_CALL_AMBIGUOUS", functionCall: "sha256(unknown)" } }
    },
    {
      name: "a single byte beyond the combined window",
      stdout: "synthetic stdout",
      logBytes: 128 * 1024 + 1,
      logs: scopedPrefix + "42725|ERROR:  " + permittedMessage + "\n",
      postgres: { status: "unavailable" }
    },
    {
      // A PG16-shaped synthetic log tests retention only, not an actual SQL cause.
      name: "a controlled PG16 function ambiguity signature",
      logs: scopedPrefix + "42725|ERROR:  function pg_catalog.has_column_privilege(oid, unknown, unknown) is not unique\n",
      postgres: { status: "captured", sqlState: "42725", reason: "POSTGRES_ERROR",
        diagnostic: { messageClass: "FUNCTION_CALL_AMBIGUOUS",
          functionCall: "pg_catalog.has_column_privilege(oid, unknown, unknown)" } }
    },
    {
      name: "a PG16 function name ambiguity",
      logs: scopedPrefix + "42725|ERROR:  function name \"pg_catalog.has_table_privilege\" is not unique\n",
      postgres: {"status": "captured", "sqlState": "42725", "reason": "POSTGRES_ERROR", "diagnostic": {"messageClass": "FUNCTION_NAME_AMBIGUOUS", "functionName": "pg_catalog.has_table_privilege"}}
    },
    {
      name: "a PG16 regproc name ambiguity",
      logs: scopedPrefix + "42725|ERROR:  more than one function named \"has_column_privilege\"\n",
      postgres: {"status": "captured", "sqlState": "42725", "reason": "POSTGRES_ERROR", "diagnostic": {"messageClass": "REGPROC_NAME_AMBIGUOUS", "functionName": "has_column_privilege"}}
    },
    {
      name: "a source-covered sha256 call ambiguity",
      logs: scopedPrefix + "42725|ERROR:  function sha256(unknown) is not unique\n",
      postgres: {"status": "captured", "sqlState": "42725", "reason": "POSTGRES_ERROR", "diagnostic": {"messageClass": "FUNCTION_CALL_AMBIGUOUS", "functionCall": "sha256(unknown)"}}
    },
    {
      name: "a fixed public recipe function ambiguity",
      logs: scopedPrefix + "42725|ERROR:  function public.jg_guard_contract_direct_archive_retention_binding_v1() is not unique\n",
      postgres: {"status": "captured", "sqlState": "42725", "reason": "POSTGRES_ERROR", "diagnostic": {"messageClass": "FUNCTION_CALL_AMBIGUOUS", "functionCall": "public.jg_guard_contract_direct_archive_retention_binding_v1()"}}
    },
    {
      name: "a source-fixed quoted public name",
      logs: scopedPrefix + "42725|ERROR:  more than one function named \"public.\"protectContractEconomicReview\"\"\n",
      postgres: {"status": "captured", "sqlState": "42725", "reason": "POSTGRES_ERROR", "diagnostic": {"messageClass": "REGPROC_NAME_AMBIGUOUS", "functionName": "public.\"protectContractEconomicReview\""}}
    },
    {
      name: "fixed char and array type spellings",
      logs: scopedPrefix + "42725|ERROR:  function pg_catalog.unnest(\"char\"[], oid[]) is not unique\n",
      postgres: {"status": "captured", "sqlState": "42725", "reason": "POSTGRES_ERROR", "diagnostic": {"messageClass": "FUNCTION_CALL_AMBIGUOUS", "functionCall": "pg_catalog.unnest(\"char\"[], oid[])"}}
    },
    {
      name: "fixed catalog type spellings without schema inference",
      logs: scopedPrefix + "42725|ERROR:  function has_column_privilege(pg_catalog.oid, pg_catalog.int2, pg_catalog.text) is not unique\n",
      postgres: {"status": "captured", "sqlState": "42725", "reason": "POSTGRES_ERROR", "diagnostic": {"messageClass": "FUNCTION_CALL_AMBIGUOUS", "functionCall": "has_column_privilege(pg_catalog.oid, pg_catalog.int2, pg_catalog.text)"}}
    },
    {
      name: "no partial diagnostic for an unknown function",
      logs: scopedPrefix + "42725|ERROR:  function secret_password(unknown) is not unique\n",
      postgres: {"status": "captured", "sqlState": "42725", "reason": "POSTGRES_ERROR"}
    },
    {
      name: "no partial diagnostic for a builtin under the wrong schema",
      logs: scopedPrefix + "42725|ERROR:  function public.acldefault(\"char\", oid) is not unique\n",
      postgres: {"status": "captured", "sqlState": "42725", "reason": "POSTGRES_ERROR"}
    },
    {
      name: "no partial diagnostic for a public extension under the wrong schema",
      logs: scopedPrefix + "42725|ERROR:  function pg_catalog.digest(bytea, text) is not unique\n",
      postgres: {"status": "captured", "sqlState": "42725", "reason": "POSTGRES_ERROR"}
    },
    {
      name: "no partial diagnostic for an unlisted public jg name",
      logs: scopedPrefix + "42725|ERROR:  function public.jg_unlisted_bound_secret(text) is not unique\n",
      postgres: {"status": "captured", "sqlState": "42725", "reason": "POSTGRES_ERROR"}
    },
    {
      name: "no partial diagnostic for an unlisted quoted builtin",
      logs: scopedPrefix + "42725|ERROR:  function \"has_column_privilege\"(oid, text, text) is not unique\n",
      postgres: {"status": "captured", "sqlState": "42725", "reason": "POSTGRES_ERROR"}
    },
    {
      name: "no partial diagnostic for a nonce schema",
      logs: scopedPrefix + "42725|ERROR:  function jg_fixture_bound_secret.sha256(bytea) is not unique\n",
      postgres: {"status": "captured", "sqlState": "42725", "reason": "POSTGRES_ERROR"}
    },
    {
      name: "no partial diagnostic for a Unicode lookalike name",
      logs: scopedPrefix + "42725|ERROR:  function pg_catalog.sh\u0430256(bytea) is not unique\n",
      postgres: {"status": "captured", "sqlState": "42725", "reason": "POSTGRES_ERROR"}
    },
    {
      name: "no partial diagnostic for an ANSI-decorated message",
      logs: scopedPrefix + "42725|ERROR:  \u001b[31mfunction pg_catalog.sha256(bytea) is not unique\n",
      postgres: {"status": "captured", "sqlState": "42725", "reason": "POSTGRES_ERROR"}
    },
    {
      name: "no partial diagnostic for an embedded NUL type",
      logs: scopedPrefix + "42725|ERROR:  function pg_catalog.sha256(bytea\u0000) is not unique\n",
      postgres: {"status": "captured", "sqlState": "42725", "reason": "POSTGRES_ERROR"}
    },
    {
      name: "no partial diagnostic for a secret custom type",
      logs: scopedPrefix + "42725|ERROR:  function pg_catalog.sha256(public.bound_secret) is not unique\n",
      postgres: {"status": "captured", "sqlState": "42725", "reason": "POSTGRES_ERROR"}
    },
    {
      name: "no partial diagnostic for named argument text",
      logs: scopedPrefix + "42725|ERROR:  function pg_catalog.sha256(value => bytea) is not unique\n",
      postgres: {"status": "captured", "sqlState": "42725", "reason": "POSTGRES_ERROR"}
    },
    {
      name: "no partial diagnostic for a SQL comment in argument types",
      logs: scopedPrefix + "42725|ERROR:  function pg_catalog.sha256(bytea /* bound-secret */) is not unique\n",
      postgres: {"status": "captured", "sqlState": "42725", "reason": "POSTGRES_ERROR"}
    },
    {
      name: "no partial diagnostic for a URL instead of a type",
      logs: scopedPrefix + "42725|ERROR:  function pg_catalog.sha256(postgresql://user:password@secret-host/db) is not unique\n",
      postgres: {"status": "captured", "sqlState": "42725", "reason": "POSTGRES_ERROR"}
    },
    {
      name: "no partial diagnostic for multiple array suffixes",
      logs: scopedPrefix + "42725|ERROR:  function pg_catalog.unnest(text[][]) is not unique\n",
      postgres: {"status": "captured", "sqlState": "42725", "reason": "POSTGRES_ERROR"}
    },
    {
      name: "no partial diagnostic for an argument value instead of a type",
      logs: scopedPrefix + "42725|ERROR:  function pg_catalog.sha256(12345) is not unique\n",
      postgres: {"status": "captured", "sqlState": "42725", "reason": "POSTGRES_ERROR"}
    },
    {
      name: "no partial diagnostic for a valid message with trailing SQL",
      logs: scopedPrefix + "42725|ERROR:  function pg_catalog.sha256(bytea) is not unique SELECT 'bound-secret'\n",
      postgres: {"status": "captured", "sqlState": "42725", "reason": "POSTGRES_ERROR"}
    },
    {
      name: "no partial diagnostic for a valid message with trailing whitespace",
      logs: scopedPrefix + "42725|ERROR:  function pg_catalog.sha256(bytea) is not unique \n",
      postgres: {"status": "captured", "sqlState": "42725", "reason": "POSTGRES_ERROR"}
    },
    {
      name: "no partial diagnostic for a known name with one unknown type",
      logs: scopedPrefix + "42725|ERROR:  function has_column_privilege(oid, text, bound_secret) is not unique\n",
      postgres: {"status": "captured", "sqlState": "42725", "reason": "POSTGRES_ERROR"}
    },
    {
      name: "no partial diagnostic for a nonstandard comma separator",
      logs: scopedPrefix + "42725|ERROR:  function has_column_privilege(oid,text,text) is not unique\n",
      postgres: {"status": "captured", "sqlState": "42725", "reason": "POSTGRES_ERROR"}
    },
    {
      name: "no partial diagnostic for a regproc name with appended content",
      logs: scopedPrefix + "42725|ERROR:  more than one function named \"has_column_privilege\" bound-secret\n",
      postgres: {"status": "captured", "sqlState": "42725", "reason": "POSTGRES_ERROR"}
    },
    {
      name: "an ambiguity-shaped message under a different SQLSTATE",
      logs: scopedPrefix + "23514|ERROR:  function pg_catalog.sha256(bytea) is not unique\n",
      postgres: {"status": "captured", "sqlState": "23514", "reason": "POSTGRES_ERROR"}
    },
    {
      name: "the first unknown42725 rather than a later permitted signature",
      logs: scopedPrefix + "42725|ERROR:  bound-secret\n" + scopedPrefix + "42725|ERROR:  function sha256(unknown) is not unique\n",
      postgres: {"status": "captured", "sqlState": "42725", "reason": "POSTGRES_ERROR"}
    },
    {
      name: "the first other SQLSTATE rather than a later permitted signature",
      logs: scopedPrefix + "42501|ERROR:  bound-secret\n" + scopedPrefix + "42725|ERROR:  function sha256(unknown) is not unique\n",
      postgres: {"status": "captured", "sqlState": "42501", "reason": "POSTGRES_ERROR"}
    },
    {
      name: "a missing primary before a later permitted signature",
      logs: scopedPrefix + "25P02|ERROR:  aborted\n" + scopedPrefix + "42725|ERROR:  function sha256(unknown) is not unique\n",
      postgres: {"status": "primary-not-retained"}
    },
    {
      name: "no signature from stdout",
      stdout: scopedPrefix + "42725|ERROR:  function sha256(unknown) is not unique\n",
      logs: scopedPrefix + "42725|ERROR:  bound-secret\n",
      postgres: {"status": "captured", "sqlState": "42725", "reason": "POSTGRES_ERROR"}
    },
    {
      name: "no signature from DETAIL or STATEMENT",
      logs: scopedPrefix + "42725|ERROR:  bound-secret\n" + scopedPrefix + "42725|DETAIL:  function sha256(unknown) is not unique\n" + "STATEMENT: function sha256(unknown) is not unique\n",
      postgres: {"status": "captured", "sqlState": "42725", "reason": "POSTGRES_ERROR"}
    },
    {
      name: "no signature from another application",
      logs: "JG-PFQ|another-app|jiangkong_project_financing_quota_concurrency|13|42725|ERROR:  function sha256(unknown) is not unique\n",
      postgres: {"status": "primary-not-retained"}
    },
    {
      name: "no signature from another database",
      logs: scopedPrefix.replace("|jiangkong_project_financing_quota_concurrency|", "|other_database|") + "42725|ERROR:  function sha256(unknown) is not unique\n",
      postgres: {"status": "primary-not-retained"}
    },
    {
      name: "no signature from an invalid zero PID",
      logs: scopedPrefix.replace("|13|", "|0|") + "42725|ERROR:  function sha256(unknown) is not unique\n",
      postgres: {"status": "primary-not-retained"}
    },
    {
      name: "no signature from an invalid overflow PID",
      logs: scopedPrefix.replace("|13|", "|2147483648|") + "42725|ERROR:  function sha256(unknown) is not unique\n",
      postgres: {"status": "primary-not-retained"}
    },
    {
      name: "the first scoped cause",
      logs: [
        "JG-PFQ|unrelated|jiangkong_project_financing_quota_concurrency|11|42501|ERROR:  secret",
        "JG-PFQ|jg-pfq-first-00000000-0000-0000-0000-000000000000|jiangkong_project_financing_quota_concurrency|11|42501|ERROR:  stale run",
        scopedPrefix.replace("|13|", "|0|") + "42501|ERROR:  invalid backend",
        scopedPrefix.replace("|13|", "|9999999999|") + "42501|ERROR:  invalid backend",
        "JG-PFQ|jg-pfq-first-migrate|other_database|12|23505|ERROR:  secret",
        scopedPrefix + "P0001|ERROR:  真实归档应用角色或函数资格未提供，拒绝安装",
        "STATEMENT: SELECT 'postgresql://user:password@secret-host/db', 'bound-secret'",
        scopedPrefix + "25P02|ERROR:  current transaction is aborted"
      ].join("\n") + "\n",
      postgres: firstFailure
    },
    {
      name: "an unknown error without its raw SQL or values",
      logs: scopedPrefix + "23514|ERROR:  SELECT 'bound-secret' postgresql://user:password@secret-host/db\n",
      postgres: { status: "captured", sqlState: "23514", reason: "POSTGRES_ERROR" }
    },
    {
      name: "an exact known message with the wrong SQLSTATE",
      logs: scopedPrefix + "23514|ERROR:  真实归档应用角色或函数资格未提供，拒绝安装\n",
      postgres: { status: "captured", sqlState: "23514", reason: "POSTGRES_ERROR" }
    },
    {
      name: "an inexact known message",
      logs: scopedPrefix + "P0001|ERROR:  真实归档应用角色或函数资格未提供，拒绝安装 trailing-secret\n",
      postgres: { status: "captured", sqlState: "P0001", reason: "POSTGRES_ERROR" }
    },
    {
      name: "the file caller prerequisite",
      logs: scopedPrefix + "P0001|ERROR:  旧文件链实际caller闭包未提供，拒绝假定\n",
      postgres: { status: "captured", sqlState: "P0001", reason: "ARCHIVE_FILE_CALLERS_REQUIRED" }
    },
    {
      name: "the direct pending prerequisite",
      logs: scopedPrefix + "P0001|ERROR:  真实待登记应用与文件调用者尚未供应，拒绝安装\n",
      postgres: { status: "captured", sqlState: "P0001", reason: "DIRECT_PENDING_CALLERS_REQUIRED" }
    },
    {
      name: "the bound control identity failure",
      logs: scopedPrefix + "P0001|ERROR:  local fixture base identity changed\n",
      postgres: { status: "captured", sqlState: "P0001", reason: "FIXTURE_BASE_IDENTITY_CHANGED" }
    },
    {
      name: "the original trigger divergence",
      logs: scopedPrefix + "P0001|ERROR:  local fixture old trigger changed\n",
      postgres: { status: "captured", sqlState: "P0001", reason: "FIXTURE_OLD_TRIGGER_CHANGED" }
    },
    {
      name: "the original routine divergence",
      logs: scopedPrefix + "P0001|ERROR:  local fixture old routine changed\n",
      postgres: { status: "captured", sqlState: "P0001", reason: "FIXTURE_OLD_ROUTINE_CHANGED" }
    },
    {
      name: "the role catalog divergence",
      logs: scopedPrefix + "P0001|ERROR:  local fixture role catalog changed\n",
      postgres: { status: "captured", sqlState: "P0001", reason: "FIXTURE_ROLE_CATALOG_CHANGED" }
    },
    {
      name: "the original file caller divergence",
      logs: scopedPrefix + "P0001|ERROR:  local fixture file callers changed\n",
      postgres: { status: "captured", sqlState: "P0001", reason: "FIXTURE_FILE_CALLERS_CHANGED" }
    },
    {
      name: "the bounded caller DML failure",
      logs: scopedPrefix + "P0001|ERROR:  local fixture file caller DML changed\n",
      postgres: { status: "captured", sqlState: "P0001", reason: "FIXTURE_FILE_CALLER_DML_CHANGED" }
    },
    {
      name: "the bounded caller stage failure",
      logs: scopedPrefix + "P0001|ERROR:  local fixture file caller stage changed\n",
      postgres: { status: "captured", sqlState: "P0001", reason: "FIXTURE_FILE_CALLER_STAGE_CHANGED" }
    },
    {
      name: "the bounded caller column ACL failure",
      logs: scopedPrefix + "P0001|ERROR:  local fixture file caller column ACL changed\n",
      postgres: { status: "captured", sqlState: "P0001", reason: "FIXTURE_FILE_CALLER_COLUMN_ACL_CHANGED" }
    },
    {
      name: "the bounded complete readback overflow",
      logs: scopedPrefix + "P0001|ERROR:  local fixture readback too large\n",
      postgres: { status: "captured", sqlState: "P0001", reason: "FIXTURE_READBACK_TOO_LARGE" }
    },
    {
      name: "the earlier unknown cause ahead of a known prerequisite",
      logs: scopedPrefix + "42501|ERROR:  unknown-secret\n" +
        scopedPrefix + "P0001|ERROR:  真实归档应用角色或函数资格未提供，拒绝安装\n",
      postgres: { status: "captured", sqlState: "42501", reason: "POSTGRES_ERROR" }
    },
    {
      name: "a known phrase with extra whitespace",
      logs: scopedPrefix + "P0001|ERROR:  真实归档应用角色或函数资格未提供，拒绝安装 \n",
      postgres: { status: "captured", sqlState: "P0001", reason: "POSTGRES_ERROR" }
    },
    {
      name: "a missing primary error",
      logs: scopedPrefix + "25P02|ERROR:  aborted\n" +
        scopedPrefix + "P0001|ERROR:  真实归档应用角色或函数资格未提供，拒绝安装\n",
      postgres: { status: "primary-not-retained" }
    },
    {
      name: "unrelated sessions only",
      logs: "JG-PFQ|unrelated|other_database|12|23505|ERROR:  secret\n",
      postgres: { status: "primary-not-retained" }
    },
    {
      name: "a saturated tail without mislabelling a later error",
      logs: "unrelated record\n".repeat(256) +
        scopedPrefix + "P0001|ERROR:  真实归档应用角色或函数资格未提供，拒绝安装\n",
      postgres: { status: "window-exceeded" }
    },
    {
      name: "a saturated mixed stdout and stderr tail",
      stdout: "one stdout record\n",
      logs: "unrelated record\n".repeat(255) +
        scopedPrefix + "P0001|ERROR:  真实归档应用角色或函数资格未提供，拒绝安装\n",
      postgres: { status: "window-exceeded" }
    },
    {
      name: "a saturated window with a blank stdout line",
      stdout: "\n",
      logs: "unrelated record\n".repeat(255) +
        scopedPrefix + "P0001|ERROR:  真实归档应用角色或函数资格未提供，拒绝安装\n",
      postgres: { status: "window-exceeded" }
    },
    {
      name: "an oversized record",
      logs: scopedPrefix + "P0001|ERROR:  " + "x".repeat(128 * 1024),
      postgres: { status: "unavailable" }
    },
    {
      name: "unavailable server logs",
      logs: "",
      logsFailed: true,
      postgres: { status: "unavailable" }
    },
    {
      name: "an unavailable artifact path",
      logs: scopedPrefix + "P0001|ERROR:  真实归档应用角色或函数资格未提供，拒绝安装\n",
      existingEvidence: true,
      postgres: firstFailure
    },
    {
      name: "an additional cleanup error",
      logs: scopedPrefix + "P0001|ERROR:  真实归档应用角色或函数资格未提供，拒绝安装\n",
      cleanupFailed: true,
      postgres: firstFailure
    }
  ])("retains $name before cleanup and stops later gates", (scenario) => {
    const fixture = mkdtempSync(join(tmpdir(), "pfq-first-error-test-"));
    try {
      const prismaRoot = join(fixture, "services/api/prisma");
      const dist = join(fixture, "services/api/dist/database");
      const bin = join(fixture, "bin");
      const artifacts = join(fixture, "artifacts");
      for (const directory of [prismaRoot, dist, bin, artifacts]) {
        mkdirSync(directory, { recursive: true });
      }
      for (const filename of [
        "run-project-financing-quota-concurrency-local.cjs",
        "money-bigint-runner-runtime.cjs",
        "local-staged-migrations.cjs",
        "local-staged-migration-controls.cjs",
        "local-staged-migration-acl.sql",
        "local-staged-migration-qualification.json",
        "local-staged-technical-profile-policy.cjs",
        "local-staged-tail-qualification.cjs", "local-staged-tail-qualification.json", "local-staged-tail-post213.sql", "testdata",
        "migration-baseline.cjs",
        "schema.prisma",
        "database-dynamic-gate-manifest.json",
        "migrations"
      ]) {
        cpSync(join(process.cwd(), "prisma", filename), join(prismaRoot, filename), { recursive: true });
      }
      writeFileSync(join(dist, "money-bigint-live-verification.js"),
        "exports.withGuaranteedCleanup = " + withGuaranteedCleanup.toString());
      const calls = join(fixture, "calls.jsonl");
      const fake = [
        "#!" + process.execPath,
        'const fs = require("node:fs");',
        'const path = require("node:path");',
        "const calls = " + JSON.stringify(calls) + ";",
        "const args = process.argv.slice(2);",
        'const applicationName = path.basename(process.argv[1]) === "pnpm" ?',
        '  new URL(process.env.DATABASE_URL).searchParams.get("application_name") : null;',
        "fs.appendFileSync(calls, JSON.stringify({ command: path.basename(process.argv[1]), args, applicationName }) + '\\n');",
        'if (path.basename(process.argv[1]) === "pnpm") {',
        '  process.stderr.write("original-prisma-failure"); process.exit(19);',
        "}",
        'if (args[0] === "context") process.stdout.write(JSON.stringify("unix:///tmp/fake-pfq.sock"));',
        'if (args[0] === "run") process.stdout.write("a".repeat(64));',
        'if (args[0] === "inspect") {',
        "const prior = fs.readFileSync(calls, 'utf8').trim().split('\\n').map(JSON.parse).find(event => event.args[0] === 'run').args;",
        'process.stdout.write(JSON.stringify({id:"a".repeat(64),name:"/"+prior[prior.indexOf("--name")+1],',
        'runId:prior[prior.indexOf("--label")+1].split("=")[1],running:true,ports:{"5432/tcp":[{',
        'HostIp:"127.0.0.1",HostPort:prior[prior.indexOf("--publish")+1].split(":")[1]}]}}));',
        '}',
        'if (args[0] === "exec" && args.includes("psql")) {',
        'process.stdout.write(JSON.stringify({database:args[args.indexOf("-d")+1],databaseOid:"16384",namespaceOid:"2200",',
        'actorOid:"10",ownerOid:"10",actor:"jiangkong",sessionActor:"jiangkong",systemIdentifier:"1234567890123456789",',
        'version:160015,encoding:"UTF8",replication:"origin",ledger:[],roles:[{oid:"10",name:"jiangkong"}]}));',
        '}',

        'if (args[0] === "logs") {',
        "const ownedApp = fs.readFileSync(calls, 'utf8').trim().split('\\n').map(JSON.parse)" +
          ".find(event => event.command === 'pnpm').applicationName;",
        "const stdout = " + JSON.stringify(scenario.stdout ?? "") + ".replaceAll('jg-pfq-first-migrate', ownedApp);",
        "let stderr = " + JSON.stringify(scenario.logs) + ".replaceAll('jg-pfq-first-migrate', ownedApp);",
        "const logBytes = " + JSON.stringify(scenario.logBytes ?? null) + ";",
        'if (logBytes !== null) stderr += "x".repeat(logBytes - Buffer.byteLength(stdout) - Buffer.byteLength(stderr));',
        "process.stdout.write(stdout);",
        "process.stderr.write(stderr, () => process.exit(" + (scenario.logsFailed ? 7 : 0) + "));",
        "}",
        'if (args[0] === "rm") process.exit(' + (scenario.cleanupFailed ? 9 : 0) + ");"
      ].join("\n");
      for (const filename of ["docker", "pnpm"]) {
        writeFileSync(join(bin, filename), fake, { mode: 0o700 });
      }
      const evidencePath = join(artifacts, "project_financing_quota-evidence.json");
      if (scenario.existingEvidence) writeFileSync(evidencePath, "existing evidence");
      const run = spawnSync(process.execPath, [join(prismaRoot, "run-project-financing-quota-concurrency-local.cjs")], {
        env: {
          PATH: bin,
          HOME: fixture,
          TMPDIR: artifacts,
          NODE_ENV: "test",
          PNPM_BIN: join(bin, "pnpm"),
          DATABASE_DYNAMIC_GATE_CANDIDATE_SHA: "a".repeat(40),
          PROJECT_FINANCING_QUOTA_LOCAL_EVIDENCE_PATH: evidencePath
        },
        encoding: "utf8",
        timeout: 10_000
      });
      expect(run.status).toBe(1);
      expect(run.stderr).toContain("original-prisma-failure");
      if (scenario.cleanupFailed) expect(run.stderr).toContain("本地金额验收清理失败");
      const events = readFileSync(calls, "utf8").trim().split("\n")
        .map(line => JSON.parse(line) as { command: string; args: string[]; applicationName: string | null });
      expect(events.filter(event => event.command === "pnpm")).toHaveLength(1);
      expect(events.find(event => event.command === "pnpm")?.applicationName)
        .toMatch(/^jg-pfq-first-[a-f0-9-]{36}$/u);
      const controlCalls = events.filter(event => event.args.includes("psql"));
      expect(controlCalls.length).toBeGreaterThan(0);
      const ownedApplicationName = events.find(event => event.command === "pnpm")?.applicationName;
      for (const call of controlCalls) {
        expect(call.args).toEqual(expect.arrayContaining(["--env", `PGAPPNAME=${ownedApplicationName}`, "a".repeat(64)]));
      }
      expect(events.at(-1)?.args.slice(0, 3)).toEqual(["rm", "--force", "--volumes"]);
      expect(events.findIndex(event => event.args[0] === "logs")).toBeGreaterThan(
        events.findIndex(event => event.command === "pnpm"));
      expect(events.findIndex(event => event.args[0] === "logs")).toBeLessThan(
        events.findIndex(event => event.args[0] === "rm"));
      const receiptLine = run.stderr.split("\n")
        .find(line => line.startsWith("[project-financing-quota-failure] {"));
      expect(receiptLine).toBeDefined();
      const receiptText = receiptLine?.slice("[project-financing-quota-failure] ".length) ?? "";
      expect(JSON.parse(receiptText)).toEqual({
        schemaVersion: 1,
        gate: "project_financing_quota",
        status: "failed",
        phase: "first-migrate-deploy",
        candidateSha: "a".repeat(40),
        postgres: scenario.postgres
      });
      if (scenario.existingEvidence) {
        expect(readFileSync(evidencePath, "utf8")).toBe("existing evidence");
        expect(run.stderr).toContain("evidence-write-unavailable");
      } else {
        expect(readFileSync(evidencePath, "utf8").trim()).toBe(receiptText);
        expect(statSync(evidencePath).mode & 0o777).toBe(0o600);
      }
      expect(readdirSync(artifacts)).toEqual(["project_financing_quota-evidence.json"]);
      for (const secret of ["SELECT", "password", "bound-secret", "secret-host", "25P02"]) {
        expect(receiptText).not.toContain(secret);
      }
      expect(events.find(event => event.args[0] === "logs")?.args.slice(0, 3))
        .toEqual(["logs", "--tail", "257"]);
      const dockerRun = events.find(event => event.args[0] === "run")?.args ?? [];
      expect(dockerRun).toEqual(expect.arrayContaining([
        "log_line_prefix=JG-PFQ|%a|%d|%p|%e|",
        "log_min_error_statement=panic",
        "log_parameter_max_length_on_error=0"
      ]));
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  it.each(["first", "pre115-recovery", "pre115-recovery-output-limit", "replacement-child-setup"])("retains the %s owned control failure before cleanup", (scope) => {
    const recovered = scope !== "first";
    const outputLimit = scope === "pre115-recovery-output-limit";
    const setup = scope === "replacement-child-setup";
    const firstDatabase = "jiangkong_project_financing_quota_concurrency";
    const targetDatabase = setup ? "jiangkong_project_financing_quota_pre115_replacement_child"
      : recovered ? "jiangkong_project_financing_quota_pre115_duplicate" : firstDatabase;
    const fixture = mkdtempSync(join(tmpdir(), "pfq-control-readback-error-"));
    try {
      const prismaRoot = join(fixture, "services/api/prisma");
      const dist = join(fixture, "services/api/dist/database");
      const bin = join(fixture, "bin"), artifacts = join(fixture, "artifacts");
      for (const directory of [prismaRoot, dist, bin, artifacts]) mkdirSync(directory, { recursive: true });
      for (const filename of ["run-project-financing-quota-concurrency-local.cjs", "money-bigint-runner-runtime.cjs",
        "local-staged-migrations.cjs", "local-staged-migration-controls.cjs", "local-staged-migration-acl.sql",
        "local-staged-migration-qualification.json",
        "local-staged-technical-profile-policy.cjs",
        "local-staged-tail-qualification.cjs", "local-staged-tail-qualification.json", "local-staged-tail-post213.sql", "testdata", "migration-baseline.cjs", "schema.prisma",
        "database-dynamic-gate-manifest.json", "migrations"]) {
        cpSync(join(process.cwd(), "prisma", filename), join(prismaRoot, filename), { recursive: true });
      }
      writeFileSync(join(dist, "money-bigint-live-verification.js"),
        "exports.withGuaranteedCleanup = " + withGuaranteedCleanup.toString());
      const migrations = readdirSync(join(prismaRoot, "migrations")).filter(name => /^\d{14}_/u.test(name)).sort()
        .map(name => ({ name, sha256: createHash("sha256")
          .update(readFileSync(join(prismaRoot, "migrations", name, "migration.sql"))).digest("hex") }));
      const statePath = join(fixture, "state.json");
      writeFileSync(statePath, JSON.stringify({ prismaRoot, migrations, databases: {}, events: [], appCount: 0, serverLog: "",
        retainExpectedReason: true,
        legacyNames: ["jg_payment_execution_payer_issuer", "jg_pol275_owner", "jg_pol275_runtime", "jg_pol279_runtime", "jg_pol280_runtime"],
        roles: [{ oid: "10", name: "jiangkong", superuser: true, createRole: false, createDb: true,
          replication: true, bypassRls: true, memberships: [] }] }));
      const failurePort = [
        'event.applicationName = tool === "pnpm" ? new URL(process.env.DATABASE_URL).searchParams.get("application_name") :',
        '  args.find(value => value.startsWith("PGAPPNAME="))?.slice("PGAPPNAME=".length) ?? "psql";',
        'if (tool !== "pnpm" && args.includes("psql") && args[args.indexOf("-d")+1] === ' + JSON.stringify(targetDatabase) +
          ' && args[args.indexOf("-c")+1]?.startsWith(' +
          JSON.stringify(setup ? "-- Local owned-container fixture only." : "-- local-fixture readback") + ')) {',
        '  event.action = "control-readback-failure";',
        '  event.database = args[args.indexOf("-d")+1];',
        ...(recovered ? [
          '  state.serverLog = "JG-PFQ|" + event.applicationName + "|' + firstDatabase + '|203|42702|ERROR:  first-database-secret\\n";',
          '  state.serverLog += "JG-PFQ|jg-pfq-other-tag|" + event.database + "|204|23505|ERROR:  other-tag-secret\\n";'
        ] : ['  state.serverLog = "";']),
        ...(!outputLimit ? [
          '  state.serverLog += "JG-PFQ|" + event.applicationName + "|" + event.database +',
          '    "|202|P0001|ERROR:  ' +
          (setup ? "local fixture file caller DML vector limit" : "local fixture old routine changed") +
          '\\nSTATEMENT: SELECT bound-secret\\n";',
        ] : []),
        '  state.events.push(event); fs.writeFileSync(statePath,JSON.stringify(state));',
        outputLimit
          ? '  process.stderr.write("output-limit-secret".repeat(80_000), () => process.exit(23)); return;'
          : '  process.stderr.write("control-port-failure SELECT bound-secret"); process.exit(23);',
        '}'
      ].join("\n");
      const fakeSource = readFileSync(join(process.cwd(), "prisma/testdata/pfq-masked-115-command.cjs"), "utf8")
        .replace('if (tool === "pnpm") {', failurePort + '\nif (tool === "pnpm") {')
        .replace('else if (args[0] === "logs") stdout = state.serverLog;', 'else if (args[0] === "logs") stderr = state.serverLog;');
      for (const name of ["docker", "pnpm"]) writeFileSync(join(bin, name), "#!" + process.execPath + "\n" + fakeSource, { mode: 0o700 });
      const evidencePath = join(artifacts, "project_financing_quota-evidence.json");
      const run = spawnSync(process.execPath, [join(prismaRoot, "run-project-financing-quota-concurrency-local.cjs")], {
        env: { PATH: bin, HOME: fixture, TMPDIR: artifacts, NODE_ENV: "test", PNPM_BIN: join(bin, "pnpm"),
          PROJECT_FINANCING_QUOTA_LOCAL_EVIDENCE_PATH: evidencePath }, encoding: "utf8", timeout: 15_000
      });
      expect({ status: run.status, error: run.error }).toEqual({ status: 1, error: undefined });
      expect(run.stderr).toContain(setup ? "LOCAL_MIGRATION_SQL_QUALIFICATION_SETUP" : "LOCAL_MIGRATION_SQL_STAGE205_READBACK");
      const state = JSON.parse(readFileSync(statePath, "utf8")) as {
        databases: Record<string, { applied: number; failed: boolean; resolved: boolean; remediated: boolean }>;
        events: { action?: string; tool: string; applicationName: string; database?: string; count?: number; args: string[] }[];
      };
      const receiptText = readFileSync(evidencePath, "utf8");
      const receipt = JSON.parse(receiptText);
      expect(receipt.phase).toBe(setup ? "qualification-setup" : recovered ? "pre115-recovery-stage205-readback" : "first-migrate-deploy");
      expect(receipt.database).toBe(recovered ? targetDatabase : undefined);
      expect(receipt.postgres).toEqual(outputLimit ? { status: "primary-not-retained" }
        : { status: "captured", sqlState: "P0001", reason: setup ? "FIXTURE_FILE_CALLER_DML_VECTOR_LIMIT" : "FIXTURE_OLD_ROUTINE_CHANGED" });
      expect(receipt.transport).toBe(outputLimit ? "OUTPUT_LIMIT" : undefined);
      const ownedApplicationName = state.events.find(event => event.tool === "pnpm")!.applicationName;
      expect(ownedApplicationName).toMatch(/^jg-pfq-first-[a-f0-9-]{36}$/u);
      const failed = state.events.findIndex(event => event.action === "control-readback-failure");
      const failure = state.events[failed]!;
      if (recovered) {
        const priorDatabases = [firstDatabase, "jiangkong_project_financing_quota_pre115_clean"];
        if (setup) priorDatabases.push("jiangkong_project_financing_quota_pre115_duplicate", "jiangkong_project_financing_quota_pre115_cross_business");
        expect(Object.keys(state.databases)).toEqual([...priorDatabases, targetDatabase]);
        expect(state.databases[firstDatabase]!.applied).toBe(migrations.length);
        expect(state.databases["jiangkong_project_financing_quota_pre115_clean"]!.applied).toBe(migrations.length);
        expect(state.databases[targetDatabase]).toMatchObject({ applied: setup ? 203 : 205, failed: true, resolved: true, remediated: true });
        const targetEvents = state.events.filter(event => event.database === targetDatabase);
        expect(targetEvents.filter(event => event.action === "masked-failure")).toHaveLength(1);
        expect(targetEvents.findIndex(event => event.action === "resolve")).toBeLessThan(targetEvents.indexOf(failure));
        expect(failure.applicationName).toMatch(setup ? /^jg-pfq-setup-[a-f0-9-]{36}$/u : /^jg-pfq-pre115-205-[a-f0-9-]{36}$/u);
        expect(state.events.filter(event => event.applicationName === failure.applicationName)).toEqual([failure]);
        expect(failure.args).toEqual(expect.arrayContaining([
          "PGOPTIONS=-c log_min_error_statement=panic -c log_error_verbosity=terse", "VERBOSITY=terse",
          "a".repeat(64), "-c", "<SQL>"
        ]));
      } else {
        expect(state.events.filter(event => event.action === "deploy").map(event => event.count)).toEqual([203, 205]);
        const controls = state.events.filter(event => event.args.includes("psql"));
        expect(controls.length).toBeGreaterThan(2);
        expect(controls.every(event => event.applicationName === ownedApplicationName &&
          event.args.includes("a".repeat(64)) && event.database === firstDatabase)).toBe(true);
      }
      const captured = state.events.findIndex((event, index) => index > failed && event.args[0] === "logs" && event.args[1] === "--tail");
      const removed = state.events.findIndex(event => event.args[0] === "rm");
      expect(failed).toBeLessThan(captured); expect(captured).toBeLessThan(removed);
      if (recovered) expect(state.events[captured]?.args.at(-1)).toBe("a".repeat(64));
      expect(state.events.some(event => event.action === "business-tests")).toBe(false);
      expect(statSync(evidencePath).mode & 0o777).toBe(0o600);
      for (const secret of ["SELECT", "bound-secret", "local fixture", "control-port-failure", "first-database-secret", "other-tag-secret", "output-limit-secret"]) {
        expect(receiptText).not.toContain(secret);
        expect(run.stderr).not.toContain(secret);
      }
    } finally { rmSync(fixture, { recursive: true, force: true }); }
  });

  it.each(["NODE_PROOF", "RESOURCE_PORT"])("retains fixed tail stage and bounded error evidence for %s", (tailFailureKind) => {
    const fixture = mkdtempSync(join(tmpdir(), "pfq-control-readback-error-"));
    try {
      const prismaRoot = join(fixture, "services/api/prisma");
      const dist = join(fixture, "services/api/dist/database");
      const bin = join(fixture, "bin"), artifacts = join(fixture, "artifacts");
      for (const directory of [prismaRoot, dist, bin, artifacts]) mkdirSync(directory, { recursive: true });
      for (const filename of ["run-project-financing-quota-concurrency-local.cjs", "money-bigint-runner-runtime.cjs",
        "local-staged-migrations.cjs", "local-staged-migration-controls.cjs", "local-staged-migration-acl.sql",
        "local-staged-migration-qualification.json",
        "local-staged-technical-profile-policy.cjs",
        "local-staged-tail-qualification.cjs", "local-staged-tail-qualification.json", "local-staged-tail-post213.sql", "testdata", "migration-baseline.cjs", "schema.prisma",
        "database-dynamic-gate-manifest.json", "migrations"]) {
        cpSync(join(process.cwd(), "prisma", filename), join(prismaRoot, filename), { recursive: true });
      }
      writeFileSync(join(dist, "money-bigint-live-verification.js"),
        "exports.withGuaranteedCleanup = " + withGuaranteedCleanup.toString());
      const migrations = readdirSync(join(prismaRoot, "migrations")).filter(name => /^\d{14}_/u.test(name)).sort()
        .map(name => ({ name, sha256: createHash("sha256")
          .update(readFileSync(join(prismaRoot, "migrations", name, "migration.sql"))).digest("hex") }));
      const statePath = join(fixture, "state.json");
      writeFileSync(statePath, JSON.stringify({ prismaRoot, migrations, databases: {}, events: [], appCount: 0, serverLog: "",
        retainExpectedReason: true, tailFailureKind,
        legacyNames: ["jg_payment_execution_payer_issuer", "jg_pol275_owner", "jg_pol275_runtime", "jg_pol279_runtime", "jg_pol280_runtime"],
        roles: [{ oid: "10", name: "jiangkong", superuser: true, createRole: false, createDb: true,
          replication: true, bypassRls: true, memberships: [] }] }));
      const fakeSource = readFileSync(join(process.cwd(), "prisma/testdata/pfq-masked-115-command.cjs"), "utf8")
        .replace('else if (args[0] === "logs") stdout = state.serverLog;', 'else if (args[0] === "logs") stderr = state.serverLog;');
      for (const name of ["docker", "pnpm"]) writeFileSync(join(bin, name), "#!" + process.execPath + "\n" + fakeSource, { mode: 0o700 });
      const evidencePath = join(artifacts, "project_financing_quota-evidence.json");
      const run = spawnSync(process.execPath, [join(prismaRoot, "run-project-financing-quota-concurrency-local.cjs")], {
        env: { PATH: bin, HOME: fixture, TMPDIR: artifacts, NODE_ENV: "test", PNPM_BIN: join(bin, "pnpm"),
          PROJECT_FINANCING_QUOTA_LOCAL_EVIDENCE_PATH: evidencePath }, encoding: "utf8", timeout: 15_000
      });
      expect({ status: run.status, error: run.error }).toEqual({ status: 1, error: undefined });
      const stage = tailFailureKind === "NODE_PROOF" ? "TAIL213_READBACK" : "TAIL213_SUPPLY";
      expect(run.stderr).toContain("LOCAL_MIGRATION_" + stage + "_" + tailFailureKind);
      const state = JSON.parse(readFileSync(statePath, "utf8")) as { events: {
        action?: string; syntheticFailure?: string; tool: string; applicationName: string; database?: string; count?: number; stdinBytes?: number; args: string[]
      }[] };
      expect(state.events.filter(event => event.action === "deploy").map(event => event.count)).toEqual([203, 205, 213]);
      const ownedApplicationName = state.events.find(event => event.tool === "pnpm")!.applicationName;
      expect(ownedApplicationName).toMatch(/^jg-pfq-first-[a-f0-9-]{36}$/u);
      const controls = state.events.filter(event => event.args.includes("psql"));
      expect(controls.length).toBeGreaterThan(2);
      expect(controls.every(event => event.applicationName === ownedApplicationName &&
        event.args.includes("a".repeat(64)) && event.database === "jiangkong_project_financing_quota_concurrency")).toBe(true);
      const failed = state.events.findIndex(event => event.syntheticFailure === tailFailureKind);
      const captured = state.events.findIndex(event => event.args[0] === "logs");
      const removed = state.events.findIndex(event => event.args[0] === "rm");
      expect(failed).toBeLessThan(captured); expect(captured).toBeLessThan(removed);
      expect(state.events.some(event => event.action === "business-tests")).toBe(false);
      const receiptText = readFileSync(evidencePath, "utf8");
      expect(JSON.parse(receiptText).postgres).toEqual(tailFailureKind === "RESOURCE_PORT"
        ? { status: "captured", sqlState: "P0001", reason: "POSTGRES_ERROR" } : { status: "primary-not-retained" });
      expect(JSON.parse(receiptText).localMigration).toEqual({ stage, kind: tailFailureKind,
        reason: tailFailureKind === "NODE_PROOF" ? "READBACK_VALIDATE_CONTINUITY" : "SUPPLY_RESULT" });
      for (const event of state.events.filter(event => event.action?.startsWith("tail-"))) {
        expect(event.args).toEqual(expect.arrayContaining(["PGOPTIONS=-c log_min_error_statement=panic -c log_error_verbosity=terse", "VERBOSITY=terse"]));
        if (event.action === "tail-supply") {
          expect(event.args).toEqual(expect.arrayContaining(["--interactive", "-f", "-"]));
          expect(event.args).not.toContain("-c");
          expect(event.stdinBytes).toBeGreaterThan(120_000);
          expect(event.stdinBytes).toBeLessThanOrEqual(16 * 1024 * 1024);
        }
      }
      expect(state.events.filter(event => event.args.includes("psql") && !event.action?.startsWith("tail-"))
        .every(event => !event.args.some(value => value.startsWith("PGOPTIONS=")))).toBe(true);
      expect(statSync(evidencePath).mode & 0o777).toBe(0o600);
      for (const secret of ["SELECT", "secret-role", "synthetic client", "STATEMENT", "local fixture", "control-port-failure"]) expect(receiptText).not.toContain(secret);
    } finally { rmSync(fixture, { recursive: true, force: true }); }
  });

  it.each([true, false])("preserves the original CLI masked115 evidence and resolve boundary when expected evidence is retained=%s", (retainExpectedReason) => {
    const fixture = mkdtempSync(join(tmpdir(), "pfq-masked115-cli-"));
    try {
      const prismaRoot = join(fixture, "services/api/prisma");
      const dist = join(fixture, "services/api/dist/database");
      const bin = join(fixture, "bin");
      const artifacts = join(fixture, "artifacts");
      for (const directory of [prismaRoot, dist, bin, artifacts]) mkdirSync(directory, { recursive: true });
      for (const filename of ["run-project-financing-quota-concurrency-local.cjs", "money-bigint-runner-runtime.cjs",
        "local-staged-migrations.cjs", "local-staged-migration-controls.cjs", "local-staged-migration-acl.sql",
        "local-staged-migration-qualification.json",
        "local-staged-technical-profile-policy.cjs",
        "local-staged-tail-qualification.cjs", "local-staged-tail-qualification.json", "local-staged-tail-post213.sql", "testdata", "migration-baseline.cjs", "schema.prisma",
        "database-dynamic-gate-manifest.json", "migrations"]) {
        cpSync(join(process.cwd(), "prisma", filename), join(prismaRoot, filename), { recursive: true });
      }
      writeFileSync(join(dist, "money-bigint-live-verification.js"),
        "exports.withGuaranteedCleanup = " + withGuaranteedCleanup.toString());
      const migrations = readdirSync(join(prismaRoot, "migrations")).filter(name => /^\d{14}_/u.test(name)).sort()
        .map(name => ({ name, sha256: createHash("sha256")
          .update(readFileSync(join(prismaRoot, "migrations", name, "migration.sql"))).digest("hex") }));
      const statePath = join(fixture, "state.json");
      writeFileSync(statePath, JSON.stringify({ prismaRoot, migrations, databases: {}, events: [], appCount: 0, serverLog: "", retainExpectedReason,
        ...(retainExpectedReason ? { oversizedStage205Database: "jiangkong_project_financing_quota_pre115_duplicate" } : {}),
        legacyNames: ["jg_payment_execution_payer_issuer", "jg_pol275_owner", "jg_pol275_runtime", "jg_pol279_runtime", "jg_pol280_runtime"],
        roles: [{ oid: "10", name: "jiangkong", superuser: true, createRole: false, createDb: true,
          replication: true, bypassRls: true, memberships: [] }] }));
      const fake = "#!" + process.execPath + "\n" + readFileSync(
        join(process.cwd(), "prisma/testdata/pfq-masked-115-command.cjs"), "utf8");
      for (const name of ["docker", "pnpm"]) writeFileSync(join(bin, name), fake, { mode: 0o700 });
      const run = spawnSync(process.execPath, [join(prismaRoot, "run-project-financing-quota-concurrency-local.cjs")], {
        env: { PATH: bin, HOME: fixture, TMPDIR: artifacts, NODE_ENV: "test", PNPM_BIN: join(bin, "pnpm") },
        encoding: "utf8", timeout: 30_000
      });
      const state = JSON.parse(readFileSync(statePath, "utf8")) as {
        databases: Record<string, { applied: number; failed: boolean; resolved: boolean; remediated: boolean }>;
        events: { action?: string; database?: string; count?: number; args: string[]; readbackWireBytes?: number }[];
      };
      if (!retainExpectedReason) {
        expect({ status: run.status, error: run.error }).toEqual({ status: 1, error: undefined });
        expect(run.stderr).toContain("场景未以预期错误停止迁移");
        expect(state.events.filter(event => ["resolve", "remediate", "business-tests"].includes(event.action ?? "")))
          .toHaveLength(0);
        expect(state.events.filter(event => event.action === "masked-failure")).toHaveLength(1);
        expect(state.events.at(-1)?.args.slice(0, 3)).toEqual(["rm", "--force", "--volumes"]);
        return;
      }
      expect({ status: run.status, error: run.error }).toEqual({ status: 0, error: undefined });
      expect(run.stderr.match(/current transaction is aborted/gu)).toHaveLength(4);
      expect(run.stderr).not.toContain("project_financing_quota_duplicate_attachment");
      expect(run.stderr).not.toContain("project_financing_quota_cross_business_attachment");
      expect(Object.keys(state.databases)).toHaveLength(7);
      expect(Object.values(state.databases).every(database => database.applied === migrations.length)).toBe(true);
      const oversizedReadbacks = state.events.filter(event => (event.readbackWireBytes ?? 0) > 512 * 1024);
      expect(oversizedReadbacks.map(event => event.database)).toEqual(["jiangkong_project_financing_quota_pre115_duplicate"]);
      const failures = state.events.filter(event => event.action === "masked-failure");
      expect(failures).toHaveLength(4);
      for (const failure of failures) {
        const events = state.events.filter(event => event.database === failure.database);
        const failed = events.indexOf(failure);
        const retained = events.findIndex(event => event.action === "retained-failure-log");
        const rollback = events.findIndex(event => event.action === "rollback-proof");
        const remediate = events.findIndex(event => event.action === "remediate");
        const resolve = events.findIndex(event => event.action === "resolve");
        expect(failed).toBeLessThan(retained);
        expect(retained).toBeLessThan(rollback);
        expect(rollback).toBeLessThan(remediate);
        expect(remediate).toBeLessThan(resolve);
        expect(events.slice(resolve + 1).filter(event => event.action === "deploy").map(event => event.count))
          .toEqual([203, 205, 213, 215, 218, 221, migrations.length]);
      }
      expect(state.events.filter(event => event.action === "business-tests")).toHaveLength(1);
      expect(state.events.at(-1)?.args.slice(0, 3)).toEqual(["rm", "--force", "--volumes"]);
    } finally { rmSync(fixture, { recursive: true, force: true }); }
  }, 30_000);

  it("pins the exact local database, migration count, terminal migration and checksum", () => {
    const baseline = localRequire(
      join(process.cwd(), "prisma/migration-baseline.cjs")
    ).loadCanonicalMigrationBaseline() as {
      expectedDirectoryCount: number;
      terminalMigration: string;
    };
    const runner = localRequire(runnerPath) as {
      DATABASE_NAME: string;
      CURRENT_TERMINAL_MIGRATION: string;
      EXPECTED_MIGRATION_COUNT: number;
      PRE115_MIGRATION_COUNT: number;
      PRE115_TERMINAL_MIGRATION: string;
      REQUEST_MIGRATION: string;
      REQUEST_MIGRATION_CHECKSUM: string;
      TERMINAL_MIGRATION: string;
      TERMINAL_MIGRATION_CHECKSUM: string;
      assertDedicatedLocalDatabase: (databaseUrl: string) => void;
    };
    const migration = readFileSync(
      join(
        process.cwd(),
        "prisma/migrations",
        runner.TERMINAL_MIGRATION,
        "migration.sql"
      )
    );
    const requestMigration = readFileSync(
      join(
        process.cwd(),
        "prisma/migrations",
        runner.REQUEST_MIGRATION,
        "migration.sql"
      )
    );

    expect(runner.DATABASE_NAME).toBe(
      "jiangkong_project_financing_quota_concurrency"
    );
    expect(runner.EXPECTED_MIGRATION_COUNT).toBe(
      baseline.expectedDirectoryCount
    );
    expect(runner.CURRENT_TERMINAL_MIGRATION).toBe(
      baseline.terminalMigration
    );
    expect(runner.PRE115_MIGRATION_COUNT).toBe(114);
    expect(runner.PRE115_TERMINAL_MIGRATION).toBe(
      "20260728161000_spot_procurement_application_revision_status"
    );
    expect(runner.REQUEST_MIGRATION).toBe(
      "20260802010000_project_financing_quota_request_idempotency"
    );
    expect(runner.REQUEST_MIGRATION_CHECKSUM).toBe(
      createHash("sha256").update(requestMigration).digest("hex")
    );
    expect(runner.TERMINAL_MIGRATION).toBe(
      "20260802020000_project_financing_quota_termination_idempotency"
    );
    expect(runner.TERMINAL_MIGRATION_CHECKSUM).toBe(
      createHash("sha256").update(migration).digest("hex")
    );
    expect(() => runner.assertDedicatedLocalDatabase(
      "postgresql://local:secret@127.0.0.1:55432/jiangkong_project_financing_quota_concurrency"
    )).not.toThrow();
    for (const unsafe of [
      "postgresql://prod:secret@db.example.com:5432/jiangkong_project_financing_quota_concurrency",
      "postgresql://prod:secret@127.0.0.1:5432/jiangkong",
      "mysql://local:secret@127.0.0.1:3306/jiangkong_project_financing_quota_concurrency",
      "not-a-url"
    ]) {
      expect(() => runner.assertDedicatedLocalDatabase(unsafe)).toThrow();
    }
  });

  it("sanitizes the Docker environment and rejects remote endpoints or contexts", () => {
    const runner = localRequire(runnerPath) as {
      assertLocalDockerEndpoint: (endpoint: string) => void;
      assertResolvedLocalDockerEndpoint: (endpoint: string) => string;
      pinResolvedLocalDockerEndpoint: (
        dockerEnv: Record<string, string>,
        endpoint: string
      ) => string;
      createControlledDockerEnv: (
        sourceEnv: Record<string, string | undefined>,
        fallbackHome: string
      ) => Record<string, string>;
    };

    expect(runner.createControlledDockerEnv({
      PATH: "/usr/bin",
      HOME: "/tmp/home",
      DOCKER_HOST: "unix:///tmp/docker.sock",
      DOCKER_CONTEXT: "desktop-linux",
      DATABASE_URL: "postgresql://production",
      POSTGRES_PASSWORD: "must-not-leak",
      NODE_ENV: "production"
    }, "/tmp/fallback")).toEqual({
      PATH: "/usr/bin",
      HOME: "/tmp/home",
      DOCKER_HOST: "unix:///tmp/docker.sock",
      DOCKER_CONTEXT: "desktop-linux"
    });
    for (const local of ["", "unix:///tmp/docker.sock", "npipe:////./pipe/docker_engine"]) {
      expect(() => runner.assertLocalDockerEndpoint(local)).not.toThrow();
    }
    for (const remote of [
      "tcp://127.0.0.1:2375",
      "tcp://docker.example.com:2376",
      "ssh://runner:secret@remote-docker"
    ]) {
      let message = "";
      try {
        runner.assertLocalDockerEndpoint(remote);
      } catch (error) {
        message = String((error as Error).message);
      }
      expect(message).toBe(
        "项目垫资额度并发门拒绝远程 Docker endpoint/context"
      );
      expect(message).not.toContain(remote);
      expect(message).not.toContain("secret");
    }
    for (const resolvedLocal of [
      '"unix:///tmp/docker.sock"',
      '"npipe:////./pipe/docker_engine"'
    ]) {
      expect(runner.assertResolvedLocalDockerEndpoint(resolvedLocal)).toBe(
        JSON.parse(resolvedLocal)
      );
    }
    for (const unresolved of [
      "",
      "   ",
      '""',
      "null",
      "{}",
      '"unterminated',
      '"tcp://runner:secret@remote:2376"',
      '"unix://"',
      JSON.stringify("unix:///tmp/docker.sock\nssh://remote")
    ]) {
      let message = "";
      try {
        runner.assertResolvedLocalDockerEndpoint(unresolved);
      } catch (error) {
        message = String((error as Error).message);
      }
      expect(message).toBe(
        "项目垫资额度并发门无法确认本机 Docker endpoint/context"
      );
      if (unresolved.trim()) {
        expect(message).not.toContain(unresolved.trim());
      }
      expect(message).not.toContain("secret");
    }
    const pinnedDockerEnv = {
      PATH: "/usr/bin",
      HOME: "/tmp/home",
      DOCKER_HOST: "unix:///stale.sock",
      DOCKER_CONTEXT: "stale-context"
    };
    expect(runner.pinResolvedLocalDockerEndpoint(
      pinnedDockerEnv,
      '"unix:///tmp/pinned.sock"'
    )).toBe("unix:///tmp/pinned.sock");
    expect(pinnedDockerEnv).toEqual({
      PATH: "/usr/bin",
      HOME: "/tmp/home",
      DOCKER_HOST: "unix:///tmp/pinned.sock"
    });
  });

  it("uses an existing postgres:16 image, loopback publish, double deploy and exact migration proof", () => {
    const source = readFileSync(runnerPath, "utf8");
    const dockerRunBlock = source.match(
      /await dockerCommand\(\[\s*"run",[\s\S]*?\]\s*,\s*\{/u
    )?.[0];
    const forbiddenVolumeArgument =
      /"(?:--mount(?:=[^"]*)?|--volume(?:=[^"]*)?|-v)"/u;

    expect(source).toContain('dockerCommand(["image", "inspect", "postgres:16"]');
    expect(source).toContain('process.env.NODE_ENV === "production"');
    expect(source).toContain("const databasePort = await freePort()");
    expect(source).toContain("randomUUID().slice(0, 8)");
    expect(source).toContain("const databasePassword = `${randomUUID()}${randomUUID()}`");
    expect(source).toContain('"--pull=never"');
    expect(source).toContain('`127.0.0.1:${databasePort}:5432`');
    expect(dockerRunBlock).toBeDefined();
    for (const forbidden of [
      "--mount",
      "--mount=type=bind,src=/tmp,dst=/data",
      "--volume",
      "--volume=/tmp:/data",
      "-v"
    ]) {
      expect(`"${forbidden}"`).toMatch(forbiddenVolumeArgument);
    }
    expect(dockerRunBlock).not.toMatch(forbiddenVolumeArgument);
    expect(source).toContain(
      "firstDeploy = await runPrismaMigrate({"
    );
    expect(source).toContain(
      "const secondDeploy = await runPrismaMigrate({ databaseUrl, runtimeEnv })"
    );
    expect(source).toContain("No pending migrations to apply");
    expect(source).toContain('"migrate", "status"');
    expect(source).toContain('FROM "_prisma_migrations"');
    expect(source).toContain('"checksum"');
    expect(source).toContain("appliedMigrationCount");
    expect(source).toContain("terminalMigrationCount");
    expect(source).toContain("rolledBackMigrationCount");
    expect(source).toContain("TERMINAL_MIGRATION_CHECKSUM");
    expect(source).not.toContain("dotenv");
    expect(source).not.toContain('".env"');
    expect(source).not.toContain("'.env'");
  });

  it("exposes one explicit root-to-API opt-in command", () => {
    const manifest = JSON.parse(readFileSync(
      join(process.cwd(), "prisma/database-dynamic-gate-manifest.json"), "utf8"
    )) as { coveredGroups: { id: string; runner: { evidenceEnv?: string } }[] };
    expect(manifest.coveredGroups.find(group => group.id === "project_financing_quota")
      ?.runner.evidenceEnv).toBe("PROJECT_FINANCING_QUOTA_LOCAL_EVIDENCE_PATH");
    const rootPackage = JSON.parse(readFileSync(
      join(process.cwd(), "../..", "package.json"),
      "utf8"
    )) as { scripts: Record<string, string> };
    const apiPackage = JSON.parse(readFileSync(
      join(process.cwd(), "package.json"),
      "utf8"
    )) as { scripts: Record<string, string> };

    expect(rootPackage.scripts[
      "verify:project-financing-quota-concurrency:local"
    ]).toBe(
      "node scripts/pnpm-workspace.mjs --filter @jiangkong/api " +
      "verify:project-financing-quota-concurrency:local"
    );
    expect(apiPackage.scripts[
      "preverify:project-financing-quota-concurrency:local"
    ]).toBe(
      "node ../../scripts/pnpm-workspace.mjs --filter @jiangkong/api build"
    );
    expect(apiPackage.scripts[
      "verify:project-financing-quota-concurrency:local"
    ]).toBe(
      "node prisma/run-project-financing-quota-concurrency-local.cjs"
    );
  });

  it("proves the pre-116 legacy upgrade and runs only the opt-in financing quota spec", () => {
    const source = readFileSync(runnerPath, "utf8");

    expect(source).toContain("preparePre116MigrationRoot");
    expect(source).toContain("LEGACY_DATABASE_NAME");
    expect(source).toContain('entry.name >= TERMINAL_MIGRATION');
    expect(source).toContain('"terminationActionId" IS NULL');
    expect(source).toContain('"terminationRequestFingerprint" IS NULL');
    expect(source).toContain("legacy financing quota termination changed during migration");
    expect(source).toContain('RUN_PROJECT_FINANCING_QUOTA_DATABASE: "1"');
    expect(source).toContain(
      "src/database/project-financing-quota-concurrency.spec.ts"
    );
    expect(source).not.toContain(
      "src/database/project-funding-availability-concurrency.spec.ts"
    );
  });

  it("rehearses #115 from an exact 114-migration root across isolated databases", () => {
    const source = readFileSync(runnerPath, "utf8");

    expect(source).toContain("PRE115_MIGRATION_COUNT = 114");
    expect(source).toContain(
      'REQUEST_MIGRATION =\n  "20260802010000_project_financing_quota_request_idempotency"'
    );
    expect(source).toContain(
      'PRE115_TERMINAL_MIGRATION =\n  "20260728161000_spot_procurement_application_revision_status"'
    );
    expect(source).toContain("preparePre115MigrationRoot");
    expect(source).toContain("entry.name >= REQUEST_MIGRATION");
    expect(source).toContain("verifyPre115MigrationProof");
    expect(source).toContain("appliedPre115MigrationCount");
    expect(source).toContain("pre115TerminalMigrationCount");
    expect(source.match(/await verifyPre115MigrationProof\(/gu) ?? [])
      .toHaveLength(2);
    expect(source).toContain("verifyPre115RetainedMigrations");
    expect(source.indexOf("await verifyPre115RetainedMigrations({"))
      .toBeLessThan(source.indexOf("await verifyLegacyUpgrade({"));

    for (const databaseName of [
      "jiangkong_project_financing_quota_pre115_clean",
      "jiangkong_project_financing_quota_pre115_duplicate",
      "jiangkong_project_financing_quota_pre115_cross_business",
      "jiangkong_project_financing_quota_pre115_replacement_child",
      "jiangkong_project_financing_quota_pre115_replacement_parent"
    ]) {
      expect(source).toContain(databaseName);
    }
    for (const scenario of [
      'kind: "duplicate"',
      'kind: "cross_business"',
      'kind: "replacement_child"',
      'kind: "replacement_parent"'
    ]) {
      expect(source).toContain(scenario);
    }
  });

  it("proves every #115 conflict rolls back unchanged and recovers after exact remediation", () => {
    const source = readFileSync(runnerPath, "utf8");

    expect(source).toContain("capturePre115BusinessSnapshot");
    expect(source).toContain("verifyRequestMigrationRollback");
    expect(source).toContain("requestSnapshotColumnCount");
    expect(source).toContain("failedRequestMigrationCount");
    expect(source).toContain("beforeSnapshot");
    expect(source).toContain("afterFailureSnapshot");
    expect(source).toContain("runPrismaResolveRolledBack");
    expect(source).toContain('"--rolled-back"');
    expect(source).toContain("remediatePre115Conflict");
    expect(source).toContain("verifyRecoveredMigrationProof");
    expect(source).toContain('"rolled_back_at" IS NOT NULL');

    expect(source).toContain("project_financing_quota_duplicate_attachment");
    expect(source).toContain("project_financing_quota_cross_business_attachment");
    expect(source).toContain('SET "signatureFileId" = NULL');
    expect(source).toContain('SET "supersedesFileObjectId" = NULL');
    expect(source).toContain("DELETE FROM \"ProjectFinancingQuota\"");
  });

  it("keeps clean historical #115 rows all-null without fabricating request facts", () => {
    const source = readFileSync(runnerPath, "utf8");

    expect(source).toContain("verifyHistoricalRequestSnapshotNull");
    for (const field of [
      "attachmentFileSha256Snapshot",
      "requestedByRoleKey",
      "requestIdempotencyKey",
      "requestFingerprint"
    ]) {
      expect(source).toContain(`"${field}" IS NULL`);
    }
    expect(source).toContain("historicalRequestSnapshotNullCount");
  });

  it("requires a real terminate-versus-allocation PostgreSQL race", () => {
    const proof = readFileSync(
      join(
        process.cwd(),
        "src/database/project-financing-quota-concurrency.spec.ts"
      ),
      "utf8"
    );
    const start = proof.indexOf(
      '"F3 races termination against allocation with exactly one winner"'
    );
    const end = proof.indexOf("\n  integrationTest(", start + 1);
    const race = proof.slice(start, end === -1 ? proof.length : end);

    expect(start).toBeGreaterThanOrEqual(0);
    expect(race).toContain("Promise.allSettled([");
    expect(race).toContain("terminateProjectFinancingQuota(");
    expect(race).toContain("funding.allocateExecution(");
    expect(race).toContain('result.status === "fulfilled"');
    expect(race).toContain('result.status === "rejected"');
    expect(race).toContain("projectFundingAllocation.findMany");
    expect(race).toContain('action: "project.financing_quota.terminate"');
  });

  it("requires all nine #116 terminal coordinates to be mutated independently", () => {
    const proof = readFileSync(
      join(
        process.cwd(),
        "src/database/project-financing-quota-concurrency.spec.ts"
      ),
      "utf8"
    );

    expect(proof).toContain("TERMINATION_IMMUTABLE_MUTATIONS");
    for (const field of [
      "status",
      "terminatedAt",
      "terminatedByUserId",
      "terminationReason",
      "terminationSignatureFileId",
      "terminationSignatureSha256",
      "terminationSignatureVersionId",
      "terminationActionId",
      "terminationRequestFingerprint"
    ]) {
      expect(proof).toContain(`field: "${field}"`);
    }
    expect(proof).toContain("for (const mutation of TERMINATION_IMMUTABLE_MUTATIONS");
    expect(proof).toContain("expect(terminalAfterMutations).toEqual(terminalBeforeMutations)");
  });

  it("requires F1, F2 and F3 Audit rollback to use a real BEFORE INSERT trigger", () => {
    const proof = readFileSync(
      join(
        process.cwd(),
        "src/database/project-financing-quota-concurrency.spec.ts"
      ),
      "utf8"
    );

    expect(proof).toContain("installAuditInsertFailure");
    expect(proof).toContain("dropAuditInsertFailure");
    expect(proof).toContain('BEFORE INSERT ON "AuditLog"');
    expect(proof).toContain("pfq_audit_insert_failure");
    expect(proof).toContain("ERRCODE = 'P0001'");
    expect(proof.match(/await installAuditInsertFailure\(/gu) ?? [])
      .toHaveLength(3);
    expect(proof.match(/await dropAuditInsertFailure\(/gu) ?? [])
      .toHaveLength(3);
    expect(proof).not.toContain("mockRejectedValue");
  });

  it("cleans the exact container and temporary root on signals and finally", () => {
    const source = readFileSync(runnerPath, "utf8");

    expect(source).toContain('process.on("SIGINT"');
    expect(source).toContain('process.on("SIGTERM"');
    expect(source).not.toContain('process.once("SIGINT"');
    expect(source).not.toContain('process.once("SIGTERM"');
    expect(source).toContain("interruptionPromise ??=");
    expect(source).toContain("runInterruption");
    expect(source).toContain("withGuaranteedCleanup");
    expect(source).toContain("containerLifecycle.localDockerValidated = true");
    expect(source).toContain("containerLifecycle.containerRunAttempted = true");
    expect(source).toContain(
      "pinResolvedLocalDockerEndpoint(dockerEnv, context.stdout)"
    );
    expect(source).toContain(
      "dockerEnv.DOCKER_HOST = resolvedDockerEndpoint"
    );
    expect(source).toContain("delete dockerEnv.DOCKER_CONTEXT");
    expect(source).not.toContain("assertLocalDockerEndpoint(context.stdout)");
    expect(source.indexOf("containerLifecycle.localDockerValidated = true"))
      .toBeGreaterThan(
        source.indexOf("pinResolvedLocalDockerEndpoint(dockerEnv, context.stdout)")
      );
    expect(source.indexOf("containerLifecycle.containerRunAttempted = true"))
      .toBeLessThan(source.indexOf('await dockerCommand([\n        "run"'));
    expect(source).toContain('process.removeListener("SIGINT", onSigint)');
    expect(source).toContain('process.removeListener("SIGTERM", onSigterm)');
    expect(source).toContain('["rm", "--force", "--volumes", containerName]');
    expect(source).toContain("recursive: true");
    expect(source).toContain("force: true");
  });

  it.each([
    ["unverified", false, true, 0],
    ["validated but not started", true, false, 0],
    ["validated and run attempted", true, true, 1]
  ] as const)(
    "gates exact idempotent container cleanup when Docker is %s",
    async (
      _state,
      localDockerValidated,
      containerRunAttempted,
      expectedDockerCalls
    ) => {
    const runner = localRequire(runnerPath) as {
      createFinancingQuotaRunnerCleanup: (options: {
        commandRuntime: { stopAll: () => Promise<void> };
        dockerCommand: (
          args: string[],
          options?: Record<string, unknown>
        ) => Promise<unknown>;
        containerName: string;
        containerLifecycle: {
          localDockerValidated: boolean;
          containerRunAttempted: boolean;
        };
        temporaryRoot: string;
        removeTemporaryRoot: (
          path: string,
          options: { recursive: true; force: true }
        ) => Promise<void>;
      }) => () => Promise<void>;
    };
    const stopAll = jest.fn().mockResolvedValue(undefined);
    const dockerCommand = jest.fn().mockResolvedValue({ stdout: "", stderr: "" });
    const removeTemporaryRoot = jest.fn().mockResolvedValue(undefined);
    const cleanup = runner.createFinancingQuotaRunnerCleanup({
      commandRuntime: { stopAll },
      dockerCommand,
      containerName: "jiangkong-pfq-concurrency-exact-test",
      containerLifecycle: {
        localDockerValidated,
        containerRunAttempted
      },
      temporaryRoot: "/tmp/jiangkong-pfq-concurrency-exact-test",
      removeTemporaryRoot
    });

    await cleanup();
    await cleanup();

    expect(stopAll).toHaveBeenCalledTimes(1);
    expect(dockerCommand).toHaveBeenCalledTimes(expectedDockerCalls);
    if (expectedDockerCalls === 1) {
      expect(dockerCommand).toHaveBeenCalledWith(
        ["rm", "--force", "--volumes", "jiangkong-pfq-concurrency-exact-test"],
        { timeoutMs: 60_000 }
      );
    }
    expect(removeTemporaryRoot).toHaveBeenCalledTimes(1);
    expect(removeTemporaryRoot).toHaveBeenCalledWith(
      "/tmp/jiangkong-pfq-concurrency-exact-test",
      { recursive: true, force: true }
    );
    }
  );
});
