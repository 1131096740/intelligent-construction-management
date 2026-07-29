import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

type ReadinessRecord = {
  contractVersionId: string;
  status: "ready" | "manual_review" | "blocking";
  facts: {
    draftRevision: number;
    hasPendingOrApprovedUnpaid: boolean;
  };
  reasons: string[];
};

type TransitionModule = {
  parseArgs(argv: string[]): Record<string, unknown>;
  normalizeLockedRow(row: Record<string, unknown>): Record<string, unknown>;
  assertApplyGates(input: {
    args: Record<string, unknown>;
    report: Record<string, unknown>;
    currentDatabaseFingerprint: string;
    now: Date;
  }): void;
  executeTransition(input: {
    store: {
      lockAndRecompute: (ids: string[]) => Promise<Array<Record<string, unknown>>>;
      findCompletedIds: (batchId: string, ids: string[]) => Promise<string[]>;
      applyRecord: (
        record: Record<string, unknown>,
        context: Record<string, unknown>
      ) => Promise<number>;
    };
    report: Record<string, unknown>;
    batchId: string;
    actorUserId: string;
    now: Date;
  }): Promise<Record<string, unknown>>;
  runApplyWithClient(input: {
    prisma: {
      $transaction: (
        callback: (tx: unknown) => Promise<unknown>,
        options: Record<string, unknown>
      ) => Promise<unknown>;
    };
    report: Record<string, unknown>;
    batchId: string;
    actorUserId: string;
    now: Date;
    createStore: (tx: unknown) => {
      lockAndRecompute: (ids: string[]) => Promise<Array<Record<string, unknown>>>;
      findCompletedIds: (batchId: string, ids: string[]) => Promise<string[]>;
      applyRecord: (
        record: Record<string, unknown>,
        context: Record<string, unknown>
      ) => Promise<number>;
    };
  }): Promise<Record<string, unknown>>;
};

const requireFromHere = createRequire(__filename);
const transitionPath = resolve(
  __dirname,
  "../../prisma/transition-contract-draft-aggregate.cjs"
);
const readinessPath = resolve(
  __dirname,
  "../../scripts/inspect-contract-draft-aggregate-readiness.cjs"
);
const gateNow = new Date("2026-07-29T00:10:00.000Z");
const actorUserId = "seed-user-contract-director";

function loadTransition(): TransitionModule {
  return requireFromHere(transitionPath) as TransitionModule;
}

function createReport(
  records: ReadinessRecord[],
  fingerprint = "a".repeat(64)
): Record<string, unknown> {
  const readiness = requireFromHere(readinessPath) as {
    createReport: (input: Record<string, unknown>) => Record<string, unknown>;
  };
  const rows = records.map((record) => ({
    contractVersionId: record.contractVersionId,
    versionStatus: "draft",
    draftRevision: record.facts.draftRevision,
    billCount: "1",
    partyCount: "1",
    attachmentCount: "0",
    latestGeneratedRevision: null,
    checkpointChangedAfterCreation: false,
    approvalInstanceCount: "0",
    earliestApprovalCreatedAt: null,
    firstSubmittedAt: null,
    formalCode: null,
    abandonedAt: null,
    takeoverId: null,
    takeoverActivatedAt: null,
    takeoverStatus: null,
    oldContractConfirmedAt: null,
    oldFinanceConfirmedAt: null,
    contractFactsCount: "0",
    financeFactsCount: "0",
    historicalPaidCents: "0",
    itemizedHistoricalPaidCents: "0",
    historicalPaymentCount: "0",
    historicalVoucherCount: "0",
    historicalApprovalPendingPaymentCents:
      record.facts.hasPendingOrApprovedUnpaid ? "1" : "0",
    historicalApprovedPendingPaymentCents: "0",
    performanceStatus: null,
    settlementClosedAt: null,
    finalSettlementId: null
  }));
  return readiness.createReport({
    databaseFingerprint: fingerprint,
    generatedAt: "2026-07-29T00:00:00.000Z",
    migrationHead: "migration-head",
    totalRows: rows.length,
    rows
  });
}

function readyRecord(
  contractVersionId = "00000000-0000-4000-8000-000000000001"
): ReadinessRecord {
  return {
    contractVersionId,
    status: "ready",
    facts: {
      draftRevision: 3,
      hasPendingOrApprovedUnpaid: false
    },
    reasons: []
  };
}

