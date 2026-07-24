import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { clearLegacyRecentBusinessRoutes } from "./legacy-layout-storage";

function createMemoryStorage(seed: Record<string, string> = {}): Storage {
  const values = new Map(Object.entries(seed));
  return {
    get length() {
      return values.size;
    },
    clear() {
      values.clear();
    },
    getItem(key) {
      return values.get(key) ?? null;
    },
    key(index) {
      return [...values.keys()][index] ?? null;
    },
    removeItem(key) {
      values.delete(key);
    },
    setItem(key, value) {
      values.set(key, value);
    }
  };
}

describe("legacy layout storage", () => {
  it("keeps the admin layout free of recent business route UI and state", () => {
    const source = readFileSync(new URL("./AdminLayout.vue", import.meta.url), "utf8");

    expect(source).not.toContain("recent-strip");
    expect(source).not.toContain("recentBusinessRoutes");
    expect(source).not.toContain("upsertRecentBusinessRoute");
    expect(source).toContain("clearLegacyRecentBusinessRoutes");
  });

  it("removes the exact legacy key and its account-scoped suffixes", () => {
    const storage = createMemoryStorage({
      "jiangkong:recent-business-routes": "[]",
      "jiangkong:recent-business-routes:user-1": "[]",
      "jiangkong:recent-business-routes:user-2": "[]"
    });

    expect(clearLegacyRecentBusinessRoutes(storage)).toBe(3);
    expect(storage.length).toBe(0);
  });

  it("preserves similar prefixes, column settings, and unrelated app data", () => {
    const storage = createMemoryStorage({
      "jiangkong:recent-business-routes": "[]",
      "jiangkong:recent-business-routes-v2:user-1": "keep",
      "jiangkong:recent-business-route:user-1": "keep",
      "jiangkong:column-settings:user-1": "{\"contracts\":[]}",
      "other-app:recent-business-routes": "keep"
    });

    expect(clearLegacyRecentBusinessRoutes(storage)).toBe(1);
    expect(storage.getItem("jiangkong:recent-business-routes")).toBeNull();
    expect(storage.getItem("jiangkong:recent-business-routes-v2:user-1")).toBe("keep");
    expect(storage.getItem("jiangkong:recent-business-route:user-1")).toBe("keep");
    expect(storage.getItem("jiangkong:column-settings:user-1")).toBe("{\"contracts\":[]}");
    expect(storage.getItem("other-app:recent-business-routes")).toBe("keep");
  });

  it("returns zero for empty storage", () => {
    expect(clearLegacyRecentBusinessRoutes(createMemoryStorage())).toBe(0);
  });

  it("ignores null keys while scanning storage", () => {
    const storage = createMemoryStorage({
      "other-app:preference": "keep",
      "jiangkong:recent-business-routes:user-1": "[]"
    });
    const originalKey = storage.key.bind(storage);
    storage.key = (index) => (index === 0 ? null : originalKey(index));

    expect(clearLegacyRecentBusinessRoutes(storage)).toBe(1);
    expect(storage.getItem("jiangkong:recent-business-routes:user-1")).toBeNull();
    expect(storage.getItem("other-app:preference")).toBe("keep");
  });

  it("does not swallow removeItem failures", () => {
    const storage = createMemoryStorage({
      "jiangkong:recent-business-routes:user-1": "[]"
    });
    storage.removeItem = () => {
      throw new Error("storage blocked");
    };

    expect(() => clearLegacyRecentBusinessRoutes(storage)).toThrow("storage blocked");
  });
});
