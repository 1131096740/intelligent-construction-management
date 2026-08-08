import { ForbiddenException } from "@nestjs/common";
import { DraftRetentionService } from "./draft-retention.service";

describe("DraftRetentionService", () => {
  const old = new Date("2026-01-01T00:00:00.000Z");

  function delegate(dateKey: "createdAt" | "updatedAt", count = 1) {
    return {
      count: jest.fn().mockResolvedValue(count),
      aggregate: jest
        .fn()
        .mockResolvedValue({ _min: { [dateKey]: count ? old : null } })
    };
  }

  function prisma(files: Array<Record<string, unknown>> = []) {
    return {
      settlementImport: delegate("updatedAt"),
      settlementTemplatePreviewJob: delegate("updatedAt"),
      contractLayoutPreviewJob: delegate("updatedAt"),
      contractBillImport: delegate("createdAt"),
      contractGeneratedDocument: {
        ...delegate("updatedAt"),
        findMany: jest.fn().mockResolvedValue([
          {
            id: "generated-latest",
            contractVersionId: "version-1",
            updatedAt: new Date("2026-01-02T00:00:00.000Z")
          },
          {
            id: "generated-old",
            contractVersionId: "version-1",
            updatedAt: old
          }
        ])
      },
      contractDraftSaveRequest: delegate("createdAt"),
      contractVersion: delegate("abandonedAt" as "createdAt"),
      fileObject: {
        findMany: jest.fn().mockResolvedValue(files)
      },
      $transaction: jest.fn(async (callback) =>
        callback({
          fileObject: {
            findMany: jest.fn().mockResolvedValue([])
          },
          spotProcurementReceiptPhoto: {
            findMany: jest.fn().mockResolvedValue([])
          }
        })
      )
    };
  }

  it("returns the locked retention policy without deleting records", async () => {
    const client = prisma();
    const result = await new DraftRetentionService(client as never).preview();

    expect(result).toMatchObject({
      mode: "preview_only",
      executionAllowed: false,
      policyVersion: "contract-draft-retention-v2",
      businessDraftPurgeEnabled: false
    });
    expect(
      result.categories.map((category) => [
        category.key,
        category.retentionDays,
        category.applyScope
      ])
    ).toEqual([
      ["unbound_temporary_file", 1, "temporary"],
      ["contract_bill_import_preview", 7, "temporary"],
      ["settlement_contract_import_preview", 7, "temporary"],
      ["render_intermediate_file", 0, "temporary"],
      ["contract_draft_preview_superseded", 0, "temporary"],
      ["contract_draft_save_receipt", 7, "temporary"],
      ["pristine_abandoned_contract_draft", 7, "business_purge"],
      ["contract_draft_checkpoint", null, "retain_only"]
    ]);
    expect(result.categories.at(-1)).toMatchObject({
      candidateCount: 0,
      rule: expect.stringMatching(/Release C1.*只读保留/u)
    });
    expect(client.contractVersion.count).toHaveBeenCalledWith({
      where: {
        status: "abandoned",
        abandonedAt: { lt: expect.any(Date) },
        abandonReason: null,
        changeType: "original",
        versionNo: 1
      }
    });
    expect(result.categories.find((category) => category.key === "pristine_abandoned_contract_draft"))
      .toMatchObject({
        rule: expect.stringMatching(/effective\/superseded（含历史生效版本）永久排除/u)
      });
    expect(client.$transaction).not.toHaveBeenCalled();
  });

  it("fails closed and reports zero file candidates when the scan is truncated", async () => {
    const files = Array.from({ length: 501 }, (_, index) => ({
      id: `file-${index}`,
      createdAt: old,
      supersedesFileObjectId: null
    }));
    const client = prisma(files);
    const result = await new DraftRetentionService(client as never).preview();
    const category = result.categories.find(
      (item) => item.key === "unbound_temporary_file"
    );

    expect(result.fileScanTruncated).toBe(true);
    expect(category).toMatchObject({
      candidateCount: 0,
      blockedReason: "FILE_SCAN_TRUNCATED"
    });
    expect(client.$transaction).not.toHaveBeenCalled();
  });

  it("treats every replacement-chain member as bound", async () => {
    const client = prisma([
      {
        id: "file-old",
        createdAt: old,
        supersedesFileObjectId: null
      },
      {
        id: "file-new",
        createdAt: old,
        supersedesFileObjectId: "file-old"
      }
    ]);
    const result = await new DraftRetentionService(client as never).preview();
    const category = result.categories.find(
      (item) => item.key === "unbound_temporary_file"
    );

    expect(category?.candidateCount).toBe(0);
  });

  it("keeps the HTTP execution entry fail-closed", async () => {
    const service = new DraftRetentionService({} as never);
    await expect(service.controlledEntry("execute")).rejects.toBeInstanceOf(
      ForbiddenException
    );
  });
});
