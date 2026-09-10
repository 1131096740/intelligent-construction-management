import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./api-fetch", () => ({ apiFetch: vi.fn() }));

import { apiFetch } from "./api-fetch";
import {
  fetchNecessaryExpenseReserveCapabilities,
  fetchNecessaryExpenseReserveWorkbench,
  saveNecessaryExpenseReserveDraft,
  transitionNecessaryExpenseReserve
} from "./necessary-expense-reserve.api";

const mockApiFetch = vi.mocked(apiFetch);

function response(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}

describe("necessary expense reserve API", () => {
  beforeEach(() => {
    mockApiFetch.mockReset();
  });

  it("uses the dedicated capability, workbench, draft and transition interface", async () => {
    mockApiFetch.mockImplementation(async () => response({ reserves: [] }));

    await fetchNecessaryExpenseReserveWorkbench("project-1");
    await fetchNecessaryExpenseReserveCapabilities("project-1");
    await saveNecessaryExpenseReserveDraft({ projectId: "project-1" });
    await transitionNecessaryExpenseReserve("entry-1", {
      action: "submit",
      expectedRevision: 1,
      expectedFingerprint: "a".repeat(64),
      idempotencyKey: crypto.randomUUID()
    });

    expect(mockApiFetch).toHaveBeenNthCalledWith(
      1,
      "/necessary-expense-reserves/workbench?projectId=project-1"
    );
    expect(mockApiFetch).toHaveBeenNthCalledWith(
      2,
      "/necessary-expense-reserves/capabilities?projectId=project-1"
    );
    expect(mockApiFetch).toHaveBeenNthCalledWith(
      3,
      "/necessary-expense-reserves/drafts",
      expect.objectContaining({ method: "POST" })
    );
    expect(mockApiFetch).toHaveBeenNthCalledWith(
      4,
      "/necessary-expense-reserves/entries/entry-1/transition",
      expect.objectContaining({ method: "POST" })
    );
  });
});
