import { ProjectUpstreamFundBusinessEntryService } from "./project-upstream-fund-business-entry.service";

describe("ProjectUpstreamFundBusinessEntryService", () => {
  it("freezes the authoritative remittance routing in the same transaction", async () => {
    const audit = { record: jest.fn().mockResolvedValue(undefined) };
    const tx = {
      businessEntrySubmissionSnapshot: {
        create: jest.fn().mockResolvedValue({ id: "snapshot-1" })
      }
    };
    const service = new ProjectUpstreamFundBusinessEntryService(audit as never);

    const result = await service.freeze(tx as never, "finance-1", {
      id: "fact-1",
      projectId: "project-1",
      factType: "affiliate_remittance_to_company",
      basisType: "written",
      occurredAt: new Date("2026-09-19T00:00:00.000Z"),
      amountCents: 12345n,
      counterpartyName: "我方一公司",
      companyEntityId: "company-1",
      affiliateCompanyContractId: "contract-1",
      affiliateSettlementFactId: "settlement-1",
      invoiceRecordId: "invoice-1",
      upstreamSettlementId: null,
      deductionCategory: null,
      description: "施工企业拨款"
    });

    expect(result).toMatchObject({
      sceneKey: "project_upstream_fund_fact",
      revision: 1,
      values: {
        amountYuan: "123.45",
        companyEntityId: "company-1",
        affiliateCompanyContractId: "contract-1",
        affiliateSettlementFactId: "settlement-1",
        invoiceRecordId: "invoice-1"
      }
    });
    expect(tx.businessEntrySubmissionSnapshot.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        projectId: "project-1",
        entityType: "project_upstream_fund_fact",
        entityId: "fact-1",
        revision: 1,
        frozenByUserId: "finance-1"
      })
    });
    expect(audit.record).toHaveBeenCalledWith(tx, expect.objectContaining({
      action: "business_entry.freeze",
      businessId: "fact-1"
    }));
  });
});
