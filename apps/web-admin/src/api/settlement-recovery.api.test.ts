import { afterEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "./api-fetch";
import {
  fetchSettlementRecovery,
  recordSettlementRecovery,
  reverseSettlementRecovery
} from "./settlement-recovery.api";

vi.mock("./api-fetch", () => ({ apiFetch: vi.fn() }));

const mockedFetch = vi.mocked(apiFetch);

describe("settlement recovery api", () => {
  afterEach(() => { vi.clearAllMocks(); });

  it("reads the recovery ledger through the scoped settlement resource", async () => {
    mockedFetch.mockResolvedValue(new Response("null", { status: 200 }));

    await expect(fetchSettlementRecovery("settlement/1")).resolves.toBeNull();
    expect(mockedFetch).toHaveBeenCalledWith("/settlements/settlement%2F1/recovery", { method: "GET" });
  });

  it("posts refund facts and reversals without accepting a client actor", async () => {
    mockedFetch
      .mockResolvedValueOnce(new Response(JSON.stringify({ balance: {}, entry: {} }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ balance: {}, entry: {} }), { status: 201 }));

    await recordSettlementRecovery("settlement-1", {
      entryType: "refund",
      amountCents: "100",
      occurredOn: "2026-07-27",
      evidenceFileId: "file-1",
      reason: "退款到账",
      idempotencyKey: "recover-1",
      confirmationPassword: "current-password"
    });
    await reverseSettlementRecovery("settlement-1", "entry-1", {
      evidenceFileId: "file-2",
      reason: "原登记有误",
      idempotencyKey: "reverse-1",
      confirmationPassword: "current-password"
    });

    expect(mockedFetch).toHaveBeenNthCalledWith(1, "/settlements/settlement-1/recovery-entries", expect.objectContaining({ method: "POST" }));
    expect(mockedFetch).toHaveBeenNthCalledWith(2, "/settlements/settlement-1/recovery-entries/entry-1/reversal", expect.objectContaining({ method: "POST" }));
  });
});
