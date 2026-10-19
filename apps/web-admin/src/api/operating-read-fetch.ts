import type { ApiFetchInit } from "./http";

type ApiFetch = (path: string, init?: ApiFetchInit) => Promise<Response>;

export function createOperatingReadFetch(fetchApi: ApiFetch, getSession: () => unknown): ApiFetch {
  let tail: Promise<void> | null = null;
  return (path, init = {}) => {
    const pathname = path.split("?")[0];
    const projectionRead = (init.method ?? "GET").toUpperCase() === "GET" && (
      pathname.startsWith("/operating-projections/") ||
      /^\/projects\/[^/]+\/(operating-funds-overview|close-profit)$/u.test(pathname)
    );
    if (!projectionRead) return fetchApi(path, init);

    const session = getSession();
    const run = async () => {
      if (init.signal?.aborted) throw init.signal.reason ?? new DOMException("读取已取消", "AbortError");
      if (getSession() !== session) throw new Error("登录身份已变化，请刷新页面后重试");
      return fetchApi(path, init);
    };
    // These endpoints share the backend's per-actor projection limit. Keep one
    // read in flight, leaving capacity for explicit business commands. No cache
    // or retry: each caller still receives its own authorized, fresh response.
    const result = tail ? tail.then(run) : run();
    tail = result.then(() => undefined, () => undefined);
    return result;
  };
}
