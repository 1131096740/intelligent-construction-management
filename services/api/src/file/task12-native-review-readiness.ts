import { AsyncLocalStorage } from "node:async_hooks";
import { ServiceUnavailableException } from "@nestjs/common";
import { Prisma } from "@prisma/client";

export const TASK12_NATIVE_REVIEW_MIGRATION = "20261109110000_contract_direct_review_retention_v1";
export const TASK12_NATIVE_REVIEW_CHECKSUM = "df73ffa2861318e571c6c8bba5c4d226808f00f65684d2953a0d5937d6d4bb92";

type Identity = Readonly<{
  database: string;
  databaseOid: string;
  ordinaryOid: string;
  ordinaryName: string;
  serverPort: number;
  systemIdentifier: string;
  project?: string;
  applicant?: string;
}>;
type OwnerRead = Identity & Readonly<{ ownerOid: string; ownerSession: boolean; ssl: boolean; completed: boolean }>;
export type Task12NativeReviewTransactionRead = Partial<Omit<Identity, "systemIdentifier">> & Readonly<{ sessionRole?: boolean; ssl?: boolean }>;
type Proof = { identity: Identity; check: () => void };
const issued = new WeakMap<object, Proof>();
const scope = new AsyncLocalStorage<{ proof: Proof; active: boolean }>();
const denied = () => new ServiceUnavailableException("隔离验收的履约复核原件保留状态暂时无法核对");
const transactionKeys = ["database", "databaseOid", "ordinaryOid", "ordinaryName", "serverPort"] as const;

export function issueTask12NativeReviewReadiness(identity: Identity, owner: OwnerRead, check: () => void): object {
  if (!/^jg_task01_[0-9a-f]{32}$/u.test(identity.database) ||
      !/^jg_fixture_app_[0-9a-f]{24}$/u.test(identity.ordinaryName) ||
      !/^[1-9][0-9]{0,9}$/u.test(identity.databaseOid) || !/^[1-9][0-9]{0,9}$/u.test(identity.ordinaryOid) ||
      !/^[1-9][0-9]{0,19}$/u.test(identity.systemIdentifier) ||
      !Number.isSafeInteger(identity.serverPort) || identity.serverPort <= 1024 || identity.serverPort > 65535 ||
      !transactionKeys.every(key => owner[key] === identity[key]) ||
      owner.systemIdentifier !== identity.systemIdentifier || owner.ownerOid !== "10" ||
      owner.ownerSession !== true || owner.ssl !== true || owner.completed !== true) throw denied();
  check();
  const token = Object.freeze({});
  issued.set(token, { identity: Object.freeze({ ...identity }), check });
  return token;
}

export async function withTask12NativeReviewReadiness<T>(token: object, use: () => Promise<T>): Promise<T> {
  const proof = issued.get(token);
  if (!proof || scope.getStore()) throw denied();
  issued.delete(token);
  proof.check();
  const active = { proof, active: true };
  try { return await scope.run(active, use); }
  finally { active.active = false; }
}

export function hasTask12NativeReviewReadiness(): boolean {
  return scope.getStore() !== undefined;
}

export function assertTask12NativeReviewReadiness(actual: Task12NativeReviewTransactionRead, ready: boolean): void {
  const current = scope.getStore();
  if (!current?.active || !ready || actual.sessionRole !== true || actual.ssl !== true ||
      !transactionKeys.every(key => actual[key] === current.proof.identity[key])) throw denied();
  current.proof.check();
}

type AssignmentRow = { userId: string; roleKey: string };
type AssignmentRows = { project: AssignmentRow[]; global: AssignmentRow[] };

export async function task12NativeApprovalAssignments(
  tx: Prisma.TransactionClient, phase: "applicant" | "candidates" | "review" | "seal", project: string, actor: string,
  projectRoles: readonly string[] = [], globalRoles: readonly string[] = []
): Promise<AssignmentRows | undefined> {
  const current = scope.getStore();
  if (!current) return undefined;
  if (!current.active || current.proof.identity.project !== project || ((phase === "applicant" || phase === "candidates") && current.proof.identity.applicant !== actor)) throw denied();
  current.proof.check();
  const [row, extra] = await tx.$queryRaw<Array<{ assignments: AssignmentRows }>>(Prisma.sql`
    SELECT jg_t12_normal_approval.read_locked_assignments(${project}, ${actor}, ${phase}, ${[...projectRoles]}::text[], ${[...globalRoles]}::text[]) AS assignments
  `);
  if (extra || !row || !Array.isArray(row.assignments?.project) || !Array.isArray(row.assignments?.global)) throw denied();
  return row.assignments;
}

export function task12NativeSealAssignments(tx: Prisma.TransactionClient, actor: string): Promise<AssignmentRows | undefined> {
  const current = scope.getStore();
  if (!current) return Promise.resolve(undefined);
  if (!current.proof.identity.project) throw denied();
  return task12NativeApprovalAssignments(tx, "seal", current.proof.identity.project, actor, [], ["comprehensive_director", "super_admin"]);
}

type LockedApprovalSignature = { id: string; fileId: string; contentSha256: string };

export async function task12NativeApprovalSignature(
  tx: { $queryRaw<T>(query: Prisma.Sql): Promise<T> }, project: string, actor: string
): Promise<LockedApprovalSignature | null | undefined> {
  const current = scope.getStore();
  if (!current) return undefined;
  if (!current.active || current.proof.identity.project !== project) throw denied();
  current.proof.check();
  const [row, extra] = await tx.$queryRaw<LockedApprovalSignature[]>(Prisma.sql`
    SELECT id, "fileId", "contentSha256" FROM jg_t12_normal_approval.read_locked_approval_signature(${project}, ${actor})
  `);
  if (extra) throw denied();
  return row ?? null;
}
