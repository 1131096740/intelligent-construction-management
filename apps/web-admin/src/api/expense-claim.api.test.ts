import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchExpenseClaims } from "./expense-claim.api";

vi.mock("./api-fetch", () => ({ apiFetch: vi.fn() }));

import { apiFetch } from "./api-fetch";

const mockApiFetch = vi.mocked(apiFetch);

describe("expense claim API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads the current user's new-domain claims with the selected server-side view", async () => {
    mockApiFetch.mockResolvedValue(new Response(JSON.stringify([{ id: "claim-1", code: "BX-1" }]), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    }));

    await expect(fetchExpenseClaims("pending_funds")).resolves.toEqual([
      expect.objectContaining({ id: "claim-1", code: "BX-1" })
    ]);
    expect(mockApiFetch).toHaveBeenCalledWith("/expense-claims?view=pending_funds");
  });

  it("keeps the all view free of a misleading client-side query", async () => {
    mockApiFetch.mockResolvedValue(new Response(JSON.stringify([]), { status: 200 }));

    await fetchExpenseClaims();

    expect(mockApiFetch).toHaveBeenCalledWith("/expense-claims");
  });
});
