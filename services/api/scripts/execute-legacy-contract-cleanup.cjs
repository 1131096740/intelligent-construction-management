#!/usr/bin/env node
"use strict";
/* eslint-disable @typescript-eslint/no-var-requires */

/**
 * Explicit production executor for the two legacy abandoned candidates from
 * Issue #19's read-only preflight. This is intentionally narrower than the
 * generic ended-application batch: it accepts exactly two candidate IDs and
 * requires a fresh, exact report plus a separate confirmation string.
 */

const { execFileSync } = require("node:child_process");
const { readFileSync } = require("node:fs");
const crypto = require("node:crypto");
const { PrismaClient } = require("@prisma/client");
const preflight = require("./inspect-legacy-contract-cleanup-preflight.cjs");

const EXPECTED_CANDIDATE_COUNT = 2;

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
  return `EXECUTE_LEGACY_CONTRACT_CLEANUP_${batchId}`;
}

function currentCodeSha() {
  return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" })
    .trim()
    .toLowerCase();
}

function parseArgs(argv) {
  const parsed = {
    apply: false,
    candidateIds: [],
    help: false
  };
  const valueOptions = new Set([
    "--report",
    "--batch-id",
    "--expected-database-fingerprint",
    "--expected-report-sha256",
    "--confirm",
    "--candidate-id"
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
    if (key === "--candidate-id") {
      parsed.candidateIds.push(value);
    } else {
      const field = {
        "--report": "reportPath",
        "--batch-id": "batchId",
        "--expected-database-fingerprint": "expectedDatabaseFingerprint",
        "--expected-report-sha256": "expectedReportSha256",
        "--confirm": "confirmation"
      }[key];
      parsed[field] = value;
    }
  }
  if (parsed.help) return parsed;
  invariant(parsed.apply, "必须显式提供 --apply；默认不执行生产清理");
  invariant(typeof parsed.reportPath === "string", "必须提供 --report");
  invariant(
    typeof parsed.batchId === "string" && /^[a-z0-9][a-z0-9._-]{2,79}$/iu.test(parsed.batchId),
    "batchId 无效"
  );
  invariant(
    parsed.candidateIds.length === EXPECTED_CANDIDATE_COUNT,
    `必须提供 exactly two candidate IDs（实际 ${parsed.candidateIds.length}）`
  );
  invariant(
    new Set(parsed.candidateIds).size === parsed.candidateIds.length,
    "candidate IDs 不能重复"
  );
  invariant(/^[a-f0-9]{64}$/u.test(parsed.expectedDatabaseFingerprint ?? ""),
    "必须提供 64 位数据库 fingerprint");
  invariant(/^[a-f0-9]{64}$/u.test(parsed.expectedReportSha256 ?? ""),
    "必须提供 64 位报告 SHA-256");
  invariant(
    parsed.confirmation === expectedConfirmation(parsed.batchId),
    `确认串必须精确为 ${expectedConfirmation(parsed.batchId)}`
  );
  return parsed;
}

function readReport(reportPath) {
  const report = JSON.parse(readFileSync(reportPath, "utf8"));
  preflight.verifyReport(report);
  return report;
}

function selectAuthorizedCandidateIds(report) {
  return (Array.isArray(report?.records) ? report.records : [])
    .filter((record) => record.status === "candidate")
    .map((record) => record.contractVersionId)
    .filter((id) => typeof id === "string" && id.length > 0)
    .sort();
}

function sortedIds(ids) {
  return [...ids].sort();
}

function assertSameIds(expected, actual, message) {
  invariant(
    JSON.stringify(sortedIds(expected)) === JSON.stringify(sortedIds(actual)),
    message
  );
}

function verifyExecutionReport(report, options) {
  preflight.verifyReport(report);
  invariant(
    report.status === "ready" || report.status === "blocked",
    "report status must be ready or blocked only after explicit candidate allowlist"
  );
  invariant(report.codeSha === options.currentCodeSha,
    "报告 code SHA 与当前执行代码不同");
  invariant(report.reportSha256 === options.expectedReportSha256,
    "报告 SHA-256 与预期不同");
  invariant(report.databaseFingerprint === options.expectedDatabaseFingerprint,
    "报告 database fingerprint 与预期不同");
  invariant(options.confirmation === expectedConfirmation(options.batchId),
    "生产清理确认串不匹配");
  const authorizedIds = selectAuthorizedCandidateIds(report);
  assertSameIds(
    authorizedIds,
    options.candidateIds,
    "报告 candidate 集合与显式生产授权不完全一致"
  );
  invariant(
    authorizedIds.length === EXPECTED_CANDIDATE_COUNT &&
      report.summary?.legacyAuthorizedCandidates === EXPECTED_CANDIDATE_COUNT,
    "报告没有恰好两条 legacy authorized candidate"
  );
  for (const record of report.records ?? []) {
    if (authorizedIds.includes(record.contractVersionId)) {
      invariant(
        record.classification === "legacy_abandoned" &&
          record.authorization === "legacy_delete_confirmed" &&
          record.status === "candidate" &&
          (!record.reasons || record.reasons.length === 0),
        "显式候选包含阻断事实，拒绝执行"
      );
    }
  }
}

function assertFreshReportMatches(original, fresh, candidateIds) {
  invariant(fresh.codeSha === original.codeSha, "新鲜预检 code SHA 已漂移");
  invariant(fresh.migrationHead === original.migrationHead, "新鲜预检 migration head 已漂移");
  invariant(sha256(fresh.policy) === sha256(original.policy), "新鲜预检保留策略已漂移");
  invariant(
    fresh.databaseFingerprint === original.databaseFingerprint,
    "新鲜预检 database fingerprint 已漂移"
  );
  invariant(
    sha256(fresh.records) === sha256(original.records),
    "新鲜预检候选状态或文件清单已漂移"
  );
  invariant(
    sha256(fresh.summary) === sha256(original.summary) &&
      fresh.objectManifestHash === original.objectManifestHash,
    "新鲜预检对象/汇总清单已漂移"
  );
  assertSameIds(selectAuthorizedCandidateIds(fresh), candidateIds,
    "新鲜预检 candidate 集合与授权不一致");
}

async function execute({ prisma, candidateIds, batchId, now }) {
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
  return service.purgeLegacyAuthorizedApplications(candidateIds, batchId, now);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(
      "apply: node execute-legacy-contract-cleanup.cjs --apply --report <file> " +
      "--batch-id <id> --candidate-id <id> --candidate-id <id> " +
      "--expected-database-fingerprint <sha> --expected-report-sha256 <sha> " +
      "--confirm EXECUTE_LEGACY_CONTRACT_CLEANUP_<id>\n"
    );
    return;
  }
  const report = readReport(args.reportPath);
  const codeSha = currentCodeSha();
  verifyExecutionReport(report, {
    currentCodeSha: codeSha,
    expectedReportSha256: args.expectedReportSha256,
    expectedDatabaseFingerprint: args.expectedDatabaseFingerprint,
    batchId: args.batchId,
    candidateIds: args.candidateIds,
    confirmation: args.confirmation
  });

  const prisma = new PrismaClient();
  try {
    const freshReport = await preflight.inspectWithClient(prisma, { codeSha });
    verifyExecutionReport(freshReport, {
      currentCodeSha: codeSha,
      expectedReportSha256: freshReport.reportSha256,
      expectedDatabaseFingerprint: report.databaseFingerprint,
      batchId: args.batchId,
      candidateIds: args.candidateIds,
      confirmation: args.confirmation
    });
    assertFreshReportMatches(report, freshReport, args.candidateIds);
    const results = await execute({
      prisma,
      candidateIds: args.candidateIds,
      batchId: args.batchId,
      now: new Date()
    });
    const receipt = {
      status: results.every((result) => result.status === "completed") ? "completed" : "retryable",
      codeSha,
      reportSha256: args.expectedReportSha256,
      databaseFingerprint: args.expectedDatabaseFingerprint,
      batchId: args.batchId,
      candidateIds: args.candidateIds,
      results
    };
    process.stdout.write(`${JSON.stringify(receipt)}\n`);
    if (receipt.status !== "completed") process.exitCode = 2;
  } finally {
    await prisma.$disconnect();
  }
}

module.exports = {
  EXPECTED_CANDIDATE_COUNT,
  expectedConfirmation,
  parseArgs,
  selectAuthorizedCandidateIds,
  verifyExecutionReport,
  assertFreshReportMatches
};

if (require.main === module) {
  main().catch(() => {
    process.stderr.write("Legacy contract cleanup was blocked safely; no changes were made.\n");
    process.exitCode = 1;
  });
}
