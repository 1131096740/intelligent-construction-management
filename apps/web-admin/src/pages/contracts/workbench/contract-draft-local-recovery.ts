const SCHEMA_VERSION = 1;
export const CONTRACT_DRAFT_LOCAL_RECOVERY_TTL_MS = 24 * 60 * 60 * 1_000;

const DEVICE_KEY = `jg:contract-draft-device:v${SCHEMA_VERSION}`;
const RECOVERY_KEY_PREFIX = `jg:contract-draft-local-recovery:v${SCHEMA_VERSION}`;
const PRIVATE_FIELD_NAMES = new Set([
  "accesstoken",
  "bytestream",
  "bytes",
  "coskey",
  "currentpassword",
  "downloadurl",
  "leasetoken",
  "objectkey",
  "password",
  "presignedurl",
  "privateurl",
  "signedurl",
  "token"
]);

export interface ContractDraftRecoveryIdentity {
  userId: string;
  deviceId: string;
  projectId: string;
  contractVersionId: string;
  serverRevision: number;
}

export interface ContractDraftLocalRecovery<T> {
  schemaVersion: 1;
  identity: ContractDraftRecoveryIdentity;
  savedAt: number;
  expiresAt: number;
  snapshot: T;
}

export interface ContractDraftLocalRecoveryMatch<T> {
  revisionMatches: boolean;
  recovery: ContractDraftLocalRecovery<T>;
}

export function getContractDraftDeviceId(storage: Storage): string | null {
  try {
    const existing = storage.getItem(DEVICE_KEY)?.trim();
    if (existing) return existing;
    const deviceId = globalThis.crypto?.randomUUID?.() ??
      `device-${Date.now()}-${Math.random()}`;
    storage.setItem(DEVICE_KEY, deviceId);
    return deviceId;
  } catch {
    return null;
  }
}

export function sanitizeContractDraftRecoverySnapshot<T>(snapshot: T): T {
  return sanitizeValue(snapshot) as T;
}

export function writeContractDraftLocalRecovery<T>(
  storage: Storage,
  identity: ContractDraftRecoveryIdentity,
  snapshot: T,
  now = Date.now()
): boolean {
  const recovery: ContractDraftLocalRecovery<T> = {
    schemaVersion: SCHEMA_VERSION,
    identity: { ...identity },
    savedAt: now,
    expiresAt: now + CONTRACT_DRAFT_LOCAL_RECOVERY_TTL_MS,
    snapshot: sanitizeContractDraftRecoverySnapshot(snapshot)
  };
  try {
    storage.setItem(recoveryKey(identity), JSON.stringify(recovery));
    return true;
  } catch {
    return false;
  }
}

export function findContractDraftLocalRecovery<T>(
  storage: Storage,
  identity: ContractDraftRecoveryIdentity,
  now = Date.now()
): ContractDraftLocalRecoveryMatch<T> | null {
  let newest: ContractDraftLocalRecovery<T> | null = null;
  for (const key of recoveryKeys(storage)) {
    const recovery = readRecovery<T>(storage, key, now);
    if (!recovery || !sameScope(recovery.identity, identity)) continue;
    if (
      recovery.identity.serverRevision === identity.serverRevision &&
      (!newest || newest.identity.serverRevision !== identity.serverRevision ||
        recovery.savedAt > newest.savedAt)
    ) {
      newest = recovery;
      continue;
    }
    if (
      newest?.identity.serverRevision !== identity.serverRevision &&
      (!newest || recovery.savedAt > newest.savedAt)
    ) {
      newest = recovery;
    }
  }
  return newest
    ? {
        revisionMatches: newest.identity.serverRevision === identity.serverRevision,
        recovery: newest
      }
    : null;
}

