import { Prisma } from "@prisma/client";
import { loadEffectiveProjectApprovalAssignments } from "../approval/project-approval-assignments";
import { auditDutyNoticeId } from "../approval/audit-duty-notification-delivery";
import type { ApprovalSmsService } from "../approval/approval-sms.service";
import type { PrismaService } from "../database/prisma.service";
import {
  CONTRACT_WORK_COMPLETION_NOTIFICATION_KIND as KIND,
  ContractWorkCompletionNotificationService
} from "./contract-work-completion-notification.service";

jest.mock("../approval/project-approval-assignments");

type Row = { id: string; businessType?: string | null; businessId?: string | null; actorUserId?: string | null;
  action: string; metadata: Record<string, unknown>; createdAt?: Date };

const sqlText = (query: unknown) => typeof query === "string" ? query
  : (query as { sql?: string } | null)?.sql ?? (query as string[] | null)?.join?.("?") ?? "";

const dutyNames = ["合同部主管", "项目经理", "财务"];
const duties = () => [
  { name: "合同部主管", protocolVersion: 1, executionMode: "parallel", mode: "any", roleKeys: ["contract_director"], approvedRoleKeys: [] },
  { name: "项目经理", protocolVersion: 1, executionMode: "parallel", mode: "any", roleKeys: ["project_manager"], approvedRoleKeys: [] },
  { name: "财务", protocolVersion: 1, executionMode: "parallel", mode: "any", roleKeys: ["finance_staff", "finance_director"], approvedRoleKeys: [] }
] as Array<Record<string, unknown>>;

const version = { id: "version", contractId: "contract", status: "effective", companyEntityNameSnapshot: "本公司",
  amountYuan: new Prisma.Decimal("500.0000"), amountLimitType: "capped" };
const contract = { id: "contract", code: "HT-01", name: "设备采购合同", projectId: "project",
  companyEntityName: "本公司", counterparty: "相对方", voidedAt: null };
const project = { isActive: true, name: "合同项目" };

type State = {
  completion: { id: string; contractVersionId: string; createdByUserId: string; status: string;
    approvalInstanceId: string | null; work: string; amountYuan: Prisma.Decimal };
  round: { id: string; status: string; businessType: string; businessId: string; flowType: string;
    applicantUserId: string; currentNodeIndex: number; frozenNodes: Array<Record<string, unknown>> };
  cooling: Array<{ nodeIndex: number; createdAt: Date }>;
  rows: Row[];
};

function fixture(holders: Record<string, string[]> = {
  contract_director: ["director"], project_manager: ["manager"], finance_staff: ["finance"], finance_director: ["finance"]
}) {
  jest.mocked(loadEffectiveProjectApprovalAssignments).mockImplementation(async (_tx, _projectId, roleKeys) =>
    roleKeys.flatMap(role => (holders[role] ?? []).map(userId => ({
      projectId: "project", userId, roleKey: role, userIsActive: true
    }))));
  const state: State = {
    completion: { id: "completion", contractVersionId: "version", createdByUserId: "author", status: "in_approval",
      approvalInstanceId: "round", work: "主体结构", amountYuan: new Prisma.Decimal("100.0123") },
    round: { id: "round", status: "in_progress", businessType: "contract_work_completion", businessId: "completion",
      flowType: "contract.work_completion.approve", applicantUserId: "author", currentNodeIndex: 0, frozenNodes: duties() },
    cooling: [],
    rows: []
  };
  const createMany = jest.fn().mockImplementation(async ({ data }: { data: Row[] }) => {
    const added = data.filter(row => !state.rows.some(current => current.id === row.id));
    state.rows.push(...added);
    return { count: added.length };
  });
  const tx = {
    contractWorkCompletion: { findUnique: jest.fn(async () => state.completion) },
    approvalInstance: { findUnique: jest.fn(async () => state.round) },
    contractVersion: { findUnique: jest.fn(async () => version) },
    contract: { findUnique: jest.fn(async () => contract) },
    project: { findUnique: jest.fn(async () => project) },
    user: {
      findMany: jest.fn(async ({ where }: { where: { id: { in: string[] } } }) => where.id.in.map(id => ({ id }))),
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) =>
        where.id === "author" ? { name: "原经办人", phone: "13800000001", isActive: true }
          : { name: where.id, phone: "13800000002", isActive: true })
    },
    approvalDelegation: { findMany: jest.fn(async () => []) },
    auditLog: {
      createMany,
      findMany: jest.fn(async ({ where }: { where: { createdAt: { gte: Date } } }) =>
        state.cooling.filter(row => row.createdAt >= where.createdAt.gte).map(row => ({
          id: `cooling-${row.nodeIndex}`, action: "queued", metadata: {
            kind: KIND, event: "queued", stage: "duty", nodeIndex: row.nodeIndex, completionId: "completion", roundId: "round"
          }
        })))
    }
  };
  const service = new ContractWorkCompletionNotificationService(
    { $transaction: (fn: (db: typeof tx) => unknown) => fn(tx) } as unknown as PrismaService,
    { available: () => true, sendDutyIntent: jest.fn() } as unknown as ApprovalSmsService
  );
  return { service, tx, state, createMany };
}

