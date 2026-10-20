import { Prisma } from "@prisma/client";
import { assertSettlementApplicant } from "./settlement-applicant";

describe("settlement applicant boundary", () => {
  it.each(["engineering_tech", "engineering_foreman", "engineering_director"])("allows same-project %s", async roleKey => {
    const tx = { $queryRaw: jest.fn().mockResolvedValue([{ projectId: "p", userId: "u", roleKey, userIsActive: true }]) };
    await expect(assertSettlementApplicant(tx as unknown as Prisma.TransactionClient, { projectId: "p", contractTypeKey: "labor_subcontract" }, "u")).resolves.toBeUndefined();
  });
  it("rejects a global or other-project engineer and contract-only labor applicants", async () => {
    for (const rows of [[], [{ projectId: "other", userId: "u", roleKey: "engineering_director", userIsActive: true }], [{ projectId: "p", userId: "u", roleKey: "contract_staff", userIsActive: true }]]) {
      const tx = { $queryRaw: jest.fn().mockResolvedValue(rows) };
      await expect(assertSettlementApplicant(tx as unknown as Prisma.TransactionClient, { projectId: "p", contractTypeKey: "professional_subcontract" }, "u")).rejects.toThrow("同项目");
    }
  });
});
