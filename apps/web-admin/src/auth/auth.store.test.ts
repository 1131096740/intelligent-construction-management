import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AUTH_STORAGE_KEY, useAuthStore } from "./auth.store";
import {
  getContractDraftDeviceId,
  writeContractDraftLocalRecovery
} from "../pages/contracts/workbench/contract-draft-local-recovery";

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    getItem: (key) => (map.has(key) ? (map.get(key) as string) : null),
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
    clear: () => map.clear(),
    key: (index) => Array.from(map.keys())[index] ?? null
  };
}

function loginResponse() {
  return new Response(
    JSON.stringify({
      user: {
        id: "u1",
        name: "合同部 李工",
        phone: "13800000001",
        mustChangePassword: false,
        roleKeys: ["finance_staff", "super_admin"],
        globalRoleKeys: ["finance_staff"]
      },
      tokens: { accessToken: "access-1", refreshToken: "refresh-1", expiresIn: 900 }
    }),
    { status: 200 }
  );
}

async function seedSession() {
  globalThis.fetch = vi.fn(async () => loginResponse()) as never;
  const store = useAuthStore();
  await store.login("13800000001", "Jgzg@2026");
  return store;
}

beforeEach(() => {
  setActivePinia(createPinia());
  globalThis.localStorage = memoryStorage();
});

