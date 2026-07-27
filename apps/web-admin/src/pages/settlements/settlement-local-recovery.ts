const SCHEMA_VERSION = 1;
export const SETTLEMENT_WORKBENCH_LOCAL_RECOVERY_TTL_MS = 7 * 24 * 60 * 60 * 1_000;

const DEVICE_KEY = `jg:settlement-workbench-device:v${SCHEMA_VERSION}`;
const RECOVERY_KEY_PREFIX = `jg:settlement-workbench-local-recovery:v${SCHEMA_VERSION}`;

export interface SettlementWorkbenchRecoveryIdentity {
  userId: string;
  deviceId: string;
  projectId: string;
  draftId: string;
  revision: number;
}

export interface SettlementWorkbenchLocalRecovery<T> {
  schemaVersion: 1;
  identity: SettlementWorkbenchRecoveryIdentity;
  savedAt: number;
  expiresAt: number;
  snapshot: T;
}

export function getSettlementWorkbenchDeviceId(storage: Storage): string | null {
  try {
    const current = storage.getItem(DEVICE_KEY)?.trim();
    if (current) return current;
    const deviceId = globalThis.crypto?.randomUUID?.() ?? `device-${Date.now()}-${Math.random()}`;
    storage.setItem(DEVICE_KEY, deviceId);
    return deviceId;
  } catch {
    return null;
  }
}

export function writeSettlementWorkbenchLocalRecovery<T>(
  storage: Storage,
  identity: SettlementWorkbenchRecoveryIdentity,
  snapshot: T,
  now = Date.now()
): boolean {
  const value: SettlementWorkbenchLocalRecovery<T> = {
    schemaVersion: SCHEMA_VERSION,
    identity: { ...identity },
    savedAt: now,
    expiresAt: now + SETTLEMENT_WORKBENCH_LOCAL_RECOVERY_TTL_MS,
    snapshot
  };
  try {
    storage.setItem(recoveryKey(identity), JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function readSettlementWorkbenchLocalRecovery<T>(
  storage: Storage,
  identity: SettlementWorkbenchRecoveryIdentity,
  now = Date.now()
): SettlementWorkbenchLocalRecovery<T> | null {
  const key = recoveryKey(identity);
  let raw: string | null;
  try {
    raw = storage.getItem(key);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<SettlementWorkbenchLocalRecovery<T>>;
    if (
      value.schemaVersion !== SCHEMA_VERSION ||
      !sameIdentity(value.identity, identity) ||
      typeof value.savedAt !== "number" ||
      typeof value.expiresAt !== "number" ||
      value.expiresAt <= now ||
      !("snapshot" in value)
    ) {
      safeRemove(storage, key);
      return null;
    }
    return {
      schemaVersion: SCHEMA_VERSION,
      identity: { ...identity },
      savedAt: value.savedAt,
      expiresAt: value.expiresAt,
      snapshot: value.snapshot as T
    };
  } catch {
    safeRemove(storage, key);
    return null;
  }
}

export function clearSettlementWorkbenchLocalRecovery(
  storage: Storage,
  identity: SettlementWorkbenchRecoveryIdentity
) {
  safeRemove(storage, recoveryKey(identity));
}

function recoveryKey(identity: SettlementWorkbenchRecoveryIdentity) {
  return [
    RECOVERY_KEY_PREFIX,
    identity.userId,
    identity.deviceId,
    identity.projectId,
    identity.draftId,
    String(identity.revision)
  ].map(encodeURIComponent).join(":");
}

function sameIdentity(
  actual: Partial<SettlementWorkbenchRecoveryIdentity> | undefined,
  expected: SettlementWorkbenchRecoveryIdentity
) {
  return actual?.userId === expected.userId &&
    actual.deviceId === expected.deviceId &&
    actual.projectId === expected.projectId &&
    actual.draftId === expected.draftId &&
    actual.revision === expected.revision;
}

function safeRemove(storage: Storage, key: string) {
  try { storage.removeItem(key); }
  catch { /* Local recovery cleanup is best effort. */ }
}
