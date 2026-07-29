import {
  calculateContractOwnerRisk,
  DOWNSTREAM_CONTRACT_OCCUPANCY_STATUSES,
  loadContractOwnerRisk
} from "./contract-owner-risk";

describe("contract owner master risk", () => {
  it("returns a visible non-blocking risk when no effective owner contract exists", () => {
    expect(
      calculateContractOwnerRisk({
        ownerContractAmounts: [],
        downstreamVersions: [
          { contractId: "contract-1", amountCents: 5000n, signingSubjectType: "our_company" }
        ]
      })
    ).toEqual({
      status: "missing_owner_contract",
      ownerContractAmountCents: 0n,
      downstreamContractAmountCents: 5000n,
      excessAmountCents: 5000n
    });
  });

  it("uses only our-company contract occupancy and reports the exact excess", () => {
    expect(
      calculateContractOwnerRisk({
        ownerContractAmounts: [10000n],
        downstreamVersions: [
          { contractId: "contract-1", amountCents: 7000n, signingSubjectType: "our_company" },
          { contractId: "contract-1", amountCents: 9000n, signingSubjectType: "our_company" },
          { contractId: "contract-2", amountCents: 4000n, signingSubjectType: "our_company" },
          { contractId: "affiliate-1", amountCents: 999999n, signingSubjectType: "affiliate" }
        ]
      })
    ).toEqual({
      status: "exceeds_owner_contract",
      ownerContractAmountCents: 10000n,
      downstreamContractAmountCents: 13000n,
      excessAmountCents: 3000n
    });
  });

  it("loads every pre-effective and effective our-company occupancy state", async () => {
    const tx = {
      projectOwnerContract: {
        findMany: jest.fn().mockResolvedValue([{ amountCents: 10000n }])
      },
      contract: {
        findMany: jest.fn().mockResolvedValue([{ id: "contract-1" }])
      },
      contractVersion: {
        findMany: jest.fn().mockResolvedValue([
          {
            contractId: "contract-1",
            amountCents: 9000n,
            signingSubjectType: "our_company"
          }
        ])
      }
    };

    await expect(
      loadContractOwnerRisk(tx as never, "project-1")
    ).resolves.toMatchObject({
      status: "clear",
      downstreamContractAmountCents: 9000n
    });
    expect(tx.contractVersion.findMany).toHaveBeenCalledWith({
      where: {
        contractId: { in: ["contract-1"] },
        signingSubjectType: "our_company",
        status: { in: [...DOWNSTREAM_CONTRACT_OCCUPANCY_STATUSES] }
      },
      select: {
        contractId: true,
        amountCents: true,
        signingSubjectType: true
      }
    });
  });
});
