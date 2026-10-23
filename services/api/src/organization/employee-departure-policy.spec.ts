import type { Prisma } from "@prisma/client";
import { resolveApprovalReviewIdentity, type FrozenApprovalNode } from "../approval/approval-review-identity";
import { employeeDepartureBlockingReasons, evaluateEmployeeDeparture } from "./employee-departure-policy";

const now = new Date("2026-10-23T01:00:00.000Z");
const completed: FrozenApprovalNode = { name: "两岗位会签", mode: "all", roleKeys: ["contract_director", "finance_director"],
  approvedRoleKeys: ["contract_director"], candidateUserIds: ["signed", "pending"],
  candidateUserIdsByRole: { contract_director: ["signed"], finance_director: ["pending"] } };
function reasons(userId: string, nodes: unknown[] = [completed]) {
  return employeeDepartureBlockingReasons(userId, [{ applicantUserId: "applicant", currentNodeIndex: 0,
    frozenNodes: nodes as Prisma.JsonArray }], [], now);
}

describe("员工离职仅保护尚未完成的冻结责任", () => {
  it("复用真实审批身份的待办定义：已会签A不可再签且可离职，未签B仍阻断", async () => {
    expect(resolveApprovalReviewIdentity({ node: completed, actorUserId: "signed", actorRoleKeys: ["contract_director"] })).toBeNull();
    expect(resolveApprovalReviewIdentity({ node: completed, actorUserId: "pending", actorRoleKeys: ["finance_director"] })).toMatchObject({ approvedRoleKey: "finance_director" });
    const tx = { approvalInstance: { findMany: jest.fn().mockResolvedValue([{ applicantUserId: "applicant", currentNodeIndex: 0, frozenNodes: [completed] }]) },
      approvalDelegation: { findMany: jest.fn().mockResolvedValue([]) } };
    await expect(evaluateEmployeeDeparture(tx as unknown as Prisma.TransactionClient, "signed", now)).resolves.toEqual([]);
    await expect(evaluateEmployeeDeparture(tx as unknown as Prisma.TransactionClient, "pending", now)).resolves.toContain("仍有当前或未来冻结审批任务，请先完成或在原业务交接");
  });

  it("已完成岗位的旧转审两方可离开，未完成岗位的转审两方继续受保护", () => {
    const nodes = [{ ...completed, assignments: [
      { kind: "transfer", fromUserId: "signed", toUserId: "signed-transfer", fromRoleKey: "contract_director" },
      { kind: "transfer", fromUserId: "pending", toUserId: "pending-transfer", fromRoleKey: "finance_director" }
    ] }];
    expect(reasons("signed", nodes)).toEqual([]); expect(reasons("signed-transfer", nodes)).toEqual([]);
    expect(reasons("pending", nodes)).not.toEqual([]); expect(reasons("pending-transfer", nodes)).not.toEqual([]);
  });

  it("下一节点再次安排已会签人、同人另有未签岗位以及或签未办均保留阻断", () => {
    expect(reasons("signed", [completed, { ...completed, approvedRoleKeys: [] }])).not.toEqual([]);
    expect(reasons("signed", [{ ...completed, candidateUserIdsByRole: { contract_director: ["signed"], finance_director: ["signed"] } }])).not.toEqual([]);
    expect(reasons("signed", [{ ...completed, mode: "any", approvedRoleKeys: [] }])).not.toEqual([]);
  });

  it("没有角色映射的legacy及未知转审岗位不能证明完成，继续fail closed", () => {
    const legacy = { ...completed, candidateUserIdsByRole: undefined };
    expect(reasons("signed", [legacy])).not.toEqual([]);
    expect(reasons("signed", [{ ...completed, roleKeys: ["contract_director", "unknown_role"] }])).not.toEqual([]);
    expect(reasons("signed", [{ ...completed, approvedRoleKeys: ["contract_director", "unknown_role"] }])).not.toEqual([]);
    expect(reasons("unknown-transfer", [{ ...completed, assignments: [{ kind: "transfer", fromUserId: "signed",
      toUserId: "unknown-transfer" }] }])).not.toEqual([]);
  });

  it("legacy未知岗位被标记已完成时，转审双方仍不能据此解除责任", () => {
    const legacy = { name: "未知历史岗位", mode: "all", roleKeys: ["unknown_role"], approvedRoleKeys: ["unknown_role"],
      assignments: [{ kind: "transfer", fromUserId: "legacy-from", toUserId: "legacy-to", fromRoleKey: "unknown_role" }] };
    expect(reasons("legacy-from", [legacy])).not.toEqual([]);
    expect(reasons("legacy-to", [legacy])).not.toEqual([]);
  });

  it("未签岗位缺失或畸形映射时，已签候选与其转审双方仍保留责任阻断", () => {
    for (const candidateUserIdsByRole of [
      { contract_staff: ["u"] },
      { contract_staff: ["u"], finance_staff: null },
      { contract_staff: ["u"], finance_staff: [] },
      { contract_staff: ["u"], finance_staff: [" "] },
      { contract_staff: ["u"], finance_staff: ["v", 42] }
    ]) {
      const incomplete = { name: "旧会签映射待核对", mode: "all", roleKeys: ["contract_staff", "finance_staff"],
        approvedRoleKeys: ["contract_staff"], candidateUserIds: ["u", "v"], candidateUserIdsByRole };
      expect(reasons("u", [incomplete])).not.toEqual([]);
      const transferred = { ...incomplete, assignments: [{ kind: "transfer", fromUserId: "u", toUserId: "old-transfer", fromRoleKey: "contract_staff" }] };
      expect(reasons("u", [transferred])).not.toEqual([]);
      expect(reasons("old-transfer", [transferred])).not.toEqual([]);
    }
  });
});
