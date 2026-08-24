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

  it("shares one refresh across concurrent 401 responses", async () => {
    let token = "stale";
    let releaseRefresh: (() => void) | undefined;
    const refreshBarrier = new Promise<void>((resolve) => {
      releaseRefresh = resolve;
    });
    const fetchImpl = vi.fn(async (...args: Parameters<typeof fetch>) => {
      const [, init] = args;
      const authorization = new Headers(init?.headers).get("Authorization");
      return jsonResponse(authorization === "Bearer fresh" ? 200 : 401);
    });
    const refresh = vi.fn(async () => {
      await refreshBarrier;
      token = "fresh";
      return true;
    });
    const onUnauthorized = vi.fn();
    const apiFetch = createApiFetch(
      bridge({ getAccessToken: () => token, refresh, onUnauthorized }),
      fetchImpl
    );

    const requests = [apiFetch("/payments/1"), apiFetch("/settlements/1")];
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    releaseRefresh?.();

    const responses = await Promise.all(requests);

    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it("reuses a token refreshed while a slower stale request was still pending", async () => {
    let token = "stale";
    let releaseSlowResponse: (() => void) | undefined;
    const slowResponseBarrier = new Promise<void>((resolve) => {
      releaseSlowResponse = resolve;
    });
    const fetchImpl = vi.fn(async (...args: Parameters<typeof fetch>) => {
      const [url, init] = args;
      const authorization = new Headers(init?.headers).get("Authorization");
      if (authorization === "Bearer fresh") return jsonResponse(200);
      if (String(url).endsWith("/settlements/1")) await slowResponseBarrier;
      return jsonResponse(401);
    });
    const refresh = vi.fn(async () => {
      token = "fresh";
      return true;
    });
    const apiFetch = createApiFetch(
      bridge({ getAccessToken: () => token, refresh }),
      fetchImpl
    );

    const fastRequest = apiFetch("/payments/1");
    const slowRequest = apiFetch("/settlements/1");
    await expect(fastRequest).resolves.toMatchObject({ status: 200 });
    releaseSlowResponse?.();
    await expect(slowRequest).resolves.toMatchObject({ status: 200 });

    expect(refresh).toHaveBeenCalledTimes(1);
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

  it("can leave a 401 unreplayed for an idempotent write", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(401));
    const refresh = vi.fn(async () => true);
    const onUnauthorized = vi.fn();
    const apiFetch = createApiFetch(bridge({ refresh, onUnauthorized }), fetchImpl);

    const response = await apiFetch("/business-parties", { method: "POST" }, {
      retryUnauthorized: false
    });

    expect(response.status).toBe(401);
    expect(refresh).not.toHaveBeenCalled();
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

  it("returns an authenticated password validation error without refreshing or clearing the session", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ message: "当前密码不正确，请重新输入" }), { status: 400 })
    );
    const refresh = vi.fn(async () => true);
    const onUnauthorized = vi.fn();
    const apiFetch = createApiFetch(bridge({ refresh, onUnauthorized }), fetchImpl);

    const response = await apiFetch("/files/file-1/download-ticket", { method: "POST" });

    expect(response.status).toBe(400);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(refresh).not.toHaveBeenCalled();
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it("notifies the app when the backend requires password change", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ message: "Password change required" }), { status: 403 })
    );
    const onUnauthorized = vi.fn();
    const onPasswordChangeRequired = vi.fn();
    const apiFetch = createApiFetch(
      bridge({ onUnauthorized, onPasswordChangeRequired }),
      fetchImpl
    );

    const response = await apiFetch("/contracts/1");

    expect(response.status).toBe(403);
    expect(onPasswordChangeRequired).toHaveBeenCalledTimes(1);
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it("maps browser fetch failures before they reach pages", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    const apiFetch = createApiFetch(bridge(), fetchImpl);

    await expect(apiFetch("/contracts/1")).rejects.toThrow("网络连接失败，请检查网络后重试。");
  });
});
