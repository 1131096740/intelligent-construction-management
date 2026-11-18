import { beforeEach, expect, it, vi } from "vitest";
import { actOnFundAccountTransfer, registerFundAccountTransfer } from "./fund-account-transfer.api";

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock("./api-fetch", () => ({ apiFetch }));

beforeEach(() => apiFetch.mockReset());

it("submits the original account version, source allocations and idempotency key", async () => {
  const command = {
    sourceScopeKey: "public_cash", destinationScopeKey: "company:company-a",
    expectedRegistrationId: "original-registration", idempotencyKey: "original-key",
    transferredOn: "2026-11-18", evidenceReference: "现金交接凭据",
    lines: [{ sourceBatchId: "original-source", amountYuan: "12.3400" }]
  };
  const receipt = { id: "3d5bbc1e-be9a-4cca-9704-41b9c1df4ea2", status: "pending_receipt", revision: 1 };
  apiFetch.mockResolvedValue(Response.json(receipt));
  await expect(registerFundAccountTransfer(command)).resolves.toEqual(receipt);
  expect(apiFetch).toHaveBeenCalledWith("/fund-account-transfers", expect.objectContaining({
    method: "POST", body: JSON.stringify(command)
  }));
});

it("requires a valid receipt before treating confirmation as successful", async () => {
  const command = { idempotencyKey: "original-key", expectedRevision: 2, action: "confirm" as const, evidenceReference: "财务确认到账" };
  apiFetch.mockResolvedValue(Response.json({ status: "received" }));
  await expect(actOnFundAccountTransfer("transfer/id", command)).rejects.toThrow();
  expect(apiFetch).toHaveBeenCalledWith("/fund-account-transfers/transfer%2Fid/actions", expect.objectContaining({
    method: "POST", body: JSON.stringify(command)
  }));
});

it.each([
  ["FUND_ACCOUNT_TRANSFER_REJECTED_NO_WRITE", true],
  ["UNKNOWN_UPSTREAM_CONFLICT", false]
])("distinguishes an explicit no-write conflict from an unknown conflict (%s)", async (code, isDefinitiveRejection) => {
  apiFetch.mockResolvedValue(Response.json({ statusCode: 409, code, message: "请重新核对转款资料" }, { status: 409 }));
  const command = { idempotencyKey: "original-key", expectedRevision: 2, action: "confirm" as const, evidenceReference: "财务确认到账" };
  await expect(actOnFundAccountTransfer("transfer-id", command)).rejects.toMatchObject({ status: 409, isDefinitiveRejection });
});
