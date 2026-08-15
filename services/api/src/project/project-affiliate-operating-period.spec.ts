import { ProjectService } from "./project.service";

describe("ProjectService construction-enterprise operating period", () => {
  it("rejects a construction enterprise that starts after an enabled operating ledger", async () => {
    const tx = {
      $queryRaw: jest.fn()
        .mockResolvedValueOnce([{
          id: "project-1",
          isActive: true,
          constructionEnterpriseLockedAt: null,
          operatingLedgerEffectiveDate: new Date("2026-08-01T00:00:00.000Z")
        }])
        .mockResolvedValueOnce([]),
      businessPartyVersion: { findUnique: jest.fn() }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx))
    };
    const service = new ProjectService(prisma as never);

    await expect(service.assignAffiliate("project-1", "finance-1", {
      businessPartyVersionId: "party-version-1",
      effectiveFrom: "2026-08-02T00:00:00.000Z",
      changeReason: "调整施工企业"
    })).rejects.toThrow("施工企业生效日不得晚于经营账生效日");
    expect(tx.businessPartyVersion.findUnique).not.toHaveBeenCalled();
  });
});