function resubmitted(state: State, roundId: string) {
  state.completion.approvalInstanceId = roundId;
  state.round = { ...state.round, id: roundId, frozenNodes: duties() };
}

const queued = (nodeIndex: number, recipientId: string, roundId = "round"): Row => ({
  id: auditDutyNoticeId(KIND, roundId, "duty", String(nodeIndex), recipientId), businessType: KIND,
  businessId: "completion", actorUserId: "author", action: "queued", createdAt: new Date(),
  metadata: { kind: KIND, event: "queued", stage: "duty", completionId: "completion", roundId,
    contractVersionId: "version", nodeIndex, recipientId, dutyName: dutyNames[nodeIndex] }
});

function dispatchFixture(state: State) {
  const tx = {
    $queryRaw: jest.fn(async (query: unknown) => {
      if (!sqlText(query).includes('FROM "AuditLog" queued')) return [];
      const values = (query as { values: unknown[] }).values;
      const actor = values.find(value => typeof value === "string" &&
        ["director", "manager", "finance", "author"].includes(value));
      return state.rows.filter(row => row.action === "queued" && row.metadata.event === "queued" &&
        (actor === undefined || row.metadata.recipientId === actor) &&
        !state.rows.some(other => other.metadata.retryOf === row.id));
    }),
    contractWorkCompletion: { findUnique: jest.fn(async () => state.completion) },
    approvalInstance: { findUnique: jest.fn(async () => state.round) },
    contractVersion: { findUnique: jest.fn(async () => version) },
    contract: { findUnique: jest.fn(async () => contract) },
    project: { findUnique: jest.fn(async () => project) },
    user: {
      findMany: jest.fn(async ({ where }: { where: { id: { in: string[] } } }) => where.id.in.map(id => ({ id }))),
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) =>
        where.id === "author" ? { name: "原经办人", phone: "13800000001", isActive: true }
          : { name: where.id, phone: "13800000002", isActive: true })
    },
    approvalDelegation: { findMany: jest.fn(async () => []) },
    auditLog: {
      findFirst: jest.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
        state.rows.find(row => where.id.in.includes(row.id)) ?? null),
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) =>
        state.rows.find(row => row.id === where.id) ?? null),
      findMany: jest.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
        state.rows.filter(row => where.id.in.includes(row.id))),
      createMany: jest.fn(async ({ data }: { data: Row[] }) => {
        const added = data.filter(row => !state.rows.some(current => current.id === row.id));
        state.rows.push(...added);
        return { count: added.length };
      })
    }
  };
  const prisma = {
    ...tx,
    $queryRaw: jest.fn(async (query: unknown) => sqlText(query).includes('FROM "AuditLog" queued')
      ? state.rows.filter(row => row.action === "queued" && row.metadata.event === "queued") : []),
    $transaction: async (callback: (db: typeof tx) => Promise<unknown>) => callback(tx)
  };
  return { tx, prisma };
}