describe("useAuthStore", () => {
  it("stores tokens and user on successful login and persists the session", async () => {
    const store = await seedSession();

    expect(store.isAuthenticated).toBe(true);
    expect(store.accessToken).toBe("access-1");
    expect(store.user?.name).toBe("合同部 李工");
    expect(store.user?.roleKeys).toEqual(["finance_staff", "super_admin"]);
    expect(store.user?.globalRoleKeys).toEqual(["finance_staff"]);
    expect(localStorage.getItem(AUTH_STORAGE_KEY)).toContain("refresh-1");
    expect(localStorage.getItem(AUTH_STORAGE_KEY)).toContain('"globalRoleKeys":["finance_staff"]');
  });

  it("throws and stays unauthenticated on bad credentials", async () => {
    globalThis.fetch = vi.fn(async () => new Response("nope", { status: 401 })) as never;
    const store = useAuthStore();

    await expect(store.login("13800000001", "wrong")).rejects.toThrow();
    expect(store.isAuthenticated).toBe(false);
    expect(localStorage.getItem(AUTH_STORAGE_KEY)).toBeNull();
  });

  it("shows a friendly message for backend credential errors", async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            message: "Invalid phone or password",
            error: "Unauthorized",
            statusCode: 401
          }),
          { status: 401 }
        )
    ) as never;
    const store = useAuthStore();

    await expect(store.login("13800000001", "wrong")).rejects.toThrow("手机号或密码错误");
    expect(store.isAuthenticated).toBe(false);
  });

  it("shows a Chinese message when the login request cannot reach the server", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError("failed for fetch");
    }) as never;
    const store = useAuthStore();

    await expect(store.login("13800000001", "Jgzg@2026")).rejects.toThrow(
      "网络连接失败，请检查网络后重试。"
    );
    expect(store.isAuthenticated).toBe(false);
  });

  it("clears the session and storage on logout", async () => {
    const store = await seedSession();
    writeContractDraftLocalRecovery(localStorage, {
      userId: "u1",
      deviceId: getContractDraftDeviceId(localStorage)!,
      projectId: "project-1",
      contractVersionId: "version-1",
      serverRevision: 1
    }, { contractName: "退出前本机副本" });
    globalThis.fetch = vi.fn(async () => new Response("{}", { status: 200 })) as never;

    await store.logout();

    expect(store.isAuthenticated).toBe(false);
    expect(store.accessToken).toBeNull();
    expect(localStorage.getItem(AUTH_STORAGE_KEY)).toBeNull();
    expect(Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index)))
      .not.toEqual(expect.arrayContaining([
        expect.stringContaining("contract-draft-local-recovery")
      ]));
  });

  it("restores a persisted session from storage", () => {
    localStorage.setItem(
      AUTH_STORAGE_KEY,
      JSON.stringify({
        accessToken: "access-x",
        refreshToken: "refresh-x",
        user: {
          id: "u9",
          name: "出纳",
          phone: "13800000002",
          mustChangePassword: false,
          roleKeys: ["super_admin"]
        }
      })
    );
    const store = useAuthStore();

    store.restore();

    expect(store.isAuthenticated).toBe(true);
    expect(store.user?.id).toBe("u9");
    expect(store.user?.roleKeys).toEqual(["super_admin"]);
    expect(store.user?.globalRoleKeys).toEqual([]);
    expect(store.accessToken).toBe("access-x");
  });

  it("refreshes tokens and returns true on success", async () => {
    const store = await seedSession();
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            tokens: { accessToken: "access-2", refreshToken: "refresh-2", expiresIn: 900 }
          }),
          { status: 200 }
        )
    ) as never;

    const ok = await store.refreshTokens();

    expect(ok).toBe(true);
    expect(store.accessToken).toBe("access-2");
    expect(store.refreshToken).toBe("refresh-2");
  });

  it("changes the first-login password, saves the real name, and rotates the local session", async () => {
    const store = await seedSession();
    store.user = { ...store.user!, mustChangePassword: true };
    store.persist();
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            user: {
              ...store.user,
              name: "杨济旭",
              mustChangePassword: false
            },
            tokens: { accessToken: "access-2", refreshToken: "refresh-2", expiresIn: 900 },
            ok: true
          }),
          { status: 200 }
        )
    ) as never;

    await store.changePassword("Jgzg@2026", "Personal@2026", "杨济旭");

    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/api/auth/change-password",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer access-1"
        })
      })
    );
    expect(JSON.parse(String((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]?.[1]?.body))).toEqual({
      oldPassword: "Jgzg@2026",
      newPassword: "Personal@2026",
      name: "杨济旭"
    });
    expect(store.accessToken).toBe("access-2");
    expect(store.refreshToken).toBe("refresh-2");
    expect(store.user?.name).toBe("杨济旭");
    expect(store.user?.mustChangePassword).toBe(false);
    expect(localStorage.getItem(AUTH_STORAGE_KEY)).toContain('"mustChangePassword":false');
  });

  it("renews an expired access credential once before retrying a rejected password change", async () => {
    const store = await seedSession();
    const requests: Array<{ path: string; authorization: string | null; body: unknown }> = [];
    globalThis.fetch = vi.fn(async (input, init) => {
      const path = String(input);
      requests.push({ path, authorization: new Headers(init?.headers).get("Authorization"), body: JSON.parse(String(init?.body)) });
      if (path === "/api/auth/refresh") return new Response(JSON.stringify({
        tokens: { accessToken: "renewed-access", refreshToken: "renewed-refresh", expiresIn: 900 }
      }), { status: 200 });
      if (requests.filter((request) => request.path === "/api/auth/change-password").length === 1) {
        return new Response(JSON.stringify({ message: "登录凭证无效，请重新登录" }), { status: 401 });
      }
      return new Response(JSON.stringify({ user: store.user,
        tokens: { accessToken: "changed-access", refreshToken: "changed-refresh", expiresIn: 900 }
      }), { status: 200 });
    }) as never;

    await store.changePassword("Synthetic-Current-01", "Synthetic-New-01");

    expect(requests).toEqual([
      { path: "/api/auth/change-password", authorization: "Bearer access-1", body: { oldPassword: "Synthetic-Current-01", newPassword: "Synthetic-New-01" } },
      { path: "/api/auth/refresh", authorization: null, body: { refreshToken: "refresh-1" } },
      { path: "/api/auth/change-password", authorization: "Bearer renewed-access", body: { oldPassword: "Synthetic-Current-01", newPassword: "Synthetic-New-01" } }
    ]);
    expect(store.accessToken).toBe("changed-access");
    expect(store.refreshToken).toBe("changed-refresh");
  });

  it("updates the signed-in user's name and login phone with a rotated session", async () => {
    const store = await seedSession();
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            user: { ...store.user, name: "杨济旭", phone: "13900000001" },
            tokens: { accessToken: "access-3", refreshToken: "refresh-3", expiresIn: 900 }
          }),
          { status: 200 }
        )
    ) as never;

    await store.updateProfile("杨济旭", "13900000001", "current-password");

    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/api/auth/profile",
      expect.objectContaining({
        method: "PATCH",
        headers: expect.objectContaining({ Authorization: "Bearer access-1" })
      })
    );
    expect(store.user?.name).toBe("杨济旭");
    expect(store.user?.phone).toBe("13900000001");
    expect(store.accessToken).toBe("access-3");
    expect(localStorage.getItem(AUTH_STORAGE_KEY)).toContain("13900000001");
  });

  it("clears an expired session when renewal fails without resending the password change", async () => {
    const store = await seedSession();
    const paths: string[] = [];
    globalThis.fetch = vi.fn(async (input) => {
      paths.push(String(input));
      return new Response(JSON.stringify({ message: "登录凭证无效，请重新登录" }), { status: 401 });
    }) as never;

    await expect(store.changePassword("Synthetic-Current-01", "Synthetic-New-01")).rejects.toThrow("登录已过期，请返回登录后重试");
    expect(paths).toEqual(["/api/auth/change-password", "/api/auth/refresh"]);
    expect(store.isAuthenticated).toBe(false);
    expect(localStorage.getItem(AUTH_STORAGE_KEY)).toBeNull();
  });

  it("does not renew or replay a password change after an uncertain network failure", async () => {
    const store = await seedSession();
    globalThis.fetch = vi.fn(async () => { throw new TypeError("Failed to fetch"); }) as never;

    await expect(store.changePassword("Synthetic-Current-01", "Synthetic-New-01")).rejects.toThrow();
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it("renews a rejected profile change once and keeps its phone-verification payload", async () => {
    const store = await seedSession();
    let changes = 0;
    const bodies: unknown[] = [];
    globalThis.fetch = vi.fn(async (input, init) => {
      if (String(input) === "/api/auth/refresh") return new Response(JSON.stringify({
        tokens: { accessToken: "renewed-access", refreshToken: "renewed-refresh", expiresIn: 900 }
      }), { status: 200 });
      changes += 1;
      bodies.push(JSON.parse(String(init?.body)));
      if (changes === 1) return new Response("{}", { status: 401 });
      expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer renewed-access");
      return new Response(JSON.stringify({ user: { ...store.user, phone: "13900000002" },
        tokens: { accessToken: "changed-access", refreshToken: "changed-refresh", expiresIn: 900 }
      }), { status: 200 });
    }) as never;

    await store.updateProfile("合成员工", "13900000002", "Synthetic-Current-01", "123456");
    expect(bodies).toEqual([
      { name: "合成员工", phone: "13900000002", currentPassword: "Synthetic-Current-01", code: "123456" },
      { name: "合成员工", phone: "13900000002", currentPassword: "Synthetic-Current-01", code: "123456" }
    ]);
    expect(store.user?.phone).toBe("13900000002");
  });

  it("shows a business message when password change fails", async () => {
    const store = await seedSession();
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            message: "Invalid old password",
            statusCode: 400
          }),
          { status: 400 }
        )
    ) as never;

    await expect(store.changePassword("wrong", "Personal@2026")).rejects.toThrow("当前密码不正确");
  });

  it("returns false and clears the session when refresh fails", async () => {
    const store = await seedSession();
    globalThis.fetch = vi.fn(async () => new Response("no", { status: 401 })) as never;

    const ok = await store.refreshTokens();

    expect(ok).toBe(false);
    expect(store.isAuthenticated).toBe(false);
    expect(localStorage.getItem(AUTH_STORAGE_KEY)).toBeNull();
  });
});
