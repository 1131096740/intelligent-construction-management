import type { Prisma } from "@prisma/client";
import { resolvePrincipalReturnReviewIdentity } from "../fund-account/fund-principal-return.service";
import { loadPrincipalReturnDelegationDuty } from "./principal-return-delegation";

jest.mock("../fund-account/fund-principal-return.service", () => ({
  ...jest.requireActual("../fund-account/fund-principal-return.service"),
  resolvePrincipalReturnReviewIdentity: jest.fn(),
}));

const resolveReview = jest.mocked(resolvePrincipalReturnReviewIdentity);
const roundId = "round";
const current = {
  id: roundId, businessId: "application", businessType: "registered_principal_return",
  status: "approval_pending", currentNodeIndex: 0,
  frozenNodes: [
    { protocolVersion: 1, executionMode: "parallel", mode: "any", roleKeys: ["finance_director"], approvedRoleKeys: [] },
    { protocolVersion: 1, executionMode: "parallel", mode: "any", roleKeys: ["chairman"], approvedRoleKeys: ["chairman"] },
  ],
};
const app = { id: "application", status: "pending", projectId: "project", contributorName: "合成出资人", createdByUserId: "applicant" };
const identity = { approvedRoleKey: "finance_director", representedUserId: "holder", viaAssignment: false } as const;

function database(application = app, round = current) {
  return {
    approvalInstance: { findUnique: jest.fn().mockResolvedValue(round) },
    registeredPrincipalReturnApplication: { findUnique: jest.fn().mockResolvedValue(application) },
  } as unknown as Prisma.TransactionClient;
}

describe("principal return delegation scope", () => {
  beforeEach(() => { resolveReview.mockReset(); });

  it("resolves the exact unfinished duty against the original project and current holder", async () => {
    resolveReview.mockResolvedValue({ identity, roles: ["finance_director"] });
    const tx = database();
    await expect(loadPrincipalReturnDelegationDuty(tx, "holder", "round:0")).resolves.toMatchObject({
      resourceId: "round:0", applicationId: "application", actionKey: "fund_account.principal_return.review",
    });
    expect(resolveReview).toHaveBeenCalledWith(tx, "holder", "project", "round", 0, current.frozenNodes[0], true);
  });

  it.each(["round:1", "round:00"])("rejects completed or noncanonical duty %s", async resourceId => {
    await expect(loadPrincipalReturnDelegationDuty(database(), "holder", resourceId)).rejects.toThrow("职责已结束或不匹配");
    expect(resolveReview).not.toHaveBeenCalled();
  });

  it("rejects a stale application binding or onward delegation by a representative", async () => {
    await expect(loadPrincipalReturnDelegationDuty(database({ ...app, id: "other" }), "holder", "round:0"))
      .rejects.toThrow("审批记录已变化");
    resolveReview.mockResolvedValue({ identity: { ...identity, viaAssignment: true }, roles: [] });
    await expect(loadPrincipalReturnDelegationDuty(database(), "delegate", "round:0")).rejects.toThrow("无权");
    await expect(loadPrincipalReturnDelegationDuty(database(), "delegate", "round:0", false)).resolves.toMatchObject({ applicationId: "application" });
  });
});
