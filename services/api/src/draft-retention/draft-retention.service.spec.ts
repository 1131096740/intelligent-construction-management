import { ForbiddenException } from "@nestjs/common";
import { DraftRetentionService } from "./draft-retention.service";

describe("DraftRetentionService", () => {
  const old = new Date("2026-01-01T00:00:00.000Z");

  function delegate(dateKey: "createdAt" | "updatedAt") {
    return {
      count: jest.fn().mockResolvedValue(1),
      aggregate: jest.fn().mockResolvedValue({ _min: { [dateKey]: old } })
    };
  }

  it("returns a read-only policy preview without deleting records", async () => {
    const prisma = {
      settlementImport: delegate("updatedAt"),
      settlementTemplatePreviewJob: delegate("updatedAt"),
      contractLayoutPreviewJob: delegate("updatedAt"),
      contractBillImport: delegate("createdAt"),
      contractGeneratedDocument: delegate("updatedAt"),
      contractDocumentComparison: delegate("updatedAt"),
      contractDraftCheckpoint: delegate("createdAt"),
      fileObject: { findMany: jest.fn().mockResolvedValue([]) }
    };
    const result = await new DraftRetentionService(prisma as never).preview();

    expect(result).toMatchObject({
      mode: "preview_only",
      executionAllowed: false,
      policyVersion: "draft-retention-v1",
      totalCandidateCount: 7
    });
    expect(result.categories).toHaveLength(8);
    expect((prisma as Record<string, unknown>).delete).toBeUndefined();
  });

  it("fails closed when physical execution is requested", async () => {
    const service = new DraftRetentionService({} as never);
    await expect(service.controlledEntry("execute")).rejects.toBeInstanceOf(ForbiddenException);
  });
});
