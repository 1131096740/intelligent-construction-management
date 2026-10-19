import { sanitizeContractDraftRecoverySnapshot } from "../pages/contracts/workbench/contract-draft-local-recovery";

const prefix = "jg:business-form:v1:";
interface SavedForm<T> { value: T; revision: string; owner: string; savedAt: number; completed?: boolean; }

export function localBusinessForm<T>(storage: Storage, owner: string, scene: string) {
  const key = prefix + encodeURIComponent(owner) + ":" + encodeURIComponent(scene);
  let revision: string | undefined;
  const read = (): SavedForm<T> | undefined => {
    const raw = storage.getItem(key);
    if (!raw) return;
    const saved = JSON.parse(raw) as SavedForm<T>;
    if (saved.owner !== owner || !saved.revision || !saved.savedAt) throw new Error("本机草稿无法核对，请保留当前填写并联系管理员。");
    return saved;
  };
  function write(value: T, completed = false) {
    if (!owner) throw new Error("请先登录后保存草稿。");
    const existing = read();
    if (existing?.revision !== revision) throw new Error("另一页面已更新这份草稿，当前填写未覆盖它。请保留当前内容，回到原页面继续办理。");
    const next = globalThis.crypto.randomUUID();
    storage.setItem(key, JSON.stringify({ value: sanitizeContractDraftRecoverySnapshot(value), revision: next, owner, savedAt: Date.now(), completed } satisfies SavedForm<T>));
    revision = next;
  }
  return {
    async submit<R>(task: () => Promise<R>): Promise<R> {
      if (!globalThis.navigator?.locks) throw new Error("浏览器暂不支持安全恢复提交，请保留当前填写，使用新版 Safari 或 Chrome 后再试。");
      return globalThis.navigator.locks.request(key, async () => {
        if (read()?.revision !== revision) throw new Error("另一页面已更新这份草稿，请回到原页面核对，当前没有重复提交。");
        return task();
      });
    },
    restore() {
      const saved = read();
      revision = saved?.revision;
      return saved && !saved.completed ? saved.value : undefined;
    },
    save: write,
    complete(value: T) { write(value, true); }
  };
}

