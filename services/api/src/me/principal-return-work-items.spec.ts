import { Prisma } from "@prisma/client";
import type { PrismaService } from "../database/prisma.service";
import { principalReturnPayableScopeKeys, resolvePrincipalReturnReviewIdentity } from "../fund-account/fund-principal-return.service";
import { principalReturnWorkItems } from "./principal-return-work-items";

jest.mock("../fund-account/fund-principal-return.service", () => ({
  ...jest.requireActual("../fund-account/fund-principal-return.service"),
  principalReturnPayableScopeKeys: jest.fn(),
  resolvePrincipalReturnReviewIdentity: jest.fn(),
}));

const payableScopes = jest.mocked(principalReturnPayableScopeKeys);
const resolveReview = jest.mocked(resolvePrincipalReturnReviewIdentity);
const exact = (amount: string) => new Prisma.Decimal(amount);
const queryRows = [
  { id: "review", status: "pending", projectId: "project", contributorName: "合成出资人一",
    approvalInstanceId: "round", requestedYuan: exact("2.1001"), paidYuan: exact("0"), approvedYuan: null, createdByUserId: "applicant" },
  { id: "part", status: "partially_paid", projectId: null, contributorName: "合成出资人二",
    approvalInstanceId: "closed", requestedYuan: exact("5.1000"), paidYuan: exact("4.0999"), approvedYuan: exact("5.1000"), createdByUserId: "applicant" },
];
const rounds = [{
  id: "round", businessId: "review", status: "approval_pending", businessType: "registered_principal_return", currentNodeIndex: 0,
  frozenNodes: [
    { protocolVersion: 1, executionMode: "parallel", mode: "any", roleKeys: ["finance_director"], approvedRoleKeys: [] },
    { protocolVersion: 1, executionMode: "parallel", mode: "any", roleKeys: ["chairman"], approvedRoleKeys: ["chairman"] },
  ],
}];

function database(active = true) {
  const tx = {
    user: { findUnique: jest.fn().mockResolvedValue({ isActive: active }) },
    registeredPrincipalReturnApplication: { findMany: jest.fn().mockResolvedValue(queryRows) },
    approvalInstance: { findMany: jest.fn().mockResolvedValue(rounds) },
    project: { findMany: jest.fn().mockResolvedValue([{ id: "project", name: "合成项目" }]) },
  };
  return { tx, prisma: { ...tx, $transaction: async (read: (value: typeof tx) => unknown) => read(tx) } as unknown as PrismaService };
}

describe("principal return work items", () => {
  beforeEach(() => {
    payableScopes.mockReset().mockResolvedValue([]);
    resolveReview.mockReset().mockResolvedValue(null);
  });

  it("retains the exact four-place remainder for a payer and hides it from an ineligible actor", async () => {
    const { prisma } = database();
    payableScopes.mockResolvedValueOnce(["company:synthetic"]);
    await expect(principalReturnWorkItems(prisma, "finance", "pending")).resolves.toMatchObject([
      { id: "principal-return-pay:part", targetPath: "/垫资本金归还/part", amountText: "待归还 ¥1.0001" },
    ]);
    await expect(principalReturnWorkItems(prisma, "other", "pending")).resolves.toEqual([]);
  });

  it("keeps pending approvals readable without querying prepared funding when no principal is outstanding", async () => {
    const { prisma, tx } = database();
    tx.registeredPrincipalReturnApplication.findMany.mockResolvedValueOnce([
      queryRows[0], { ...queryRows[1], paidYuan: queryRows[1].approvedYuan },
    ]);
    resolveReview.mockResolvedValueOnce({ identity: {
      viaAssignment: false, approvedRoleKey: "finance_director", representedUserId: "finance",
    }, roles: ["finance_director"] });
    payableScopes.mockRejectedValue(new Error("Payment runtime preparation is unavailable"));
    await expect(principalReturnWorkItems(prisma, "finance", "pending")).resolves.toMatchObject([
      { id: "principal-return-review:round:0" },
    ]);
    expect(payableScopes).not.toHaveBeenCalled();
    expect(tx.registeredPrincipalReturnApplication.findMany).toHaveBeenCalledTimes(1);
  });

  it("keeps the last fractional digit at the account precision limit", async () => {
    const { prisma, tx } = database();
    tx.registeredPrincipalReturnApplication.findMany.mockResolvedValueOnce([
      { ...queryRows[1], id: "large", approvedYuan: exact("90000000000000000000.0001"), paidYuan: exact("0.0000") },
    ]);
    payableScopes.mockResolvedValueOnce(["company:synthetic"]);
    await expect(principalReturnWorkItems(prisma, "finance", "pending")).resolves.toMatchObject([
      { amountText: "待归还 ¥90000000000000000000.0001" },
    ]);
  });

  it("shows only outstanding duties and drops the item when current scope is lost", async () => {
    const { prisma } = database();
    resolveReview.mockResolvedValueOnce({ identity: { viaAssignment: true, approvedRoleKey: "finance_director", representedUserId: "reviewer" }, roles: [] });
    await expect(principalReturnWorkItems(prisma, "delegate", "delegated")).resolves.toMatchObject([
      { id: "principal-return-review:round:0", targetPath: "/垫资本金归还/review", type: "approval" },
    ]);
    expect(resolveReview).toHaveBeenCalledTimes(1);
    await expect(principalReturnWorkItems(prisma, "delegate", "delegated")).resolves.toEqual([]);
  });
});
