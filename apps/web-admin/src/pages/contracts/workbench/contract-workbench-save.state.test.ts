import { describe, expect, it } from "vitest";
import {
  beginAggregateSave,
  canMergeAggregateSaveDerivedFacts,
  completeAggregateSave,
  createAggregateSaveState,
  failAggregateSave,
  markAggregateSaveEdited,
  type AggregateSaveSnapshot
} from "./contract-workbench-save.state";

type Snapshot = AggregateSaveSnapshot & {
  contractName: string;
  amount: string;
};

function snapshot(contractName: string, amount = "100"): Snapshot {
  return { contractName, amount };
}

describe("contract workbench aggregate save state", () => {
  it("uses a two-second leading window that later edits do not postpone", () => {
    const initial = createAggregateSaveState<Snapshot>(3);
    const first = markAggregateSaveEdited(initial, "draft", 1_000);
    const second = markAggregateSaveEdited(first, "parties", 2_500);

    expect(first).toMatchObject({
      kind: "dirty",
      deadlineAt: 3_000,
      localGeneration: 1,
      changedSections: ["draft"]
    });
    expect(second).toMatchObject({
      kind: "dirty",
      deadlineAt: 3_000,
      localGeneration: 2,
      changedSections: ["draft", "parties"]
    });
  });

  it("starts the next two-second window only after an in-flight save resolves", () => {
    const dirty = markAggregateSaveEdited(
      createAggregateSaveState<Snapshot>(3),
      "draft",
      0
    );
    const input = snapshot("请求开始");
    const saving = beginAggregateSave(dirty, input, "idempotency-1");
    input.contractName = "调用方后来修改";
    const edited = markAggregateSaveEdited(saving, "draft", 1_500);
    const completed = completeAggregateSave(edited, 4, 2_000);

    expect(saving).toMatchObject({
      kind: "saving",
      sentGeneration: 1,
      idempotencyKey: "idempotency-1",
      inFlightSnapshot: { contractName: "请求开始" }
    });
    expect(completed).toMatchObject({
      kind: "dirty",
      serverRevision: 4,
      ackedGeneration: 1,
      localGeneration: 2,
      deadlineAt: 4_000,
      changedSections: ["draft"]
    });
  });

  it("allows only one save in flight for the same revision", () => {
    const saving = beginAggregateSave(
      markAggregateSaveEdited(createAggregateSaveState<Snapshot>(7), "draft", 0),
      snapshot("单飞"),
      "idempotency-1"
    );

    expect(beginAggregateSave(saving, snapshot("第二请求"), "idempotency-2"))
      .toBe(saving);
  });

  it("reuses the same idempotency key for a network retry and changes it next round", () => {
    const saving = beginAggregateSave(
      markAggregateSaveEdited(createAggregateSaveState<Snapshot>(3), "draft", 0),
      snapshot("第一次"),
      "idempotency-1",
      "auto"
    );
    const failed = failAggregateSave(saving, "network", "网络中断");
    const retry = beginAggregateSave(failed, snapshot("不应替换"), "idempotency-2");
    const clean = completeAggregateSave(retry, 4, 1_000);
    const next = beginAggregateSave(
      markAggregateSaveEdited(clean, "draft", 2_000),
      snapshot("下一轮"),
      "idempotency-2"
    );

    expect(retry).toMatchObject({
      kind: "saving",
      saveKind: "auto",
      idempotencyKey: "idempotency-1",
      inFlightSnapshot: { contractName: "第一次" }
    });
    expect(next).toMatchObject({
      kind: "saving",
      idempotencyKey: "idempotency-2",
      inFlightSnapshot: { contractName: "下一轮" }
    });
  });

  it("merges derived facts only when their source sections were not edited in flight", () => {
    const saving = beginAggregateSave(
      markAggregateSaveEdited(createAggregateSaveState<Snapshot>(3), "bills", 0),
      snapshot("合同", "100"),
      "idempotency-1"
    );
    const unrelated = markAggregateSaveEdited(saving, "parties", 500);
    const billEdited = markAggregateSaveEdited(unrelated, "bills", 600);

    expect(canMergeAggregateSaveDerivedFacts(unrelated, ["bills"])).toBe(true);
    expect(canMergeAggregateSaveDerivedFacts(unrelated, ["parties"])).toBe(false);
    expect(canMergeAggregateSaveDerivedFacts(billEdited, ["bills"])).toBe(false);
  });

  it("preserves dirty generations when conflict or lease loss makes saving fail closed", () => {
    const saving = beginAggregateSave(
      markAggregateSaveEdited(createAggregateSaveState<Snapshot>(3), "draft", 0),
      snapshot("本地内容"),
      "idempotency-1"
    );
    const conflict = failAggregateSave(saving, "conflict", "修订冲突");
    const readonly = failAggregateSave(saving, "readonly", "租约已丢失");

    expect(conflict).toMatchObject({
      kind: "conflict",
      localGeneration: 1,
      ackedGeneration: 0,
      inFlightSnapshot: { contractName: "本地内容" }
    });
    expect(readonly).toMatchObject({
      kind: "readonly",
      localGeneration: 1,
      ackedGeneration: 0,
      inFlightSnapshot: { contractName: "本地内容" }
    });
  });
});
