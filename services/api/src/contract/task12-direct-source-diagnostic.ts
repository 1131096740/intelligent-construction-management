import { AsyncLocalStorage } from "node:async_hooks";
import { types } from "node:util";

const phases = [
  "UPWARD_PROJECTION", "DEPARSE_ENVIRONMENT", "TRANSITION_DISCOVERY", "RETENTION_DISCOVERY", "DISPATCH_DISCOVERY",
  "BINDING_CATALOG", "BINDING_ROW", "SOURCE_CATALOG", "SOURCE_POLICY", "DISPATCH_CATALOG", "DISPATCH_POLICY",
  "DISPATCH_NATIVE_ADMISSION", "DISPATCH_LINKS", "SHAPE_BINDINGS", "SHAPE_GENERATED_PARENT",
  "SHAPE_UPWARD_SAVE_PROJECTION", "SHAPE_UPWARD_SAVE_CATALOG", "SHAPE_UPWARD_SAVE_SUBMISSION",
  "SHAPE_UPWARD_SAVE_ARCHIVE_TRANSITION", "SHAPE_UPWARD_SAVE_SEAL_COMPLETION", "SHAPE_UPWARD_SAVE_ATTACHMENT",
  "SHAPE_UPWARD_CREATE", "SHAPE_HELPERS", "SHAPE_TRIGGERS", "COLLISION_ACL", "FILE_BINDING", "ROUTINES",
  "TRIGGERS", "DEFINERS", "DEFINER_UNKNOWN", "DEFINER_READER_BINDING_ABSENT", "DEFINER_READER_CATALOG",
  "DEFINER_READER_NO_ROW", "DEFINER_READER_MULTIPLE_ROWS", "DEFINER_READER_MISMATCH", "TRANSITION", "RETENTION",
  "RETENTION_PREPARATION", "RETENTION_PROJECTION", "RETENTION_CATALOG", "RETENTION_BINDING",
  "RETENTION_REGISTRY", "RETENTION_APPLICATION_READS", "RETENTION_FILE_CALLERS", "RETENTION_BOUND_CATALOG",
  "RETENTION_COMPLETION_PROBE", "RETENTION_COMPLETION_PROJECTION", "RETENTION_COMPLETION_CATALOG",
  "RETENTION_COMPLETION_REGISTRY", "RETENTION_COMPLETION_NATIVE", "RETENTION_COMPLETION_IDENTITY",
  "RETENTION_COMPLETION_LINKS", "RETENTION_COMPLETION_BINDINGS", "RETENTION_COMPLETION_GENERATED",
  "RETENTION_COMPLETION_ENABLED_DIRECT", "RETENTION_COMPLETION_UPWARD", "RETENTION_COMPLETION_LEGACY",
  "RETENTION_COMPLETION_ROUTINES", "RETENTION_COMPLETION_GLOBAL_POSTIMAGE", "RETENTION_COMPLETION_DIRECT_POSTIMAGE",
  "RETENTION_COMPLETION_NATIVE_LEGACY", "RETENTION_LEGACY_CATALOG", "RETENTION_DESCRIPTORS",
  "RETENTION_ROUTINES", "RETENTION_TRIGGERS", "CONTINUITY"
] as const;
type Phase = typeof phases[number];
const readerFields = ["ownerOid", "completionOid", "routineOid", "bodySha256", "namespaceOid", "databaseOid",
  "sessionRoleOid", "currentRoleOid", "backendPid", "transactionId"] as const;
export type ReaderField = typeof readerFields[number];
type Observation = Readonly<{ phase: Phase; operation?: "PRISMA_QUERY_RAW"; prismaCode?: "P2010"; sqlState?: string;
  mismatchedFields?: readonly ReaderField[] }>;
const context = new AsyncLocalStorage<{ phase: Phase; observation?: Observation }>();
function own(object: unknown, key: string): unknown {
  return object && typeof object === "object" && !types.isProxy(object) ? Object.getOwnPropertyDescriptor(object, key)?.value : undefined;
}

export function markTask12DirectSourceDiagnostic(phase: Phase): void {
  const state = context.getStore();
  if (state && phases.includes(phase)) state.phase = phase;
}

export function recordTask12DirectSourceDiagnostic(error: unknown, readerMismatch?: Readonly<Partial<Record<ReaderField, boolean>>>): void {
  const state = context.getStore();
  if (!state || state.observation) return;
  const sqlState = own(own(error, "meta"), "code");
  const fields = state.phase === "DEFINER_READER_MISMATCH"
    ? readerFields.filter(field => own(readerMismatch, field) === true) : [];
  state.observation = Object.freeze({ phase: state.phase,
    ...(fields.length ? { mismatchedFields: Object.freeze(fields) } : {}),
    ...(own(error, "code") === "P2010" && typeof sqlState === "string" && /^[0-9A-Z]{5}$/u.test(sqlState)
      ? { operation: "PRISMA_QUERY_RAW", prismaCode: "P2010", sqlState } : {}) });
}

export async function observeTask12DirectSourceDiagnostic<T>(run: () => Promise<T>, publish: (detail: Observation) => void): Promise<T> {
  const state: { phase: Phase; observation?: Observation } = { phase: "UPWARD_PROJECTION" };
  return context.run(state, async () => {
    try { return await run(); }
    catch (error) {
      if (state.observation) {
        try { publish(state.observation); } catch { /* Diagnostics never replace the original failure. */ }
      }
      throw error;
    }
  });
}
