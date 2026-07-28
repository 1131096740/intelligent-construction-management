import { describe, expect, it } from "vitest";
import {
  CONTRACT_DRAFT_LOCAL_RECOVERY_TTL_MS,
  clearContractDraftLocalRecoveriesForUser,
  clearContractDraftLocalRecoveryScope,
  findContractDraftLocalRecovery,
  getContractDraftDeviceId,
  sanitizeContractDraftRecoverySnapshot,
  writeContractDraftLocalRecovery,
  type ContractDraftRecoveryIdentity
} from "./contract-draft-local-recovery";

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => map.set(key, value),
    removeItem: (key) => map.delete(key),
    clear: () => map.clear(),
    key: (index) => Array.from(map.keys())[index] ?? null
  };
}

const identity: ContractDraftRecoveryIdentity = {
  userId: "user-1",
  deviceId: "device-1",
  projectId: "project-1",
  contractVersionId: "version-1",
  serverRevision: 7
};

describe("contract draft local recovery", () => {
  it("isolates copies by account, device, project, version and server revision", () => {
    const storage = memoryStorage();
    writeContractDraftLocalRecovery(storage, identity, { contractName: "本机草稿" }, 1_000);

    expect(findContractDraftLocalRecovery(storage, identity, 1_001)).toMatchObject({
      revisionMatches: true,
      recovery: {
        identity,
        snapshot: { contractName: "本机草稿" }
      }
    });
    expect(findContractDraftLocalRecovery(storage, {
      ...identity,
      userId: "user-2"
    }, 1_001)).toBeNull();
    expect(findContractDraftLocalRecovery(storage, {
      ...identity,
      deviceId: "device-2"
    }, 1_001)).toBeNull();
    expect(findContractDraftLocalRecovery(storage, {
      ...identity,
      projectId: "project-2"
    }, 1_001)).toBeNull();
    expect(findContractDraftLocalRecovery(storage, {
      ...identity,
      contractVersionId: "version-2"
    }, 1_001)).toBeNull();
  });

  it("returns an older revision only for explicit comparison and never as a match", () => {
    const storage = memoryStorage();
    writeContractDraftLocalRecovery(storage, identity, { contractName: "旧修订输入" }, 1_000);

    const found = findContractDraftLocalRecovery(storage, {
      ...identity,
      serverRevision: 8
    }, 1_001);

    expect(found).toMatchObject({
      revisionMatches: false,
      recovery: {
        identity: { serverRevision: 7 },
        snapshot: { contractName: "旧修订输入" }
      }
    });
  });

  it("expires after 24 hours and removes the stale copy", () => {
    const storage = memoryStorage();
    writeContractDraftLocalRecovery(storage, identity, { contractName: "会过期" }, 1_000);

    expect(findContractDraftLocalRecovery(
      storage,
      identity,
      1_000 + CONTRACT_DRAFT_LOCAL_RECOVERY_TTL_MS
    )).toBeNull();
    expect(storage.length).toBe(0);
  });

  it("removes lease, password, bytes and private object locations recursively", () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const sanitized = sanitizeContractDraftRecoverySnapshot({
      contractName: "安全副本",
      leaseToken: "lease-secret",
      currentPassword: "password-secret",
      attachment: {
        fileId: "file-1",
        bytes,
        signedUrl: "https://private.example/signed",
        downloadUrl: "https://private.example/download",
        cosKey: "private/object-key",
        objectKey: "private/object-key-2"
      },
      nested: [{ accessToken: "access-secret", value: "保留" }]
    });
    const encoded = JSON.stringify(sanitized);

    expect(encoded).toContain("安全副本");
    expect(encoded).toContain("file-1");
    expect(encoded).toContain("保留");
    expect(encoded).not.toContain("secret");
    expect(encoded).not.toContain("private.example");
    expect(encoded).not.toContain("object-key");
    expect(encoded).not.toContain("1,2,3");
  });

  it("clears a version scope on save and all user copies on logout", () => {
    const storage = memoryStorage();
    writeContractDraftLocalRecovery(storage, identity, { value: 1 }, 1_000);
    writeContractDraftLocalRecovery(storage, {
      ...identity,
      serverRevision: 8
    }, { value: 2 }, 2_000);
    writeContractDraftLocalRecovery(storage, {
      ...identity,
      contractVersionId: "version-2"
    }, { value: 3 }, 3_000);

    clearContractDraftLocalRecoveryScope(storage, identity);
    expect(findContractDraftLocalRecovery(storage, identity, 3_001)).toBeNull();
    expect(findContractDraftLocalRecovery(storage, {
      ...identity,
      contractVersionId: "version-2"
    }, 3_001)).not.toBeNull();

    clearContractDraftLocalRecoveriesForUser(storage, "user-1");
    expect(storage.length).toBe(0);
  });

  it("uses a stable per-browser device id without storing draft secrets", () => {
    const storage = memoryStorage();
    const first = getContractDraftDeviceId(storage);
    const second = getContractDraftDeviceId(storage);

    expect(first).toBeTruthy();
    expect(second).toBe(first);
    expect(Array.from({ length: storage.length }, (_, index) => storage.key(index)))
      .toHaveLength(1);
  });
});
