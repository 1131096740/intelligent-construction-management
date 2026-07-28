import { defineStore } from "pinia";
import type { RoleKey } from "@jiangkong/shared-domain";
import { formatApiErrorMessage, formatUnknownApiError } from "../api/error-message";
import { clearContractDraftLocalRecoveriesForUser } from "../pages/contracts/workbench/contract-draft-local-recovery";

export const AUTH_STORAGE_KEY = "jiangkong-web-admin-auth";

export interface AuthUser {
  id: string;
  name: string;
  phone: string | null;
  mustChangePassword: boolean;
  roleKeys: RoleKey[];
  globalRoleKeys: RoleKey[];
}

interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

interface AuthenticatedSessionResponse {
  user: AuthUser;
  tokens: AuthTokens;
}

interface PersistedSession {
  accessToken: string;
  refreshToken: string;
  user: AuthUser;
}

interface AuthState {
  accessToken: string | null;
  refreshToken: string | null;
  user: AuthUser | null;
}

function getStorage(): Storage | null {
  return typeof localStorage === "undefined" ? null : localStorage;
}

async function postAuth<T>(path: string, body: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/auth/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
  } catch (error) {
    throw new Error(formatUnknownApiError(error, "登录请求失败"));
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(formatAuthError(text, response.status, "登录请求失败"));
  }

  return response.json() as Promise<T>;
}

function formatAuthError(text: string, status: number, fallback: string) {
  if (!text) {
    return formatApiErrorMessage(text, status, fallback);
  }

  try {
    const parsed = JSON.parse(text) as { message?: unknown };
    const message = Array.isArray(parsed.message)
      ? parsed.message.filter((item): item is string => typeof item === "string").join("；")
      : typeof parsed.message === "string"
        ? parsed.message
        : "";

    return formatApiErrorMessage(message, status, fallback);
  } catch {
    return formatApiErrorMessage(text, status, fallback);
  }
}

function normalizeUser(user: AuthUser): AuthUser {
  return {
    ...user,
    roleKeys: Array.isArray(user.roleKeys) ? user.roleKeys : [],
    globalRoleKeys: Array.isArray(user.globalRoleKeys) ? user.globalRoleKeys : []
  };
}

export const useAuthStore = defineStore("auth", {
  state: (): AuthState => ({
    accessToken: null,
    refreshToken: null,
    user: null
  }),
  getters: {
    isAuthenticated: (state) => Boolean(state.accessToken && state.user)
  },
  actions: {
    persist() {
      const storage = getStorage();
      if (!storage) {
        return;
      }

      if (this.accessToken && this.refreshToken && this.user) {
        const session: PersistedSession = {
          accessToken: this.accessToken,
          refreshToken: this.refreshToken,
          user: normalizeUser(this.user)
        };
        storage.setItem(AUTH_STORAGE_KEY, JSON.stringify(session));
      } else {
        storage.removeItem(AUTH_STORAGE_KEY);
      }
    },
    restore() {
      const raw = getStorage()?.getItem(AUTH_STORAGE_KEY);
      if (!raw) {
        return;
      }

      try {
        const session = JSON.parse(raw) as PersistedSession;
        this.accessToken = session.accessToken;
        this.refreshToken = session.refreshToken;
        this.user = normalizeUser(session.user);
      } catch {
        this.clearSession();
      }
    },
    clearSession() {
      this.accessToken = null;
      this.refreshToken = null;
      this.user = null;
      this.persist();
    },
    async login(phone: string, password: string) {
      const result = await postAuth<{ user: AuthUser; tokens: AuthTokens }>("login", {
        phone,
        password
      });

      this.accessToken = result.tokens.accessToken;
      this.refreshToken = result.tokens.refreshToken;
      const user = normalizeUser(result.user);
      this.user = user;
      this.persist();

      return user;
    },
    async refreshTokens(): Promise<boolean> {
      if (!this.refreshToken) {
        return false;
      }

      try {
        const result = await postAuth<{ tokens: AuthTokens }>("refresh", {
          refreshToken: this.refreshToken
        });
        this.accessToken = result.tokens.accessToken;
        this.refreshToken = result.tokens.refreshToken;
        this.persist();
        return true;
      } catch {
        this.clearSession();
        return false;
      }
    },
    async changePassword(oldPassword: string, newPassword: string, name?: string) {
      if (!this.accessToken) {
        throw new Error("请先登录");
      }

      let response: Response;
      try {
        response = await fetch("/api/auth/change-password", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.accessToken}`
          },
          body: JSON.stringify({ oldPassword, newPassword, ...(name ? { name } : {}) })
        });
      } catch (error) {
        throw new Error(formatUnknownApiError(error, "修改密码失败"));
      }

      if (!response.ok) {
        const text = await response.text();
        throw new Error(formatAuthError(text, response.status, "修改密码失败"));
      }

      const result = (await response.json()) as AuthenticatedSessionResponse;
      this.accessToken = result.tokens.accessToken;
      this.refreshToken = result.tokens.refreshToken;
      this.user = normalizeUser(result.user);
      this.persist();
    },
    async updateProfile(name: string, phone: string, currentPassword: string) {
      if (!this.accessToken) {
        throw new Error("请先登录");
      }

      let response: Response;
      try {
        response = await fetch("/api/auth/profile", {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.accessToken}`
          },
          body: JSON.stringify({ name, phone, currentPassword })
        });
      } catch (error) {
        throw new Error(formatUnknownApiError(error, "修改账号资料失败"));
      }

      if (!response.ok) {
        const text = await response.text();
        throw new Error(formatAuthError(text, response.status, "修改账号资料失败"));
      }

      const result = (await response.json()) as AuthenticatedSessionResponse;
      this.accessToken = result.tokens.accessToken;
      this.refreshToken = result.tokens.refreshToken;
      this.user = normalizeUser(result.user);
      this.persist();
    },
    async logout() {
      const refreshToken = this.refreshToken;
      const userId = this.user?.id;
      const storage = getStorage();
      if (storage && userId) {
        clearContractDraftLocalRecoveriesForUser(storage, userId);
      }
      this.clearSession();

      if (!refreshToken) {
        return;
      }

      try {
        await postAuth("logout", { refreshToken });
      } catch {
        // 登出是尽力而为：本地态已清，后端撤销失败不阻塞用户。
      }
    }
  }
});
