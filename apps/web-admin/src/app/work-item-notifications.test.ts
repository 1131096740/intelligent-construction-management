import { describe, expect, it } from "vitest";
import { addedWorkItemNoticeKeys, collectWorkItemNotices, persistWorkItemNoticeIndex, readWorkItemNoticeIndex } from "./work-item-notifications";

function storage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); }
  };
}

describe("新待办提示", () => {
  it("未处理的同一职责只提示一次，刷新后仍然不重复", () => {
    const seen = storage();
    const item = { id: "payment-1", currentNode: "登记付款" };
    expect(collectWorkItemNotices(seen, "finance", new Set(), [item])).toEqual([item]);
    expect(collectWorkItemNotices(seen, "finance", new Set(), [item])).toEqual([]);
    expect(collectWorkItemNotices(seen, "reviewer", new Set(), [item])).toEqual([item]);
    const nextDuty = { ...item, currentNode: "核对付款" };
    expect(collectWorkItemNotices(seen, "finance", new Set(), [nextDuty])).toEqual([nextDuty]);
    const reminded = { ...nextDuty, reminderId: "manual-1" };
    expect(collectWorkItemNotices(seen, "finance", new Set(), [reminded])).toEqual([reminded]);
    expect(collectWorkItemNotices(seen, "finance", new Set(), [reminded])).toEqual([]);
  });

  it("首次看到已催办的待办，在催办提示期结束后不重复弹出", () => {
    const seen = storage();
    const item = { id: "approval-2", currentNode: "会签" };
    const reminded = { ...item, reminderId: "manual-1" };
    expect(collectWorkItemNotices(seen, "finance", new Set(), [reminded])).toEqual([reminded]);
    expect(collectWorkItemNotices(seen, "finance", new Set(), [item])).toEqual([]);
  });

  it("存储不可用时，在当前页面仍然不会重复提示", () => {
    const seen = new Set<string>();
    const item = { id: "approval-1", currentNode: "会签" };
    expect(collectWorkItemNotices(null, "finance", seen, [item])).toEqual([item]);
    expect(collectWorkItemNotices(null, "finance", seen, [item])).toEqual([]);
  });
});


describe("授权待办指纹增量", () => {
  const first = { version: "a".repeat(64), keys: ["1".repeat(64), "2".repeat(64)] };

  it("不按业务时间取差，超过10条及重新授权的旧事项均进入差集", () => {
    const additions = Array.from({ length: 14 }, (_, index) => (index + 10).toString(16).padStart(64, "0"));
    const next = { version: "b".repeat(64), keys: [first.keys[1], ...additions] };
    expect(addedWorkItemNoticeKeys(first, next)).toEqual(additions);
    expect(addedWorkItemNoticeKeys(next, { ...first, keys: [first.keys[0], ...next.keys] })).toEqual([first.keys[0]]);
  });

  it("同一职责的催办出现才提醒，催办到期恢复普通待办不重复提醒", () => {
    const reminded = first.keys[0] + "3".repeat(64);
    const withReminder = { ...first, keys: [reminded, first.keys[1]] };
    expect(addedWorkItemNoticeKeys(first, withReminder)).toEqual([reminded]);
    expect(addedWorkItemNoticeKeys(withReminder, first)).toEqual([]);
  });

  it("指纹基线随当前账号存储，页面刷新后继续计算", () => {
    const store = storage();
    persistWorkItemNoticeIndex(store, "finance", first);
    expect(readWorkItemNoticeIndex(store, "finance")).toEqual(first);
    expect(readWorkItemNoticeIndex(store, "other")).toBeNull();
  });
});
