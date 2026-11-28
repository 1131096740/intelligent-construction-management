import { fundBalanceNoticeLocks, prepareFundBalanceNoticeAudit } from "./fund-balance-notice-locks";
import { createHmac, randomBytes } from "node:crypto";
import { FundAccountService } from "./fund-account.service";
import { ForbiddenException } from "@nestjs/common";
import { FundBalanceReviewNotificationService } from "./fund-balance-review-notification.service";
import { resolveFreshCorrectionRecipient, resolveFundReviewIdentity } from "./fund-account-duty";

jest.mock("./fund-balance-notice-locks");

jest.mock("./fund-account-duty", () => ({
  resolveFundReviewIdentity: jest.fn(),
  resolveFreshCorrectionRecipient: jest.fn()
}));

function fixture() {
  const resolve = jest.mocked(resolveFundReviewIdentity);
  jest.mocked(prepareFundBalanceNoticeAudit).mockReset().mockResolvedValue(undefined);
  jest.mocked(fundBalanceNoticeLocks).mockReset().mockImplementation((_tx, operation, id, round, attempt, actor) =>
    async () => id === "registration" && round === "round" && actor === "finance" && (
      operation !== "retry" || rows.has(attempt)
    ));
  const duty = {row: {balanceYuan: {toFixed: () => "120.1234"}, version: 2, createdByUserId: "applicant"},
    round: {id: "round"}, account: {companyEntityId: null}} as never;
  resolve.mockReset().mockResolvedValue(duty);
  jest.mocked(resolveFreshCorrectionRecipient).mockReset().mockResolvedValue(duty);
  const rows = new Map();
  const db = {
    position: {findMany: async () => [{id: "position"}]},
    userPosition: {findMany: async () => [{userId: "finance"}]},
    companyEntity: {findUnique: jest.fn()},
    user: {findUnique: async ({where}: {where: {id: string}}) => where.id === "applicant"
      ? {name: "合成发起人"} : {isActive: true, phone: "13800000000"}},
    auditLog: {
      createMany: async ({data}: {data: {id: string}[]}) => {
        let count = 0;
        for (const item of data) if (!rows.has(item.id)) {rows.set(item.id,item); count++;}
        return {count};
      },
      findFirst: async ({where}: {where: {id: {in: string[]}}}) => where.id.in.map(id => rows.get(id)).find(Boolean),
      findMany: async ({where}: {where: {id: {in: string[]}}}) => where.id.in.map(id => rows.get(id)).filter(Boolean),
      findUnique: async ({where}: {where: {id: string}}) => rows.get(where.id) ?? null
    },
    $queryRaw: async ({strings, values}: {strings: string[]; values: string[]}) => {
      const sql = strings.join("");
      if (!sql.includes("SELECT queued.*")) return [];
      const entries = [...rows.values()];
      const pending = entries.filter(row => row.businessType === values[0] && row.action === "queued");
      if (sql.includes('ORDER BY queued."createdAt" DESC')) {
        return pending.filter(row => row.businessId === values[1] && row.metadata.recipientId === values[2]
          && !pending.some(retry => retry.metadata.retryOf === row.id)).reverse().slice(0, 1);
      }
      return pending.filter(row => !entries.some(outcome => outcome.metadata.intentId === row.id));
    }
  };
  let tail: Promise<unknown> = Promise.resolve();
  const prisma = {...db, $transaction: <T>(run: (tx: typeof db) => Promise<T>) => {
    const result = tail.then(() => run(db));
    tail = result.catch(() => undefined);
    return result;
  }};
  const sms = {available: () => true, sendDutyIntent: jest.fn()};
  const worker = {client: {...prisma, $transaction: jest.fn(prisma.$transaction)}};
  const service = new FundBalanceReviewNotificationService(prisma as never, sms as never, worker as never);
  return {service, db, rows, sms, resolve, worker};
}

it("新受控余额更正仅确认本事务锁，未确认时拒绝且不入队", async () => {
  const {service, db, rows, sms, resolve} = fixture();
  const fresh = jest.mocked(resolveFreshCorrectionRecipient);
  fresh.mockRejectedValueOnce(new Error("资金更正通知缺少同事务收件人锁"));
  await expect(service.queue(db as never, "registration", "round", "applicant", true))
    .rejects.toThrow("资金更正通知缺少同事务收件人锁");
  expect(rows.size).toBe(0);
  await service.queue(db as never, "registration", "round", "applicant", true);
  await service.queue(db as never, "registration", "round", "applicant", true);
  expect(fresh).toHaveBeenCalledWith(db, "registration", "round", "finance");
  expect(resolve).not.toHaveBeenCalled();
  expect([...rows.values()]).toEqual([
    expect.objectContaining({action: "queued", metadata: {roundId: "round", recipientId: "finance"}})
  ]);
  expect(sms.sendDutyIntent).not.toHaveBeenCalled();
});

