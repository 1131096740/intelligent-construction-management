import { createRequire } from "node:module";
import { resolve } from "node:path";

type ResolutionModule = {
  parseArgs(argv: string[]): Record<string, unknown>;
  expectedConfirmation(contractVersionId: string, decision: string): string;
  assertApplyGates(input: {
    args: Record<string, unknown>;
    report: Record<string, unknown>;
    currentDatabaseFingerprint: string;
    now: Date;
  }): Record<string, unknown>;
  executeResolution(input: {
    store: {
      lockAndLoad: (contractVersionId: string) => Promise<Record<string, unknown>>;
      assertActorCanResolve: (
        actorUserId: string,
        projectId: string
      ) => Promise<void>;
      clearFormalCode: (
        record: Record<string, unknown>,
        context: Record<string, unknown>
      ) => Promise<number>;
      recordDisposition: (
        record: Record<string, unknown>,
        context: Record<string, unknown>
      ) => Promise<number>;
    };
    target: Record<string, unknown>;
    decision: "retain" | "void";
    actorUserId: string;
    reason: string;
    reportSha256: string;
    now: Date;
  }): Promise<Record<string, unknown>>;
  createStore(tx: Record<string, unknown>): {
    clearFormalCode(
      record: Record<string, unknown>,
      context: Record<string, unknown>
    ): Promise<number>;
    recordDisposition(
      record: Record<string, unknown>,
      context: Record<string, unknown>
    ): Promise<number>;
  };
};

const requireFromHere = createRequire(__filename);
const readiness = requireFromHere(
  resolve(__dirname, "../../scripts/inspect-contract-draft-aggregate-readiness.cjs")
) as {
  sha256(value: unknown): string;
  createReport(input: Record<string, unknown>): Record<string, unknown>;
};
const scriptPath = resolve(
  __dirname,
  "../../scripts/resolve-contract-draft-formal-code.cjs"
);

function loadTool(): ResolutionModule {
  return requireFromHere(scriptPath) as ResolutionModule;
}

const versionId = "00000000-0000-4000-8000-000000000001";
const actorUserId = "00000000-0000-4000-8000-000000000099";
const formalCode = "HT-20260729-001";
const fingerprint = "a".repeat(64);

function blockedReport(
  generatedAt = "2026-07-29T00:00:00.000Z",
  overrides: Record<string, unknown> = {}
) {
  return readiness.createReport({
    databaseFingerprint: fingerprint,
    generatedAt,
    migrationHead: "migration-head",
    totalRows: 1,
    rows: [{
      contractVersionId: versionId,
      versionStatus: "draft",
      draftRevision: 11,
      billCount: "1",
      missingTaxExclusiveUnitPriceCount: "0",
      underivableTaxExclusiveUnitPriceCount: "0",
      partyCount: "1",
      attachmentCount: "0",
      latestGeneratedRevision: null,
      checkpointChangedAfterCreation: false,
      approvalInstanceCount: "0",
      earliestApprovalCreatedAt: null,
      firstSubmittedAt: null,
      formalCode,
      formalCodeDispositionDecision: null,
      formalCodeDispositionSha256: null,
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
      finalSettlementId: null,
      ...overrides
    }]
  });
}

function lockedRecord(overrides: Record<string, unknown> = {}) {
  return {
    contractVersionId: versionId,
    contractId: "00000000-0000-4000-8000-000000000002",
    projectId: "00000000-0000-4000-8000-000000000003",
    versionStatus: "draft",
    draftRevision: 11,
    firstSubmittedAt: null,
    approvalInstanceCount: "0",
    formalCode,
    formalCodeSha256: readiness.sha256(formalCode),
    currentDispositionDecision: null,
    currentDispositionSha256: null,
    ...overrides
  };
}

