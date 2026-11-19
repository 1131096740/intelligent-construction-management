import { ForbiddenException } from "@nestjs/common";
import { FundBalanceReviewNotificationService } from "./fund-balance-review-notification.service";
import { resolveFundReviewIdentity } from "./fund-account-duty";

jest.mock("./fund-account-duty", () => ({
  resolveFundReviewIdentity: jest.fn()
}));

function fixture() {
  const resolve = jest.mocked(resolveFundReviewIdentity);
  const duty = {row: {balanceYuan: {toFixed: () => "120.1234"}, version: 2, createdByUserId: "applicant"},
    round: {id: "round"}, account: {companyEntityId: null}} as never;
  resolve.mockReset().mockResolvedValue(duty);
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
  const service = new FundBalanceReviewNotificationService(prisma as never, sms as never);
  return {service, db, rows, sms, resolve};
}

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
  const {service, db, sms, resolve} = fixture();
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
  expect(resolve).toHaveBeenCalledWith(expect.anything(), "registration", "finance", "round");
  expect(sms.sendDutyIntent).toHaveBeenCalledTimes(2);
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
