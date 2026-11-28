import type { ApprovalActionLog, ApprovalInstance, Prisma } from "@prisma/client";
import { PaymentApprovalNotificationService } from "./payment-approval-notification.service";

function fixture() {
  const payment = {id: "payment", projectId: "project", code: "FK-01", status: "approval_pending"};
  const nodes = [
    {name: "综合部主管", mode: "any", roleKeys: ["comprehensive_director"]},
    {name: "项目经理", mode: "any", roleKeys: ["project_manager"]}
  ];
  const round: ApprovalInstance = {id: "round", applicantUserId: "author", businessId: payment.id, businessType: "payment_request",
    flowType: "payment.approve", status: "in_progress", currentNodeIndex: 0, createdAt: new Date(10), updatedAt: new Date(10), frozenNodes: nodes};
  const people = new Map([
    ["first", "comprehensive_director"], ["peer", "comprehensive_director"], ["manager", "project_manager"], ["outsider", "comprehensive_director"],
    ["author", "employee"]
  ]);
  const logs = new Map<string, ApprovalActionLog>();
  let active = false;
  const tx = {
    approvalInstance: {findUnique: async () => round,
      findFirst: async () => round.status === "in_progress" ? null : round,
      findMany: async ({where}: {where:{businessId:string;status:string}}) =>
      where.businessId === round.businessId && where.status === round.status ? [round] : []},
    position: {findMany: async () => []},
    userPosition: {findMany: async () => []},
    projectMember: {findMany: async ({where}: {where: {positionKey: {in: string[]}}}) =>
      [...people].filter(([, role]) => where.positionKey.in.includes(role)).map(([userId]) => ({userId}))},
    paymentRequest: {findUnique: async () => payment},
    approvalDelegation: {findMany: async () => [], groupBy: async () => []},
    user: {findUnique: async ({where}: {where: {id: string}}) => ({isActive: true, phone: "13800000000" + where.id})},
    approvalActionLog: {
      createMany: async ({data}: {data: ApprovalActionLog[]}) => {
        let count = 0;
        for (const entry of data) if (!logs.has(entry.id)) { logs.set(entry.id, entry); count++; }
        return {count};
      },
      findUnique: async ({where}: {where: {id: string}}) => logs.get(where.id) ?? null,
      findMany: async ({where}: {where: {approvalInstanceId: string}}) =>
        [...logs.values()].filter(row => row.approvalInstanceId === where.approvalInstanceId)
    },
    $queryRaw: async (query: Prisma.Sql) => {
      if (!query.sql.includes("SELECT queued.*")) return [];
      const all = [...logs.values()];
      return all.filter(entry => (entry.metadata as Prisma.JsonObject)?.event === "queued"
        && (!query.sql.includes('AND queued."id" =') || entry.id === query.values[2])
        && !all.some(other => (other.metadata as Prisma.JsonObject)?.intentId === entry.id));
    }
  };
  let tail: Promise<unknown> = Promise.resolve();
  const prisma = {...tx, $transaction: <T>(run: (client: typeof tx) => Promise<T>) => {
    const result = tail.then(async () => {
      active = true;
      try { return await run(tx); } finally { active = false; }
    });
    tail = result.catch(() => undefined);
    return result;
  }};
  const visibility = {
    effectiveRoleScopesInTransaction: async (_tx: unknown, id: string) => ({
      globalRoleKeys: [], projectRoleKeys: people.has(id) ? [people.get(id)] : []
    }),
    visibleRequestedProjectIdsInTransaction: async (_tx: unknown, id: string) => id === "outsider" ? [] : ["project"]
  };
  const sms = {available: () => true, send: jest.fn(async () => {
    expect(active).toBe(false);
    return {status: "accepted"};
  })};
  const service = new PaymentApprovalNotificationService(prisma as never, sms as never, visibility as never);
  return {payment, round, people, logs, tx, sms, service};
}

it("初始同职责逐人排队，剔除无岗位及跨项目人员，撤岗取消且并发领取不重复发送", async () => {
  const {payment, round, people, logs, tx, service, sms} = fixture();
  await service.queue(tx as never, payment, round, null);
  await service.queue(tx as never, payment, round, null);
  expect([...logs.values()].map(row => (row.metadata as Prisma.JsonObject).recipientId)).toEqual(["first", "peer"]);
  people.delete("peer");
  await Promise.all([service.afterCommit(payment.id), service.afterCommit(payment.id)]);
  expect(sms.send).toHaveBeenCalledTimes(1);
  expect(sms.send).toHaveBeenCalledWith("13800000000first", "付款申请", "综合部主管", "FK-01");
  expect([...logs.values()].some(row => (row.metadata as Prisma.JsonObject).event === "cancelled")).toBe(true);
});

