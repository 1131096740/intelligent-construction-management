import { createTask12Con18DefaultHttp } from "./task12-con18-default-http";

describe("CON-18 同应用公开 HTTP 传输", () => {
  it("仅为已登录用户附加本地会话，拒绝未登录和非本地 URL", async () => {
    const calls: Array<{ url: string; headers: Headers }> = [];
    const client = jest.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), headers: new Headers(init?.headers) });
      return new Response(JSON.stringify({ tokens: { accessToken: "ey.test.signature" } }), { status: 201, headers: { "content-type": "application/json" } });
    });
    const bridge = createTask12Con18DefaultHttp("http://127.0.0.1:55556", new AbortController().signal, client as typeof fetch);
    await expect(bridge.send(1, { method: "GET", path: "/contracts" })).rejects.toThrow();
    await bridge.send(1, { method: "POST", path: "/auth/login", json: { phone: "19900000000", password: "fiction" } });
    await bridge.send(1, { method: "GET", path: "/contracts" });
    expect(calls[1].headers.get("authorization")).toBe("Bearer ey.test.signature");
    await expect(bridge.send(1, { method: "GET", path: "//example.invalid/" })).rejects.toThrow();
    await expect(bridge.send(1, { method: "GET", path: "/contracts", headers: { authorization: "Bearer other" } })).rejects.toThrow();
    expect(() => createTask12Con18DefaultHttp("http://example.invalid", new AbortController().signal, client as typeof fetch)).toThrow();
    expect(calls).toHaveLength(2);
  });
});
