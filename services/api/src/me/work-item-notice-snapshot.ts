import { createHash } from "node:crypto";
import type { WorkItem } from "./me.service";

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function workItemNoticeKey(item: WorkItem) {
  const duty = hash(JSON.stringify([item.id, item.currentNode]));
  return item.reminderId ? duty + hash(item.reminderId) : duty;
}

export function workItemNoticeSnapshot(items: WorkItem[]) {
  const entries = new Map<string, WorkItem>();
  for (const item of items) entries.set(workItemNoticeKey(item), item);
  const keys = [...entries.keys()].sort();
  return { version: hash(keys.join(",")), keys, entries };
}
