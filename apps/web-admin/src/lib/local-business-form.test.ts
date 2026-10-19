import { afterEach, describe, expect, it, vi } from "vitest";
import { localBusinessForm } from "./local-business-form";
function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => { map.set(key, value); },
    removeItem: (key: string) => { map.delete(key); },
    clear: () => map.clear(),
    key: (index: number) => [...map.keys()][index] ?? null,
    get length() { return map.size; }
  } satisfies Storage;
}
describe("local business form recovery", () => {
  afterEach(() => { vi.unstubAllGlobals(); });
  it("rechecks the draft after waiting for another tab to finish submitting", async () => {
    let queue: Promise<unknown> = Promise.resolve();
    vi.stubGlobal("navigator", { locks: { request: (_key: string, task: () => Promise<unknown>) => {
      const result = queue.then(task); queue = result.catch(() => undefined); return result;
    } } });
    const storage = memoryStorage();
    const a = localBusinessForm(storage, "owner", "form");
    a.restore(); a.save({ reason: "本次申请" });
    const b = localBusinessForm(storage, "owner", "form"); b.restore();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const submitting = a.submit(async () => {
      a.save({ reason: "本次申请", uncertain: true });
      await gate;
      a.complete({ reason: "本次申请" });
    });
    const attachmentMutation = vi.fn(async () => undefined);
    const queued = b.submit(attachmentMutation);
    const rejection = expect(queued).rejects.toThrow("另一页面");
    release();
    await submitting; await rejection;
    expect(attachmentMutation).not.toHaveBeenCalled();
    expect(localBusinessForm(storage, "owner", "form").restore()).toBeUndefined();
  });
  it("does not call a business API when cross-tab locking is unavailable", async () => {
    vi.stubGlobal("navigator", {});
    const local = localBusinessForm(memoryStorage(), "owner", "form");
    local.restore(); local.save({ reason: "仍在本机" });
    const submit = vi.fn(async () => undefined);
    await expect(local.submit(submit)).rejects.toThrow("浏览器暂不支持");
    expect(submit).not.toHaveBeenCalled();
  });
  it("recovers project and request identity on refresh, isolated by account and form", () => {
    const storage = memoryStorage();
    const saved = { projectId: "project-a", requestKey: "same-operation", reason: "待保存", uncertain: true };
    const original = localBusinessForm(storage, "owner-a", "procurement");
    original.restore(); original.save(saved);
    expect(localBusinessForm(storage, "owner-a", "procurement").restore()).toEqual(saved);
    expect(localBusinessForm(storage, "owner-b", "procurement").restore()).toBeUndefined();
    expect(localBusinessForm(storage, "owner-a", "expense").restore()).toBeUndefined();
  });
  it("rejects a stale tab overwrite and retains the newer saved content", () => {
    const storage = memoryStorage();
    const a = localBusinessForm(storage, "owner", "form");
    const b = localBusinessForm(storage, "owner", "form");
    a.restore(); b.restore();
    a.save({ reason: "先保存的内容" });
    expect(() => b.save({ reason: "旧页面内容" })).toThrow("另一页面");
    expect(localBusinessForm(storage, "owner", "form").restore()).toEqual({ reason: "先保存的内容" });
  });
  it("does not replay confirmed business submissions or persist credentials", () => {
    const storage = memoryStorage();
    const local = localBusinessForm(storage, "owner", "form");
    local.restore();
    local.save({ reason: "保留正文", password: "never-persist", accessToken: "never-persist" });
    const restored = localBusinessForm<Record<string, string>>(storage, "owner", "form").restore();
    expect(restored?.reason).toBe("保留正文");
    expect(JSON.stringify(restored)).not.toContain("never-persist");
    local.complete({ reason: "保留已确认的填写" });
    expect(localBusinessForm(storage, "owner", "form").restore()).toBeUndefined();
    expect(storage.length).toBe(1);
  });
  it("does not claim success when browser storage rejects a write", () => {
    const storage = memoryStorage();
    const local = localBusinessForm(storage, "owner", "form");
    local.restore();
    local.save({ reason: "原内容" });
    storage.setItem = () => { throw new Error("quota"); };
    expect(() => local.save({ reason: "新内容" })).toThrow("quota");
    expect(localBusinessForm(storage, "owner", "form").restore()).toEqual({ reason: "原内容" });
  });
});
