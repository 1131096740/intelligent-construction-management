import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./api-fetch", () => ({ apiFetch: vi.fn() }));

import { apiFetch } from "./api-fetch";
import {
  fetchInterEntityRelationships,
  fetchPayableSettlementCapabilities,
  fetchPayableSettlementWorkbench,
  fetchWagePayableCases
} from "./payable-settlement.api";

const mockApiFetch = vi.mocked(apiFetch);

describe("payable settlement API", () => {
  beforeEach(() => {
    mockApiFetch.mockReset();
    mockApiFetch.mockImplementation(async () =>
      new Response(JSON.stringify({}), { status: 200 })
    );
  });

  it("reads historical wage cases and workbench records", async () => {
    await fetchPayableSettlementCapabilities();
    await fetchPayableSettlementWorkbench();
    await fetchWagePayableCases();

    expect(mockApiFetch).toHaveBeenNthCalledWith(1, "/payable-settlements/capabilities");
    expect(mockApiFetch).toHaveBeenNthCalledWith(
      2,
      "/payable-settlements/workbench"
    );
    expect(mockApiFetch).toHaveBeenNthCalledWith(
      3,
      "/payable-settlements/wage-payable-cases"
    );
  });

  it("reads explicit cross-entity relationships", async () => {
    await fetchInterEntityRelationships();

    expect(mockApiFetch).toHaveBeenCalledWith("/payable-settlements/inter-entity-relationships");
  });
});
