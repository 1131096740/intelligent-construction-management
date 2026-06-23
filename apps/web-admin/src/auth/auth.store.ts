import { defineStore } from "pinia";

export const AUTH_STORAGE_KEY = "jiangkong-web-admin-auth";

export interface AuthUser {
  id: string;
  name: string;
  phone: string | null;
  mustChangePassword: boolean;
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
    throw new Error(text || `登录请求失败：${response.status}`);
  }

  return response.json() as Promise<T>;
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
          user: this.user
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
        this.user = session.user;
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
      this.user = result.user;
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
