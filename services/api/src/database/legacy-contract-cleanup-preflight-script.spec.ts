import { resolve } from "node:path";

const scriptPath = resolve(
  __dirname,
  "../../scripts/inspect-legacy-contract-cleanup-preflight.cjs"
);

describe("legacy contract cleanup preflight", () => {
  it("classifies only confirmed never-submitted abandoned drafts as legacy-authorized", () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const tool = require(scriptPath);

    const report = tool.createReport({
      codeSha: "a".repeat(40),
      databaseFingerprint: "b".repeat(64),
      generatedAt: "2026-08-09T00:00:00.000Z",
      batchId: "legacy-preflight-20260809",
      migrationHead: "20260809150000_contract_retention_policy_timestamptz",
      policyActivatedAt: "2026-08-08T00:00:00.000Z",
      totalRows: "1",
      rows: [
        {
          contractVersionId: "legacy-authorized-version",
          classification: "legacy_abandoned",
          status: "abandoned",
          source: "system",
          changeType: "original",
          versionNo: 1,
          firstSubmittedAt: null,
          approvalInstanceCount: "0",
          approvalActionCount: "0",
          abandonedAt: "2026-06-01T00:00:00.000Z",
          abandonedByUserId: "user-1",
          abandonReason: null,
          holdCount: "0",
          formalBusinessFactCount: "0",
          unknownBindingCount: "0",
          missingFileHashCount: "0",
          inconsistentCoordinateCount: "0",
          exclusiveFileCount: "1",
          sharedFileCount: "1",
          versionCount: "3",
          deleteMarkerCount: "1",
          versionEnumerationFailureCount: "0",
          objectListHash: "c".repeat(64)
        }
      ]
    });

    expect(report).toMatchObject({
      mode: "read_only",
      executionAllowed: false,
      status: "ready",
      policy: {
        activatedAt: "2026-08-08T00:00:00.000Z",
        legacyRetentionStartsAt: "2026-08-08T00:00:00.000Z"
      },
      summary: {
        legacyAuthorizedCandidates: 1,
        exclusiveFileCount: 1,
        sharedFileCount: 1,
        objectVersionCount: 3,
        deleteMarkerCount: 1
      },
      records: [
        {
          contractVersionId: "legacy-authorized-version",
          classification: "legacy_abandoned",
          authorization: "legacy_delete_confirmed",
          status: "candidate",
          objectListHash: "c".repeat(64)
        }
      ]
    });
    expect(() => tool.verifyReport(report)).not.toThrow();
  });

  it("fails closed when an otherwise abandoned draft is not a system-origin original", () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const tool = require(scriptPath);

    const report = tool.createReport({
      codeSha: "a".repeat(40),
      databaseFingerprint: "b".repeat(64),
      generatedAt: "2026-08-09T00:00:00.000Z",
      batchId: "legacy-preflight-20260809-source",
      migrationHead: "20260809150000_contract_retention_policy_timestamptz",
      policyActivatedAt: "2026-08-08T00:00:00.000Z",
      totalRows: "1",
      rows: [{
        contractVersionId: "historical-version",
        status: "abandoned",
        source: "historical",
        changeType: "original",
        versionNo: 1,
        firstSubmittedAt: null,
        approvalInstanceCount: "0",
        approvalActionCount: "0",
        abandonedAt: "2026-06-01T00:00:00.000Z",
        abandonedByUserId: "user-1",
        abandonReason: null,
        holdCount: "0",
        formalBusinessFactCount: "0",
        unknownBindingCount: "0",
        missingFileHashCount: "0",
        inconsistentCoordinateCount: "0",
        exclusiveFileCount: "0",
        sharedFileCount: "0",
        versionCount: "0",
        deleteMarkerCount: "0",
        versionEnumerationFailureCount: "0",
        bucketMismatchCount: "0",
        objectListHash: "c".repeat(64)
      }]
    });

    expect(report).toMatchObject({
      status: "blocked",
      summary: { legacyAuthorizedCandidates: 0, blockingRecords: 1 },
      records: [{
        contractVersionId: "historical-version",
        authorization: "unverified",
        status: "blocking",
        reasons: expect.arrayContaining(["LEGACY_SOURCE_NOT_SYSTEM"])
      }]
    });
  });

  it("marks the reviewed authorization-update audit fact for a separate exception", () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const tool = require(scriptPath);
    const report = tool.createReport({
      codeSha: "a".repeat(40),
      databaseFingerprint: "b".repeat(64),
      generatedAt: "2026-08-09T00:00:00.000Z",
      batchId: "legacy-preflight-audit-exception",
      migrationHead: "20260809150000_contract_retention_policy_timestamptz",
      policyActivatedAt: "2026-08-08T00:00:00.000Z",
      totalRows: "1",
      rows: [{
        contractVersionId: "legacy-audit-exception-version",
        status: "abandoned",
        source: "system",
        changeType: "original",
        versionNo: 1,
        firstSubmittedAt: null,
        approvalInstanceCount: "0",
        approvalActionCount: "0",
        abandonedAt: "2026-06-01T00:00:00.000Z",
        abandonedByUserId: "user-1",
        abandonReason: null,
        holdCount: "0",
        formalBusinessFactCount: "0",
        legacyAuthorizationUpdateAuditCount: "2",
        unknownBindingCount: "0",
        missingFileHashCount: "0",
        inconsistentCoordinateCount: "0",
        exclusiveFileCount: "0",
        sharedFileCount: "0",
        versionCount: "0",
        deleteMarkerCount: "0",
        versionEnumerationFailureCount: "0",
        bucketMismatchCount: "0",
        objectListHash: "c".repeat(64)
      }]
    });

    expect(report).toMatchObject({
      status: "manual_review",
      summary: { legacyAuthorizedCandidates: 0, manualReviewRecords: 1 },
      records: [{
        contractVersionId: "legacy-audit-exception-version",
        status: "manual_review",
        reasons: ["NON_DELETABLE_AUTHORIZATION_AUDIT"],
        legacyAuthorizationUpdateAuditCount: 2
      }]
    });
  });

  it("keeps the database fingerprint opaque and rejects any apply argument", () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const tool = require(scriptPath);
    const fingerprint = tool.databaseFingerprint({
      migrationHead: "20260809150000_contract_retention_policy_timestamptz",
      migrationCount: 124,
      migrationDigest: "c".repeat(64),
      candidateStateHash: "d".repeat(64)
    });
    const report = tool.createReport({
      codeSha: "a".repeat(40),
      databaseFingerprint: fingerprint,
      generatedAt: "2026-08-09T00:00:00.000Z",
      batchId: "legacy-preflight-20260809-opaque",
      migrationHead: "20260809150000_contract_retention_policy_timestamptz",
      policyActivatedAt: "2026-08-08T00:00:00.000Z",
      totalRows: "0",
      rows: []
    });

    expect(fingerprint).toMatch(/^[a-f0-9]{64}$/u);
    expect(JSON.stringify(report)).not.toMatch(
      /DATABASE_URL|postgres:\/\/|host|password|objectKey|contractName|counterparty/iu
    );
    expect(() => tool.parseArgs(["--apply"])).toThrow(/disabled/iu);
    expect(report).toMatchObject({ executionAllowed: false, apply: { status: "disabled" } });
  });

  it("binds the retention-policy ID instead of composing it into unsafe SQL", () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const tool = require(scriptPath);

    const query = tool.checks.policy();
    expect(query).not.toEqual(expect.any(String));
    expect(query.values).toEqual(["contract-ended-retention-v1"]);
  });

  it("restarts ended-application retention from the controlled enablement date", () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const tool = require(scriptPath);

    const report = tool.createReport({
      codeSha: "a".repeat(40),
      databaseFingerprint: "b".repeat(64),
      generatedAt: "2026-08-09T00:00:00.000Z",
      batchId: "legacy-preflight-20260809-retention",
      migrationHead: "20260809150000_contract_retention_policy_timestamptz",
      policyActivatedAt: "2026-08-08T00:00:00.000Z",
      totalRows: "1",
      rows: [{
        contractVersionId: "ended-before-enable",
        status: "approval_rejected",
        source: "system",
        changeType: "original",
        versionNo: 1,
        firstSubmittedAt: "2026-06-01T00:00:00.000Z",
        approvalInstanceCount: "1",
        approvalActionCount: "1",
        abandonedAt: null,
        abandonedByUserId: null,
        abandonReason: null,
        endedAt: "2026-06-02T00:00:00.000Z",
        holdCount: "0",
        formalBusinessFactCount: "0",
        unknownBindingCount: "0",
        missingFileHashCount: "0",
        inconsistentCoordinateCount: "0",
        exclusiveFileCount: "0",
        sharedFileCount: "0",
        versionCount: "0",
        deleteMarkerCount: "0",
        versionEnumerationFailureCount: "0",
        bucketMismatchCount: "0",
        objectListHash: "c".repeat(64)
      }]
    });

    expect(report).toMatchObject({
      status: "ready",
      summary: { retainedRecords: 1, legacyAuthorizedCandidates: 0 },
      records: [{
        classification: "ended_application",
        status: "retained",
        retentionStartsAt: "2026-08-08T00:00:00.000Z"
      }]
    });
  });

  it("keeps every candidate and summary when more than one internal keyset page is needed", () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const tool = require(scriptPath);
    const rows = Array.from({ length: tool.PAGE_SIZE + 1 }, (_, index) => ({
      contractVersionId: `active-draft-${String(index).padStart(4, "0")}`,
      status: "draft",
      source: "system",
      changeType: "original",
      versionNo: 1,
      firstSubmittedAt: null,
      approvalInstanceCount: "0",
      approvalActionCount: "0",
      abandonedAt: null,
      abandonedByUserId: null,
      abandonReason: null,
      holdCount: "0",
      formalBusinessFactCount: "0",
      unknownBindingCount: "0",
      missingFileHashCount: "0",
      inconsistentCoordinateCount: "0",
      exclusiveFileCount: "0",
      sharedFileCount: "0",
      versionCount: "0",
      deleteMarkerCount: "0",
      versionEnumerationFailureCount: "0",
      bucketMismatchCount: "0",
      objectListHash: "c".repeat(64)
    }));

    const report = tool.createReport({
      codeSha: "a".repeat(40),
      databaseFingerprint: "b".repeat(64),
      generatedAt: "2026-08-09T00:00:00.000Z",
      batchId: "legacy-preflight-20260809-all-pages",
      migrationHead: "20260809150000_contract_retention_policy_timestamptz",
      policyActivatedAt: "2026-08-08T00:00:00.000Z",
      totalRows: String(rows.length),
      rows
    });

    expect(report).toMatchObject({
      status: "manual_review",
      page: {
        pageSize: tool.PAGE_SIZE,
        totalRows: tool.PAGE_SIZE + 1,
        returnedRows: tool.PAGE_SIZE + 1,
        pageCount: 2,
        traversal: "internal_keyset_complete"
      },
      summary: { manualReviewRecords: tool.PAGE_SIZE + 1 }
    });
    expect(report.records).toHaveLength(tool.PAGE_SIZE + 1);
    expect(report.blockers).not.toContain("REPORT_TRUNCATED");
  });

  it("walks all internal keyset pages inside one read-only transaction", async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const tool = require(scriptPath);
    const rows = Array.from({ length: tool.PAGE_SIZE + 1 }, (_, index) => ({
      contractVersionId: `active-draft-${String(index).padStart(4, "0")}`,
      status: "draft",
      source: "system",
      changeType: "original",
      versionNo: 1,
      firstSubmittedAt: null,
      abandonedAt: null,
      abandonedByUserId: null,
      abandonReason: null,
      endedAt: null,
      effectiveAt: null,
      approvalInstanceCount: "0",
      approvalActionCount: "0",
      holdCount: "0",
      formalBusinessFactCount: "0",
      inconsistentCoordinateCount: "0"
    }));
    const originalDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = "postgresql://redacted.local/test";
    const transaction = {
      $executeRawUnsafe: jest.fn(),
      $queryRawUnsafe: jest.fn((query: string) => {
        if (query === tool.checks.migrationHead) {
          return [{ migrationHead: "20260809150000_contract_retention_policy_timestamptz" }];
        }
        if (query === tool.checks.migrationBaseline) {
          return [{ migrationName: "20260809150000_contract_retention_policy_timestamptz", checksum: "x" }];
        }
        if (query === tool.checks.candidateCount) return [{ count: String(rows.length) }];
        throw new Error(`unexpected unsafe query: ${query}`);
      }),
      $queryRaw: jest.fn((query: { values: unknown[] }) => {
        if (query.values.length === 1) {
          return [{ activatedAt: new Date("2026-08-08T00:00:00.000Z") }];
        }
        const afterContractVersionId = String(query.values[0]);
        return rows
          .filter((row) => row.contractVersionId > afterContractVersionId)
          .slice(0, tool.PAGE_SIZE);
      })
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (tx: typeof transaction) => Promise<unknown>) =>
        callback(transaction)
      )
    };

    try {
      const report = await tool.inspectWithClient(prisma, {
        now: new Date("2026-08-09T00:00:00.000Z"),
        codeSha: "a".repeat(40),
        storage: null
      });

      const keysetQueries = transaction.$queryRaw.mock.calls
        .map(([query]) => query as { values: unknown[] })
        .filter((query) => query.values.length === 2);
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(transaction.$executeRawUnsafe).toHaveBeenNthCalledWith(1, "SET TRANSACTION READ ONLY");
      expect(keysetQueries.map((query) => query.values[0])).toEqual([
        "",
        "active-draft-0499"
      ]);
      expect(report.records).toHaveLength(tool.PAGE_SIZE + 1);
      expect(report.summary.manualReviewRecords).toBe(tool.PAGE_SIZE + 1);
      expect(report.blockers).not.toContain("REPORT_TRUNCATED");
    } finally {
      if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = originalDatabaseUrl;
    }
  });

  it("fails closed instead of emitting a partial report when one keyset page fails", async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const tool = require(scriptPath);
    const originalDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = "postgresql://redacted.local/test";
    const transaction = {
      $executeRawUnsafe: jest.fn(),
      $queryRawUnsafe: jest.fn((query: string) => {
        if (query === tool.checks.migrationHead) {
          return [{ migrationHead: "20260809150000_contract_retention_policy_timestamptz" }];
        }
        if (query === tool.checks.migrationBaseline) {
          return [{ migrationName: "20260809150000_contract_retention_policy_timestamptz", checksum: "x" }];
        }
        if (query === tool.checks.candidateCount) return [{ count: "1" }];
        throw new Error(`unexpected unsafe query: ${query}`);
      }),
      $queryRaw: jest.fn((query: { values: unknown[] }) => {
        if (query.values.length === 1) {
          return [{ activatedAt: new Date("2026-08-08T00:00:00.000Z") }];
        }
        throw new Error("keyset page unavailable");
      })
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (tx: typeof transaction) => Promise<unknown>) =>
        callback(transaction)
      )
    };

    try {
      await expect(tool.inspectWithClient(prisma, {
        now: new Date("2026-08-09T00:00:00.000Z"),
        codeSha: "a".repeat(40),
        storage: null
      })).rejects.toThrow("keyset page unavailable");
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    } finally {
      if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = originalDatabaseUrl;
    }
  });
});
