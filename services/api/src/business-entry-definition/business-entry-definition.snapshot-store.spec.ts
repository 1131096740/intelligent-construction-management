import { Prisma } from "@prisma/client";
import { PrismaService } from "../database/prisma.service";
import { PrismaBusinessEntrySnapshotStore } from "./business-entry-definition.snapshot-store";
import type { BusinessEntryFrozenSnapshot } from "@jiangkong/shared-domain";

const snapshot: BusinessEntryFrozenSnapshot = {
  sceneKey: "project_operating_profile",
  target: { entityType: "project", entityId: "project-1" },
  revision: 1,
  definitionVersion: 1,
  definition: {
    key: "project_operating_profile",
    entityType: "project",
    name: "项目经营档案",
    description: "受控项目经营档案",
    version: 1,
    fields: [],
    rules: []
  },
  values: { takeoverStatus: "operating_with_takeover" },
  frozenAt: "2026-08-16T10:00:00.000Z"
};

const record = {
  sceneKey: snapshot.sceneKey,
  entityType: snapshot.target.entityType,
  entityId: snapshot.target.entityId,
  revision: snapshot.revision,
  definitionVersion: snapshot.definitionVersion,
  definitionSnapshot: snapshot.definition,
  valuesSnapshot: snapshot.values,
  frozenAt: new Date(snapshot.frozenAt)
};

describe("PrismaBusinessEntrySnapshotStore", () => {
  it("persists one immutable snapshot per formal business target", async () => {
    const audit = { record: jest.fn() };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(prisma)),
      businessEntrySubmissionSnapshot: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue(record)
      }
    } as unknown as PrismaService;
    const operatingProfiles = { updateProfileInTransaction: jest.fn() };
    const store = new PrismaBusinessEntrySnapshotStore(
      prisma,
      audit as never,
      operatingProfiles as never
    );

    const saved = await store.save("project-1", "user-1", snapshot);

    expect(prisma.businessEntrySubmissionSnapshot.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          projectId: "project-1",
          entityType: "project",
          entityId: "project-1",
          frozenByUserId: "user-1"
        })
      })
    );
    expect(operatingProfiles.updateProfileInTransaction).toHaveBeenCalledWith(
      expect.anything(),
      "project-1",
      "user-1",
      { takeoverStatus: "operating_with_takeover" }
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: "business_entry.freeze" })
    );
    expect(saved).toEqual(snapshot);
  });

  it("returns the stored snapshot on retry and creates a new revision for a different payload", async () => {
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(prisma)),
      businessEntrySubmissionSnapshot: {
        findMany: jest.fn().mockResolvedValue([record]),
        create: jest.fn().mockResolvedValue({
          ...record,
          revision: 2,
          valuesSnapshot: { takeoverStatus: "takeover_completed" }
        })
      }
    } as unknown as PrismaService;
    const store = new PrismaBusinessEntrySnapshotStore(
      prisma,
      { record: jest.fn() } as never,
      { updateProfileInTransaction: jest.fn() } as never
    );

    await expect(store.save("project-1", "user-2", snapshot)).resolves.toEqual(snapshot);
    await expect(
      store.save("project-1", "user-2", {
        ...snapshot,
        values: { takeoverStatus: "takeover_completed" }
      }, 1)
    ).resolves.toMatchObject({ revision: 2 });
    expect(prisma.businessEntrySubmissionSnapshot.create).toHaveBeenCalledTimes(1);
  });

  it("does not disguise non-unique database failures as an idempotent retry", async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(prisma)),
      businessEntrySubmissionSnapshot: {
        findMany,
        create: jest.fn().mockRejectedValue(new Error("database unavailable"))
      }
    } as unknown as PrismaService;
    const store = new PrismaBusinessEntrySnapshotStore(
      prisma,
      { record: jest.fn() } as never,
      { updateProfileInTransaction: jest.fn() } as never
    );

    await expect(store.save("project-1", "user-1", snapshot)).rejects.toThrow(
      "database unavailable"
    );
    expect(findMany).toHaveBeenCalledTimes(1);
  });

  it("recognizes Prisma composite-unique field-array metadata during a concurrent retry", async () => {
    const findMany = jest.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([record]);
    const prismaError = new Prisma.PrismaClientKnownRequestError("unique", {
      code: "P2002",
      clientVersion: "5.22.0",
      meta: {
        target: ["projectId", "sceneKey", "entityType", "entityId", "revision"]
      }
    });
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(prisma)),
      businessEntrySubmissionSnapshot: {
        findMany,
        create: jest.fn().mockRejectedValue(prismaError)
      }
    } as unknown as PrismaService;
    const store = new PrismaBusinessEntrySnapshotStore(
      prisma,
      { record: jest.fn() } as never,
      { updateProfileInTransaction: jest.fn() } as never
    );

    await expect(store.save("project-1", "user-1", snapshot)).resolves.toEqual(snapshot);
    expect(findMany).toHaveBeenCalledTimes(2);
  });

  it("does not return a matching historical revision when the current revision differs", async () => {
    const historical = { ...record, revision: 1, valuesSnapshot: snapshot.values };
    const current = {
      ...record,
      revision: 2,
      valuesSnapshot: { takeoverStatus: "takeover_completed" }
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(prisma)),
      businessEntrySubmissionSnapshot: {
        findMany: jest.fn().mockResolvedValue([current, historical]),
        create: jest.fn().mockResolvedValue({ ...record, revision: 3 })
      }
    } as unknown as PrismaService;
    const store = new PrismaBusinessEntrySnapshotStore(
      prisma,
      { record: jest.fn() } as never,
      { updateProfileInTransaction: jest.fn() } as never
    );

    await expect(store.save("project-1", "user-1", snapshot, 2)).resolves.toMatchObject({
      revision: 3
    });
    expect(prisma.businessEntrySubmissionSnapshot.create).toHaveBeenCalledTimes(1);
  });
});
