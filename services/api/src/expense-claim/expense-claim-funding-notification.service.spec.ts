import type { ExpenseClaim, Prisma } from "@prisma/client";
import type { ApprovalSmsService } from "../approval/approval-sms.service";
import type { PrismaService } from "../database/prisma.service";
import { loadEffectiveProjectApprovalAssignments } from "../approval/project-approval-assignments";
import { ExpenseClaimFundingNotificationService } from "./expense-claim-funding-notification.service";

jest.mock("../approval/project-approval-assignments");

it("仅普通费用终审后为财务逐人入队，员工借款不再发资金通知", async () => {
  jest.mocked(loadEffectiveProjectApprovalAssignments).mockResolvedValue(["one", "one", "two"].map(userId => ({
    projectId: "project", userId, roleKey: "finance_staff", userIsActive: true
  })));
  const createMany = jest.fn().mockResolvedValue({ count: 2 });
  const tx = { project: { findUnique: jest.fn().mockResolvedValue({ isActive: true }) }, auditLog: { createMany } };
  const sms = { available: () => true, sendDutyIntent: jest.fn() } as unknown as ApprovalSmsService;
  const service = new ExpenseClaimFundingNotificationService({} as PrismaService, sms);
  const loan = { id: "loan", status: "approved_pending_disbursement", claimType: "loan", projectId: "project", requestedAmountCents: 100n, companyPayableAmountCents: 100n, fundedAmountCents: 0n } as ExpenseClaim;
  const reimbursement = { ...loan, id: "expense", status: "approved_pending_payment", claimType: "reimbursement" };
  const queue = (claim: ExpenseClaim) => service.queue(tx as unknown as Prisma.TransactionClient, claim, "approver");
  await expect(queue(loan)).resolves.toBe(false);
  await queue(reimbursement);
  await queue({ ...reimbursement, status: "offset_completed" });
  await queue({ ...reimbursement, projectId: null });
  await queue({ ...reimbursement, status: "partially_paid" });
  expect(createMany).toHaveBeenCalledTimes(1);
  expect(createMany.mock.calls[0][0]).toMatchObject({ skipDuplicates: true, data: [
    { businessId: "expense", metadata: { recipientId: "one", duty: "payment" } },
    { businessId: "expense", metadata: { recipientId: "two", duty: "payment" } }
  ] });
  expect(loadEffectiveProjectApprovalAssignments).toHaveBeenCalledWith(tx, "project", ["finance_staff"]);
  expect(sms.sendDutyIntent).not.toHaveBeenCalled();
});

