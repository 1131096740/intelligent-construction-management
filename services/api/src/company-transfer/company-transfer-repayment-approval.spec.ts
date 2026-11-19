import type { Prisma } from "@prisma/client";
import type { ProjectVisibilityService } from "../auth/project-visibility.service";
import { companyRepaymentApprovals, companyRepaymentDuties, isProjectProxyRepayment } from "./company-transfer-repayment-approval";

describe("project company proxy repayment duties", () => {
  it("does not reclassify a normal company loan return or a cross-project movement", () => {
    const terms = { kind: "repayment", sourceProjectId: "project", destinationProjectId: "project",
      originalProxyId: null, originalFundMovementRelationshipId: null, originalInterEntityRelationshipId: null };
    expect(isProjectProxyRepayment(terms)).toBe(false);
    expect(isProjectProxyRepayment({ ...terms, originalInterEntityRelationshipId: "root" })).toBe(true);
    expect(isProjectProxyRepayment({ ...terms, originalFundMovementRelationshipId: "root" }, "company_advance")).toBe(false);
    expect(isProjectProxyRepayment({ ...terms, destinationProjectId: "elsewhere", originalFundMovementRelationshipId: "root" })).toBe(false);
  });

  it("projects each independent pending duty and drops completed or revoked authority", async () => {
    let globalRoles = ["comprehensive_director", "finance_director", "general_manager"];
    let projectIds = ["project"];
    const tx = { $queryRaw: async () => globalRoles.map(key => ({ key })) } as unknown as Prisma.TransactionClient;
    const visibility = {
      visibleProjectIdsInTransaction: async () => projectIds,
      effectiveRoleKeysByProjectInTransaction: async () => new Map([["project", ["project_manager"]]]),
    } as unknown as ProjectVisibilityService;
    const nodes = companyRepaymentDuties();
    const currentDuties = () => companyRepaymentApprovals(tx, visibility, "applicant", "project", "applicant", nodes, 0);

    expect((await currentDuties()).map(({ nodeIndex, requiresSelfPassword }) => [nodeIndex, requiresSelfPassword])).toEqual([
      [0, true], [1, true], [2, true], [3, true],
    ]);
    nodes[3].approvedRoleKeys = ["general_manager"];
    globalRoles = ["comprehensive_director", "chairman"];
    projectIds = [];
    expect((await currentDuties()).map(({ nodeIndex }) => nodeIndex)).toEqual([0]);
  });
});
