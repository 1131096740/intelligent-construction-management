interface WorkItemNotice {
  id: string;
  currentNode: string;
  reminderId?: string;
}

const MAX_SEEN_NOTICES = 300;

export function collectWorkItemNotices<T extends WorkItemNotice>(
  storage: Pick<Storage, "getItem" | "setItem"> | null,
  userId: string,
  seen: Set<string>,
  pending: T[]
): T[] {
  if (!pending.length) return [];
  const key = `jg:work-item-notices:${userId}`;
  try {
    const saved: unknown = JSON.parse(storage?.getItem(key) ?? "[]");
    if (Array.isArray(saved)) {
      for (const item of saved.slice(-MAX_SEEN_NOTICES)) {
        if (typeof item === "string") seen.add(item);
      }
    }
  } catch { /* An unavailable store still permits page-session deduplication. */ }
  const newNotices = pending.filter(item => {
    const base = JSON.stringify([item.id, item.currentNode]);
    const notice = item.reminderId ? JSON.stringify([item.id, item.currentNode, item.reminderId]) : base;
    const isNew = !seen.has(notice);
    seen.add(base);
    seen.add(notice);
    return isNew;
  });
  if (newNotices.length) {
    try { storage?.setItem(key, JSON.stringify([...seen].slice(-MAX_SEEN_NOTICES))); }
    catch { /* Keep the in-memory set if storage is unavailable. */ }
  }
  return newNotices;
}

export interface WorkItemNoticeIndex {
  version: string;
  keys: string[];
}

const indexStorageKey = (userId: string) => `jg:work-item-notice-index:${userId}`;
const validVersion = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{64}$/u.test(value);
const validNoticeKey = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{64}(?:[0-9a-f]{64})?$/u.test(value);

export function readWorkItemNoticeIndex(storage: Pick<Storage, "getItem"> | null, userId: string): WorkItemNoticeIndex | null {
  try {
    const saved = JSON.parse(storage?.getItem(indexStorageKey(userId)) ?? "null") as WorkItemNoticeIndex | null;
    return saved && validVersion(saved.version) && Array.isArray(saved.keys) && saved.keys.every(validNoticeKey) ? saved : null;
  } catch { return null; }
}

export function persistWorkItemNoticeIndex(storage: Pick<Storage, "setItem"> | null, userId: string, index: WorkItemNoticeIndex) {
  try { storage?.setItem(indexStorageKey(userId), JSON.stringify(index)); }
  catch { /* The current page still retains its exact index. */ }
}

export function addedWorkItemNoticeKeys(previous: WorkItemNoticeIndex, next: WorkItemNoticeIndex) {
  const existing = new Map(previous.keys.map(key => [key.slice(0, 64), key]));
  return next.keys.filter(key => {
    const prior = existing.get(key.slice(0, 64));
    return prior === undefined || (key.length > 64 && prior !== key);
  });
}