describe("contract draft formal code resolution", () => {
  it("defaults to preview and requires a fresh report-bound explicit decision", () => {
    const tool = loadTool();
    expect(tool.parseArgs([])).toMatchObject({ apply: false });
    const report = blockedReport();
    const confirmation = tool.expectedConfirmation(versionId, "retain");
    const args = tool.parseArgs([
      "--apply",
      "--report",
      "/tmp/readiness.json",
      "--contract-version-id",
      versionId,
      "--decision",
      "retain",
      "--expected-revision",
      "11",
      "--expected-database-fingerprint",
      fingerprint,
      "--expected-report-sha256",
      String(report.reportSha256),
      "--actor-user-id",
      actorUserId,
      "--reason",
      "合同部确认保留旧版本首次保存时分配的编号",
      "--confirm",
      confirmation
    ]);

    expect(tool.assertApplyGates({
      args,
      report,
      currentDatabaseFingerprint: fingerprint,
      now: new Date("2026-07-29T00:10:00.000Z")
    })).toMatchObject({
      contractVersionId: versionId,
      formalCodeSha256: readiness.sha256(formalCode)
    });
    expect(() => tool.assertApplyGates({
      args,
      report,
      currentDatabaseFingerprint: "b".repeat(64),
      now: new Date("2026-07-29T00:10:00.000Z")
    })).toThrow(/fingerprint/iu);
    expect(() => tool.assertApplyGates({
      args,
      report,
      currentDatabaseFingerprint: fingerprint,
      now: new Date("2026-07-29T00:31:00.000Z")
    })).toThrow(/expired|过期/iu);

    const retained = blockedReport("2026-07-29T00:00:00.000Z", {
      formalCodeDispositionDecision: "retain",
      formalCodeDispositionSha256: readiness.sha256(formalCode)
    });
    expect(retained).toMatchObject({ status: "ready" });
    expect(tool.assertApplyGates({
      args: {
        ...args,
        expectedReportSha256: retained.reportSha256
      },
      report: retained,
      currentDatabaseFingerprint: fingerprint,
      now: new Date("2026-07-29T00:10:00.000Z")
    })).toMatchObject({
      contractVersionId: versionId,
      formalCodeSha256: readiness.sha256(formalCode)
    });
  });

  it.each(["retain", "void"] as const)(
    "records an audited %s decision and clears the code only for void",
    async (decision) => {
      const tool = loadTool();
      const clearFormalCode = jest.fn().mockResolvedValue(2);
      const recordDisposition = jest.fn().mockResolvedValue(1);
      const result = await tool.executeResolution({
        store: {
          lockAndLoad: jest.fn().mockResolvedValue(lockedRecord()),
          assertActorCanResolve: jest.fn().mockResolvedValue(undefined),
          clearFormalCode,
          recordDisposition
        },
        target: {
          contractVersionId: versionId,
          expectedRevision: 11,
          formalCodeSha256: readiness.sha256(formalCode)
        },
        decision,
        actorUserId,
        reason: "合同部已复核旧版本编号事实",
        reportSha256: "c".repeat(64),
        now: new Date("2026-07-29T00:10:00.000Z")
      });

      expect(recordDisposition).toHaveBeenCalledTimes(1);
      expect(clearFormalCode).toHaveBeenCalledTimes(decision === "void" ? 1 : 0);
      expect(result).toMatchObject({
        status: "applied",
        decision,
        writes: decision === "void" ? 3 : 1
      });
      expect(JSON.stringify(result)).not.toContain(formalCode);
    }
  );

  it("rejects stale revision, code drift, submission evidence and unauthorized actors", async () => {
    const tool = loadTool();
    const target = {
      contractVersionId: versionId,
      expectedRevision: 11,
      formalCodeSha256: readiness.sha256(formalCode)
    };
    const baseStore = {
      assertActorCanResolve: jest.fn().mockResolvedValue(undefined),
      clearFormalCode: jest.fn(),
      recordDisposition: jest.fn()
    };
    for (const current of [
      lockedRecord({ draftRevision: 12 }),
      lockedRecord({ formalCode: "HT-20260729-002" }),
      lockedRecord({ firstSubmittedAt: new Date() }),
      lockedRecord({ approvalInstanceCount: "1" })
    ]) {
      await expect(tool.executeResolution({
        store: {
          ...baseStore,
          lockAndLoad: jest.fn().mockResolvedValue(current)
        },
        target,
        decision: "retain",
        actorUserId,
        reason: "合同部已复核旧版本编号事实",
        reportSha256: "c".repeat(64),
        now: new Date()
      })).rejects.toThrow();
    }
    await expect(tool.executeResolution({
      store: {
        ...baseStore,
        lockAndLoad: jest.fn().mockResolvedValue(lockedRecord()),
        assertActorCanResolve: jest.fn().mockRejectedValue(
          new Error("actor is not contract director")
        )
      },
      target,
      decision: "retain",
      actorUserId,
      reason: "合同部已复核旧版本编号事实",
      reportSha256: "c".repeat(64),
      now: new Date()
    })).rejects.toThrow(/contract director/iu);
    expect(baseStore.clearFormalCode).not.toHaveBeenCalled();
    expect(baseStore.recordDisposition).not.toHaveBeenCalled();
  });

  it("is idempotent only for the same retained code disposition", async () => {
    const tool = loadTool();
    const codeSha256 = readiness.sha256(formalCode);
    const recordDisposition = jest.fn();
    await expect(tool.executeResolution({
      store: {
        lockAndLoad: jest.fn().mockResolvedValue(lockedRecord({
          currentDispositionDecision: "retain",
          currentDispositionSha256: codeSha256
        })),
        assertActorCanResolve: jest.fn().mockResolvedValue(undefined),
        clearFormalCode: jest.fn(),
        recordDisposition
      },
      target: {
        contractVersionId: versionId,
        expectedRevision: 11,
        formalCodeSha256: codeSha256
      },
      decision: "retain",
      actorUserId,
      reason: "合同部已复核旧版本编号事实",
      reportSha256: "c".repeat(64),
      now: new Date()
    })).resolves.toMatchObject({ status: "already_resolved", writes: 0 });
    expect(recordDisposition).not.toHaveBeenCalled();
  });

  it("clears the exact parent code, advances revision and writes a code-free audit receipt", async () => {
    const tool = loadTool();
    const contractUpdate = jest.fn().mockResolvedValue({ count: 1 });
    const versionUpdate = jest.fn().mockResolvedValue({ count: 1 });
    const auditCreate = jest.fn().mockResolvedValue({ id: "audit-1" });
    const store = tool.createStore({
      contract: { updateMany: contractUpdate },
      contractVersion: { updateMany: versionUpdate },
      auditLog: { create: auditCreate }
    });
    const record = lockedRecord();
    const context = {
      decision: "void",
      actorUserId,
      reason: "合同部确认作废旧版本提前分配的编号",
      reportSha256: "c".repeat(64),
      formalCodeSha256: readiness.sha256(formalCode),
      expectedRevision: 11,
      now: new Date("2026-07-29T00:10:00.000Z")
    };

    await expect(store.clearFormalCode(record, context)).resolves.toBe(2);
    await expect(store.recordDisposition(record, context)).resolves.toBe(1);
    expect(contractUpdate).toHaveBeenCalledWith({
      where: {
        id: record.contractId,
        projectId: record.projectId,
        code: formalCode
      },
      data: { code: null }
    });
    expect(versionUpdate).toHaveBeenCalledWith({
      where: {
        id: versionId,
        draftRevision: 11,
        status: { in: ["draft", "returned", "withdrawn"] },
        firstSubmittedAt: null
      },
      data: { draftRevision: { increment: 1 } }
    });
    const auditPayload = auditCreate.mock.calls[0][0];
    expect(auditPayload).toMatchObject({
      data: {
        actorUserId,
        action: "contract.draft.formal_code.disposition",
        businessType: "contract_version",
        businessId: versionId,
        metadata: {
          decision: "void",
          revisionBefore: 11,
          revisionAfter: 12,
          formalCodeWillNeverBeReused: true
        }
      }
    });
    expect(JSON.stringify(auditPayload)).not.toContain(formalCode);
  });
});
