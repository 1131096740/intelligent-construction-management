import { freezeHistoricalDownstreamSettlementAuthority } from "./historical-settlement-authority";

const signingDate = new Date("2026-09-01");
const signedHistory = {
  projectId: "project",
  signedAt: signingDate,
  relationship: "outside" as const,
  companyEntityId: null,
  counterparty: "原合同供应商",
  counterpartyVersionId: "supplier-version",
  signingPartyVersionId: "builder-version"
};

function fixture() {
  const tx = {
    businessPartyVersion: { findUnique: jest.fn().mockImplementation(({ where }) => {
      if (where.id === "supplier-version") return { businessPartyId: "supplier", snapshot: { name: "原合同供应商" } };
      if (where.id === "builder-version") return { businessPartyId: "builder", snapshot: { name: "原施工企业" } };
      return null;
    }) },
    projectAffiliateAssignment: { findFirst: jest.fn().mockResolvedValue({
      id: "signed-assignment", businessPartyVersionId: "builder-version", affiliateNameSnapshot: "原施工企业"
    }) },
    projectParticipatingCompany: { findMany: jest.fn() }
  };
  return tx;
}

describe("historical signed-settlement authority", () => {
  it("freezes the explicitly selected original outside parties at the signing date", async () => {
    const tx = fixture();
    await expect(freezeHistoricalDownstreamSettlementAuthority(tx as never, signedHistory)).resolves.toEqual({
      status: "verified", relationship: "outside",
      signingParty: "原施工企业", payerKind: "construction_enterprise", payerVersionId: "builder-version",
      counterparty: "原合同供应商", counterpartyKind: "downstream_counterparty", counterpartyVersionId: "supplier-version",
      companyEntityId: null, affiliateAssignmentId: "signed-assignment", affiliateBusinessPartyVersionId: "builder-version"
    });
    expect(tx.projectAffiliateAssignment.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ projectId: "project", AND: expect.arrayContaining([{ effectiveFrom: { lte: signingDate } }]) })
    }));
  });

  it("keeps blank original authority unresolved even with an available current project party", async () => {
    const tx = fixture();
    await expect(freezeHistoricalDownstreamSettlementAuthority(tx as never, {
      ...signedHistory, signingPartyVersionId: null
    })).resolves.toEqual({ status: "unresolved", relationship: "outside" });
    expect(tx.projectAffiliateAssignment.findFirst).not.toHaveBeenCalled();
  });

  it("rejects a current or different construction entity as the original signing party", async () => {
    await expect(freezeHistoricalDownstreamSettlementAuthority(fixture() as never, {
      ...signedHistory, signingPartyVersionId: "selected-current-builder"
    })).rejects.toThrow("原签约施工企业与合同签订日的施工企业版本不一致");
  });

  it("rejects a typed partner whose version does not match the original counterparty", async () => {
    await expect(freezeHistoricalDownstreamSettlementAuthority(fixture() as never, {
      ...signedHistory, counterparty: "不是该版本的原合同相对方"
    })).rejects.toThrow("相对方版本与原合同相对方不一致");
  });

  it("freezes the declared inside company from its signing-day participation", async () => {
    const tx = fixture();
    tx.projectParticipatingCompany.findMany.mockResolvedValue([{
      companyEntityId: "inside-company", companyEntityVersionId: "company-version", companyNameSnapshot: "原我方公司"
    }]);
    await expect(freezeHistoricalDownstreamSettlementAuthority(tx as never, {
      ...signedHistory, relationship: "inside", companyEntityId: "inside-company", signingPartyVersionId: null
    })).resolves.toMatchObject({
      status: "verified", relationship: "inside", signingParty: "原我方公司",
      payerKind: "participating_company", payerVersionId: "company-version",
      companyEntityId: "inside-company", counterpartyVersionId: "supplier-version"
    });
    expect(tx.projectParticipatingCompany.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ companyEntityId: "inside-company", effectiveFrom: { lte: signingDate } })
    }));
  });
});
