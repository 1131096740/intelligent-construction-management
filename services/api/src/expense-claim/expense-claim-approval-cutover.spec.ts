import { activeApprovalNodeIndexes } from "../approval/parallel-approval-protocol";
import { createHash } from "node:crypto";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../database/prisma.service";
import { migrateLegacyExpenseApprovalRound, planLegacyExpenseApproval } from "./expense-claim-approval-cutover";

const groups = [
  { name: "综合部主管", mode: "any", roleKeys: ["comprehensive_director"],
    approvedRoleKeys: ["comprehensive_director"], candidateUserIdsByRole: { comprehensive_director: ["first"] } },
  { name: "项目经理", mode: "any", roleKeys: ["project_manager"], candidateUserIdsByRole: { project_manager: ["manager"] } },
  { name: "财务主管", mode: "any", roleKeys: ["finance_director"], candidateUserIdsByRole: { finance_director: ["finance"] } },
  { name: "负责人", mode: "any", roleKeys: ["chairman", "general_manager"],
    candidateUserIdsByRole: { chairman: ["chair"], general_manager: ["gm"] } }
];
const round = { applicantUserId: "applicant", currentNodeIndex: 1, frozenNodes: groups };
const approval = {
  id: "approved-1", action: "approve", approvedRoleKey: "comprehensive_director", actorUserId: "first",
  representedUserId: "first", signatureFileIdSnapshot: "private-file",
  signatureSha256Snapshot: "a".repeat(64), signatureVersionIdSnapshot: "private-version"
};

describe("legacy reimbursement approval cutover", () => {
  it("retains original group assignments and activates all unfinished groups at once", () => {
    const plan = planLegacyExpenseApproval(round, [approval]);
    expect(plan.completedActionIds).toEqual([approval.id]);
    expect(plan.pendingNodeIndexes).toEqual([1, 2, 3]);
    expect(activeApprovalNodeIndexes(plan.nodes, round.currentNodeIndex)).toEqual([1, 2, 3]);
    expect(plan.nodes).toEqual(groups.map(group => ({
      ...group, protocolVersion: 1, executionMode: "parallel"
    })));
  });

  it.each([
    { ...approval, signatureVersionIdSnapshot: null },
    { ...approval, actorUserId: "another-user", representedUserId: "another-user" },
    { ...approval, approvedRoleKey: "finance_director" },
    { ...approval, representedUserId: "another-user" }
  ])("stops when a historical approval cannot be tied to the original duty and signature", log => {
    expect(() => planLegacyExpenseApproval(round, [log])).toThrow("无法唯一对应");
  });

  it("preserves frozen candidate policy rather than accepting a dynamic policy marker on a legacy round", () => {
    const frozenNodes = [groups[0], { ...groups[1], candidatePolicy: "current_role_scope" }, ...groups.slice(2)];
    expect(() => planLegacyExpenseApproval({ ...round, frozenNodes }, [approval])).toThrow("无法唯一对应");
  });

  it("stops when an unfinished group contains an unknown historical assignment", () => {
    const frozenNodes = [groups[0], { ...groups[1], assignments: [
      { kind: "delegate", fromUserId: "manager", fromRoleKey: "project_manager", toUserId: "other" }
    ] }, ...groups.slice(2)];
    expect(() => planLegacyExpenseApproval({ ...round, frozenNodes }, [approval])).toThrow("无法唯一对应");
  });
});

