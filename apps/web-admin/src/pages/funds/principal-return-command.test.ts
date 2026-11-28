import { afterEach, expect, it, vi } from "vitest";
import type { PrincipalReturnCommand } from "../../api/fund-principal-return.api";
import { readPrincipalReturnCommand, runPrincipalReturnCommand } from "./principal-return-command";

const mocks = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock("../../api/api-fetch", () => mocks);
afterEach(() => {
  vi.unstubAllGlobals();
  mocks.apiFetch.mockReset();
});
const payment: PrincipalReturnCommand = {
  kind: "pay", applicationId: "app-1", idempotencyKey: "the-original-key",
  input: {
    expectedRevision: 4, scopeKey: "public_cash", expectedRegistrationId: "cash-registration-1", paidOn: "2026-11-18",
    amountYuan: "100.1234", sourceAllocations: [
      { sourceBatchId: "source-1", amountYuan: "60.1234" }, { sourceBatchId: "source-2", amountYuan: "40.0000" },
    ], evidenceReference: "归还收据",
  },
};
const receipt = { status: "recorded", idempotencyKey: payment.idempotencyKey, applicationId: payment.applicationId, paymentId: "pay-1" };

function browserStorage() {
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  vi.stubGlobal("navigator", { locks: { request: (_key: string, _options: unknown, callback: () => unknown) => callback() } });
  return storage;
}
const command = (mode: "new" | "check" | "retry", password = "") =>
  runPrincipalReturnCommand("cashier", payment, mode, () => true, password);
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

const payable = (allowed = true) => json({
  payableScopeKeys: allowed ? ["public_cash"] : [],
  items: [{ applications: [{ id: payment.applicationId, revision: 4, canPay: allowed }] }],
});
const pendingReceipt = () => json({ status: "unconfirmed", idempotencyKey: payment.idempotencyKey });
const posts = () => mocks.apiFetch.mock.calls.filter(([, options]) => options?.method === "POST");

it("recovers exact four-place payment after response loss without persisting the password", async () => {
  const storage = browserStorage();
  mocks.apiFetch.mockResolvedValueOnce(payable())
    .mockRejectedValueOnce(new TypeError("lost response"))
    .mockResolvedValueOnce(json({ ...receipt, idempotencyKey: "other-key" }))
    .mockResolvedValueOnce(pendingReceipt())
    .mockResolvedValueOnce(payable())
    .mockResolvedValueOnce(json(receipt));
  expect(await command("new", "first-secret")).toMatchObject({ kind: "pending" });
  expect([...storage.values()].join("")).not.toContain("first-secret");
  expect(readPrincipalReturnCommand("cashier")).toEqual(payment);
  expect(readPrincipalReturnCommand("other")).toBeNull();
  expect(await command("check")).toMatchObject({ kind: "pending" });
  expect(await command("retry", "new-secret")).toEqual({ kind: "recorded" });
  expect(mocks.apiFetch.mock.calls[2]).toEqual(["/fund-accounts/principal-returns/results/the-original-key", { responseIsCurrent: expect.any(Function) }]);
  expect(posts().map(([path, options]) => [path, JSON.parse(options.body)])).toEqual(
    ["first-secret", "new-secret"].map(confirmationPassword => [
      "/fund-accounts/principal-returns/applications/app-1/payments",
      { ...payment.input, idempotencyKey: "the-original-key", confirmationPassword },
    ]),
  );
  expect(readPrincipalReturnCommand("cashier")).toBeNull();
});

it("keeps an uncertain original command even after a subsequent typed rejection", async () => {
  browserStorage();
  const reject = () => json({ code: "REGISTERED_PRINCIPAL_RETURN_REJECTED", message: "请刷新后核对" }, 409);
  mocks.apiFetch.mockResolvedValueOnce(payable())
    .mockResolvedValueOnce(reject())
    .mockResolvedValueOnce(payable())
    .mockResolvedValueOnce(json({ message: "账户状态变化" }, 409))
    .mockResolvedValueOnce(pendingReceipt())
    .mockResolvedValueOnce(payable())
    .mockResolvedValueOnce(reject())
    .mockResolvedValueOnce(json(receipt));
  expect(await command("new")).toMatchObject({ kind: "rejected" });
  expect(readPrincipalReturnCommand("cashier")).toBeNull();
  expect(await command("new")).toMatchObject({ kind: "pending" });
  expect(await command("retry")).toMatchObject({ kind: "pending" });
  const replacement = { ...payment, idempotencyKey: "do-not-submit" };
  expect(await runPrincipalReturnCommand("cashier", replacement, "new", () => true)).toEqual({ kind: "pending", command: payment });
  expect(posts()).toHaveLength(3);
  expect(await command("check")).toEqual({ kind: "recorded" });
});

it("checks the original key first and keeps the original payment frozen when payment authority was revoked", async () => {
  browserStorage();
  mocks.apiFetch.mockResolvedValueOnce(payable())
    .mockRejectedValueOnce(new TypeError("lost response"))
    .mockResolvedValueOnce(pendingReceipt())
    .mockResolvedValueOnce(payable(false))
    .mockResolvedValueOnce(json(receipt));
  expect(await command("new", "secret")).toMatchObject({ kind: "pending" });
  expect(await command("retry", "secret")).toMatchObject({ kind: "pending" });
  expect(posts()).toHaveLength(1);
  expect(await command("retry", "secret")).toEqual({ kind: "recorded" });
  expect(posts()).toHaveLength(1);
});

it("never sends a pending request after the actor changes while waiting for the browser lock", async () => {
  browserStorage();
  let current = true;
  vi.stubGlobal("navigator", { locks: { request: (_key: string, _options: unknown, callback: () => unknown) => {
    current = false;
    return callback();
  } } });
  await expect(runPrincipalReturnCommand("cashier", payment, "new", () => current)).rejects.toThrow("当前账号已变化");
  expect(mocks.apiFetch).not.toHaveBeenCalled();
  expect(readPrincipalReturnCommand("cashier")).toBeNull();
});
