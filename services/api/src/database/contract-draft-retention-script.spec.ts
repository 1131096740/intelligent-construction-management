import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";

type RetentionModule = {
  parseArgs(argv: string[]): Record<string, unknown>;
  createReport(input: Record<string, unknown>): Record<string, unknown>;
  assertApplyGates(input: Record<string, unknown>): void;
  executeRetention(input: {
    store: {
      rescan: (candidate: Record<string, unknown>) => Promise<Record<string, unknown>>;
      markFileDeleting: (id: string) => Promise<void>;
      deleteFileRecord: (id: string) => Promise<void>;
      restoreFileActive: (id: string) => Promise<void>;
      deleteTechnicalRecord: (candidate: Record<string, unknown>) => Promise<number>;
      purgeBusinessDraft: (candidate: Record<string, unknown>) => Promise<number>;
      recordBatch: (receipt: Record<string, unknown>) => Promise<void>;
    };
    storage: { delete: (objectKey: string) => Promise<void> };
    report: Record<string, unknown>;
    options: {
      tempEnabled: boolean;
      businessPurgeEnabled: boolean;
      now: Date;
    };
  }): Promise<Record<string, unknown>>;
  inspectWithClient(
    prisma: PrismaClient,
    now?: Date
  ): Promise<Record<string, unknown>>;
  createSqlStore(
    prisma: PrismaClient,
    context: { batchId: string; reportSha256: string }
  ): Record<string, unknown>;
};

const scriptPath = resolve(
  __dirname,
  "../../scripts/execute-contract-draft-retention.cjs"
);
const requireFromHere = createRequire(__filename);

function loadModule(): RetentionModule {
  return requireFromHere(scriptPath) as RetentionModule;
}

function report(
  candidates: Array<Record<string, unknown>>,
  generatedAt = "2026-07-29T00:00:00.000Z"
) {
  return loadModule().createReport({
    databaseFingerprint: "a".repeat(64),
    generatedAt,
    scanTruncated: false,
    candidates
  });
}

