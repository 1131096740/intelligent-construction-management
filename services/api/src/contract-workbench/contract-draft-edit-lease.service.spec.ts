import {
  ConflictException,
  ForbiddenException
} from "@nestjs/common";
import { createHash } from "node:crypto";
import {
  CONTRACT_DRAFT_LEASE_TTL_MS,
  ContractDraftEditLeaseService
} from "./contract-draft-edit-lease.service";

describe("ContractDraftEditLeaseService", () => {
  let lease: Record<string, unknown> | null;
  let now: Date;
  let ownerUserId: string;
  let director: boolean;

  const audit = { record: jest.fn().mockResolvedValue({ id: "audit-1" }) };
  const auth = { confirmPassword: jest.fn().mockResolvedValue({ ok: true }) };
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([{ id: "cv-1" }]),
    contractVersion: {
      findUnique: jest.fn().mockResolvedValue({
        id: "cv-1",
        contractId: "contract-1",
        status: "draft"
      })
    },
    contract: {
      findUnique: jest.fn().mockImplementation(async () => ({
        id: "contract-1",
        ownerUserId,
        voidedAt: null
      }))
    },
    contractDraftEditLease: {
      findUnique: jest.fn().mockImplementation(async () => lease),
      upsert: jest.fn().mockImplementation(async ({ create, update }: {
        create: Record<string, unknown>;
        update: Record<string, unknown>;
      }) => {
        lease = lease ? { ...lease, ...update } : { ...create };
        return lease;
      }),
      updateMany: jest.fn().mockImplementation(async ({ where, data }: {
        where: { tokenHash: string; expiresAt: { gt: Date } };
        data: Record<string, unknown>;
      }) => {
        if (
          !lease ||
          lease.tokenHash !== where.tokenHash ||
          (lease.expiresAt as Date).getTime() <= where.expiresAt.gt.getTime()
        ) {
          return { count: 0 };
        }
        lease = { ...lease, ...data };
        return { count: 1 };
      }),
      deleteMany: jest.fn().mockImplementation(async ({ where }: {
        where: { tokenHash: string };
      }) => {
        const matched = lease?.tokenHash === where.tokenHash;
        if (matched) lease = null;
        return { count: matched ? 1 : 0 };
      })
    },
    userPosition: {
      findMany: jest.fn().mockImplementation(async () =>
        director ? [{ positionId: "contract-director" }] : []
      )
    },
    position: {
      findMany: jest.fn().mockResolvedValue([
        { id: "contract-director", key: "contract_director" }
      ])
    },
    auditLog: {
      create: jest.fn()
    }
  };
  const prisma = {
    ...tx,
    $transaction: jest.fn(
      async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)
    )
  };

  function service() {
    return new ContractDraftEditLeaseService(
      prisma as never,
      auth as never,
      audit as never,
      () => new Date(now)
    );
  }

  beforeEach(() => {
    lease = null;
    now = new Date("2026-07-28T10:00:00.000Z");
    ownerUserId = "owner-1";
    director = false;
    jest.clearAllMocks();
  });

  it("returns a raw token once but stores only its SHA-256 hash", async () => {
    const result = await service().acquire("cv-1", "owner-1");
    const storedHash = lease?.tokenHash as string;

    expect(result.token).toBeTruthy();
    expect(storedHash).toBe(
      createHash("sha256").update(result.token).digest("hex")
    );
    expect(JSON.stringify(lease)).not.toContain(result.token);
    expect((lease?.expiresAt as Date).getTime() - now.getTime()).toBe(
      CONTRACT_DRAFT_LEASE_TTL_MS
    );
  });

  it("heartbeats the same token without increasing leaseRevision", async () => {
    const acquired = await service().acquire("cv-1", "owner-1");
    const revision = lease?.leaseRevision;
    now = new Date("2026-07-28T10:00:30.000Z");

    await service().heartbeat("cv-1", acquired.token);

    expect(lease?.leaseRevision).toBe(revision);
    expect(lease?.heartbeatAt).toEqual(now);
  });

  it("does not let another user silently acquire the active owner lease", async () => {
    await service().acquire("cv-1", "owner-1");
    ownerUserId = "owner-1";

    await expect(service().acquire("cv-1", "other-1")).rejects.toBeInstanceOf(
      ForbiddenException
    );
  });

  it("lets a contract director take over and invalidates the old token", async () => {
    const oldLease = await service().acquire("cv-1", "owner-1");
    director = true;

    const replacement = await service().takeOver("cv-1", "director-1", {
      currentPassword: "current-password"
    });

    expect(replacement.token).not.toBe(oldLease.token);
    await expect(
      service().heartbeat("cv-1", oldLease.token)
    ).rejects.toBeInstanceOf(ConflictException);
    expect(auth.confirmPassword).toHaveBeenCalledWith(
      "director-1",
      "current-password"
    );
  });

  it("lets the owner acquire again after natural expiry", async () => {
    const first = await service().acquire("cv-1", "owner-1");
    now = new Date("2026-07-28T10:02:01.000Z");

    const second = await service().acquire("cv-1", "owner-1");

    expect(second.token).not.toBe(first.token);
    expect(second.leaseRevision).toBe(2);
  });

  it("never writes the raw token or token hash into takeover audit metadata", async () => {
    await service().acquire("cv-1", "owner-1");
    director = true;
    const replacement = await service().takeOver("cv-1", "director-1", {
      currentPassword: "current-password"
    });

    const auditInput = audit.record.mock.calls.at(-1)?.[1];
    expect(JSON.stringify(auditInput)).not.toContain(replacement.token);
    expect(JSON.stringify(auditInput)).not.toContain(lease?.tokenHash);
  });
});
