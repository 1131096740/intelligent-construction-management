/* eslint-disable @typescript-eslint/no-var-requires */

const executor = require("../../scripts/execute-legacy-contract-cleanup.cjs") as {
  expectedConfirmation(batchId: string): string;
  parseArgs(argv: string[]): Record<string, unknown>;
  verifyExecutionReport(report: Record<string, unknown>, options: {
    currentCodeSha: string;
    expectedReportSha256: string;
    expectedDatabaseFingerprint: string;
    batchId: string;
    candidateIds: string[];
    confirmation: string;
  }): void;
  selectAuthorizedCandidateIds(report: Record<string, unknown>): string[];
};

describe("legacy contract cleanup executor gates", () => {
  it("requires an explicit two-candidate allowlist and exact confirmation", () => {
    expect(() => executor.parseArgs([
      "--apply",
      "--report",
      "/tmp/report.json",
      "--batch-id",
      "legacy-cleanup-a1",
      "--candidate-id",
      "candidate-a",
      "--candidate-id",
      "candidate-b",
      "--expected-database-fingerprint",
      "a".repeat(64),
      "--expected-report-sha256",
      "b".repeat(64),
      "--confirm",
      "EXECUTE_LEGACY_CONTRACT_CLEANUP_legacy-cleanup-a1"
    ])).not.toThrow();

    expect(() => executor.parseArgs([
      "--apply",
      "--report",
      "/tmp/report.json",
      "--batch-id",
      "legacy-cleanup-a1",
      "--candidate-id",
      "candidate-a",
      "--expected-database-fingerprint",
      "a".repeat(64),
      "--expected-report-sha256",
      "b".repeat(64),
      "--confirm",
      "EXECUTE_LEGACY_CONTRACT_CLEANUP_legacy-cleanup-a1"
    ])).toThrow(/exactly two candidate IDs/u);
  });

  it("never selects manual-review or blocking records", () => {
    const report = {
      records: [
        { contractVersionId: "candidate-a", status: "candidate" },
        { contractVersionId: "manual-a", status: "manual_review" },
        { contractVersionId: "blocked-a", status: "blocking" }
      ]
    };
    expect(executor.selectAuthorizedCandidateIds(report)).toEqual(["candidate-a"]);
  });

  it("rejects a report whose candidate set or confirmation has drifted", () => {
    const body = {
      schemaVersion: 1,
      mode: "read_only",
      executionAllowed: false,
      apply: { status: "disabled" },
      codeSha: "c".repeat(40),
      databaseFingerprint: "d".repeat(64),
      batchId: "legacy-preflight-a1",
      summary: { legacyAuthorizedCandidates: 2 },
      records: [
        { contractVersionId: "candidate-a", classification: "legacy_abandoned", status: "candidate" },
        { contractVersionId: "candidate-b", classification: "legacy_abandoned", status: "candidate" },
        { contractVersionId: "blocked-a", classification: "ended_application", status: "blocking" }
      ]
    };
    const crypto = require("node:crypto") as typeof import("node:crypto");
    const preflight = require("../../scripts/inspect-legacy-contract-cleanup-preflight.cjs") as {
      canonicalize(value: unknown): unknown;
    };
    const report = {
      ...body,
      reportSha256: crypto
        .createHash("sha256")
        .update(JSON.stringify(preflight.canonicalize(body)))
        .digest("hex")
    };
    expect(() => executor.verifyExecutionReport(report, {
      currentCodeSha: body.codeSha,
      expectedReportSha256: report.reportSha256,
      expectedDatabaseFingerprint: body.databaseFingerprint,
      batchId: "legacy-cleanup-a1",
      candidateIds: ["candidate-a", "candidate-b"],
      confirmation: executor.expectedConfirmation("legacy-cleanup-a1")
    })).toThrow(/report status must be ready or blocked only after explicit candidate allowlist/u);
  });
});