const pgCutover = process.env.RUN_EXPENSE_CUTOVER_PG16 === "1" ? describe : describe.skip;
pgCutover("legacy reimbursement cutover on PostgreSQL", () => {
  it("preserves signature and monetary rows, queues once, and rejects stale coordinates", async () => {
    const connection = new URL(process.env.DATABASE_URL ?? "");
    expect(connection.hostname).toBe("127.0.0.1");
    expect(connection.pathname).toBe("/jiangkong_expense_cutover_test");
    const prisma = new PrismaService();
    try {
      const actor = await prisma.user.create({ data: { name: "隔离演练操作人" } });
      const signer = await prisma.user.create({ data: { name: "隔离演练签批人" } });
      const claim = await prisma.expenseClaim.create({ data: {
        code: "EXPENSE-CUTOVER-TEST", companyEntityId: "isolated-company", companyEntityNameSnapshot: "隔离主体",
        claimType: "reimbursement", status: "approval_pending", applicantUserId: actor.id,
        applicantNameSnapshot: actor.name, handledByUserId: actor.id, handledByNameSnapshot: actor.name,
        reason: "隔离演练", requestedAmountCents: 20000n, loanOffsetAmountCents: 3000n,
        companyPayableAmountCents: 17000n
      } });

      const originalDuties = [{ ...groups[0],
        candidateUserIdsByRole: { comprehensive_director: [signer.id] } }, ...groups.slice(1)];
      const instance = await prisma.approvalInstance.create({ data: {
        flowType: "expense_claim.approve", businessType: "expense_claim", businessId: claim.id,
        status: "in_progress", currentNodeIndex: 1, frozenNodes: originalDuties, applicantUserId: actor.id
      } });
      const before = await prisma.expenseClaim.update({
        where: { id: claim.id }, data: { approvalInstanceId: instance.id }
      });
      const buffer = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=", "base64");
      const sha256 = createHash("sha256").update(buffer).digest("hex");
      const file = await prisma.fileObject.create({ data: {
        bucket: "isolated", objectKey: "isolated-signature", originalName: "signature.png", mimeType: "image/png",
        sizeBytes: buffer.length, contentSha256: sha256, uploadedByUserId: signer.id
      } });
      const signature = await prisma.handwrittenSignatureVersion.create({ data: {
        userId: signer.id, fileId: file.id, contentSha256: sha256
      } });
      const historical = await prisma.approvalActionLog.create({ data: {
        approvalInstanceId: instance.id, action: "approve", actorUserId: signer.id, representedUserId: signer.id,
        approvedRoleKey: "comprehensive_director", signatureFileIdSnapshot: file.id,
        signatureVersionIdSnapshot: signature.id, signatureSha256Snapshot: sha256
      } });

      const files = { getFileBuffer: jest.fn().mockResolvedValue({ file, buffer }) };
      const notifications = { queueApprovalDuties: jest.fn().mockResolvedValue(true), afterCommit: jest.fn() };
      const coordinates = { approvalInstanceId: instance.id, claimUpdatedAt: before.updatedAt, approvalUpdatedAt: instance.updatedAt };
      const run = (expected = coordinates) => migrateLegacyExpenseApprovalRound(
        prisma, new AuditService(), files, notifications, claim.id, actor.id, expected
      );
      await expect(run({ ...coordinates, approvalUpdatedAt: new Date(0) })).rejects.toThrow("已变化");
      await expect(run()).resolves.toEqual({ status: "mapped", pendingNodeIndexes: [1, 2, 3] });
      await expect(run()).resolves.toEqual({ status: "already_mapped" });
      const after = await prisma.approvalInstance.findUniqueOrThrow({ where: { id: instance.id } });
      expect(activeApprovalNodeIndexes(after.frozenNodes, after.currentNodeIndex)).toEqual([1, 2, 3]);
      expect(await prisma.expenseClaim.findUnique({ where: { id: claim.id } })).toEqual(before);
      expect(await prisma.approvalActionLog.findUnique({ where: { id: historical.id } })).toEqual(historical);
      const [audit] = await prisma.auditLog.findMany({ where: { businessId: claim.id } });
      expect(audit.metadata).toMatchObject({ completedActionIds: [historical.id], pendingNodeIndexes: [1, 2, 3] });
      expect(await prisma.auditLog.count({ where: { businessId: claim.id } })).toBe(1);
      expect(notifications.queueApprovalDuties).toHaveBeenCalledTimes(1);
      expect(notifications.afterCommit).toHaveBeenCalledTimes(1);
    } finally {
      await prisma.$disconnect();
    }
  });
});
