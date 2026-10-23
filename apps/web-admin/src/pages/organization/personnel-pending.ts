import type { PersonnelCommand, ProjectRosterChange } from "../../api/organization.api";

export type PendingRosterChange = ProjectRosterChange & { commandKey: string; projectName: string; personName: string };
type PendingKind = "personnel" | "roster";
type SessionStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;
function storageKey(actorId: string, kind: PendingKind) { return `jiangkong-pending-${kind}:${actorId}`; }
function roleTarget(row: NonNullable<PersonnelCommand["additions"]>[number] | NonNullable<PersonnelCommand["removals"]>[number]) {
  return { operation: row.operation, userId: row.userId, scope: row.scope, roleKey: row.roleKey,
    ...(row.scope === "project" ? { projectId: row.projectId } : {}) };
}
export function savePendingPersonnel(actorId: string, input: PersonnelCommand, storage: SessionStore = sessionStorage) {
  const command: PersonnelCommand = { commandKey: input.commandKey, userId: input.userId, action: input.action, reason: input.reason,
    ...(input.departmentId ? { departmentId: input.departmentId } : {}), ...(input.startedOn ? { startedOn: input.startedOn } : {}),
    ...(input.companyEntityId ? { companyEntityId: input.companyEntityId } : {}),
    ...(input.additions ? { additions: input.additions.map((row) => ({ ...roleTarget(row), operation: "add" as const })) } : {}),
    ...(input.removals ? { removals: input.removals.map((row) => ({ ...roleTarget(row), operation: "remove" as const })) } : {}),
    ...(input.rosterChanges ? { rosterChanges: input.rosterChanges.map((row) => ({ operation: row.operation, projectId: row.projectId })) } : {}) };
  save(actorId, "personnel", command, storage);
}
export function savePendingRoster(actorId: string, input: PendingRosterChange, storage: SessionStore = sessionStorage) {
  save(actorId, "roster", { commandKey: input.commandKey, userId: input.userId, operation: input.operation,
    projectId: input.projectId, projectName: input.projectName, personName: input.personName, reason: input.reason }, storage);
}
function save(actorId: string, kind: PendingKind, command: PersonnelCommand | PendingRosterChange, storage: SessionStore) {
  if (!actorId) throw new Error("登录状态待核实，请重新登录后办理");
  try { storage.setItem(storageKey(actorId, kind), JSON.stringify({ actorId, command })); }
  catch { throw new Error("暂不能保留办理编号，请恢复浏览器会话存储后再试；尚未提交办理"); }
}
function load(actorId: string, kind: PendingKind, storage: SessionStore): unknown {
  if (!actorId) return null;
  try {
    const saved = JSON.parse(storage.getItem(storageKey(actorId, kind)) ?? "null") as { actorId?: unknown; command?: unknown } | null;
    return saved?.actorId === actorId ? saved.command : null;
  } catch { return null; }
}
function validCommand(value: unknown): value is { commandKey: string; userId: string; reason: string } {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return typeof row.commandKey === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu.test(row.commandKey)
    && typeof row.userId === "string" && Boolean(row.userId) && typeof row.reason === "string";
}
export function loadPendingPersonnel(actorId: string, storage: SessionStore = sessionStorage): PersonnelCommand | null {
  const value = load(actorId, "personnel", storage);
  return validCommand(value) && ["join", "adjust", "offboard", "rehire"].includes(String((value as Record<string, unknown>).action)) ? value as PersonnelCommand : null;
}
export function loadPendingRoster(actorId: string, storage: SessionStore = sessionStorage): PendingRosterChange | null {
  const value = load(actorId, "roster", storage);
  if (!validCommand(value)) return null;
  const row = value as Record<string, unknown>;
  return ["join", "leave"].includes(String(row.operation)) && typeof row.projectId === "string" && typeof row.projectName === "string" && typeof row.personName === "string" ? value as PendingRosterChange : null;
}
export function clearPendingPersonnel(actorId: string, kind: PendingKind, storage: SessionStore = sessionStorage) {
  try { storage.removeItem(storageKey(actorId, kind)); } catch { /* A known receipt can be queried again; never replay its write. */ }
}