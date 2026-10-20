import { ContractOperatingSourceAdapter } from "./contract-operating-source.adapter";
import { reduceOperatingProjection } from "../operating-projection/operating-projection.reducer";
import type { OperatingSourceSnapshot } from "../operating-ledger/operating-source-adapter";
const adapter = new ContractOperatingSourceAdapter();
function snapshot(delta: string, id: string): OperatingSourceSnapshot {
  return { projectId: "p", sourceType: "contract_version", sourceBusinessId: id, sourceBusinessCode: "合同一", sourceVersion: 1, status: "confirmed", sourceSnapshot: {
    signingSubjectType: "our_company", companyEntityVersionId: "company", contractRelationship: "inside",
    counterpartyName: "供应商", counterpartyVersionId: "supplier-v1", commitmentDeltaCents: delta, amountNature: "fixed", occurredAt: "2026-10-01T00:00:00.000Z",
    confirmedAt: "2026-10-01T00:00:00.000Z", confirmedByUserId: "confirmer", operatingLedgerEffectiveDate: "2026-09-01T00:00:00.000Z",
    affiliate: { assignmentId: "a", businessPartyVersionId: "av", name: "施工企业" }
  } };
}
describe("合同承诺与成本分离", () => {
  it.each([["capped", 600000000n, "100000000"], ["capped", 480000000n, "-20000000"], ["uncapped", 0n, "-500000000"]])("从正式版本推导%s金额%s的差额为%s", async (amountLimitType, amountCents, expected) => {
    const first = { id: "v1", contractId: "c", effectiveAt: new Date("2026-09-01"), amountLimitType: "capped", amountCents: 500000000n };
    const second = { id: "v2", contractId: "c", versionNo: 2, effectiveAt: new Date("2026-10-01"), amountLimitType, amountCents, supersedesVersionId: "v1", signingSubjectType: "our_company", companyEntityVersionId: "company-v1" };
    const tx = { contractEconomicReview:{findMany:jest.fn().mockResolvedValue([])}, operatingFact:{findFirst:jest.fn().mockResolvedValue(null)}, contractVersion: { findUnique: jest.fn().mockResolvedValue(second), findUniqueOrThrow: jest.fn(async ({ where }: { where: { id: string } }) => where.id === "v1" ? first : second) },
      contract: { findFirst: jest.fn().mockResolvedValue({ id: "c" }), findUniqueOrThrow: jest.fn().mockResolvedValue({ id: "c", projectId: "p", code: "HT1", counterparty: "供应商" }) },
      contractArchiveFile: { findFirst: jest.fn().mockResolvedValue({ confirmedByUserId: "reviewer" }) }, contractFormalFile: { findFirst: jest.fn().mockResolvedValue(null) }, contractTakeover: { findFirst: jest.fn().mockResolvedValue(null) },
      project: { findUnique: jest.fn().mockResolvedValue({ operatingLedgerEffectiveDate: new Date("2026-09-01") }) },
      projectAffiliateAssignment: { findFirst: jest.fn().mockResolvedValue({ id: "a", businessPartyVersionId: "av", affiliateNameSnapshot: "施工企业" }) },
      contractPartySnapshot: { findFirst: jest.fn().mockResolvedValue({ businessPartyVersionId: "supplier-v1" }) }
    };
    const result = await adapter.readSourceSnapshot(tx as never, { projectId: "p", sourceType: "contract_version", sourceBusinessId: "v2" });
    expect(tx.contractFormalFile.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ status: "active", purpose: "mutually_signed_final", confirmedAt: { not: null }, confirmedByUserId: { not: null } }) }));
    expect(result?.sourceSnapshot.commitmentDeltaCents).toBe(expected);
    expect(result?.sourceSnapshot.counterpartyVersionId).toBe("supplier-v1");
  });
  it("500万元合同增加100万元再减少20万元，承诺580万元、成本仍零", () => {
    const facts = ["500000000", "100000000", "-20000000"].map((delta, index) => {
      const source = snapshot(delta, String(index)); const { input } = adapter.toOperatingFactInput(source);
      expect(input.impacts.map((i) => i.impactKind)).toEqual(["contract_commitment_reference"]);
      return { id: String(index), projectId: "p", projectCode: "项目一", projectName: "项目一", sourceType: input.sourceType,
        sourceBusinessId: input.sourceBusinessId, sourceVersion: 1, sourceBusinessCode: "合同一",
        occurredAt: input.occurredAt.toISOString(), confirmedAt: input.confirmedAt.toISOString(),
        affiliateBusinessPartyVersionId: "av", affiliateNameSnapshot: "施工企业", factKind: input.factKind,
        operatingLevel: input.operatingLevel, evidenceLevel: input.evidenceLevel, amountCents: input.amountCents,
        direction: input.direction, sourceSnapshot: input.sourceSnapshot, entryKind: "original",
        impacts: input.impacts.map((impact) => ({ ...impact, id: String(index) })) };
    });
    const result = reduceOperatingProjection({ scope: { kind: "project", projectId: "p", projectIds: ["p"] },
      readAt: "2026-10-19T00:00:00.000Z", cutoffAt: "2026-10-19T00:00:00.000Z", facts, riskByProject: [] });
    expect(result.commitments.contractCommitmentCents).toBe("580000000");
    expect(result.operating.confirmedCostCents).toBe("0");
    expect(result.operating.payableCents).toBe("0");
    expect(result.relationshipTotals?.find((r) => r.relationship === "inside")?.contractCommitmentCents).toBe("580000000");
  });
  it("拒绝缺少真实签约公司", () => {
    const source = snapshot("100", "1"); source.sourceSnapshot = { ...source.sourceSnapshot, companyEntityVersionId: null };
    expect(() => adapter.toOperatingFactInput(source)).toThrow("签约主体");
  });
  it("明确未定合同不会伪造成本或应付", () => {
    const source = snapshot("0", "1"); source.sourceSnapshot = { ...source.sourceSnapshot, amountNature: "uncapped" };
    const { input } = adapter.toOperatingFactInput(source);
    expect(input.amountCents).toBe(0n);
    expect(input.basisSnapshot).toMatchObject({ amountNature: "uncapped" });
  });
});
