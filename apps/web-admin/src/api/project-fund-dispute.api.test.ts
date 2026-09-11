import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./api-fetch", () => ({ apiFetch: vi.fn() }));

import { apiFetch } from "./api-fetch";
import {
  fetchProjectFundDisputeWorkbench,
  saveProjectFundDisputeDraft,
  transitionProjectFundDispute
} from "./project-fund-dispute.api";

const mockApiFetch = vi.mocked(apiFetch);

function response(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}

describe("project fund dispute API", () => {
  beforeEach(() => {
    mockApiFetch.mockReset();
  });

  it("uses the frozen workbench, draft and transition interface", async () => {
    mockApiFetch.mockImplementation(async () => response({ disputes: [] }));

    await fetchProjectFundDisputeWorkbench("project-1");
    await saveProjectFundDisputeDraft({ projectId: "project-1" });
    await transitionProjectFundDispute("entry-1", {
      action: "submit",
      expectedRevision: 1,
      expectedFingerprint: "a".repeat(64),
      idempotencyKey: crypto.randomUUID()
    });

    expect(mockApiFetch).toHaveBeenNthCalledWith(
      1,
      "/project-fund-disputes/workbench?projectId=project-1"
    );
    expect(mockApiFetch).toHaveBeenNthCalledWith(
      2,
      "/project-fund-disputes/drafts",
      expect.objectContaining({ method: "POST" })
    );
    expect(mockApiFetch).toHaveBeenNthCalledWith(
      3,
      "/project-fund-disputes/entries/entry-1/transition",
      expect.objectContaining({ method: "POST" })
    );
  });
});
