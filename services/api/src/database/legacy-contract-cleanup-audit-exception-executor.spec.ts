/* eslint-disable @typescript-eslint/no-var-requires */

export {};

const executor = require("../../scripts/execute-legacy-contract-cleanup-audit-exception.cjs") as {
  EXPECTED_AUDIT_ACTION: string;
  expectedConfirmation(batchId: string): string;
  parseArgs(argv: string[]): Record<string, unknown>;
  findExceptionRecord(
    report: Record<string, unknown>,
    candidateId: string,
    expectedAuditCount: number
  ): Record<string, unknown>;
  verifyExecutionReport(report: Record<string, unknown>, options: Record<string, unknown>): void;
};

describe("legacy cleanup audit exception executor gates", () => {
  const reportBody = {
    schemaVersion: 1,
    mode: "read_only",
    executionAllowed: false,
    apply: { status: "disabled" },
    codeSha: "a".repeat(40),
    databaseFingerprint: "b".repeat(64),
    batchId: "legacy-preflight-audit-a1",
    status: "manual_review",
    summary: { legacyAuthorizedCandidates: 0, manualReviewRecords: 2 },
    records: [
      {
        contractVersionId: "reviewed-version",
        classification: "legacy_abandoned",
        authorization: "legacy_delete_confirmed",
        status: "manual_review",
        reasons: ["NON_DELETABLE_AUTHORIZATION_AUDIT"],
        legacyAuthorizationUpdateAuditCount: 2
      },
      {
        contractVersionId: "active-version",
        classification: "active_draft",
        authorization: "separate_user_confirmation_required",
        status: "manual_review",
        reasons: ["ACTIVE_DRAFT_IS_NEVER_AUTOMATICALLY_SELECTED"],
        legacyAuthorizationUpdateAuditCount: 0
      }
    ]
  };

  function signedReport() {
    const preflight = require("../../scripts/inspect-legacy-contract-cleanup-preflight.cjs") as {
      canonicalize(value: unknown): unknown;
    };
    const crypto = require("node:crypto") as typeof import("node:crypto");
    return {
      ...reportBody,
      reportSha256: crypto
        .createHash("sha256")
        .update(JSON.stringify(preflight.canonicalize(reportBody)))
        .digest("hex")
    };
  }

  it("accepts only the reviewed action/count and exact confirmation", () => {
    const report = signedReport();
    expect(executor.findExceptionRecord(report, "reviewed-version", 2)).toMatchObject({
      contractVersionId: "reviewed-version"
    });
    expect(() => executor.verifyExecutionReport(report, {
      currentCodeSha: reportBody.codeSha,
      expectedReportSha256: report.reportSha256,
      expectedDatabaseFingerprint: reportBody.databaseFingerprint,
      batchId: "legacy-audit-a1",
      candidateId: "reviewed-version",
      expectedAuditCount: 2,
      confirmation: executor.expectedConfirmation("legacy-audit-a1")
    })).not.toThrow();
    expect(executor.EXPECTED_AUDIT_ACTION).toBe("contract.authorization.update");
  });

  it("rejects candidate drift, count drift, and ordinary confirmation strings", () => {
    const report = signedReport();
    expect(() => executor.findExceptionRecord(report, "reviewed-version", 1)).toThrow();
    expect(() => executor.verifyExecutionReport(report, {
      currentCodeSha: reportBody.codeSha,
      expectedReportSha256: report.reportSha256,
      expectedDatabaseFingerprint: reportBody.databaseFingerprint,
      batchId: "legacy-audit-a1",
      candidateId: "reviewed-version",
      expectedAuditCount: 2,
      confirmation: "EXECUTE_LEGACY_CONTRACT_CLEANUP_legacy-audit-a1"
    })).toThrow(/确认串/u);
    expect(() => executor.parseArgs([
      "--apply",
      "--report", "/tmp/report.json",
      "--batch-id", "legacy-audit-a1",
      "--candidate-id", "reviewed-version",
      "--expected-audit-count", "11",
      "--expected-database-fingerprint", "b".repeat(64),
      "--expected-report-sha256", "c".repeat(64),
      "--confirm", executor.expectedConfirmation("legacy-audit-a1")
    ])).toThrow(/1-10/u);
  });
});