it("保留普通费用的当前短信与重试边界，已入队员工借款停止发送", async () => {
  const assignment = (userId: string) => ({ projectId: "project", userId, roleKey: "finance_staff", userIsActive: true });
  jest.mocked(loadEffectiveProjectApprovalAssignments).mockImplementation(async (_tx, _project, _roles, userId) =>
    userId === "former" ? [] : userId ? [assignment(userId)] : [assignment("current"), assignment("former")]);
  const claim = { id: "expense", code: "LX-01", applicantNameSnapshot: "费用经办人", companyEntityNameSnapshot: "费用承担公司", status: "approved_pending_payment", claimType: "incidental_expense", projectId: "project", requestedAmountCents: 100n, companyPayableAmountCents: 100n, fundedAmountCents: 0n } as ExpenseClaim;
  type Row = { id: string; action: string; businessType: string; businessId?: string; metadata: { intentId?: string; recipientId?: string; duty?: string } };
  const records: Row[] = [{
    id: "historical-queue", action: "queued", businessType: "expense_claim_funding_duty_notification",
    businessId: "loan", metadata: { recipientId: "current", duty: "disbursement" }
  }];
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    expenseClaim: { findUnique: jest.fn(async ({ where }) => where.id === "loan" ? { ...claim, id: "loan", claimType: "loan", status: "partially_disbursed" } : claim) },
    project: { findUnique: jest.fn().mockResolvedValue({ isActive: true, name: "费用项目" }) },
    user: { findUnique: jest.fn().mockResolvedValue({ phone: "13800000019", isActive: true }) },
    auditLog: {
      findFirst: jest.fn().mockImplementation(async ({ where }) => records.find(row => where.id.in.includes(row.id))),
      createMany: jest.fn().mockImplementation(async ({ data }) => {
        const added = data.filter((row: Row) => !records.some(current => current.id === row.id));
        records.push(...added);
        return { count: added.length };
      })
    }
  };
  const prisma = { ...tx, $queryRaw: jest.fn(async (query: Prisma.Sql) =>
    records.filter(row => row.action === "queued" && row.businessType === query.values[0])),
    $transaction: async (run: (client: typeof tx) => Promise<unknown>) => run(tx) };
  const send = jest.fn().mockRejectedValue(new Error("合成供应商超时"));
  const service = new ExpenseClaimFundingNotificationService(prisma as unknown as PrismaService,
    { available: () => true, sendDutyIntent: send } as unknown as ApprovalSmsService);
  await service.queue(tx as unknown as Prisma.TransactionClient, claim, "approver");
  claim.status = "partially_paid";
  await service.afterCommit();
  await service.afterCommit();
  expect(send.mock.calls).toEqual([["13800000019", expect.objectContaining({
    businessLabel: "费用待办", dutyName: "登记实际付款", businessCode: "LX-01", scopeName: "费用项目", initiatorName: "费用经办人",
    subject: "零星费用", participants: ["费用承担公司", "费用经办人"], amountText: "1.00 元", totalText: "1.00 元", targetPath: "/费用与报销/expense"
  })]]);
  const current = records.find(row => row.metadata.recipientId === "current" && row.id !== "historical-queue");
  expect(records.filter(row => row.metadata.intentId === "historical-queue").map(row => row.action)).toEqual(["cancelled"]);
  const former = records.find(row => row.metadata.recipientId === "former");
  expect(records.filter(row => row.metadata.intentId === current?.id).map(row => row.action)).toEqual(["dispatch_claimed", "unknown"]);
  expect(records.filter(row => row.metadata.intentId === former?.id).map(row => row.action)).toEqual(["cancelled"]);
});

it("uses newly configured current-scope recipients and omits completed historical duties", async () => {
  const auditLog = { createMany: jest.fn().mockResolvedValue({ count: 2 }) };
  const tx = {
    position: { findMany: jest.fn().mockResolvedValue([{ id: "finance-role", key: "finance_director" }]) },
    userPosition: { findMany: jest.fn().mockResolvedValue([{ userId: "new-finance", positionId: "finance-role", projectId: null }]) },
    projectMember: { findMany: jest.fn().mockResolvedValue([]) },
    user: { findMany: jest.fn().mockResolvedValue([{ id: "new-finance" }]) },
    auditLog
  };
  const service = new ExpenseClaimFundingNotificationService({} as PrismaService, {} as ApprovalSmsService);
  const claim = { id: "expense", status: "approval_pending", approvalInstanceId: "round", projectId: "project" };
  const round = { id: "round", frozenNodes: [
    { roleKeys: ["comprehensive_director"], approvedRoleKeys: ["comprehensive_director"], candidateUserIds: ["already-signed"] },
    { roleKeys: ["finance_director"], candidatePolicy: "current_role_scope", roleScopesByRole: { finance_director: "global" }, candidateUserIds: [] },
    { roleKeys: ["project_manager"], candidateUserIds: ["frozen-manager"] }
  ].map(node => ({ ...node, protocolVersion: 1, executionMode: "parallel", mode: "any" })) };
  const client = tx as unknown as Prisma.TransactionClient;
  await expect(service.queueApprovalDuties(client, claim, round, "submitter")).resolves.toBe(true);
  await service.queueApprovalDuties(client, claim, round, "submitter");
  expect(auditLog.createMany.mock.calls[0]).toEqual(auditLog.createMany.mock.calls[1]);
  expect(auditLog.createMany).toHaveBeenCalledWith({ skipDuplicates: true, data: [
    expect.objectContaining({ metadata: { recipientId: "new-finance", approvalInstanceId: "round", approvalDutyIndex: 1 } }),
    expect.objectContaining({ metadata: { recipientId: "frozen-manager", approvalInstanceId: "round", approvalDutyIndex: 2 } })
  ] });
});