it("收件人锁签名仅接受当前事务和审批轮次", async () => {
  const originalKey = process.env.FUND_BALANCE_CORRECTION_WITNESS_KEY;
  const key = randomBytes(32);
  process.env.FUND_BALANCE_CORRECTION_WITNESS_KEY = key.toString("hex");
  try {
    const binding = {database: "test", role: "runtime", xid: "204", backend: "123", expires: "1234567890"};
    const query = jest.fn().mockResolvedValueOnce([binding]).mockResolvedValueOnce([]);
    const service = new FundAccountService({} as never, {} as never, {} as never);
    const verify = await service["authorizeCorrectionRound"]({$queryRaw: query} as never, "registration", []);
    const sign = (xid: string) => createHmac("sha256", key).update(
      ["fund_balance_correction_recipient_locks_v1", binding.database, binding.role, xid,
        binding.backend, "registration", "round"].map(value => Buffer.from(value).toString("hex")).join(":")
    ).digest("hex");
    query.mockResolvedValue([{proof: sign(binding.xid)}]);
    await expect(verify("round")).resolves.toBeUndefined();
    await expect(verify("other-round")).rejects.toThrow("资金更正收件人锁定证明不可用");
    query.mockResolvedValue([{proof: sign("205")}]);
    await expect(verify("round")).rejects.toThrow("资金更正收件人锁定证明不可用");
    query.mockResolvedValue([{proof: null}]);
    await expect(verify("round")).rejects.toThrow("资金更正收件人锁定证明不可用");
  } finally {
    key.fill(0);
    if (originalKey === undefined) delete process.env.FUND_BALANCE_CORRECTION_WITNESS_KEY;
    else process.env.FUND_BALANCE_CORRECTION_WITNESS_KEY = originalKey;
  }
});

it.each(["accepted", "revoked", "unknown"])("余额更正复核按当前处理权及短信回执消费 (%s)", async (state) => {
  const {service, db, rows, sms, resolve} = fixture();
  sms.sendDutyIntent.mockResolvedValue({status: state});
  await service.queue(db as never, "registration", "round", "applicant");
  await service.queue(db as never, "registration", "round", "applicant");
  expect(sms.sendDutyIntent).not.toHaveBeenCalled();
  if (state === "revoked") resolve.mockRejectedValue(new ForbiddenException());
  await service.afterCommit();
  await service.afterCommit();
  expect([...rows.values()].map(item => item.action)).toEqual(
    state === "revoked" ? ["queued", "cancelled"] : ["queued", "dispatch_claimed", state]);
  if (state === "revoked") expect(sms.sendDutyIntent).not.toHaveBeenCalled();
  else {
    expect(sms.sendDutyIntent).toHaveBeenCalledTimes(1);
    expect(sms.sendDutyIntent).toHaveBeenCalledWith("13800000000", expect.objectContaining({
      initiatorName: "合成发起人", scopeName: "公共现金", amountText: "120.1234 元", targetPath: "/资金余额复核/registration"
    }));
  }
});

it("当前原收件人可重试明确失败，并发旧键与响应重放同一结果", async () => {
  const {service, db, sms, resolve, worker} = fixture();
  sms.sendDutyIntent.mockResolvedValueOnce({status: "failed"}).mockResolvedValueOnce({status: "accepted"});
  await service.queue(db as never, "registration", "round", "applicant");
  await service.afterCommit();
  const {notice} = await service.status("registration", "finance");
  expect(notice).toMatchObject({status: "failed", canRetry: true});
  expect(await service.status("registration", "new-delegate")).toEqual({notice: null});
  const attemptId = notice!.attemptId;
  await expect(service.retry("registration", "new-delegate", attemptId, "round")).rejects.toThrow("当前待办或短信记录已变化");
  await expect(service.retry("foreign", "finance", attemptId, "round")).rejects.toThrow("当前待办或短信记录已变化");
  await expect(service.retry("registration", "finance", attemptId, "wrong-round")).rejects.toThrow("当前待办或短信记录已变化");
  const retry = () => service.retry("registration", "finance", attemptId, "round");
  await Promise.all([retry(), retry()]);
  expect(await retry()).toMatchObject({status: "accepted", canRetry: false});
  expect(resolve).toHaveBeenCalledWith(expect.anything(), "registration", "finance", "round", false, expect.any(Function));
  expect(sms.sendDutyIntent).toHaveBeenCalledTimes(2);
  expect(worker.client.$transaction).toHaveBeenCalledTimes(4);
  expect(jest.mocked(prepareFundBalanceNoticeAudit).mock.calls.map(call => call[3]))
    .toEqual(["dispatch_claimed", "failed", "queued", "dispatch_claimed", "accepted"]);
  expect(fundBalanceNoticeLocks).toHaveBeenCalledWith(db, "dispatch", "registration", "round", expect.any(String), "finance");
  expect(fundBalanceNoticeLocks).toHaveBeenCalledWith(db, "status", "registration", "round", expect.any(String), "finance");
  expect(fundBalanceNoticeLocks).toHaveBeenCalledWith(db, "retry", "registration", "round", attemptId, "finance");
});

it("轮次或当前职责失效时隐藏通知，结果未知不再发短信", async () => {
  const {service, db, sms, resolve} = fixture();
  sms.sendDutyIntent.mockResolvedValueOnce({status: "failed"}).mockRejectedValueOnce(new Error("合成响应丢失"));
  await service.queue(db as never, "registration", "round", "applicant");
  await service.afterCommit();
  const {notice} = await service.status("registration", "finance");
  const retry = () => service.retry("registration", "finance", notice!.attemptId, "round");
  const current = await retry();
  expect(current).toMatchObject({status: "unknown", canRetry: false});
  await expect(retry()).resolves.toEqual(current);
  await expect(service.retry("registration", "finance", current.attemptId, "round")).rejects.toThrow("仅确认发送失败");
  resolve.mockRejectedValue(new ForbiddenException());
  expect(await service.status("registration", "finance")).toEqual({notice: null});
  await expect(retry()).rejects.toThrow("当前待办或短信记录已变化");
  expect(sms.sendDutyIntent).toHaveBeenCalledTimes(2);
});
