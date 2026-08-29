import { beforeEach, describe, expect, it, vi } from "vitest";

import { fetchFundMovements } from "./fund-movement.api";
import { apiFetch } from "./api-fetch";

vi.mock("./api-fetch", () => ({ apiFetch: vi.fn() }));

const mockApiFetch = vi.mocked(apiFetch);

describe("fund movement API", () => {
  beforeEach(() => {
    mockApiFetch.mockReset();
  });

  it("reads the aggregate list through the backend module", async () => {
    mockApiFetch.mockResolvedValue(new Response("[]", { status: 200 }));
    await expect(fetchFundMovements()).resolves.toEqual([]);
    expect(mockApiFetch).toHaveBeenCalledWith("/fund-movements");
  });
});