const smsStub = (send: jest.Mock = jest.fn().mockResolvedValue({ status: "accepted", message: "已提交" })) =>
  ({ available: () => true, sendDutyIntent: send } as unknown as ApprovalSmsService);

describe("合同履约确认的待办短信入队", () => {
  it("提交后三个职责各自入队一次，同一职责双岗同人只发一条", async () => {
    const { service, tx, createMany, state } = fixture({
      contract_director: ["director"], project_manager: ["manager"], finance_staff: ["finance"], finance_director: ["finance"]
    });
    await service.queueDuty(tx as never, "completion", "round");
    const command = createMany.mock.calls[0][0];
    expect(command.skipDuplicates).toBe(true);
    expect(command.data.map((row: Row) => row.metadata)).toMatchObject([
      { stage: "duty", nodeIndex: 0, recipientId: "director", dutyName: "合同部主管", completionId: "completion", roundId: "round" },
      { stage: "duty", nodeIndex: 1, recipientId: "manager", dutyName: "项目经理" },
      { stage: "duty", nodeIndex: 2, recipientId: "finance", dutyName: "财务" }
    ]);
    expect(command.data.every((row: Row) => row.businessType === KIND && row.businessId === "completion" &&
      row.action === "queued" && row.actorUserId === "author")).toBe(true);
    expect(new Set(command.data.map((row: Row) => row.id)).size).toBe(3);
    expect(command.data.filter((row: Row) => row.metadata.nodeIndex === 2)).toHaveLength(1);
    expect(state.rows).toHaveLength(3);
  });

  it("同一职责同一轮次重复入队保持同一标识，不重复通知", async () => {
    const { service, tx, createMany, state } = fixture({ contract_director: ["director"], project_manager: ["manager"],
      finance_staff: ["finance"], finance_director: [] });
    await service.queueDuty(tx as never, "completion", "round");
    await service.queueDuty(tx as never, "completion", "round");
    expect(createMany).toHaveBeenCalledTimes(2);
    expect(createMany.mock.calls[0][0]).toEqual(createMany.mock.calls[1][0]);
    expect(state.rows).toHaveLength(3);
  });

  it("60 秒共享冷却按职责生效：同一职责刚发过则整批跳过，超过冷却后重新通知", async () => {
    const { service, tx, createMany, state } = fixture({ contract_director: ["director"], project_manager: ["manager"],
      finance_staff: ["finance"], finance_director: [] });
    state.cooling = [{ nodeIndex: 1, createdAt: new Date(Date.now() - 10_000) }];
    resubmitted(state, "round-2");
    await service.queueDuty(tx as never, "completion", "round-2");
    expect(createMany.mock.calls[0][0].data.map((row: Row) => row.metadata.nodeIndex)).toEqual([0, 2]);
    state.cooling = [{ nodeIndex: 1, createdAt: new Date(Date.now() - 120_000) }];
    resubmitted(state, "round-3");
    await service.queueDuty(tx as never, "completion", "round-3");
    expect(createMany.mock.calls[1][0].data.map((row: Row) => row.metadata.nodeIndex)).toEqual([0, 1, 2]);
  });

  it("任一职责驳回后只通知原制单人一次", async () => {
    const { service, tx, createMany, state } = fixture();
    state.completion.status = "draft";
    state.round.status = "rejected";
    await service.queueCorrection(tx as never, "completion", "round");
    await service.queueCorrection(tx as never, "completion", "round");
    expect(createMany).toHaveBeenCalledTimes(2);
    expect(createMany.mock.calls[0][0]).toEqual(createMany.mock.calls[1][0]);
    expect(createMany.mock.calls[0][0].data).toEqual([expect.objectContaining({
      id: auditDutyNoticeId(KIND, "round", "correction", "author"), businessType: KIND, businessId: "completion",
      actorUserId: "author", action: "queued",
      metadata: expect.objectContaining({ stage: "correction", recipientId: "author", nodeIndex: -1,
        dutyName: "履约确认退回，请修改后重新提交" })
    })]);
  });

  it("提交业务事务回滚时待办短信不入队", async () => {
    const { tx } = fixture();
    const committed: Row[] = [];
    const buffered: Row[] = [];
    const transactionTx = { ...tx, auditLog: {
      ...tx.auditLog,
      createMany: jest.fn(async ({ data }: { data: Row[] }) => { buffered.push(...data); return { count: data.length }; })
    } };
    const prisma = {
      auditLog: { createMany: jest.fn(async ({ data }: { data: Row[] }) => { committed.push(...data); return { count: data.length }; }) },
      $transaction: async (callback: (db: typeof transactionTx) => Promise<unknown>) => {
        await callback(transactionTx);
        throw new Prisma.PrismaClientKnownRequestError("serialization failure", { code: "P2034", clientVersion: "5.22.0" });
      }
    };
    const rebased = new ContractWorkCompletionNotificationService(prisma as unknown as PrismaService, smsStub());
    await expect(prisma.$transaction(db => rebased.queueDuty(db as never, "completion", "round")))
      .rejects.toMatchObject({ code: "P2034" });
    expect(buffered).toHaveLength(3);
    expect(committed).toEqual([]);
  });
});

