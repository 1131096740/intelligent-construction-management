import { createHmac, randomBytes } from "node:crypto";
import { fundBalanceNoticeLocks, prepareFundBalanceNoticeAudit } from "./fund-balance-notice-locks";

const key = randomBytes(32).toString("hex");
const oldNoticeKey = process.env.FUND_BALANCE_NOTICE_WITNESS_KEY;
const oldCorrectionKey = process.env.FUND_BALANCE_CORRECTION_WITNESS_KEY;
const binding = { database: "synthetic", role: "worker", xid: "23", backend: "14", expires: "1234567890" };

beforeEach(() => {
  process.env.FUND_BALANCE_NOTICE_WITNESS_KEY = key;
  delete process.env.FUND_BALANCE_CORRECTION_WITNESS_KEY;
});
afterEach(() => {
  if (oldNoticeKey === undefined) delete process.env.FUND_BALANCE_NOTICE_WITNESS_KEY;
  else process.env.FUND_BALANCE_NOTICE_WITNESS_KEY = oldNoticeKey;
  if (oldCorrectionKey === undefined) delete process.env.FUND_BALANCE_CORRECTION_WITNESS_KEY;
  else process.env.FUND_BALANCE_CORRECTION_WITNESS_KEY = oldCorrectionKey;
});

it("binds each stage to the role, transaction, round, intent and recipient and separates purpose", async () => {
  const query = jest.fn().mockResolvedValueOnce([binding]).mockResolvedValueOnce([{locked:true}])
    .mockResolvedValueOnce([{locked:true}]).mockResolvedValueOnce([{...binding, role:"app"}])
    .mockResolvedValueOnce([{locked:true}]);
  const tx = {$queryRaw:query} as never;
  const dispatch = fundBalanceNoticeLocks(tx, "dispatch", "registration", "round", "attempt", "recipient");
  await expect(dispatch("round")).resolves.toBe(true);
  await expect(dispatch("user", "delegator")).resolves.toBe(true);
  const status = fundBalanceNoticeLocks(tx, "status", "registration", "round", "attempt", "recipient");
  await expect(status("round")).resolves.toBe(true);
  const sqlArguments = (index: number) => query.mock.calls[index].slice(1);
  const proof = (operation: string, stage: string, role: string, subject: string) => createHmac("sha256", Buffer.from(key,"hex"))
    .update([operation === "dispatch" ? "fund_balance_notice_worker_v1" : "fund_balance_notice_interaction_v1",
      "synthetic", role, "23", "14", "1234567890", operation, stage, "registration", "round", "attempt", "recipient", subject]
      .map(value => Buffer.from(value).toString("hex")).join(":")).digest("hex");
  expect(sqlArguments(1)).toEqual(["dispatch","round","registration","round","attempt","recipient","recipient",
    binding.expires,proof("dispatch","round","worker","recipient")]);
  expect(sqlArguments(2).at(-1)).toBe(proof("dispatch","user","worker","delegator"));
  expect(sqlArguments(4).at(-1)).toBe(proof("status","round","app","recipient"));
});

it.each([undefined, key])("fails closed for missing or reused key (%s)", async (correctionKey) => {
  if (correctionKey === undefined) delete process.env.FUND_BALANCE_NOTICE_WITNESS_KEY;
  else process.env.FUND_BALANCE_CORRECTION_WITNESS_KEY = correctionKey;
  const query = jest.fn();
  await expect(fundBalanceNoticeLocks({$queryRaw:query} as never,
    "retry", "registration", "round", "attempt", "actor")("round")).rejects.toThrow("授权未配置");
  expect(query).not.toHaveBeenCalled();
});

it("binds audit action and row separately from the lock and uses the current terminal transaction", async () => {
  const outcomeBinding = { ...binding, xid: "24" };
  const query = jest.fn().mockResolvedValueOnce([binding]).mockResolvedValueOnce([])
    .mockResolvedValueOnce([outcomeBinding]).mockResolvedValueOnce([]);
  const tx = { $queryRaw: query } as never;
  const intent = { id: "attempt", businessId: "registration", metadata: { roundId: "round", recipientId: "recipient" } } as never;
  await prepareFundBalanceNoticeAudit(tx, intent, "claim", "dispatch_claimed");
  await prepareFundBalanceNoticeAudit(tx, intent, "terminal", "failed");
  const proof = (xid: string, id: string, action: string) =>
    createHmac("sha256", Buffer.from(key, "hex")).update([
      "fund_balance_notice_audit_worker_v1", "synthetic", "worker", xid, "14", binding.expires,
      action, id, "registration", "round", "attempt", "recipient"
    ].map(value => Buffer.from(value).toString("hex")).join(":")).digest("hex");
  expect(query.mock.calls[1][1]).toBe(binding.expires + ":" + proof("23", "claim", "dispatch_claimed"));
  expect(query.mock.calls[3][1]).toBe(binding.expires + ":" + proof("24", "terminal", "failed"));
});
