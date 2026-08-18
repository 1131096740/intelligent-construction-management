import { Prisma } from "@prisma/client";
import { PrismaService } from "../database/prisma.service";
import { PrismaBusinessEntrySnapshotStore } from "./business-entry-definition.snapshot-store";
import { isBusinessEntryExistingTarget, type BusinessEntryFrozenSnapshot } from "@jiangkong/shared-domain";

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
  id: "snapshot-1",
  sceneKey: snapshot.sceneKey,
  entityType: snapshot.target.entityType,
  entityId: isBusinessEntryExistingTarget(snapshot.target) ? snapshot.target.entityId : "",
  revision: snapshot.revision,
  definitionVersion: snapshot.definitionVersion,
  definitionSnapshot: snapshot.definition,
  valuesSnapshot: snapshot.values,
  frozenAt: new Date(snapshot.frozenAt)
};

describe("PrismaBusinessEntrySnapshotStore", () => {
  function createTransactionalHarness(options?: { snapshotFailure?: Error }) {
    let committed = {
      projectName: "原始项目名称",
      snapshots: [] as typeof record[]
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (tx: Prisma.TransactionClient) => Promise<unknown>) => {
        const working = {
          projectName: committed.projectName,
          snapshots: [...committed.snapshots]
        };
        const tx = {
          project: {
            update: jest.fn(async ({ data }: { data: { name: string } }) => {
              working.projectName = data.name;
              return { id: "project-1", name: working.projectName };
            })
          },
          businessEntrySubmissionSnapshot: {
            findMany: jest.fn(async () => [...working.snapshots].reverse()),
            create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
              if (options?.snapshotFailure) throw options.snapshotFailure;
              const created = {
                ...record,
                ...data,
                definitionSnapshot: data.definitionSnapshot ?? record.definitionSnapshot,
                valuesSnapshot: data.valuesSnapshot ?? record.valuesSnapshot,
                frozenAt: data.frozenAt ?? record.frozenAt
              } as typeof record;
              working.snapshots.push(created);
              return created;
            })
          }
        } as unknown as Prisma.TransactionClient;
        const result = await callback(tx);
        committed = working;
        return result;
      })
    } as unknown as PrismaService;
    return {
      prisma,
      state: () => committed
    };
  }

  it("rolls back the formal snapshot when the caller's outer business transaction fails", async () => {
    const harness = createTransactionalHarness();
    const store = new PrismaBusinessEntrySnapshotStore(
      harness.prisma,
      { record: jest.fn() } as never,
      { updateProfileInTransaction: jest.fn() } as never
    );

    await expect(
      harness.prisma.$transaction(async (tx) => {
        await store.saveInTransaction(tx, "project-1", "user-1", snapshot);
        await tx.project.update({
          where: { id: "project-1" },
          data: { name: "外层业务写入" }
        });
        throw new Error("外层业务写入失败");
      })
    ).rejects.toThrow("外层业务写入失败");

    expect(harness.state()).toEqual({
      projectName: "原始项目名称",
      snapshots: []
    });
    expect(harness.prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it("rolls back the caller's formal business write when snapshot freezing fails", async () => {
    const harness = createTransactionalHarness({
      snapshotFailure: new Error("快照冻结失败")
    });
    const store = new PrismaBusinessEntrySnapshotStore(
      harness.prisma,
      { record: jest.fn() } as never,
      { updateProfileInTransaction: jest.fn() } as never
    );

    await expect(
      harness.prisma.$transaction(async (tx) => {
        await tx.project.update({
          where: { id: "project-1" },
          data: { name: "正式业务写入" }
        });
        await store.saveInTransaction(tx, "project-1", "user-1", snapshot);
      })
    ).rejects.toThrow("快照冻结失败");

    expect(harness.state()).toEqual({
      projectName: "原始项目名称",
      snapshots: []
    });
    expect(harness.prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it("keeps standalone freezing as an explicit legal path", async () => {
    const harness = createTransactionalHarness();
    const store = new PrismaBusinessEntrySnapshotStore(
      harness.prisma,
      { record: jest.fn() } as never,
      { updateProfileInTransaction: jest.fn() } as never
    );

    await expect(
      store.saveStandalone("project-1", "user-1", snapshot)
    ).resolves.toEqual(snapshot);

    expect(harness.state().snapshots).toHaveLength(1);
    expect(harness.prisma.$transaction).toHaveBeenCalledTimes(1);
  });

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

    const saved = await store.saveStandalone("project-1", "user-1", snapshot);

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

    await expect(store.saveStandalone("project-1", "user-2", snapshot)).resolves.toEqual(snapshot);
    await expect(
      store.saveStandalone("project-1", "user-2", {
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

    await expect(store.saveStandalone("project-1", "user-1", snapshot)).rejects.toThrow(
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

    await expect(store.saveStandalone("project-1", "user-1", snapshot)).resolves.toEqual(snapshot);
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

    await expect(store.saveStandalone("project-1", "user-1", snapshot, 2)).resolves.toMatchObject({
      revision: 3
    });
    expect(prisma.businessEntrySubmissionSnapshot.create).toHaveBeenCalledTimes(1);
  });
});
