import { describe, expect, it } from "vitest";
import type { PersonnelCommand } from "../../api/organization.api";
import { clearPendingPersonnel, loadPendingPersonnel, loadPendingRoster, savePendingPersonnel, savePendingRoster } from "./personnel-pending";

function store() {
  const data = new Map<string, string>();
  return { data, getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); }, removeItem: (key: string) => { data.delete(key); } };
}
const key = "00000000-0000-4000-8000-000000000001";
describe("unconfirmed personnel command recovery", () => {
  it("binds the frozen payload to its actor and persists no confirmation credentials", () => {
    const storage = store();
    const input = { commandKey: key, userId: "staff", action: "adjust", reason: "合成调整",
      confirmationPassword: "never-persist-this", additions: [{ operation: "add", userId: "staff", scope: "project", projectId: "project", roleKey: "finance_staff", confirmationPassword: "nested-never-persist" }] } as unknown as PersonnelCommand;
    savePendingPersonnel("actor", input, storage);
    expect(loadPendingPersonnel("actor", storage)).toEqual({ commandKey: key, userId: "staff", action: "adjust", reason: "合成调整",
      additions: [{ operation: "add", userId: "staff", scope: "project", projectId: "project", roleKey: "finance_staff" }] });
    expect(loadPendingPersonnel("other-actor", storage)).toBeNull();
    expect([...storage.data.values()].join()).not.toContain("never-persist");
    input.reason = "later edits";
    expect(loadPendingPersonnel("actor", storage)?.reason).toBe("合成调整");
  });
  it("recovers roster context without replay data and clears only that actor's result", () => {
    const storage = store();
    const command = { commandKey: key, userId: "staff", operation: "join" as const, projectId: "project", projectName: "合成项目", personName: "合成员工", reason: "合成安排" };
    savePendingRoster("actor", command, storage);
    savePendingRoster("other", command, storage);
    expect(loadPendingRoster("actor", storage)).toEqual(command);
    clearPendingPersonnel("actor", "roster", storage);
    expect(loadPendingRoster("actor", storage)).toBeNull();
    expect(loadPendingRoster("other", storage)).toEqual(command);
  });
  it("does not accept a record moved under another actor or a malformed command number", () => {
    const storage = store();
    storage.setItem("jiangkong-pending-personnel:actor", JSON.stringify({ actorId: "other", command: { commandKey: key, userId: "staff", action: "join", reason: "合成" } }));
    expect(loadPendingPersonnel("actor", storage)).toBeNull();
    storage.setItem("jiangkong-pending-personnel:actor", JSON.stringify({ actorId: "actor", command: { commandKey: "invalid", userId: "staff", action: "join", reason: "合成" } }));
    expect(loadPendingPersonnel("actor", storage)).toBeNull();
  });
  it("refuses before submission when a recovery number cannot be retained", () => {
    const storage = { getItem: () => null, setItem: () => { throw new Error("blocked"); }, removeItem: () => {} };
    expect(() => savePendingPersonnel("actor", { commandKey: key, userId: "staff", action: "join", reason: "合成" }, storage)).toThrow("尚未提交办理");
  });
});
