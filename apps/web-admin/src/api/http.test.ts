import { describe, expect, it, vi } from "vitest";
import { createApiFetch, withAuth, type AuthBridge } from "./http";

function jsonResponse(status: number) {
  return new Response(JSON.stringify({ ok: status < 400 }), { status });
}

function bridge(overrides: Partial<AuthBridge> = {}): AuthBridge {
  return {
    getAccessToken: () => "token-1",
    refresh: vi.fn(async () => false),
    onUnauthorized: vi.fn(),
    ...overrides
  };
}

describe("withAuth", () => {
  it("adds a Bearer header when a token is present", () => {
    const init = withAuth({ method: "POST" }, "abc");
    const headers = new Headers(init.headers);

    expect(headers.get("Authorization")).toBe("Bearer abc");
    expect(init.method).toBe("POST");
  });

  it("does not add an Authorization header when there is no token", () => {
    const init = withAuth({}, null);
    const headers = new Headers(init.headers);

    expect(headers.has("Authorization")).toBe(false);
  });

  it("preserves caller-provided headers", () => {
    const init = withAuth({ headers: { "Content-Type": "application/json" } }, "abc");
    const headers = new Headers(init.headers);

    expect(headers.get("Content-Type")).toBe("application/json");
    expect(headers.get("Authorization")).toBe("Bearer abc");
  });
});

describe("createApiFetch", () => {
  it("prefixes /api and attaches the current access token", async () => {
    const fetchImpl = vi.fn(async (...args: Parameters<typeof fetch>) => {
      void args;
      return jsonResponse(200);
    });
    const apiFetch = createApiFetch(bridge(), fetchImpl);

    await apiFetch("/contracts/1");

    const [url, init] = fetchImpl.mock.calls[0] as [RequestInfo | URL, RequestInit];
    expect(url).toBe("/api/contracts/1");
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer token-1");
  });

  it("refreshes once and retries on 401, then succeeds", async () => {
    let token = "stale";
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(401))
      .mockResolvedValueOnce(jsonResponse(200));
    const refresh = vi.fn(async () => {
      token = "fresh";
      return true;
    });
    const onUnauthorized = vi.fn();
    const apiFetch = createApiFetch(
      bridge({ getAccessToken: () => token, refresh, onUnauthorized }),
      fetchImpl
    );

    const response = await apiFetch("/contracts/1");

    expect(response.status).toBe(200);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(new Headers(fetchImpl.mock.calls[1][1].headers).get("Authorization")).toBe(
      "Bearer fresh"
    );
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it("clears the session when refresh fails on a 401", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(401));
    const refresh = vi.fn(async () => false);
    const onUnauthorized = vi.fn();
    const apiFetch = createApiFetch(bridge({ refresh, onUnauthorized }), fetchImpl);

    const response = await apiFetch("/contracts/1");

    expect(response.status).toBe(401);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("clears the session when the retry after refresh still returns 401", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(401));
    const refresh = vi.fn(async () => true);
    const onUnauthorized = vi.fn();
    const apiFetch = createApiFetch(bridge({ refresh, onUnauthorized }), fetchImpl);

    await apiFetch("/contracts/1");

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });
});
