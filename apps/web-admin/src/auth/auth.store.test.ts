import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AUTH_STORAGE_KEY, useAuthStore } from "./auth.store";

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
        roleKeys: ["finance_staff"]
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
    expect(store.user?.roleKeys).toEqual(["finance_staff"]);
    expect(localStorage.getItem(AUTH_STORAGE_KEY)).toContain("refresh-1");
  });

  it("throws and stays unauthenticated on bad credentials", async () => {
    globalThis.fetch = vi.fn(async () => new Response("nope", { status: 401 })) as never;
    const store = useAuthStore();

    await expect(store.login("13800000001", "wrong")).rejects.toThrow();
    expect(store.isAuthenticated).toBe(false);
    expect(localStorage.getItem(AUTH_STORAGE_KEY)).toBeNull();
  });

  it("clears the session and storage on logout", async () => {
    const store = await seedSession();
    globalThis.fetch = vi.fn(async () => new Response("{}", { status: 200 })) as never;

    await store.logout();

    expect(store.isAuthenticated).toBe(false);
    expect(store.accessToken).toBeNull();
    expect(localStorage.getItem(AUTH_STORAGE_KEY)).toBeNull();
  });

  it("restores a persisted session from storage", () => {
    localStorage.setItem(
      AUTH_STORAGE_KEY,
      JSON.stringify({
        accessToken: "access-x",
        refreshToken: "refresh-x",
        user: { id: "u9", name: "出纳", phone: "13800000002", mustChangePassword: false }
      })
    );
    const store = useAuthStore();

    store.restore();

    expect(store.isAuthenticated).toBe(true);
    expect(store.user?.id).toBe("u9");
    expect(store.user?.roleKeys).toEqual([]);
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

  it("returns false and clears the session when refresh fails", async () => {
    const store = await seedSession();
    globalThis.fetch = vi.fn(async () => new Response("no", { status: 401 })) as never;

    const ok = await store.refreshTokens();

    expect(ok).toBe(false);
    expect(store.isAuthenticated).toBe(false);
    expect(localStorage.getItem(AUTH_STORAGE_KEY)).toBeNull();
  });
});