it("只给推进后的项目经理，未签批准不能入队，原岗位过期，响应丢失后不重发", async () => {
  const {payment, round, logs, tx, service, sms} = fixture();
  await service.queue(tx as never, payment, round, null);
  round.currentNodeIndex = 1;
  round.updatedAt = new Date(20);
  const transition = {id: "approved", action: "approve", approvalInstanceId: round.id,
    signatureFileIdSnapshot: "signature", signatureVersionIdSnapshot: "signature-version", signatureSha256Snapshot: null} as ApprovalActionLog;
  await service.queue(tx as never, payment, round, transition);
  expect([...logs.values()]).toHaveLength(2);
  transition.signatureSha256Snapshot = "a".repeat(64);
  logs.set(transition.id, transition);
  await service.queue(tx as never, payment, round, transition);
  sms.send.mockRejectedValueOnce(new Error("合成发送响应丢失"));
  await service.afterCommit(payment.id);
  await service.afterCommit(payment.id);
  expect(sms.send).toHaveBeenCalledTimes(1);
  expect(sms.send).toHaveBeenCalledWith("13800000000manager", "付款申请", "项目经理", "FK-01");
  expect([...logs.values()].some(row => (row.metadata as Prisma.JsonObject | null)?.event === "unknown")).toBe(true);
  round.status = "approved";
  payment.status = "approved_pending_payment";
  await service.queue(tx as never, payment, round, transition);
  expect([...logs.values()].filter(row => (row.metadata as Prisma.JsonObject | null)?.event === "queued")).toHaveLength(3);
});

it.each(["accepted", "unknown"] as const)("只重试本人当前失败尝试，同键并发后为 %s", async outcome => {
  const {payment, round, people, tx, service, sms} = fixture();
  people.delete("peer");
  await service.queue(tx as never, payment, round, null);
  sms.send.mockResolvedValueOnce({status: "failed"});
  await service.afterCommit(payment.id);
  const {notice} = await service.status(payment.id, "first");
  expect(notice).toMatchObject({status: "failed", canRetry: true});
  const {attemptId} = notice!;
  expect(await service.status(payment.id, "outsider")).toEqual({notice: null});
  await expect(service.retry(payment.id, "outsider", attemptId)).rejects.toThrow("已变化");
  await expect(service.retry("another-payment", "first", attemptId)).rejects.toThrow("已变化");
  if (outcome === "unknown") sms.send.mockRejectedValueOnce(new Error("合成发送响应丢失"));
  const retry = () => service.retry(payment.id, "first", attemptId);
  await Promise.all([retry(), retry()]);
  const followUp = await retry();
  expect(followUp).toMatchObject({status: outcome, canRetry: false});
  expect(followUp.attemptId).not.toBe(attemptId);
  await expect(service.retry(payment.id, "first", followUp.attemptId)).rejects.toThrow("仅确认发送失败");
  people.delete("first");
  expect(await service.status(payment.id, "first")).toEqual({notice: null});
  await expect(retry()).rejects.toThrow("已变化");
  expect(sms.send).toHaveBeenCalledTimes(2);
});

it("审批轮版本推进后，已失败的旧尝试不能再重试", async () => {
  const {payment, round, people, tx, service, sms} = fixture();
  people.delete("peer");
  await service.queue(tx as never, payment, round, null);
  sms.send.mockResolvedValueOnce({status: "failed"});
  await service.afterCommit(payment.id);
  const {notice} = await service.status(payment.id, "first");
  expect(notice).toMatchObject({status:"failed"});
  round.updatedAt = new Date(11);
  expect(await service.status(payment.id, "first")).toEqual({notice: null});
  await expect(service.retry(payment.id, "first", notice!.attemptId)).rejects.toThrow("已变化");
  expect(sms.send).toHaveBeenCalledTimes(1);
});

it("付款最终驳回或退回申请人时入队一条修改提醒，派发后原申请人可查询并重试失败", async () => {
  const {payment, round, logs, tx, service, sms} = fixture();
  payment.status = "approval_rejected";
  round.status = "rejected";
  round.currentNodeIndex = 1;
  round.updatedAt = new Date(30);
  const transition = {id: "reject-action", action: "reject", approvalInstanceId: round.id} as ApprovalActionLog;
  logs.set(transition.id, transition);

  await service.queueCorrection(tx as never, payment, round, transition);
  await service.queueCorrection(tx as never, payment, round, transition);
  const queued = [...logs.values()].filter(row => (row.metadata as Prisma.JsonObject | null)?.event === "queued");
  expect(queued).toHaveLength(1);
  expect(queued[0].metadata).toMatchObject({phase: "correction", recipientId: "author", paymentId: payment.id});
  expect(sms.send).not.toHaveBeenCalled();

  sms.send.mockResolvedValueOnce({status: "failed"});
  await service.afterCommit(payment.id);
  expect(sms.send).toHaveBeenCalledWith("13800000000author", "付款申请退回修改", "审批退回，请修改后重新提交", "FK-01");
  const {notice} = await service.status(payment.id, "author");
  expect(notice).toMatchObject({status: "failed", canRetry: true});
  expect(await service.status(payment.id, "first")).toEqual({notice: null});

  sms.send.mockResolvedValue({status: "accepted"});
  const retried = await service.retry(payment.id, "author", notice!.attemptId);
  expect(retried).toMatchObject({status: "accepted", canRetry: false});
  expect(sms.send).toHaveBeenCalledTimes(2);
  await expect(service.retry(payment.id, "author", retried.attemptId)).rejects.toThrow("仅确认发送失败");
});
