import { PrismaClient } from "@prisma/client";
import type { ApprovalSmsService } from "../approval/approval-sms.service";
import type { PrismaService } from "../database/prisma.service";
import { MeService, type WorkItem } from "../me/me.service";
import { ExpenseClaimFundingNotificationService } from "./expense-claim-funding-notification.service";

const databaseUrl = process.env.EXPENSE_FUNDING_NOTICE_DATABASE_URL;
const pgCase = databaseUrl ? test : test.skip;

pgCase("真实费用资金待办保留岗位付款通知，旧借款队列不再发送", async () => {
  const url = new URL(databaseUrl!);
  expect(url.hostname).toBe("127.0.0.1");
  expect(url.pathname).toBe("/jiangkong_contract_bill_batch_test");
  url.searchParams.set("connection_limit", "1");
  const client = () => new PrismaClient({ datasources: { db: { url: url.toString() } } });
  const writer = client(), observer = client();
  try {
    const pids = await Promise.all([writer, observer].map(async session =>
      (await session.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`)[0].pid));
    expect(pids[0]).not.toBe(pids[1]);
    const project = await writer.project.create({ data: { name: "合成费用项目", code: "EX-OUTBOX-PG" } });
    const other = await writer.project.create({ data: { name: "其他合成项目", code: "EX-OUTBOX-OTHER" } });
    const company = await writer.companyEntity.create({ data: { name: "合成费用公司" } });
    const applicant = await writer.user.create({ data: { name: "合成经办人" } });
    const builder = await writer.businessParty.create({ data: {
      name: "合成施工企业", normalizedName: "expense-outbox-construction-enterprise",
      unifiedSocialCreditCode: "91310000123456789X", createdByUserId: applicant.id
    } });
    const builderVersion = await writer.businessPartyVersion.create({ data: {
      businessPartyId: builder.id, versionNo: 1,
      snapshot: { name: builder.name, unifiedSocialCreditCode: builder.unifiedSocialCreditCode },
      createdByUserId: applicant.id
    } });
    await writer.projectAffiliateAssignment.create({ data: {
      projectId: project.id, businessPartyId: builder.id, businessPartyVersionId: builderVersion.id,
      affiliateNameSnapshot: builder.name, affiliateCreditCodeSnapshot: builder.unifiedSocialCreditCode,
      effectiveFrom: new Date("2026-01-01"), changeReason: "合成项目主数据", assignedByUserId: applicant.id
    } });
    const finance = await writer.user.create({ data: { name: "现任财务", phone: "13800000014" } });
    const revoked = await writer.user.create({ data: { name: "调岗财务", phone: "13800000015" } });
    const outsider = await writer.user.create({ data: { name: "其他项目财务", phone: "13800000016" } });
    await writer.projectMember.createMany({ data: [
      { projectId: project.id, userId: finance.id, positionKey: "finance_staff" },
      { projectId: project.id, userId: revoked.id, positionKey: "finance_staff" },
      { projectId: other.id, userId: outsider.id, positionKey: "finance_staff" }
    ] });
    const seed = { projectId: project.id, companyEntityId: company.id, companyEntityNameSnapshot: company.name,
      applicantUserId: applicant.id, applicantNameSnapshot: applicant.name, handledByUserId: applicant.id,
      handledByNameSnapshot: applicant.name, reason: "合成资金测试", status: "approval_pending", requestedAmountCents: 100n };
    const expense = await writer.expenseClaim.create({ data: { ...seed, code: "EX-OUTBOX-BX", claimType: "reimbursement", companyPayableAmountCents: 100n } });
    await writer.expenseClaimLine.create({ data: {
      expenseClaimId: expense.id, sortOrder: 1, expenseCategory: "差旅", occurredOn: new Date("2026-11-01"),
      purpose: "合成敏感事由", receiptCount: 1, amountCents: 100n, evidenceType: "invoice"
    } });
    const loan = await writer.expenseClaim.create({ data: { ...seed, code: "EX-OUTBOX-JK", claimType: "loan" } });
    const send = jest.fn(async () => { throw new Error("simulated provider timeout"); });
    const notice = new ExpenseClaimFundingNotificationService(writer as PrismaService,
      { available: () => true, sendDutyIntent: send } as unknown as ApprovalSmsService);
    const where = { businessType: "expense_claim_funding_duty_notification", businessId: { in: [loan.id, expense.id] } };
    const transition = (rollback = false) => writer.$transaction(async tx => {
      const pendingExpense = await tx.expenseClaim.update({ where: { id: expense.id }, data: { status: "approved_pending_payment", approvedAt: new Date() } });
      const pendingLoan = await tx.expenseClaim.update({ where: { id: loan.id }, data: { status: "approved_pending_disbursement", approvedAt: new Date() } });
      await notice.queue(tx, pendingExpense, applicant.id);
      await expect(notice.queue(tx, pendingLoan, applicant.id)).resolves.toBe(false);
      expect(await tx.auditLog.count({ where })).toBe(2);
      if (rollback) throw new Error("synthetic rollback");
    });
    await expect(transition(true)).rejects.toThrow("synthetic rollback");
    expect(await observer.auditLog.count({ where })).toBe(0);
    expect(await observer.expenseClaim.count({ where: { status: "approval_pending", id: { in: [loan.id, expense.id] } } })).toBe(2);
    await transition();
    expect(await observer.auditLog.count({ where })).toBe(2);
    const oldIntent = await writer.auditLog.create({ data: {
      action: "queued", businessType: "expense_claim_funding_duty_notification", businessId: loan.id,
      actorUserId: applicant.id, metadata: { recipientId: finance.id, duty: "disbursement" }
    } });

    type Scopes = Array<{ projectId: string; roleKeys: string[] }>;
    const me = new MeService(observer as PrismaService, {} as never) as unknown as {
      loadProjectRoleScopes(userId: string): Promise<Scopes>;
      expenseFundingWorkItems(scopes: Scopes, names: Map<string, string>): Promise<WorkItem[]>;
    };
    const items = async (actor: string) => me.expenseFundingWorkItems(await me.loadProjectRoleScopes(actor), new Map([[project.id, project.name]]));
    expect((await items(finance.id)).map(item => item.targetPath).sort())
      .toEqual([`/费用与报销/${expense.id}`]);
    expect(await items(outsider.id)).toEqual([]);
    await writer.projectMember.deleteMany({ where: { projectId: project.id, userId: revoked.id } });
    expect(await items(revoked.id)).toEqual([]);
    await notice.afterCommit();
    await notice.afterCommit();
    expect(send.mock.calls).toEqual(expect.arrayContaining([
      ["13800000014", expect.objectContaining({ businessLabel: "费用待办", dutyName: "登记实际付款", businessCode: "EX-OUTBOX-BX",
        scopeName: project.name, initiatorName: applicant.name, subject: "费用报销", participants: [company.name, applicant.name],
        amountText: "1.00 元", totalText: "1.00 元", details: ["差旅 1.00 元"], targetPath: `/费用与报销/${expense.id}` })]
    ]));
    expect(send).toHaveBeenCalledTimes(1);
    expect(await notice.notificationStatus(loan.id, finance.id)).toBeNull();
    await expect(notice.retry(loan.id, finance.id, oldIntent.id)).rejects.toThrow("当前待办或短信记录已变化");
    expect(JSON.stringify(send.mock.calls)).not.toContain("合成敏感事由");
    const counts = await observer.auditLog.groupBy({ by: ["action"], where, _count: true, orderBy: { action: "asc" } });
    expect(counts).toEqual([{ action: "cancelled", _count: 2 }, { action: "dispatch_claimed", _count: 1 },
      { action: "queued", _count: 3 }, { action: "unknown", _count: 1 }]);
    await writer.expenseClaim.update({ where: { id: expense.id }, data: { status: "paid", fundedAmountCents: 100n } });
    expect((await items(finance.id)).map(item => item.businessId)).toEqual([]);
    process.stdout.write(JSON.stringify({ phase: "expense_outbox_readback", observerSessions: 2, rolledBackIntents: 0,
      committedIntents: 2, cancelledAfterRevocation: 1, cancelledHistoricalLoanIntents: 1, mockSends: 1, replayMockSends: 0,
      authorisedItemsBeforePayment: 1, remainingAfterPayment: 0, revokedItems: 0, otherProjectItems: 0 }) + "\n");
  } finally {
    await Promise.all([writer.$disconnect(), observer.$disconnect()]);
  }
}, 30_000);
