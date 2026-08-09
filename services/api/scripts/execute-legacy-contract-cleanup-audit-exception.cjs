#!/usr/bin/env node
"use strict";
/* eslint-disable @typescript-eslint/no-var-requires */

/**
 * One-off production executor for the manually reviewed legacy authorization
 * audit exception. It is intentionally separate from the ordinary two-candidate
 * executor so an audit deletion can never be smuggled into the normal allowlist.
 */

const { execFileSync } = require("node:child_process");
const { readFileSync } = require("node:fs");
const crypto = require("node:crypto");
const { PrismaClient } = require("@prisma/client");
const preflight = require("./inspect-legacy-contract-cleanup-preflight.cjs");

const EXPECTED_AUDIT_BUSINESS_TYPE = "contract_version";
const EXPECTED_AUDIT_ACTION = "contract.authorization.update";
const EXPECTED_MAX_AUDIT_COUNT = 10;

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function sha256(value) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(preflight.canonicalize(value)))
    .digest("hex");
}

function expectedConfirmation(batchId) {
  return `EXECUTE_LEGACY_CONTRACT_CLEANUP_AUDIT_EXCEPTION_${batchId}`;
}

function currentCodeSha() {
  return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" })
    .trim()
    .toLowerCase();
}

function parseArgs(argv) {
  const parsed = { apply: false, help: false };
  const valueOptions = new Set([
    "--report",
    "--batch-id",
    "--candidate-id",
    "--expected-database-fingerprint",
    "--expected-report-sha256",
    "--expected-audit-count",
    "--confirm"
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--apply") {
      parsed.apply = true;
      continue;
    }
    if (argument === "--help" || argument === "-h") {
      parsed.help = true;
      continue;
    }
    const [key, inlineValue] = argument.split("=", 2);
    invariant(valueOptions.has(key), `不支持的参数：${argument}`);
    const value = inlineValue ?? argv[index + 1];
    invariant(value && !value.startsWith("--"), `参数 ${key} 缺少值`);
    if (inlineValue === undefined) index += 1;
    const field = {
      "--report": "reportPath",
      "--batch-id": "batchId",
      "--candidate-id": "candidateId",
      "--expected-database-fingerprint": "expectedDatabaseFingerprint",
      "--expected-report-sha256": "expectedReportSha256",
      "--expected-audit-count": "expectedAuditCount",
      "--confirm": "confirmation"
    }[key];
    parsed[field] = value;
  }
  if (parsed.help) return parsed;
  invariant(parsed.apply, "必须显式提供 --apply；默认不执行生产清理");
  invariant(typeof parsed.reportPath === "string", "必须提供 --report");
  invariant(
    typeof parsed.batchId === "string" && /^[a-z0-9][a-z0-9._-]{2,79}$/iu.test(parsed.batchId),
    "batchId 无效"
  );
  invariant(typeof parsed.candidateId === "string" && parsed.candidateId.trim(),
    "必须提供唯一的 --candidate-id");
  invariant(/^[a-f0-9]{64}$/u.test(parsed.expectedDatabaseFingerprint ?? ""),
    "必须提供 64 位数据库 fingerprint");
  invariant(/^[a-f0-9]{64}$/u.test(parsed.expectedReportSha256 ?? ""),
    "必须提供 64 位报告 SHA-256");
  const expectedAuditCount = Number(parsed.expectedAuditCount);
  invariant(
    Number.isInteger(expectedAuditCount) && expectedAuditCount >= 1 &&
      expectedAuditCount <= EXPECTED_MAX_AUDIT_COUNT,
    `expected-audit-count 必须是 1-${EXPECTED_MAX_AUDIT_COUNT} 的整数`
  );
  parsed.expectedAuditCount = expectedAuditCount;
  invariant(parsed.confirmation === expectedConfirmation(parsed.batchId),
    `确认串必须精确为 ${expectedConfirmation(parsed.batchId)}`);
  return parsed;
}

function readReport(reportPath) {
  const report = JSON.parse(readFileSync(reportPath, "utf8"));
  preflight.verifyReport(report);
  return report;
}

function findExceptionRecord(report, candidateId, expectedAuditCount) {
  const record = (report.records ?? []).find(
    (item) => item.contractVersionId === candidateId
  );
  invariant(record, "报告中不存在显式候选版本");
  invariant(
    record.classification === "legacy_abandoned" &&
      record.authorization === "legacy_delete_confirmed" &&
      record.status === "manual_review" &&
      record.legacyAuthorizationUpdateAuditCount === expectedAuditCount &&
      Array.isArray(record.reasons) &&
      record.reasons.length === 1 &&
      record.reasons[0] === "NON_DELETABLE_AUTHORIZATION_AUDIT",
    "报告不是该受控授权更新审计例外的精确形态"
  );
  return record;
}

