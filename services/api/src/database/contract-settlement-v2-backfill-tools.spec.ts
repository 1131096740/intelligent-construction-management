/* eslint-disable @typescript-eslint/no-var-requires */

const {
  buildPrecheckReport,
  createBackfillManifest,
  databaseFingerprint,
  verifyBackfillManifest
} = require("../../prisma/contract-settlement-v2-backfill-tools.cjs") as {
  buildPrecheckReport(input: Record<string, unknown>): Record<string, unknown>;
  createBackfillManifest(input: Record<string, unknown>): Record<string, unknown>;
  databaseFingerprint(value: string): string;
  verifyBackfillManifest(manifest: Record<string, unknown>): void;
};
const { WRITE_CONFIRMATION, assertApplyGates, applyManifest } = require("../../prisma/backfill-contract-settlement-v2.cjs") as {
  WRITE_CONFIRMATION: string;
  assertApplyGates(args: Record<string, unknown>, manifest: Record<string, unknown>): void;
  applyManifest(tx: Record<string, unknown>, manifest: Record<string, unknown>, operatorUserId: string): Promise<Record<string, number>>;
};

describe("contract settlement V2 historical backfill tools", () => {
  it("reports missing modes and lineage as manual review instead of guessing from names", () => {
    const report = buildPrecheckReport({
      contractVersions: [{ id: "version-1", settlementMode: null }],
      contractBillRows: [{ id: "row-1", lineageId: null }],
      settlementDrafts: [{ id: "draft-1", periodStart: null, periodEnd: null, calculationVersion: null }],
      settlements: [],
      processes: [{ contractId: "contract-1", status: "open" }, { contractId: "contract-1", status: "open" }],
      documents: [{ id: "document-1", settlementDraftId: "missing", settlementId: null }]
    }) as { mode: Array<{ status: string }>; lineage: Array<{ status: string }>; summary: { manualReview: number; blocking: number }; digest: string };

    expect(report.mode[0].status).toBe("manual_review");
    expect(report.lineage[0].status).toBe("manual_review");
    expect(report.summary).toMatchObject({ manualReview: 5, blocking: 2 });
    expect(report.digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it("only permits manifest entries explicitly selected from precheck manual-review items", () => {
    const precheck = buildPrecheckReport({
      contractVersions: [{ id: "version-1", settlementMode: null }],
      contractBillRows: [{ id: "row-1", lineageId: null }],
      settlementDrafts: [], settlements: [], processes: [], documents: []
    });
    const manifest = createBackfillManifest({
      batchId: "v2-20260727-001",
      targetFingerprint: databaseFingerprint("postgresql://user:secret@example.test/db"),
      precheck,
      settlementModes: [{ contractVersionId: "version-1", settlementMode: "settlement_required" }],
      lineageAssignments: [{ contractBillRowId: "row-1", lineageId: "lineage-1", contractId: "contract-1" }]
    });

    expect(() => verifyBackfillManifest(manifest)).not.toThrow();
    expect(() => createBackfillManifest({
      batchId: "v2-20260727-001",
      targetFingerprint: databaseFingerprint("postgresql://user:secret@example.test/db"),
      precheck,
      settlementModes: [{ contractVersionId: "unknown", settlementMode: "settlement_required" }]
    })).toThrow("待人工确认");
  });

  it("blocks a historical quantity or amount that no longer conserves against its source row", () => {
    const report = buildPrecheckReport({
      contractVersions: [],
      contractBillRows: [{ id: "row-1", lineageId: "lineage-1", quantity: "2", taxInclusiveAmountCents: "100" }],
      settlementDrafts: [], settlements: [], processes: [], documents: [],
      settlementLines: [{ contractBillRowId: "row-1", quantity: "3", amountCents: "120" }]
    }) as { conservation: Array<{ status: string; reason: string }> };

    expect(report.conservation[0]).toMatchObject({ status: "blocking", reason: expect.stringContaining("超过") });
  });

  it("requires every write gate before a backfill can be applied", () => {
    const precheck = buildPrecheckReport({ contractVersions: [], contractBillRows: [], settlementDrafts: [], settlements: [], processes: [], documents: [] });
    const manifest = createBackfillManifest({
      batchId: "v2-20260727-001",
      targetFingerprint: "a".repeat(16),
      precheck
    });
    expect(() => assertApplyGates({ apply: false }, manifest)).toThrow("--apply");
    expect(() => assertApplyGates({
      apply: true,
      manifestPath: "manifest.json",
      batchId: "v2-20260727-001",
      targetFingerprint: "a".repeat(16),
      confirmation: WRITE_CONFIRMATION,
      operatorUserId: "123e4567-e89b-12d3-a456-426614174000"
    }, manifest)).not.toThrow();
  });

  it("treats a second identical manifest application as an idempotent receipt", async () => {
    const precheck = buildPrecheckReport({
      contractVersions: [{ id: "version-1", settlementMode: null }],
      contractBillRows: [{ id: "row-1", lineageId: null }],
      settlementDrafts: [], settlements: [], processes: [], documents: []
    });
    const manifest = createBackfillManifest({
      batchId: "v2-20260727-001",
      targetFingerprint: "a".repeat(16),
      precheck,
      settlementModes: [{ contractVersionId: "version-1", settlementMode: "settlement_required" }],
      newLineages: [{ id: "lineage-1", contractId: "contract-1", createdInContractVersionId: "version-1" }],
      lineageAssignments: [{ contractBillRowId: "row-1", lineageId: "lineage-1", contractId: "contract-1" }]
    });
    const tx = {
      contractVersion: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        findUnique: jest.fn().mockResolvedValue({ settlementMode: "settlement_required" })
      },
      contractBillRowLineage: {
        findUnique: jest.fn().mockResolvedValue({ contractId: "contract-1", createdInContractVersionId: "version-1" }),
        create: jest.fn()
      },
      contractBillRow: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        findUnique: jest.fn().mockResolvedValue({ lineageId: "lineage-1" })
      },
      auditLog: { create: jest.fn() }
    };

    await expect(applyManifest(tx, manifest, "123e4567-e89b-12d3-a456-426614174000")).resolves.toMatchObject({
      settlementModesAlreadyApplied: 1,
      lineagesAlreadyCreated: 1,
      lineagesAlreadyApplied: 1
    });
    expect(tx.contractBillRowLineage.create).not.toHaveBeenCalled();
  });
});
