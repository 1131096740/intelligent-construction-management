import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  activateOperatingTakeover,
  confirmOperatingTakeover,
  fetchOperatingTakeoverBatches,
  precheckOperatingTakeover,
  precheckOperatingTakeoverXlsx
} from "./operating-takeover.api";

const mockApiFetch = vi.fn();
vi.mock("./api-fetch", () => ({ apiFetch: (...args: unknown[]) => mockApiFetch(...args) }));

describe("operating takeover api", () => {
  beforeEach(() => {
    mockApiFetch.mockReset();
    mockApiFetch.mockImplementation(async () => new Response(JSON.stringify({}), { status: 200 }));
  });

  it("keeps precheck, batch, confirmation and activation project-scoped", async () => {
    await precheckOperatingTakeover("project/1", { rows: [] });
    await fetchOperatingTakeoverBatches("project/1");
    await confirmOperatingTakeover("project/1", "batch/1", {
      profession: "finance",
      expectedRevision: 1,
      idempotencyKey: "00000000-0000-4000-8000-000000000001"
    });
    await activateOperatingTakeover("project/1", "batch/1", "00000000-0000-4000-8000-000000000002");

    expect(mockApiFetch.mock.calls.map(([path]) => path)).toEqual([
      "/projects/project%2F1/operating-takeovers/precheck",
      "/projects/project%2F1/operating-takeovers",
      "/projects/project%2F1/operating-takeovers/batch%2F1/confirmations",
      "/projects/project%2F1/operating-takeovers/batch%2F1/activation"
    ]);
    expect(mockApiFetch.mock.calls.map(([, init]) => init?.method ?? "GET")).toEqual([
      "POST", "GET", "POST", "POST"
    ]);
  });

  it("sends Excel precheck as multipart without client-side writes", async () => {
    await precheckOperatingTakeoverXlsx(
      "project/1",
      new File(["xlsx"], "历史接管.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
      "owner_payment"
    );

    const [path, init] = mockApiFetch.mock.calls[0] as [string, RequestInit];
    expect(path).toBe("/projects/project%2F1/operating-takeovers/precheck-xlsx?sceneKey=owner_payment");
    expect(init.method).toBe("POST");
    expect(init.body).toBeInstanceOf(FormData);
  });
});
