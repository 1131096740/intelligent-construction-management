import type { Prisma, Settlement } from "@prisma/client";
import type { ApprovalSmsService } from "../approval/approval-sms.service";
import type { PrismaService } from "../database/prisma.service";
import { loadEffectiveProjectApprovalAssignments } from "../approval/project-approval-assignments";
import { SettlementArchiveNotificationService } from "./settlement-archive-notification.service";

jest.mock("../approval/project-approval-assignments");

it("正式合成件激活时按有权主管逐人入队，同一结算职责重试保持相同标识", async () => {
  jest.mocked(loadEffectiveProjectApprovalAssignments).mockResolvedValue(["one", "one", "two"].map(userId => ({
    projectId: "project", userId, roleKey: "contract_director", userIsActive: true
  })));
  const createMany = jest.fn();
  const tx = {
    project: { findUnique: jest.fn().mockResolvedValue({ isActive: true }) },
    auditLog: { createMany }
  };
  const settlement = { id: "settlement", projectId: "project", status: "pending_archive_confirm", governanceVersion: 1, code: "JS-01", contractId: "contract", preparedByUserId: "prepared", amountCents: 100n } as Settlement;
  const sms = { available: () => true, sendDutyIntent: jest.fn() } as unknown as ApprovalSmsService;
  const service = new SettlementArchiveNotificationService({} as PrismaService, sms);
  await service.queue(tx as unknown as Prisma.TransactionClient, settlement, "generator");
  await service.queue(tx as unknown as Prisma.TransactionClient, settlement, "generator");
  await service.queue(tx as unknown as Prisma.TransactionClient, { ...settlement, status: "pending_generation" }, "generator");
  expect(createMany).toHaveBeenCalledTimes(2);
  expect(createMany.mock.calls[0][0]).toEqual(createMany.mock.calls[1][0]);
  expect(createMany.mock.calls[0][0]).toMatchObject({ skipDuplicates: true, data: [
    { businessId: "settlement", metadata: { recipientId: "one" } },
    { businessId: "settlement", metadata: { recipientId: "two" } }
  ] });
  expect(sms.sendDutyIntent).not.toHaveBeenCalled();
});

it("发送前重新核对主管权限，超时记为待确认且重复派发不重发", async () => {
  const assignment = (userId: string) => ({ projectId: "project", userId, roleKey: "contract_director", userIsActive: true });
  jest.mocked(loadEffectiveProjectApprovalAssignments).mockImplementation(async (_tx, _project, _role, userId) =>
    userId === "two" ? [] : userId ? [assignment(userId)] : [assignment("one"), assignment("two")]);
  type Row = { id: string; action: string; metadata: { intentId?: string; recipientId?: string } };
  const records: Row[] = [];
  const settlement = { id: "settlement", projectId: "project", status: "pending_archive_confirm", governanceVersion: 1, code: "JS-01", contractId: "contract", preparedByUserId: "prepared", amountCents: 100n } as Settlement;
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    project: { findUnique: jest.fn().mockResolvedValue({ isActive: true, name: "结算项目" }) },
    contract: { findUnique: jest.fn().mockResolvedValue({ name: "合同", companyEntityName: "公司", counterparty: "相对方" }) },
    settlement: { findUnique: jest.fn().mockResolvedValue(settlement) },
    user: { findUnique: jest.fn().mockResolvedValue({ phone: "13800000019", isActive: true, name: "结算经办" }) },
    auditLog: {
      findFirst: jest.fn().mockImplementation(async ({ where }) => records.find(row => where.id.in.includes(row.id))),
      createMany: jest.fn().mockImplementation(async ({ data }) => {
        const added = data.filter((row: Row) => !records.some(current => current.id === row.id));
        records.push(...added);
        return { count: added.length };
      })
    }
  };
  let inTransaction = false;
  const prisma = { ...tx, $queryRaw: jest.fn(async () => records.filter(row => row.action === "queued")),
    $transaction: async (callback: (client: typeof tx) => Promise<unknown>) => {
      inTransaction = true;
      try { return await callback(tx); } finally { inTransaction = false; }
    }
  };
  const duringSend: boolean[] = [];
  const send = jest.fn(async () => { duringSend.push(inTransaction); throw new Error("合成供应商超时"); });
  const service = new SettlementArchiveNotificationService(prisma as unknown as PrismaService,
    { available: () => true, sendDutyIntent: send } as unknown as ApprovalSmsService);
  await service.queue(tx as unknown as Prisma.TransactionClient, settlement, "generator");
  await service.afterCommit();
  await service.afterCommit();
  expect(duringSend).toEqual([false]);
  expect(send.mock.calls).toEqual([["13800000019", expect.objectContaining({
    businessLabel: "结算待办", dutyName: "确认最终结算文件", businessCode: "JS-01", scopeName: "结算项目", initiatorName: "结算经办",
    subject: "合同结算", participants: ["公司", "相对方"], amountText: "1.00 元", targetPath: "/结算管理/JS-01"
  })]]);
  const [one, two] = records.filter(row => row.action === "queued");
  expect(records.filter(row => row.metadata.intentId === one.id).map(row => row.action)).toEqual(["dispatch_claimed", "unknown"]);
  expect(records.filter(row => row.metadata.intentId === two.id).map(row => row.action)).toEqual(["cancelled"]);
});