function currentRecord(overrides: Record<string, unknown> = {}) {
  return {
    contractVersionId: "00000000-0000-4000-8000-000000000001",
    versionStatus: "draft",
    draftRevision: 3,
    status: "ready",
    facts: {
      draftRevision: 3,
      hasPendingOrApprovedUnpaid: false
    },
    derivations: {
      billRows: [],
      firstSubmittedAt: null,
      initializeContractFacts: false,
      initializeFinanceFacts: false
    },
    reasons: [],
    ...overrides
  };
}

describe("contract draft aggregate transition", () => {
  it("requires the complete database-bound apply gate", () => {
    const tool = loadTransition();
    const fingerprint = "a".repeat(64);
    const report = createReport([readyRecord()], fingerprint);
    const args = tool.parseArgs([
      "--apply",
      "--report",
      "/tmp/report.json",
      "--batch-id",
      "draft-aggregate-20260729",
      "--expected-database-fingerprint",
      fingerprint,
      "--expected-report-sha256",
      String(report.reportSha256),
      "--actor-user-id",
      actorUserId,
      "--confirm",
      "TRANSITION_CONTRACT_DRAFT_AGGREGATE_draft-aggregate-20260729"
    ]);

    expect(() =>
      tool.assertApplyGates({
        args,
        report,
        currentDatabaseFingerprint: fingerprint,
        now: gateNow
      })
    ).not.toThrow();
    for (const key of [
      "reportPath",
      "batchId",
      "expectedDatabaseFingerprint",
      "expectedReportSha256",
      "actorUserId",
      "confirmation"
    ]) {
      expect(() =>
        tool.assertApplyGates({
          args: { ...args, [key]: undefined },
          report,
          currentDatabaseFingerprint: fingerprint,
          now: gateNow
        })
      ).toThrow();
    }
  });

  it("rejects database drift, report tampering and non-ready rows", () => {
    const tool = loadTransition();
    const fingerprint = "a".repeat(64);
    const report = createReport([readyRecord()], fingerprint);
    const args = {
      apply: true,
      reportPath: "/tmp/report.json",
      batchId: "batch-1",
      expectedDatabaseFingerprint: fingerprint,
      expectedReportSha256: report.reportSha256,
      actorUserId,
      confirmation: "TRANSITION_CONTRACT_DRAFT_AGGREGATE_batch-1"
    };

    expect(() =>
      tool.assertApplyGates({
        args,
        report,
        currentDatabaseFingerprint: "b".repeat(64),
        now: gateNow
      })
    ).toThrow(/fingerprint/iu);
    expect(() =>
      tool.assertApplyGates({
        args,
        report: { ...report, migrationHead: "changed" },
        currentDatabaseFingerprint: fingerprint,
        now: gateNow
      })
    ).toThrow(/SHA-256/iu);

    const manual = createReport([
      {
        ...readyRecord(),
        facts: { draftRevision: 3, hasPendingOrApprovedUnpaid: true }
      }
    ]);
    expect(() =>
      tool.assertApplyGates({
        args: {
          ...args,
          expectedReportSha256: manual.reportSha256
        },
        report: manual,
        currentDatabaseFingerprint: fingerprint,
        now: gateNow
      })
    ).toThrow(/ready/iu);
    expect(() =>
      tool.assertApplyGates({
        args,
        report,
        currentDatabaseFingerprint: fingerprint,
        now: new Date("2026-07-29T00:31:00.000Z")
      })
    ).toThrow(/expired|过期/iu);
  });

  it("rechecks an exact retained pre-submission formal code disposition under lock", () => {
    const tool = loadTransition();
    const readiness = requireFromHere(readinessPath) as {
      sha256: (value: unknown) => string;
    };
    const formalCode = "HT-20260729-001";
    const formalCodeSha256 = readiness.sha256(formalCode);
    const normalized = tool.normalizeLockedRow({
      contractVersionId: "00000000-0000-4000-8000-000000000001",
      versionStatus: "draft",
      draftRevision: 11,
      firstSubmittedAt: null,
      billCount: "1",
      missingTaxExclusiveUnitPriceCount: "0",
      underivableTaxExclusiveUnitPriceCount: "0",
      partyCount: "1",
      attachmentCount: "0",
      latestGeneratedRevision: null,
      checkpointChangedAfterCreation: false,
      approvalInstanceCount: "0",
      earliestApprovalCreatedAt: null,
      formalCode,
      formalCodeDispositionDecision: "retain",
      formalCodeDispositionSha256: formalCodeSha256,
      abandonedAt: null,
      takeoverId: null,
      takeoverActivatedAt: null,
      takeoverStatus: null,
      oldContractConfirmedAt: null,
      oldFinanceConfirmedAt: null,
      contractFactsCount: "0",
      financeFactsCount: "0",
      historicalPaidCents: "0",
      itemizedHistoricalPaidCents: "0",
      historicalPaymentCount: "0",
      historicalVoucherCount: "0",
      historicalApprovalPendingPaymentCents: "0",
      historicalApprovedPendingPaymentCents: "0",
      performanceStatus: null,
      settlementClosedAt: null,
      finalSettlementId: null
    });

    expect(normalized).toMatchObject({
      status: "ready",
      facts: {
        formalCodeAllocatedWhileDraft: true,
        formalCodeRetentionConfirmed: true,
        formalCodeSha256
      }
    });
    expect(readFileSync(transitionPath, "utf8")).toContain(
      "contract.draft.formal_code.disposition"
    );
  });

  it("locks and recomputes readiness before applying exact derivations", async () => {
    const tool = loadTransition();
    const report = createReport([readyRecord()]);
    const applied: string[] = [];
    const result = await tool.executeTransition({
      store: {
        lockAndRecompute: jest.fn().mockResolvedValue([currentRecord()]),
        findCompletedIds: jest.fn().mockResolvedValue([]),
        applyRecord: jest.fn(async (record) => {
          applied.push(String(record.contractVersionId));
          return 2;
        })
      },
      report,
      batchId: "batch-1",
      actorUserId,
      now: new Date("2026-07-29T01:00:00.000Z")
    });

    expect(applied).toEqual([
      "00000000-0000-4000-8000-000000000001"
    ]);
    expect(result).toMatchObject({
      status: "applied",
      selected: 1,
      processed: 1,
      writes: 2
    });
  });

  it.each([
    [
      "revision drift",
      currentRecord({ draftRevision: 4 }),
      /revision/iu
    ],
    [
      "submitted version",
      currentRecord({ versionStatus: "in_approval" }),
      /editable|draft/iu
    ],
    [
      "effective version",
      currentRecord({ versionStatus: "effective" }),
      /editable|draft/iu
    ],
    [
      "pending unpaid amount",
      currentRecord({
        status: "manual_review",
        facts: {
          draftRevision: 3,
          hasPendingOrApprovedUnpaid: true
        },
        reasons: ["PENDING_UNPAID_CANNOT_BECOME_HISTORICAL_PAYMENT"]
      }),
      /ready/iu
    ]
  ])("rejects %s after the lock", async (_label, current, error) => {
    const tool = loadTransition();
    await expect(
      tool.executeTransition({
        store: {
          lockAndRecompute: jest.fn().mockResolvedValue([current]),
          findCompletedIds: jest.fn().mockResolvedValue([]),
          applyRecord: jest.fn()
        },
        report: createReport([readyRecord()]),
        batchId: "batch-1",
        actorUserId,
        now: new Date("2026-07-29T01:00:00.000Z")
      })
    ).rejects.toThrow(error);
  });

  it("uses one Serializable transaction and makes a repeated batch zero-write", async () => {
    const tool = loadTransition();
    const transaction = jest.fn(async (callback) =>
      callback({ transaction: true })
    );
    const applyRecord = jest.fn();
    const result = await tool.runApplyWithClient({
      prisma: { $transaction: transaction },
      report: createReport([readyRecord()]),
      batchId: "batch-1",
      actorUserId,
      now: new Date("2026-07-29T01:00:00.000Z"),
      createStore: () => ({
        lockAndRecompute: jest.fn().mockResolvedValue([currentRecord()]),
        findCompletedIds: jest
          .fn()
          .mockResolvedValue([
            "00000000-0000-4000-8000-000000000001"
          ]),
        applyRecord
      })
    });

    expect(transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "Serializable"
    });
    expect(applyRecord).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      status: "already_applied",
      selected: 1,
      processed: 0,
      writes: 0
    });
    const source = readFileSync(transitionPath, "utf8");
    expect(source).not.toMatch(/INSERT\s+INTO\s+"ContractDraftCheckpoint"/iu);
    expect(source).not.toMatch(
      /UPDATE\s+"ContractTakeover"\s+SET[\s\S]*historical(?:ApprovalPending|ApprovedPending)PaymentCents/iu
    );
  });
});
