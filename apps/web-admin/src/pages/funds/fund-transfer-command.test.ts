import { afterEach, expect, it, vi } from "vitest";
import { FundTransferApiError } from "../../api/fund-account-transfer.api";
import { readFundTransferCommand, submitFundTransferCommand, type FundTransferCommand } from "./fund-transfer-command";

const mocked = vi.hoisted(() => ({ register: vi.fn(), act: vi.fn() }));
vi.mock("../../api/fund-account-transfer.api", async original => ({
  ...await original<typeof import("../../api/fund-account-transfer.api")>(),
  registerFundAccountTransfer: mocked.register,
  actOnFundAccountTransfer: mocked.act
}));
afterEach(() => { vi.unstubAllGlobals(); mocked.register.mockReset(); mocked.act.mockReset(); });
const command: FundTransferCommand = { type: "register", input: {
  sourceScopeKey: "public_cash", destinationScopeKey: "company:a",
  expectedRegistrationId: "origin-revision", idempotencyKey: "first-key",
  evidenceReference: "交接凭据", transferredOn: "2026-11-18",
  lines: [{ sourceBatchId: "source-id", amountYuan: "10.2500" }]
} };

function stubBrowser() {
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key)
  });
  vi.stubGlobal("navigator", { locks: { request: (_key: string, _options: unknown, callback: () => unknown) => callback() } });
}

it("recovers a lost registration response with the one original key and allocation after reload", async () => {
  stubBrowser();
  mocked.register.mockRejectedValueOnce(new TypeError("connection closed"))
    .mockResolvedValueOnce({ id: "saved", revision: 1, status: "pending_receipt" });
  expect(await submitFundTransferCommand("actor", command, () => true)).toMatchObject({ kind: "unknown" });
  expect(readFundTransferCommand("actor")).toEqual(command);
  expect(readFundTransferCommand("other")).toBeNull();
  const changed = { ...command, input: { ...command.input, idempotencyKey: "replacement" } };
  expect(await submitFundTransferCommand("actor", changed, () => true)).toMatchObject({ kind: "pending" });
  expect(await submitFundTransferCommand("actor", null, () => true, changed)).toEqual({ kind: "pending", command });
  expect(mocked.register).toHaveBeenCalledTimes(1);
  expect(await submitFundTransferCommand("actor", null, () => true, command)).toMatchObject({ kind: "saved" });
  expect(mocked.register.mock.calls).toEqual([[command.input], [command.input]]);
  expect(readFundTransferCommand("actor")).toBeNull();
});

it.each([false, true])("only clears a proved no-write conflict on the fresh attempt (previously uncertain: %s)", async previouslyUncertain => {
  stubBrowser();
  if (previouslyUncertain) {
    mocked.register.mockRejectedValueOnce(new TypeError("connection closed"));
    expect(await submitFundTransferCommand("actor", command, () => true)).toMatchObject({ kind: "unknown" });
  }
  mocked.register.mockRejectedValueOnce(new FundTransferApiError(
    "请重新核对转款资料", 409, "FUND_ACCOUNT_TRANSFER_REJECTED_NO_WRITE"
  ));
  const proposal = previouslyUncertain ? null : command;
  const result = await submitFundTransferCommand("actor", proposal, () => true, previouslyUncertain ? command : null);
  expect(result.kind).toBe(previouslyUncertain ? "unknown" : "rejected");
  expect(readFundTransferCommand("actor")).toEqual(previouslyUncertain ? command : null);
});


it("releases a frozen action only after the same key is proven superseded", async () => {
  stubBrowser();
  const action: FundTransferCommand = { type: "action", transferId: "transfer", input: {
    idempotencyKey: "losing-key", expectedRevision: 1, action: "confirm", evidenceReference: "到账凭据"
  } };
  mocked.act.mockRejectedValueOnce(new FundTransferApiError("状态已变化", 409))
    .mockRejectedValueOnce(new FundTransferApiError("暂不可办理", 409, "FUND_ACCOUNT_TRANSFER_REJECTED_NO_WRITE"))
    .mockRejectedValueOnce(new FundTransferApiError("原操作未入账", 409, "FUND_ACCOUNT_TRANSFER_COMMAND_SUPERSEDED"));
  expect(await submitFundTransferCommand("actor", action, () => true)).toMatchObject({ kind: "unknown" });
  expect(await submitFundTransferCommand("actor", null, () => true, action)).toMatchObject({ kind: "unknown" });
  expect(readFundTransferCommand("actor")).toEqual(action);
  expect(await submitFundTransferCommand("actor", null, () => true, action)).toMatchObject({ kind: "superseded" });
  expect(mocked.act.mock.calls).toEqual(Array.from({ length: 3 }, () => [action.transferId, action.input]));
  expect(readFundTransferCommand("actor")).toBeNull();
});
