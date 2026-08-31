import {
  FUND_EXECUTION_COMMAND_ACTIONS,
  executeFundExecutionReceiptFirst,
  fundExecutionCommandFingerprint
} from "./fund-execution-command-receipt";

describe("资金执行命令回执", () => {
  it("数据库与 TypeScript 共用五类 canonical action", () => {
    expect(FUND_EXECUTION_COMMAND_ACTIONS).toEqual([
      "create_case",
      "update_case",
      "submit_case",
      "return_case",
      "confirm_case"
    ]);
  });

  it("命令指纹包含 canonical action，并稳定规范化属性顺序、日期和 bigint", () => {
    const left = fundExecutionCommandFingerprint("update_case", {
      revision: 2,
      amountCents: 12_345n,
      occurredAt: new Date("2026-08-31T04:00:00.000Z")
    });
    const right = fundExecutionCommandFingerprint("update_case", {
      occurredAt: new Date("2026-08-31T04:00:00.000Z"),
      amountCents: 12_345n,
      revision: 2
    });

    expect(left).toBe(right);
    expect(left).toMatch(/^[a-f0-9]{64}$/);
    expect(
      fundExecutionCommandFingerprint("submit_case", {
        revision: 2,
        amountCents: 12_345n,
        occurredAt: new Date("2026-08-31T04:00:00.000Z")
      })
    ).not.toBe(left);
  });

  it("命令必须先锁幂等键、查询回执，之后才允许执行可变状态校验和写入", async () => {
    const calls: string[] = [];

    const response = await executeFundExecutionReceiptFirst({
      action: "submit_case",
      idempotencyKey: "11111111-1111-4111-8111-111111111111",
      payloadFingerprint: "payload-fingerprint",
      lockIdempotency: async () => {
        calls.push("lock_receipt");
      },
      findReceipt: async () => {
        calls.push("find_receipt");
        return null;
      },
      execute: async () => {
        calls.push("validate_mutable_state");
        calls.push("write_business_state");
        return { caseId: "case-id", status: "approval_pending" };
      },
      createReceipt: async () => {
        calls.push("create_receipt");
      }
    });

    expect(response).toEqual({ caseId: "case-id", status: "approval_pending" });
    expect(calls).toEqual([
      "lock_receipt",
      "find_receipt",
      "validate_mutable_state",
      "write_business_state",
      "create_receipt"
    ]);
  });

  it("命中同指纹回执时直接重放，绝不重新校验或写入业务状态", async () => {
    const execute = jest.fn();
    const createReceipt = jest.fn();

    const response = await executeFundExecutionReceiptFirst({
      action: "confirm_case",
      idempotencyKey: "22222222-2222-4222-8222-222222222222",
      payloadFingerprint: "same-payload",
      lockIdempotency: async () => undefined,
      findReceipt: async () => ({
        action: "confirm_case",
        payloadFingerprint: "same-payload",
        responseSnapshot: { caseId: "case-id", status: "confirmed" }
      }),
      execute,
      createReceipt
    });

    expect(response).toEqual({ caseId: "case-id", status: "confirmed" });
    expect(execute).not.toHaveBeenCalled();
    expect(createReceipt).not.toHaveBeenCalled();
  });

  it("同幂等键的 action 或 payload 不一致时失败关闭", async () => {
    await expect(
      executeFundExecutionReceiptFirst({
        action: "return_case",
        idempotencyKey: "33333333-3333-4333-8333-333333333333",
        payloadFingerprint: "new-payload",
        lockIdempotency: async () => undefined,
        findReceipt: async () => ({
          action: "submit_case",
          payloadFingerprint: "old-payload",
          responseSnapshot: { caseId: "case-id" }
        }),
        execute: async () => ({ caseId: "must-not-run" }),
        createReceipt: async () => undefined
      })
    ).rejects.toThrow("幂等键已被其他资金执行命令占用");
  });
});