export function clearContractDraftLocalRecoveryScope(
  storage: Storage,
  identity: Pick<
    ContractDraftRecoveryIdentity,
    "userId" | "deviceId" | "projectId" | "contractVersionId"
  >
): void {
  for (const key of recoveryKeys(storage)) {
    const recovery = readRecovery<unknown>(storage, key, Number.NEGATIVE_INFINITY);
    if (recovery && sameScope(recovery.identity, identity)) {
      safeRemove(storage, key);
    }
  }
}

export function clearContractDraftLocalRecoveriesForUser(
  storage: Storage,
  userId: string
): void {
  for (const key of recoveryKeys(storage)) {
    const recovery = readRecovery<unknown>(storage, key, Number.NEGATIVE_INFINITY);
    if (recovery?.identity.userId === userId) {
      safeRemove(storage, key);
    }
  }
}

function sanitizeValue(value: unknown): unknown {
  if (
    value instanceof ArrayBuffer ||
    ArrayBuffer.isView(value) ||
    (typeof Blob !== "undefined" && value instanceof Blob)
  ) {
    return undefined;
  }
  if (Array.isArray(value)) {
    return value
      .map((item) => sanitizeValue(item))
      .filter((item) => item !== undefined);
  }
  if (value && typeof value === "object") {
    const sanitized: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
      if (PRIVATE_FIELD_NAMES.has(normalizeFieldName(key))) continue;
      const next = sanitizeValue(nested);
      if (next !== undefined) sanitized[key] = next;
    }
    return sanitized;
  }
  return value;
}

function normalizeFieldName(value: string): string {
  return value.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function recoveryKey(identity: ContractDraftRecoveryIdentity): string {
  return [
    RECOVERY_KEY_PREFIX,
    identity.userId,
    identity.deviceId,
    identity.projectId,
    identity.contractVersionId,
    String(identity.serverRevision)
  ].map(encodeURIComponent).join(":");
}

function recoveryKeys(storage: Storage): string[] {
  const prefix = `${encodeURIComponent(RECOVERY_KEY_PREFIX)}:`;
  const keys: string[] = [];
  try {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key?.startsWith(prefix)) keys.push(key);
    }
  } catch {
    return [];
  }
  return keys;
}

function readRecovery<T>(
  storage: Storage,
  key: string,
  now = Date.now()
): ContractDraftLocalRecovery<T> | null {
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<ContractDraftLocalRecovery<T>>;
    if (
      value.schemaVersion !== SCHEMA_VERSION ||
      !validIdentity(value.identity) ||
      typeof value.savedAt !== "number" ||
      typeof value.expiresAt !== "number" ||
      value.expiresAt <= now ||
      !Object.hasOwn(value, "snapshot")
    ) {
      safeRemove(storage, key);
      return null;
    }
    return {
      schemaVersion: SCHEMA_VERSION,
      identity: { ...value.identity },
      savedAt: value.savedAt,
      expiresAt: value.expiresAt,
      snapshot: value.snapshot as T
    };
  } catch {
    safeRemove(storage, key);
    return null;
  }
}

function validIdentity(
  value: Partial<ContractDraftRecoveryIdentity> | undefined
): value is ContractDraftRecoveryIdentity {
  return typeof value?.userId === "string" &&
    typeof value.deviceId === "string" &&
    typeof value.projectId === "string" &&
    typeof value.contractVersionId === "string" &&
    Number.isInteger(value.serverRevision) &&
    (value.serverRevision ?? -1) >= 0;
}

function sameScope(
  actual: ContractDraftRecoveryIdentity,
  expected: Pick<
    ContractDraftRecoveryIdentity,
    "userId" | "deviceId" | "projectId" | "contractVersionId"
  >
): boolean {
  return actual.userId === expected.userId &&
    actual.deviceId === expected.deviceId &&
    actual.projectId === expected.projectId &&
    actual.contractVersionId === expected.contractVersionId;
}

function safeRemove(storage: Storage, key: string): void {
  try {
    storage.removeItem(key);
  } catch {
    // Cleanup is best effort; a failed removal must not expose the recovery.
  }
}
