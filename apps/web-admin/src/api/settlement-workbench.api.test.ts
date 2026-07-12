import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchSettlementSourceLines, previewSettlementLines } from "./settlement-workbench.api";

vi.mock("./api-fetch", () => ({ apiFetch: vi.fn() }));

import { apiFetch } from "./api-fetch";

const mockApiFetch = vi.mocked(apiFetch);

describe("settlement workbench API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads source lines from the contract-version resource endpoint", async () => {
    mockApiFetch.mockResolvedValue(
      new Response(JSON.stringify({ contractVersionId: "version/1", rows: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    );

    await expect(fetchSettlementSourceLines("version/1")).resolves.toMatchObject({ rows: [] });
    expect(mockApiFetch).toHaveBeenCalledWith(
      "/settlement-workbench/contract-versions/version%2F1/source-lines",
      { method: "GET" }
    );
  });

  it("posts selected lines to the canonical preview resource", async () => {
    mockApiFetch.mockResolvedValue(
      new Response(JSON.stringify({ contractVersionId: "version-1", amountCents: "100", lines: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    );
    const settlementLines = [
      { sourceType: "contract_bill_row" as const, contractBillRowId: "row-1", quantity: "1" }
    ];

    await expect(previewSettlementLines("version-1", { settlementLines })).resolves.toMatchObject({
      amountCents: "100"
    });
    expect(mockApiFetch).toHaveBeenCalledWith(
      "/settlement-workbench/contract-versions/version-1/preview",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ settlementLines }) })
    );
  });
});
