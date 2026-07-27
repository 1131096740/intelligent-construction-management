import { describe, expect, it } from "vitest";
import {
  SETTLEMENT_WORKBENCH_LOCAL_RECOVERY_TTL_MS,
  clearSettlementWorkbenchLocalRecovery,
  readSettlementWorkbenchLocalRecovery,
  writeSettlementWorkbenchLocalRecovery,
  type SettlementWorkbenchRecoveryIdentity
} from "./settlement-local-recovery";

function storage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key); },
    setItem: (key, value) => { values.set(key, value); }
  };
}

const identity: SettlementWorkbenchRecoveryIdentity = {
  userId: "user-1",
  deviceId: "device-1",
  projectId: "project-1",
  draftId: "draft-1",
  revision: 3
};

describe("settlement local recovery", () => {
  it("only restores an exact account, device, draft and revision match", () => {
    const target = storage();
    expect(writeSettlementWorkbenchLocalRecovery(target, identity, { code: "JS-001" }, 100)).toBe(true);
    expect(readSettlementWorkbenchLocalRecovery(target, identity, 101)?.snapshot).toEqual({ code: "JS-001" });
    expect(readSettlementWorkbenchLocalRecovery(target, { ...identity, userId: "user-2" }, 101)).toBeNull();
    expect(readSettlementWorkbenchLocalRecovery(target, { ...identity, deviceId: "device-2" }, 101)).toBeNull();
    expect(readSettlementWorkbenchLocalRecovery(target, { ...identity, draftId: "draft-2" }, 101)).toBeNull();
    expect(readSettlementWorkbenchLocalRecovery(target, { ...identity, revision: 4 }, 101)).toBeNull();
  });

  it("removes expired and explicitly discarded local recovery", () => {
    const target = storage();
    writeSettlementWorkbenchLocalRecovery(target, identity, { code: "JS-001" }, 100);
    expect(readSettlementWorkbenchLocalRecovery(
      target,
      identity,
      100 + SETTLEMENT_WORKBENCH_LOCAL_RECOVERY_TTL_MS
    )).toBeNull();
    writeSettlementWorkbenchLocalRecovery(target, identity, { code: "JS-002" }, 200);
    clearSettlementWorkbenchLocalRecovery(target, identity);
    expect(readSettlementWorkbenchLocalRecovery(target, identity, 201)).toBeNull();
  });
});
