import { describe, expect, it, vi } from "vitest";
import { createApiFetch } from "./http";
import { createOperatingReadFetch } from "./operating-read-fetch";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const paths = [
  "/operating-projections/as-of?scopeKind=projects",
  "/operating-projections/project/p-1?asOf=2026-10-20",
  "/projects/p-1/operating-funds-overview",
  "/projects/p-1/close-profit"
];

describe("operating projection read coordination", () => {
  it("keeps the real overview/balance/close-profit burst below the backend concurrency limit", async () => {
    let active = 0;
    let peak = 0;
    const backend = vi.fn(async () => {
      active++;
      peak = Math.max(peak, active);
      const status = active > 2 ? 429 : 200;
      await new Promise((resolve) => setTimeout(resolve, 5));
      active--;
      return new Response("{}", { status });
    });
    const api = createOperatingReadFetch(createApiFetch({
      getAccessToken: () => "test-token",
      refresh: async () => false,
      onUnauthorized: vi.fn()
    }, backend), () => "same-session");
    const responses = await Promise.all(paths.map((path) => api(path)));
    expect(responses.map((response) => response.status)).toEqual([200, 200, 200, 200]);
    expect(peak).toBe(1);
    expect(backend).toHaveBeenCalledTimes(4);
  });

  it("does not send queued reads under a replacement login", async () => {
    let session = {};
    const first = deferred<Response>();
    const fetchApi = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue(new Response("{}"));
    const api = createOperatingReadFetch(fetchApi, () => session);
    const active = api(paths[0]);
    const queued = api(paths[1]);
    const rejected = expect(queued).rejects.toThrow("登录身份已变化");
    session = {};
    first.resolve(new Response("{}"));
    await active;
    await rejected;
    await api(paths[2]);
    expect(fetchApi.mock.calls.map(([path]) => path)).toEqual([paths[0], paths[2]]);
  });

  it("lets a new login read without waiting for the old login's stalled request", async () => {
    let session = {};
    const first = deferred<Response>();
    const fetchApi = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue(new Response("{}"));
    const api = createOperatingReadFetch(fetchApi, () => session);
    const oldReading = api(paths[0]);
    session = {};
    const newReading = api(paths[1]);
    try {
      expect(fetchApi).toHaveBeenCalledTimes(2);
    } finally {
      first.resolve(new Response("{}"));
      await Promise.all([oldReading, newReading]);
    }
  });

  it("releases the queue after a failed request without replaying it", async () => {
    const fetchApi = vi.fn().mockRejectedValueOnce(new Error("network down")).mockResolvedValue(new Response("{}"));
    const api = createOperatingReadFetch(fetchApi, () => null);
    const failed = api(paths[0]);
    const next = api(paths[1]);
    await expect(failed).rejects.toThrow("network down");
    await expect(next).resolves.toBeInstanceOf(Response);
    expect(fetchApi).toHaveBeenCalledTimes(2);
  });

  it("preserves server 429 and does not retry it", async () => {
    const fetchApi = vi.fn().mockResolvedValue(new Response("too many", { status: 429 }));
    const api = createOperatingReadFetch(fetchApi, () => null);
    expect((await api(paths[0])).status).toBe(429);
    expect(fetchApi).toHaveBeenCalledTimes(1);
  });

  it("does not delay unrelated reads or business submissions", async () => {
    const first = deferred<Response>();
    const fetchApi = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue(new Response("{}"));
    const api = createOperatingReadFetch(fetchApi, () => null);
    const reading = api(paths[0]);
    const body = { method: "POST", body: "{}", retryUnauthorized: false };
    await api("/projects", {});
    await api("/projects/p-1/close-profit/confirm", body);
    expect(fetchApi).toHaveBeenNthCalledWith(3, "/projects/p-1/close-profit/confirm", body);
    first.resolve(new Response("{}"));
    await reading;
  });

  it("does not send an aborted queued read and continues with the next read", async () => {
    const first = deferred<Response>();
    const fetchApi = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue(new Response("{}"));
    const api = createOperatingReadFetch(fetchApi, () => null);
    const reading = api(paths[0]);
    const controller = new AbortController();
    const aborted = api(paths[1], { signal: controller.signal });
    const rejected = expect(aborted).rejects.toMatchObject({ name: "AbortError" });
    controller.abort();
    await rejected;
    first.resolve(new Response("{}"));
    await reading;
    await api(paths[2]);
    expect(fetchApi.mock.calls.map(([path]) => path)).toEqual([paths[0], paths[2]]);
  });
});