describe("合同履约确认待办短信的派发与重试", () => {
  it("派发复用通用待办模板，过期轮次取消而不发送", async () => {
    const { state } = fixture();
    const current = queued(0, "director");
    const stale = queued(1, "manager", "round-old");
    state.rows = [current, stale];
    const { prisma } = dispatchFixture(state);
    const send = jest.fn().mockResolvedValue({ status: "accepted", message: "已提交" });
    const rebased = new ContractWorkCompletionNotificationService(prisma as unknown as PrismaService, smsStub(send));
    await rebased.afterCommit();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]).toEqual(["13800000002", expect.objectContaining({
      businessLabel: "合同履约确认", dutyName: "合同部主管", businessCode: "HT-01", scopeName: "合同项目",
      initiatorName: "原经办人", subject: "设备采购合同履约确认", participants: ["本公司", "相对方"],
      amountText: "100.0123 元", targetPath: "/合同管理/HT-01"
    })]);
    expect(state.rows.filter(row => row.metadata.intentId === current.id).map(row => row.action))
      .toEqual(["dispatch_claimed", "accepted"]);
    expect(state.rows.filter(row => row.metadata.intentId === stale.id).map(row => row.action)).toEqual(["cancelled"]);
  });

  it("发送超时记为未知且不自动重发", async () => {
    const { state } = fixture();
    const attempt = queued(0, "director");
    state.rows = [attempt];
    const { prisma } = dispatchFixture(state);
    const send = jest.fn().mockRejectedValue(new Error("synthetic timeout"));
    const rebased = new ContractWorkCompletionNotificationService(prisma as unknown as PrismaService, smsStub(send));
    await rebased.afterCommit();
    await rebased.afterCommit();
    expect(send).toHaveBeenCalledTimes(1);
    expect(state.rows.filter(row => row.metadata.intentId === attempt.id).map(row => row.action))
      .toEqual(["dispatch_claimed", "unknown"]);
    expect(await rebased.notificationStatus("completion", "director")).toMatchObject({ status: "unknown", canRetry: false });
  });

  it("明确失败的记录可以重试，重试沿用 outbox 的 claimed/terminal 幂等", async () => {
    const { state } = fixture();
    const attempt = queued(0, "director");
    state.rows = [attempt,
      { id: auditDutyNoticeId(KIND, attempt.id, "claim"), businessType: KIND, businessId: "completion",
        actorUserId: "author", action: "dispatch_claimed", metadata: { intentId: attempt.id, event: "dispatch_claimed" } },
      { id: auditDutyNoticeId(KIND, attempt.id, "terminal"), businessType: KIND, businessId: "completion",
        actorUserId: "author", action: "failed", metadata: { intentId: attempt.id, event: "failed" } }];
    const { prisma, tx } = dispatchFixture(state);
    tx.$queryRaw.mockImplementation(async (query: unknown) => {
      if (!sqlText(query).includes('FROM "AuditLog" queued')) return [];
      const values = (query as { values: unknown[] }).values;
      const actor = values.find(value => typeof value === "string" &&
        ["director", "manager", "finance", "author"].includes(value));
      return state.rows.filter(row => row.action === "queued" && row.metadata.recipientId === actor &&
        !state.rows.some(other => other.metadata.retryOf === row.id));
    });
    const rebased = new ContractWorkCompletionNotificationService(prisma as unknown as PrismaService, smsStub());
    expect(await rebased.notificationStatus("completion", "director")).toMatchObject({ status: "failed", canRetry: true });
    expect(await rebased.retry("version", "director", attempt.id)).toMatchObject({
      status: "queued", canRetry: false, dutyName: "合同部主管"
    });
    expect(state.rows.find(row => row.id === auditDutyNoticeId(KIND, attempt.id, "retry"))?.metadata)
      .toMatchObject({ retryOf: attempt.id, recipientId: "director" });
    expect(await rebased.retry("version", "director", attempt.id)).toMatchObject({ status: "queued" });
    expect(state.rows.filter(row => row.metadata.retryOf === attempt.id)).toHaveLength(1);
    expect(tx.$queryRaw).toHaveBeenCalled();
  });

  it("合同详情按版本聚合本人履约待办短信", async () => {
    const { state } = fixture();
    const attempt = queued(0, "director");
    state.rows = [attempt,
      { id: auditDutyNoticeId(KIND, attempt.id, "claim"), businessType: KIND, businessId: "completion",
        actorUserId: "author", action: "dispatch_claimed", metadata: { intentId: attempt.id, event: "dispatch_claimed" } },
      { id: auditDutyNoticeId(KIND, attempt.id, "terminal"), businessType: KIND, businessId: "completion",
        actorUserId: "author", action: "failed", metadata: { intentId: attempt.id, event: "failed" } }];
    const { prisma, tx } = dispatchFixture(state);
    prisma.$queryRaw.mockImplementation(async (query: unknown): Promise<Row[]> => {
      const text = sqlText(query);
      if (text.includes("DISTINCT ON")) return [{ businessId: "completion" }] as unknown as Row[];
      if (text.includes("dutyName")) return [{ dutyName: "合同部主管" }] as unknown as Row[];
      return state.rows.filter(row => row.action === "queued" && row.metadata.recipientId === "director");
    });
    tx.$queryRaw.mockImplementation(async (query: unknown) => {
      if (!sqlText(query).includes('FROM "AuditLog" queued')) return [];
      const values = (query as { values: unknown[] }).values;
      const actor = values.find(value => typeof value === "string" &&
        ["director", "manager", "finance", "author"].includes(value));
      return state.rows.filter(row => row.action === "queued" && row.metadata.recipientId === actor &&
        !state.rows.some(other => other.metadata.retryOf === row.id));
    });
    const rebased = new ContractWorkCompletionNotificationService(prisma as unknown as PrismaService, smsStub());
    expect(await rebased.notificationStatusForVersion("version", "director")).toEqual([
      { attemptId: attempt.id, status: "failed", canRetry: true, dutyName: "合同部主管" }
    ]);
  });

  it("非本业务或非本人的短信记录不由本服务接管重试", async () => {
    const { state } = fixture();
    state.rows = [{ id: "foreign", businessType: "contract_v2_inside_duty_notification", businessId: "version",
      actorUserId: "author", action: "queued", createdAt: new Date(),
      metadata: { kind: "contract_v2_inside_duty_notification", event: "queued", stage: "approval",
        recipientId: "director", contractVersionId: "version" } }];
    const { prisma } = dispatchFixture(state);
    const rebased = new ContractWorkCompletionNotificationService(prisma as unknown as PrismaService, smsStub());
    expect(await rebased.retry("version", "director", "foreign")).toBeNull();
  });
});
