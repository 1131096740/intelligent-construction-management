import { defineStore } from "pinia";
import type { RoleKey } from "@jiangkong/shared-domain";

export const AUTH_STORAGE_KEY = "jiangkong-web-admin-auth";

export interface AuthUser {
  id: string;
  name: string;
  phone: string | null;
  mustChangePassword: boolean;
  roleKeys: RoleKey[];
}

interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
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
  const response = await fetch(`/api/auth/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(formatAuthError(text, response.status, "登录请求失败"));
  }

  return response.json() as Promise<T>;
}

function formatAuthError(text: string, status: number, fallback: string) {
  if (!text) {
    return `${fallback}：${status}`;
  }

  try {
    const parsed = JSON.parse(text) as { message?: unknown };
    const message = Array.isArray(parsed.message)
      ? parsed.message.filter((item): item is string => typeof item === "string").join("；")
      : typeof parsed.message === "string"
        ? parsed.message
        : "";

    if (message === "Invalid phone or password") {
      return "手机号或密码错误";
    }

    if (/Password change required/i.test(message)) {
      return "请先完成初始密码修改。";
    }

    if (/old password|current password|Invalid password/i.test(message)) {
      return "当前密码不正确";
    }

    if (/new password/i.test(message) || /at least 8/i.test(message)) {
      return "新密码至少 8 位";
    }

    if (/Internal server error/i.test(message)) {
      return "系统暂时无法完成操作，请稍后重试或联系管理员。";
    }

    return message || `${fallback}：${status}`;
  } catch {
    if (/Password change required/i.test(text)) {
      return "请先完成初始密码修改。";
    }
    if (/Internal server error/i.test(text)) {
      return "系统暂时无法完成操作，请稍后重试或联系管理员。";
    }
    return text;
  }
}

function normalizeUser(user: AuthUser): AuthUser {
  return {
    ...user,
    roleKeys: Array.isArray(user.roleKeys) ? user.roleKeys : []
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
      this.user = normalizeUser(result.user);
      this.persist();

      return result.user;
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
    async changePassword(oldPassword: string, newPassword: string) {
      if (!this.accessToken) {
        throw new Error("请先登录");
      }

      const response = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.accessToken}`
        },
        body: JSON.stringify({ oldPassword, newPassword })
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(formatAuthError(text, response.status, "修改密码失败"));
      }

      if (this.user) {
        this.user = {
          ...this.user,
          mustChangePassword: false
        };
        this.persist();
      }
    },
    async logout() {
      const refreshToken = this.refreshToken;
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
