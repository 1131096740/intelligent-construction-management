import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchFundsWorkbench } from "./funds-workbench.api";

vi.mock("./api-fetch", () => ({ apiFetch: vi.fn() }));

import { apiFetch } from "./api-fetch";

const mockApiFetch = vi.mocked(apiFetch);

describe("funds workbench API", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("keeps the default read free of empty filters and encodes selected server views", async () => {
    mockApiFetch
      .mockResolvedValueOnce(new Response(JSON.stringify({ view: "all", source: "all", items: [], viewCounts: {}, sourceCounts: {} }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ view: "partial_payment", source: "expense_reimbursement", items: [], viewCounts: {}, sourceCounts: {} }), { status: 200 }));

    await fetchFundsWorkbench();
    await fetchFundsWorkbench({ view: "partial_payment", source: "expense_reimbursement" });

    expect(mockApiFetch).toHaveBeenNthCalledWith(1, "/funds-workbench");
    expect(mockApiFetch).toHaveBeenNthCalledWith(2, "/funds-workbench?view=partial_payment&source=expense_reimbursement");
  });
});