function verifyExecutionReport(report, options) {
  preflight.verifyReport(report);
  invariant(report.codeSha === options.currentCodeSha, "报告 code SHA 与当前执行代码不同");
  invariant(report.reportSha256 === options.expectedReportSha256, "报告 SHA-256 与预期不同");
  invariant(
    report.databaseFingerprint === options.expectedDatabaseFingerprint,
    "报告 database fingerprint 与预期不同"
  );
  invariant(options.confirmation === expectedConfirmation(options.batchId), "生产清理确认串不匹配");
  invariant(
    !(report.records ?? []).some((record) => record.status === "candidate"),
    "报告出现未授权的普通 candidate，拒绝单记录审计例外"
  );
  findExceptionRecord(report, options.candidateId, options.expectedAuditCount);
}

function assertFreshReportMatches(original, fresh, options) {
  invariant(fresh.codeSha === original.codeSha, "新鲜预检 code SHA 已漂移");
  invariant(fresh.migrationHead === original.migrationHead, "新鲜预检 migration head 已漂移");
  invariant(sha256(fresh.policy) === sha256(original.policy), "新鲜预检保留策略已漂移");
  invariant(
    fresh.databaseFingerprint === original.databaseFingerprint,
    "新鲜预检 database fingerprint 已漂移"
  );
  invariant(sha256(fresh.records) === sha256(original.records), "新鲜预检记录或文件清单已漂移");
  invariant(
    sha256(fresh.summary) === sha256(original.summary) &&
      fresh.objectManifestHash === original.objectManifestHash,
    "新鲜预检对象/汇总清单已漂移"
  );
  findExceptionRecord(fresh, options.candidateId, options.expectedAuditCount);
}

async function execute({ prisma, candidateId, batchId, expectedAuditCount, now }) {
  const { FileCleanupSeamService } = require("../dist/file/file-cleanup-seam.service");
  const {
    ContractEndedApplicationPurgeService
  } = require("../dist/contract-ended-purge/contract-ended-application-purge.service");
  const { CosVersionedObjectStorage } = require("../dist/file/versioned-object-storage");
  const service = new ContractEndedApplicationPurgeService(
    prisma,
    new FileCleanupSeamService(prisma),
    new CosVersionedObjectStorage()
  );
  return service.purgeLegacyAuthorizedApplicationWithAuditException(
    candidateId,
    batchId,
    {
      businessType: EXPECTED_AUDIT_BUSINESS_TYPE,
      action: EXPECTED_AUDIT_ACTION,
      expectedCount: expectedAuditCount
    },
    now
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(
      "apply: node execute-legacy-contract-cleanup-audit-exception.cjs --apply " +
      "--report <file> --batch-id <id> --candidate-id <id> " +
      "--expected-audit-count <n> --expected-database-fingerprint <sha> " +
      "--expected-report-sha256 <sha> " +
      "--confirm EXECUTE_LEGACY_CONTRACT_CLEANUP_AUDIT_EXCEPTION_<id>\n"
    );
    return;
  }
  const report = readReport(args.reportPath);
  const codeSha = currentCodeSha();
  const options = {
    currentCodeSha: codeSha,
    expectedReportSha256: args.expectedReportSha256,
    expectedDatabaseFingerprint: args.expectedDatabaseFingerprint,
    batchId: args.batchId,
    candidateId: args.candidateId,
    expectedAuditCount: args.expectedAuditCount,
    confirmation: args.confirmation
  };
  verifyExecutionReport(report, options);

  const prisma = new PrismaClient();
  try {
    const freshReport = await preflight.inspectWithClient(prisma, { codeSha });
    assertFreshReportMatches(report, freshReport, options);
    const result = await execute({
      prisma,
      candidateId: args.candidateId,
      batchId: args.batchId,
      expectedAuditCount: args.expectedAuditCount,
      now: new Date()
    });
    const receipt = {
      status: result.status === "completed" ? "completed" : result.status,
      codeSha,
      reportSha256: args.expectedReportSha256,
      databaseFingerprint: args.expectedDatabaseFingerprint,
      batchId: args.batchId,
      candidateId: args.candidateId,
      auditException: {
        businessType: EXPECTED_AUDIT_BUSINESS_TYPE,
        action: EXPECTED_AUDIT_ACTION,
        expectedCount: args.expectedAuditCount
      },
      result
    };
    process.stdout.write(`${JSON.stringify(receipt)}\n`);
    if (receipt.status !== "completed") process.exitCode = 2;
  } finally {
    await prisma.$disconnect();
  }
}

module.exports = {
  EXPECTED_AUDIT_BUSINESS_TYPE,
  EXPECTED_AUDIT_ACTION,
  expectedConfirmation,
  parseArgs,
  findExceptionRecord,
  verifyExecutionReport,
  assertFreshReportMatches
};

if (require.main === module) {
  main().catch(() => {
    process.stderr.write("Legacy contract audit exception cleanup was blocked safely; no changes were made.\n");
    process.exitCode = 1;
  });
}