describe("contract draft retention execution", () => {
  const integrationTest =
    process.env.RUN_CONTRACT_DRAFT_AGGREGATE_DATABASE === "1" ? it : it.skip;
  it("defaults to preview and requires database/report/batch confirmation gates", () => {
    const tool = loadModule();
    expect(tool.parseArgs([])).toMatchObject({
      apply: false,
      includeBusinessPurge: false
    });
    const preview = report([]);
    const args = tool.parseArgs([
      "--apply",
      "--report",
      "/tmp/retention.json",
      "--batch-id",
      "retention-20260729",
      "--expected-database-fingerprint",
      "a".repeat(64),
      "--expected-report-sha256",
      String(preview.reportSha256),
      "--confirm",
      "EXECUTE_CONTRACT_DRAFT_RETENTION_retention-20260729"
    ]);
    expect(() =>
      tool.assertApplyGates({
        args,
        report: preview,
        currentDatabaseFingerprint: "a".repeat(64),
        now: new Date("2026-07-29T00:10:00.000Z")
      })
    ).not.toThrow();
  });

  it("keeps timer mode temporary-only and rejects manual apply or business purge flags", () => {
    const tool = loadModule();
    expect(tool.parseArgs(["--timer-approved-temporary"])).toMatchObject({
      apply: false,
      includeBusinessPurge: false,
      timerApprovedTemporary: true
    });
    expect(() =>
      tool.parseArgs(["--timer-approved-temporary", "--apply"])
    ).toThrow(/不能与 --apply/iu);
    expect(() =>
      tool.parseArgs([
        "--timer-approved-temporary",
        "--include-business-purge"
      ])
    ).toThrow(/不能包含业务草稿/iu);
  });

  it("blocks all deletion when a scan is truncated or the preview expired", () => {
    const tool = loadModule();
    const blocked = tool.createReport({
      databaseFingerprint: "a".repeat(64),
      generatedAt: "2026-07-29T00:00:00.000Z",
      scanTruncated: true,
      candidates: [{ id: "file-1", category: "unbound_temporary_file" }]
    });
    expect(blocked).toMatchObject({
      status: "blocked",
      candidates: []
    });
    expect(() =>
      tool.assertApplyGates({
        args: {
          apply: true,
          reportPath: "/tmp/report.json",
          batchId: "batch-1",
          expectedDatabaseFingerprint: "a".repeat(64),
          expectedReportSha256: blocked.reportSha256,
          confirmation: "EXECUTE_CONTRACT_DRAFT_RETENTION_batch-1"
        },
        report: blocked,
        currentDatabaseFingerprint: "a".repeat(64),
        now: new Date("2026-07-29T00:10:00.000Z")
      })
    ).toThrow(/blocked|truncated/iu);

    const expired = report([], "2026-07-28T00:00:00.000Z");
    expect(() =>
      tool.assertApplyGates({
        args: {
          apply: true,
          reportPath: "/tmp/report.json",
          batchId: "batch-1",
          expectedDatabaseFingerprint: "a".repeat(64),
          expectedReportSha256: expired.reportSha256,
          confirmation: "EXECUTE_CONTRACT_DRAFT_RETENTION_batch-1"
        },
        report: expired,
        currentDatabaseFingerprint: "a".repeat(64),
        now: new Date("2026-07-29T00:00:01.000Z")
      })
    ).toThrow(/expired/iu);
  });

  it("performs a fresh binding/replacement scan before deleting a file", async () => {
    const tool = loadModule();
    const deleteObject = jest.fn().mockResolvedValue(undefined);
    const deleteFileRecord = jest.fn().mockResolvedValue(undefined);
    const result = await tool.executeRetention({
      store: {
        rescan: jest.fn().mockResolvedValue({
          safe: true,
          truncated: false,
          objectKey: "temporary/file-1"
        }),
        markFileDeleting: jest.fn().mockResolvedValue(undefined),
        deleteFileRecord,
        restoreFileActive: jest.fn().mockResolvedValue(undefined),
        deleteTechnicalRecord: jest.fn(),
        purgeBusinessDraft: jest.fn(),
        recordBatch: jest.fn()
      },
      storage: { delete: deleteObject },
      report: report([
        {
          id: "file-1",
          category: "unbound_temporary_file",
          kind: "file",
          bytes: "128"
        }
      ]),
      options: {
        tempEnabled: true,
        businessPurgeEnabled: false,
        now: new Date("2026-07-29T00:05:00.000Z")
      }
    });

    expect(deleteObject).toHaveBeenCalledWith("temporary/file-1");
    expect(deleteFileRecord).toHaveBeenCalledWith("file-1");
    expect(result).toMatchObject({
      status: "applied",
      deletedCount: 1,
      deletedBytes: "128"
    });
    expect(JSON.stringify(result)).not.toContain("temporary/file-1");
  });

  it("keeps FileObject retryable when COS deletion fails", async () => {
    const tool = loadModule();
    const restoreFileActive = jest.fn().mockResolvedValue(undefined);
    const deleteFileRecord = jest.fn();
    const result = await tool.executeRetention({
      store: {
        rescan: jest.fn().mockResolvedValue({
          safe: true,
          truncated: false,
          objectKey: "temporary/file-1"
        }),
        markFileDeleting: jest.fn().mockResolvedValue(undefined),
        deleteFileRecord,
        restoreFileActive,
        deleteTechnicalRecord: jest.fn(),
        purgeBusinessDraft: jest.fn(),
        recordBatch: jest.fn()
      },
      storage: { delete: jest.fn().mockRejectedValue(new Error("COS secret")) },
      report: report([
        {
          id: "file-1",
          category: "unbound_temporary_file",
          kind: "file",
          bytes: "128"
        }
      ]),
      options: {
        tempEnabled: true,
        businessPurgeEnabled: false,
        now: new Date("2026-07-29T00:05:00.000Z")
      }
    });

    expect(deleteFileRecord).not.toHaveBeenCalled();
    expect(restoreFileActive).toHaveBeenCalledWith("file-1");
    expect(result).toMatchObject({ failedCount: 1, deletedCount: 0 });
    expect(JSON.stringify(result)).not.toMatch(/secret|objectKey/iu);
  });

  it("never treats temporary retention as business draft purge authorization", async () => {
    const tool = loadModule();
    const purgeBusinessDraft = jest.fn();
    const result = await tool.executeRetention({
      store: {
        rescan: jest.fn().mockResolvedValue({
          safe: true,
          truncated: false
        }),
        markFileDeleting: jest.fn(),
        deleteFileRecord: jest.fn(),
        restoreFileActive: jest.fn(),
        deleteTechnicalRecord: jest.fn(),
        purgeBusinessDraft,
        recordBatch: jest.fn()
      },
      storage: { delete: jest.fn() },
      report: report([
        {
          id: "version-1",
          category: "pristine_abandoned_contract_draft",
          kind: "business_draft",
          bytes: "0"
        }
      ]),
      options: {
        tempEnabled: true,
        businessPurgeEnabled: false,
        now: new Date("2026-07-29T00:05:00.000Z")
      }
    });

    expect(purgeBusinessDraft).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      businessPurgeSkippedCount: 1,
      deletedCount: 0
    });
  });

  it("writes once for an expired autosave receipt and zero times on the second cleanup", async () => {
    const tool = loadModule();
    const deleteTechnicalRecord = jest
      .fn()
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(0);
    const recordBatch = jest.fn().mockResolvedValue(undefined);
    const store = {
      rescan: jest.fn().mockResolvedValue({ safe: true, truncated: false }),
      markFileDeleting: jest.fn(),
      deleteFileRecord: jest.fn(),
      restoreFileActive: jest.fn(),
      deleteTechnicalRecord,
      purgeBusinessDraft: jest.fn(),
      recordBatch
    };
    const expiredReceiptReport = report([
      {
        id: "autosave-receipt-1",
        category: "contract_draft_save_receipt",
        kind: "technical_record",
        bytes: "0"
      }
    ]);
    const options = {
      tempEnabled: true,
      businessPurgeEnabled: false,
      now: new Date("2026-07-29T00:05:00.000Z")
    };

    const first = await tool.executeRetention({
      store,
      storage: { delete: jest.fn() },
      report: expiredReceiptReport,
      options
    });
    const second = await tool.executeRetention({
      store,
      storage: { delete: jest.fn() },
      report: expiredReceiptReport,
      options
    });

    expect(first).toMatchObject({ deletedCount: 1, skippedCount: 0 });
    expect(second).toMatchObject({ deletedCount: 0, skippedCount: 1 });
    expect(deleteTechnicalRecord).toHaveBeenCalledTimes(2);
    expect(recordBatch).toHaveBeenCalledTimes(2);
  });

  it("installs a disabled-by-default timer without enabling or starting it during deploy", () => {
    const repoRoot = resolve(__dirname, "../../../..");
    const service = readFileSync(
      resolve(
        repoRoot,
        "scripts/ops/systemd/jiangkong-draft-retention.service"
      ),
      "utf8"
    );
    const timer = readFileSync(
      resolve(
        repoRoot,
        "scripts/ops/systemd/jiangkong-draft-retention.timer"
      ),
      "utf8"
    );
    const deploy = readFileSync(
      resolve(repoRoot, "scripts/ops/deploy-production-server.sh"),
      "utf8"
    );

    expect(service).toContain("--timer-approved-temporary");
    expect(service).toContain("CONTRACT_DRAFT_TEMP_RETENTION_ENABLED=false");
    expect(service).toContain("CONTRACT_DRAFT_BUSINESS_PURGE_ENABLED=false");
    expect(timer).toContain("Persistent=true");
    expect(deploy).toContain("install_draft_retention_units");
    expect(deploy).toContain("systemctl daemon-reload");
    expect(deploy).not.toMatch(
      /systemctl\s+(?:enable|start)\s+["']?jiangkong-draft-retention/iu
    );
  });

  it("requires the physical-purge candidate to remain an original pristine draft without shared files", () => {
    const source = readFileSync(scriptPath, "utf8");
    [
      'v."abandonReason" IS NULL',
      'v."changeType" = \'original\'',
      'v."versionNo" = 1',
      '"ContractDraftSubmissionRequest"',
      '"ContractDraftCheckpoint"',
      '"ContractTaxFactRevision"',
      '"ContractDraftAttachment"',
      '"ContractGeneratedDocument"',
      '"ContractOfflineRevision"',
      '"ContractNegotiationRound"',
      'b."sourceExcelFileId" IS NOT NULL',
      '"ContractBillImport"'
    ].forEach((guard) => expect(source).toContain(guard));
  });

  integrationTest(
    "deletes expired unbound files and autosave receipts once against PostgreSQL",
    async () => {
      const databaseUrl = process.env.CONTRACT_DRAFT_AGGREGATE_DATABASE_URL;
      if (!databaseUrl || process.env.NODE_ENV === "production") {
        throw new Error("retention PostgreSQL test requires its local test database");
      }
      const parsed = new URL(databaseUrl);
      if (
        !["127.0.0.1", "localhost", "::1"].includes(parsed.hostname) ||
        parsed.pathname !== "/jiangkong_contract_draft_aggregate_test"
      ) {
        throw new Error("retention PostgreSQL test rejected a non-local database");
      }
      const client = new PrismaClient({
        datasources: { db: { url: databaseUrl } }
      });
      const previousDatabaseUrl = process.env.DATABASE_URL;
      process.env.DATABASE_URL = databaseUrl;
      const tool = loadModule();
      const suffix = randomUUID();
      const fileId = `retention-file-${suffix}`;
      const importFileId = `retention-import-file-${suffix}`;
      const billId = `retention-bill-${suffix}`;
      const importId = `retention-import-${suffix}`;
      const receiptId = `retention-receipt-${suffix}`;
      const versionId = `retention-version-${suffix}`;
      const actorId = `retention-actor-${suffix}`;
      const projectId = `retention-project-${suffix}`;
      const contractId = `retention-contract-${suffix}`;
      const objectKey = `temporary/retention-${suffix}.xlsx`;
      const importObjectKey = `temporary/retention-import-${suffix}.xlsx`;
      const old = new Date(Date.now() - 8 * 86_400_000);
      try {
        await client.user.create({
          data: { id: actorId, name: "保留策略本地验证用户" }
        });
        await client.project.create({
          data: {
            id: projectId,
            code: `RETENTION-${suffix}`,
            name: "保留策略本地验证项目"
          }
        });
        await client.contract.create({
          data: {
            id: contractId,
            projectId,
            source: "system",
            temporaryCode: `RETENTION-${suffix}`,
            name: "保留策略本地验证合同",
            counterparty: "本地验证相对方",
            contractTypeKey: "material_purchase",
            ownerUserId: actorId
          }
        });
        await client.contractVersion.create({
          data: {
            id: versionId,
            contractId,
            versionNo: 1,
            changeType: "original",
            status: "draft",
            amountCents: 0n,
            draftRevision: 1,
            pricingNature: "fixed_total",
            amountSource: "manual",
            amountLimitType: "capped",
            draftData: {},
            templateSnapshot: {},
            clauseSnapshot: []
          }
        });
        await client.fileObject.create({
          data: {
            id: fileId,
            bucket: "local-test",
            objectKey,
            originalName: "retention.xlsx",
            mimeType:
              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            sizeBytes: 256,
            uploadedByUserId: actorId,
            contentSha256: "b".repeat(64),
            storageStatus: "active",
            createdAt: old
          }
        });
        await client.fileObject.create({
          data: {
            id: importFileId,
            bucket: "local-test",
            objectKey: importObjectKey,
            originalName: "retention-import.xlsx",
            mimeType:
              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            sizeBytes: 128,
            uploadedByUserId: actorId,
            contentSha256: "d".repeat(64),
            storageStatus: "active",
            createdAt: old
          }
        });
        await client.contractBill.create({
          data: {
            id: billId,
            contractVersionId: versionId,
            billKey: "main",
            name: "保留策略验证清单",
            amountRole: "included",
            pricingMode: "tax_inclusive",
            quantityScale: 2,
            unitPriceScale: 2,
            schemaSnapshot: {}
          }
        });
        await client.contractBillImport.create({
          data: {
            id: importId,
            contractBillId: billId,
            fileId: importFileId,
            mode: "replace",
            status: "preview",
            preview: {},
            createdByUserId: actorId,
            createdAt: old
          }
        });
        await client.contractDraftSaveRequest.create({
          data: {
            idempotencyKey: receiptId,
            contractVersionId: versionId,
            expectedRevision: 1,
            resultRevision: 2,
            saveKind: "auto",
            requestSha256: "c".repeat(64),
            responseSnapshot: { draftRevision: 2 },
            createdByUserId: actorId,
            createdAt: old,
            expiresAt: new Date(old.getTime() + 7 * 86_400_000)
          }
        });
        const firstReport = await tool.inspectWithClient(client, new Date());
        expect(firstReport).toMatchObject({
          status: "ready",
          summary: { candidateCount: 3, candidateBytes: "384" }
        });
        const deleteObject = jest.fn().mockResolvedValue(undefined);
        const first = await tool.executeRetention({
          store: tool.createSqlStore(client, {
            batchId: `retention-first-${suffix}`,
            reportSha256: String(firstReport.reportSha256)
          }) as never,
          storage: { delete: deleteObject },
          report: firstReport,
          options: {
            tempEnabled: true,
            businessPurgeEnabled: false,
            now: new Date()
          }
        });
        expect(first).toMatchObject({
          status: "applied",
          deletedCount: 3,
          deletedBytes: "384"
        });
        expect(JSON.stringify(first)).not.toContain(objectKey);
        expect(JSON.stringify(first)).not.toContain(importObjectKey);
        expect(deleteObject).toHaveBeenCalledWith(objectKey);
        expect(deleteObject).toHaveBeenCalledWith(importObjectKey);

        await client.contractVersion.update({
          where: { id: versionId },
          data: {
            status: "abandoned",
            abandonedAt: old,
            abandonedByUserId: actorId,
            abandonReason: null,
            draftRevision: { increment: 1 }
          }
        });
        const businessReport = await tool.inspectWithClient(client, new Date());
        expect(businessReport).toMatchObject({
          status: "ready",
          summary: { candidateCount: 1, candidateBytes: "0" },
          candidates: [
            expect.objectContaining({
              id: versionId,
              category: "pristine_abandoned_contract_draft",
              kind: "business_draft"
            })
          ]
        });
        const disabledBusiness = await tool.executeRetention({
          store: tool.createSqlStore(client, {
            batchId: `retention-business-disabled-${suffix}`,
            reportSha256: String(businessReport.reportSha256)
          }) as never,
          storage: { delete: jest.fn() },
          report: businessReport,
          options: {
            tempEnabled: true,
            businessPurgeEnabled: false,
            now: new Date()
          }
        });
        expect(disabledBusiness).toMatchObject({
          deletedCount: 0,
          businessPurgeSkippedCount: 1
        });
        await expect(
          client.contractVersion.findUnique({ where: { id: versionId } })
        ).resolves.not.toBeNull();
        const purgedBusiness = await tool.executeRetention({
          store: tool.createSqlStore(client, {
            batchId: `retention-business-purge-${suffix}`,
            reportSha256: String(businessReport.reportSha256)
          }) as never,
          storage: { delete: jest.fn() },
          report: businessReport,
          options: {
            tempEnabled: true,
            businessPurgeEnabled: true,
            now: new Date()
          }
        });
        expect(purgedBusiness).toMatchObject({
          status: "applied",
          deletedCount: 1,
          businessPurgeSkippedCount: 0
        });
        await expect(
          client.contractVersion.findUnique({ where: { id: versionId } })
        ).resolves.toBeNull();
        await expect(
          client.contract.findUnique({ where: { id: contractId } })
        ).resolves.toBeNull();

        const secondReport = await tool.inspectWithClient(client, new Date());
        expect(secondReport).toMatchObject({
          status: "ready",
          summary: { candidateCount: 0, candidateBytes: "0" }
        });
        const second = await tool.executeRetention({
          store: tool.createSqlStore(client, {
            batchId: `retention-second-${suffix}`,
            reportSha256: String(secondReport.reportSha256)
          }) as never,
          storage: { delete: jest.fn().mockResolvedValue(undefined) },
          report: secondReport,
          options: {
            tempEnabled: true,
            businessPurgeEnabled: false,
            now: new Date()
          }
        });
        expect(second).toMatchObject({
          status: "applied",
          deletedCount: 0,
          deletedBytes: "0"
        });
      } finally {
        await client.contractDraftSaveRequest.deleteMany({
          where: { idempotencyKey: receiptId }
        });
        await client.fileObject.deleteMany({ where: { id: fileId } });
        await client.contractBillImport.deleteMany({
          where: { id: importId }
        });
        await client.contractBill.deleteMany({ where: { id: billId } });
        await client.fileObject.deleteMany({ where: { id: importFileId } });
        await client.contractVersion.deleteMany({ where: { id: versionId } });
        await client.contract.deleteMany({ where: { id: contractId } });
        await client.project.deleteMany({ where: { id: projectId } });
        await client.user.deleteMany({ where: { id: actorId } });
        await client.auditLog.deleteMany({
          where: {
            action: "contract.draft_retention.batch",
            businessId: {
              in: [
                `retention-first-${suffix}`,
                `retention-business-disabled-${suffix}`,
                `retention-business-purge-${suffix}`,
                `retention-second-${suffix}`
              ]
            }
          }
        });
        await client.$disconnect();
        if (previousDatabaseUrl === undefined) {
          delete process.env.DATABASE_URL;
        } else {
          process.env.DATABASE_URL = previousDatabaseUrl;
        }
      }
    },
    30_000
  );
});
