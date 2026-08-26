import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./api-fetch", () => ({ apiFetch: vi.fn() }));

import { apiFetch } from "./api-fetch";
import {
  attestClearingEvent,
  confirmClearingEvent,
  createClearingEvent,
  fetchClearingCapabilities,
  fetchClearingCase,
  reviseClearingEvent
} from "./clearing.api";

const mockApiFetch = vi.mocked(apiFetch);

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

describe("clearing API", () => {
  beforeEach(() => {
    mockApiFetch.mockReset();
  });

  it("reads server-derived capabilities and the immutable timeline", async () => {
    mockApiFetch
      .mockResolvedValueOnce(response({ read: true, confirm: false }))
      .mockResolvedValueOnce(response({ id: "case-1", events: [] }));

    await fetchClearingCapabilities();
    await fetchClearingCase("case-1");

    expect(mockApiFetch).toHaveBeenNthCalledWith(1, "/clearing-cases/capabilities");
    expect(mockApiFetch).toHaveBeenNthCalledWith(2, "/clearing-cases/case-1");
  });

  it("uses separate draft, revise, attestation and confirmation endpoints", async () => {
    mockApiFetch.mockImplementation(() =>
      Promise.resolve(response({ id: "event-1", revision: 1 }))
    );
    const payload = { idempotencyKey: "id-1", expectedRevision: 1 };

    await createClearingEvent("case-1", payload);
    await reviseClearingEvent("event-1", payload);
    await attestClearingEvent("event-1", payload);
    await confirmClearingEvent("event-1", { ...payload, allocations: [] });

    expect(mockApiFetch).toHaveBeenNthCalledWith(
      1,
      "/clearing-cases/case-1/events",
      expect.objectContaining({ method: "POST" })
    );
    expect(mockApiFetch).toHaveBeenNthCalledWith(
      2,
      "/clearing-cases/events/event-1/draft",
      expect.objectContaining({ method: "PATCH" })
    );
    expect(mockApiFetch).toHaveBeenNthCalledWith(
      3,
      "/clearing-cases/events/event-1/attest",
      expect.objectContaining({ method: "POST" })
    );
    expect(mockApiFetch).toHaveBeenNthCalledWith(
      4,
      "/clearing-cases/events/event-1/confirm",
      expect.objectContaining({ method: "POST" })
    );
  });
});
