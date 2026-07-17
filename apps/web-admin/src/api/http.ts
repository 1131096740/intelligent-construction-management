/**
 * 统一的鉴权 fetch 封装。
 *
 * - 自动给请求带上当前登录态的 access token。
 * - 401 时尝试用 refresh token 续期一次并重试；续期失败或重试仍 401 则清登录态。
 *
 * 逻辑做成纯工厂 + 依赖注入，便于单测；默认实例在 `api-fetch.ts` 里接 Pinia store。
 */
import { formatUnknownApiError } from "./error-message";

export interface AuthBridge {
  getAccessToken(): string | null;
  /** 用 refresh token 续期；成功返回 true（此后 getAccessToken 应返回新 token）。 */
  refresh(): Promise<boolean>;
  /** 登录态已失效（需清理并跳登录）。 */
  onUnauthorized(): void;
  /** 后端发现当前用户仍需强制改密。 */
  onPasswordChangeRequired?(): void;
}

export function withAuth(init: RequestInit, token: string | null): RequestInit {
  if (!token) {
    return init;
  }

  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);

  return { ...init, headers };
}

export function createApiFetch(
  bridge: AuthBridge,
  fetchImpl?: typeof fetch
): (path: string, init?: RequestInit) => Promise<Response> {
  let refreshInFlight: Promise<boolean> | null = null;

  const refreshOnce = () => {
    if (!refreshInFlight) {
      refreshInFlight = bridge.refresh().finally(() => {
        refreshInFlight = null;
      });
    }
    return refreshInFlight;
  };

  return async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
    const accessToken = bridge.getAccessToken();
    const send = async (token: string | null = bridge.getAccessToken()) => {
      try {
        return await (fetchImpl ?? fetch)(`/api${path}`, withAuth(init, token));
      } catch (error) {
        throw new Error(formatUnknownApiError(error, "网络请求失败"));
      }
    };

    let response = await send(accessToken);

    if (response.status === 401) {
      const currentAccessToken = bridge.getAccessToken();
      const sessionWasAlreadyRefreshed = Boolean(
        currentAccessToken && currentAccessToken !== accessToken
      );
      const refreshed = sessionWasAlreadyRefreshed || (await refreshOnce());

      if (refreshed) {
        response = await send();
      }

      if (response.status === 401) {
        bridge.onUnauthorized();
      }
    }

    if (response.status === 403 && (await isPasswordChangeRequired(response))) {
      bridge.onPasswordChangeRequired?.();
    }

    return response;
  };
}

async function isPasswordChangeRequired(response: Response) {
  try {
    return /Password change required/i.test(await response.clone().text());
  } catch {
    return false;
  }
}
