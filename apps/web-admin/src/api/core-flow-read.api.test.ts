import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchContractDetail,
  fetchPaymentDetail,
  fetchSettlementDetail
} from "./core-flow-read.api";

describe("core flow read API client", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("requests the first read-only detail endpoints", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ id: "ok" })
    } as Response);

    await fetchContractDetail("HT-2026-001");
    await fetchSettlementDetail("JS-2026-018");
    await fetchPaymentDetail("FK-2026-006");

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "/api/contracts/HT-2026-001",
      "/api/settlements/JS-2026-018",
      "/api/payments/FK-2026-006"
    ]);
  });
});
