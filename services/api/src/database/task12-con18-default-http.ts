import type { Task12LocalLifecycleBridge, Task12LocalLifecycleRequest } from "./task12-local-lifecycle-case";

/** Task-specific public HTTP transport; holds user tokens only in memory and
 * carries no owner, SQL, storage, or document-converter capability. */
export function createTask12Con18DefaultHttp(base: string, signal: AbortSignal, client: typeof fetch = fetch): Task12LocalLifecycleBridge {
  const fail = (): never => { throw new Error("TASK12_DEFAULT_HTTP_INPUT"); };
  const origin = new URL(base);
  if (origin.protocol !== "http:" || origin.hostname !== "127.0.0.1" || !origin.port || origin.pathname !== "/" || origin.search || origin.hash) fail();
  const tokens = new Map<number, string>();
  const check = () => { if (signal.aborted) fail(); };
  const target = (path: string) => {
    if (typeof path !== "string" || !path.startsWith("/") || path.startsWith("//") || /[\r\n\\#]/u.test(path)) fail();
    const url = new URL(path, origin); if (url.origin !== origin.origin) fail(); return url;
  };
  const bytes = async (response: Response, limit: number) => {
    const reader = response.body?.getReader(); if (!reader) return Buffer.alloc(0);
    const parts: Uint8Array[] = []; let size = 0;
    try { for (;;) { const item = await reader.read(); if (item.done) break; size += item.value.byteLength; if (size > limit) fail(); parts.push(item.value); } }
    catch (error) { try { await reader.cancel(); } catch { /* Preserve the original error. */ } throw error; }
    finally { reader.releaseLock(); }
    return Buffer.concat(parts.map(part => Buffer.from(part)));
  };
  const request = async (actor: number, path: string, options: RequestInit, limit: number) => {
    check(); if (!Number.isInteger(actor) || actor < 0 || actor > 7) fail();
    const headers = new Headers(options.headers); if (headers.has("authorization")) fail();
    if (path !== "/auth/login") { const token = tokens.get(actor); if (!token) fail(); headers.set("authorization", `Bearer ${token}`); }
    const response = await client(target(path), { ...options, headers, redirect: "error", signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]) });
    return { response, data: await bytes(response, limit) };
  };
  return Object.freeze({
    check, now: () => { check(); return Date.now(); },
    async wait(ms: number) { check(); if (ms !== 1000) fail(); await new Promise<void>(resolve => setTimeout(resolve, ms)); check(); },
    async send(actor: number, input: Task12LocalLifecycleRequest) {
      if (input.json && input.form) fail();
      const headers = new Headers(input.headers); let body: BodyInit | undefined;
      if (input.json) { headers.set("content-type", "application/json"); body = JSON.stringify(input.json); }
      else if (input.form) body = input.form;
      const { response, data } = await request(actor, input.path, { method: input.method, headers, body }, 5 * 1024 * 1024);
      let parsed: unknown; try { parsed = JSON.parse(data.toString("utf8")); } catch { return fail(); }
      if (input.path === "/auth/login" && response.status === 201) {
        const token = (parsed as { tokens?: { accessToken?: unknown } })?.tokens?.accessToken;
        if (typeof token !== "string" || token.length > 4096 || !/^[\w-]+\.[\w-]+\.[\w-]+$/u.test(token)) return fail();
        tokens.set(actor, token);
      }
      return { status: response.status, body: parsed };
    },
    async download(actor: number, path: string) {
      if (actor !== 0 || !/^\/files\/[a-f0-9-]{36}\/download\?/u.test(path)) fail();
      const { response, data } = await request(actor, path, { method: "GET" }, 100 * 1024 * 1024);
      return { status: response.status, bytes: data, mimeType: (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase() };
    }
  });
}
