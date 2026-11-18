import { afterEach, expect, it, vi } from "vitest";
import { readFundTransferCommand, submitFundTransferCommand, type FundTransferCommand } from "./fund-transfer-command";

const mocked = vi.hoisted(() => ({ register: vi.fn() }));
vi.mock("../../api/fund-account-transfer.api", async original => ({
  ...await original<typeof import("../../api/fund-account-transfer.api")>(),
  registerFundAccountTransfer: mocked.register
}));
afterEach(() => { vi.unstubAllGlobals(); mocked.register.mockReset(); });
const command: FundTransferCommand = { type: "register", input: {
  sourceScopeKey: "public_cash", destinationScopeKey: "company:a",
  expectedRegistrationId: "origin-revision", idempotencyKey: "first-key",
  evidenceReference: "交接凭据", transferredOn: "2026-11-18",
  lines: [{ sourceBatchId: "source-id", amountYuan: "10.2500" }]
} };

it("recovers a lost registration response with the one original key and allocation after reload", async () => {
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key)
  });
  vi.stubGlobal("navigator", { locks: { request: (_key: string, _options: unknown, callback: () => unknown) => callback() } });
  mocked.register.mockRejectedValueOnce(new TypeError("connection closed"))
    .mockResolvedValueOnce({ id: "saved", revision: 1, status: "pending_receipt" });
  expect(await submitFundTransferCommand("actor", command, () => true)).toMatchObject({ kind: "unknown" });
  expect(readFundTransferCommand("actor")).toEqual(command);
  expect(readFundTransferCommand("other")).toBeNull();
  const changed = { ...command, input: { ...command.input, idempotencyKey: "replacement" } };
  expect(await submitFundTransferCommand("actor", changed, () => true)).toMatchObject({ kind: "pending" });
  expect(await submitFundTransferCommand("actor", null, () => true)).toMatchObject({ kind: "saved" });
  expect(mocked.register.mock.calls).toEqual([[command.input], [command.input]]);
  expect(readFundTransferCommand("actor")).toBeNull();
});
