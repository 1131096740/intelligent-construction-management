import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createContractEndedApplicationRetentionHold,
  fetchContractEndedApplicationRetentionPreview,
  releaseContractEndedApplicationRetentionHold
} from "./contract-ended-retention.api";

vi.mock("./api-fetch", () => ({ apiFetch: vi.fn() }));
import { apiFetch } from "./api-fetch";

const mockApiFetch = vi.mocked(apiFetch);

describe("contract ended application retention API", () => {
  beforeEach(() => {
    mockApiFetch.mockReset();
    mockApiFetch.mockImplementation(async () =>
      new Response(JSON.stringify({ candidates: [], heldRecords: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    );
  });

  it("uses the preview-only endpoint and exact director hold routes", async () => {
    await fetchContractEndedApplicationRetentionPreview(2, 20);
    await createContractEndedApplicationRetentionHold("version/1", { reason: "等待争议解决" });
    await releaseContractEndedApplicationRetentionHold("version/1", { reason: "争议已结" });

    expect(mockApiFetch.mock.calls.map(([path]) => path)).toEqual([
      "/contract-ended-retention/preview?page=2&limit=20",
      "/contract-ended-retention/version%2F1/holds",
      "/contract-ended-retention/version%2F1/hold-release"
    ]);
    expect(mockApiFetch.mock.calls.map(([, init]) => init?.method)).toEqual([
      undefined,
      "POST",
      "POST"
    ]);
    expect(mockApiFetch.mock.calls[1]?.[1]?.body).toBe(JSON.stringify({ reason: "等待争议解决" }));
    expect(mockApiFetch.mock.calls[2]?.[1]?.body).toBe(JSON.stringify({ reason: "争议已结" }));
  });
});
