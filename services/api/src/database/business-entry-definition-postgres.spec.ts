import { Prisma, PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import type { BusinessEntryFrozenSnapshot } from "@jiangkong/shared-domain";
import { PrismaService } from "../database/prisma.service";
import {
  BusinessEntrySnapshotConflictError,
  PrismaBusinessEntrySnapshotStore
} from "../business-entry-definition/business-entry-definition.snapshot-store";

const TEST_DATABASE = "jiangkong_database_dynamic_misc";
const LIVE_TEST_ENABLED = process.env.RUN_PROJECT_OPERATING_PROFILE_DB_TESTS === "1";

function localDatabaseUrl(value: string | undefined) {
  if (!value || process.env.NODE_ENV === "production") {
    throw new Error("业务字段定义数据库测试必须连接非生产专用数据库");
  }
  const url = new URL(value);
  if (
    !["postgresql:", "postgres:"].includes(url.protocol) ||
    !["127.0.0.1", "localhost", "::1"].includes(url.hostname) ||
    url.pathname !== `/${TEST_DATABASE}`
  ) {
    throw new Error("业务字段定义数据库测试拒绝非本机专用数据库");
  }
  return url.toString();
}

const databaseUrl = LIVE_TEST_ENABLED
  ? localDatabaseUrl(process.env.DATABASE_URL)
  : undefined;
const describeDatabase = LIVE_TEST_ENABLED ? describe : describe.skip;

describe("business entry definition PostgreSQL invariants", () => {
  const prisma = databaseUrl
    ? new PrismaClient({ datasources: { db: { url: databaseUrl } } })
    : new PrismaClient();

  jest.setTimeout(15_000);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const createSnapshot = async (tx: Prisma.TransactionClient) => {
    const userId = randomUUID();
    const projectId = randomUUID();
    await tx.user.create({ data: { id: userId, name: "POL-17 动态测试用户" } });
    await tx.project.create({
      data: { id: projectId, code: `POL17-${randomUUID()}`, name: "POL-17 动态测试项目" }
    });
    return {
      id: randomUUID(),
      projectId,
      sceneKey: "project_operating_profile",
      entityType: "project",
      entityId: projectId,
      revision: 1,
      definitionVersion: 1,
      definitionSnapshot: { key: "project_operating_profile", version: 1 },
      valuesSnapshot: { takeoverStatus: "operating_with_takeover" },
      frozenAt: new Date("2026-08-16T00:00:00.000Z"),
      frozenByUserId: userId
    };
  };

  const createFrozenSnapshotTarget = async () => {
    const userId = randomUUID();
    const projectId = randomUUID();
    const projectName = `POL-19P2 事务原子性项目 ${randomUUID()}`;
    await prisma.user.create({ data: { id: userId, name: "POL-19P2 动态测试用户" } });
    await prisma.project.create({
      data: { id: projectId, code: `POL19P2-${randomUUID()}`, name: projectName }
    });
    const snapshot: BusinessEntryFrozenSnapshot = {
      sceneKey: "project_operating_profile",
      target: { entityType: "project", entityId: projectId },
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
      frozenAt: "2026-08-17T00:00:00.000Z"
    };
    return { userId, projectId, projectName, snapshot };
  };

  const snapshotStore = () => new PrismaBusinessEntrySnapshotStore(
    prisma as unknown as PrismaService,
    { record: jest.fn() } as never,
    { updateProfileInTransaction: jest.fn() } as never
  );

  describeDatabase("live PostgreSQL constraints", () => {
    it("rolls back a joined snapshot when the caller's outer business write fails", async () => {
      const target = await createFrozenSnapshotTarget();
      const store = snapshotStore();

      await expect(
        prisma.$transaction(async (tx) => {
          await store.saveInTransaction(
            tx,
            target.projectId,
            target.userId,
            target.snapshot
          );
          await tx.project.update({
            where: { id: target.projectId },
            data: { name: "不应提交的外层业务写入" }
          });
          throw new Error("外层业务写入失败");
        })
      ).rejects.toThrow("外层业务写入失败");

      await expect(
        prisma.businessEntrySubmissionSnapshot.count({
          where: { projectId: target.projectId }
        })
      ).resolves.toBe(0);
      await expect(
        prisma.project.findUniqueOrThrow({ where: { id: target.projectId } })
      ).resolves.toMatchObject({ name: target.projectName });
    });

    it("rolls back the caller's formal write when joined snapshot freezing fails", async () => {
      const target = await createFrozenSnapshotTarget();
      const store = snapshotStore();
      await store.saveStandalone(
        target.projectId,
        target.userId,
        target.snapshot
      );

      await expect(
        prisma.$transaction(async (tx) => {
          await tx.project.update({
            where: { id: target.projectId },
            data: { name: "不应留下的正式业务写入" }
          });
          await store.saveInTransaction(
            tx,
            target.projectId,
            target.userId,
            {
              ...target.snapshot,
              values: { takeoverStatus: "takeover_completed" }
            }
          );
        })
      ).rejects.toBeInstanceOf(BusinessEntrySnapshotConflictError);

      await expect(
        prisma.project.findUniqueOrThrow({ where: { id: target.projectId } })
      ).resolves.toMatchObject({ name: target.projectName });
      await expect(
        prisma.businessEntrySubmissionSnapshot.count({
          where: { projectId: target.projectId }
        })
      ).resolves.toBe(1);
    });

    it("keeps explicit standalone snapshot freezing legal", async () => {
      const target = await createFrozenSnapshotTarget();

      await expect(
        snapshotStore().saveStandalone(
          target.projectId,
          target.userId,
          target.snapshot
        )
      ).resolves.toMatchObject({
        sceneKey: "project_operating_profile",
        target: { entityType: "project", entityId: target.projectId },
        revision: 1
      });
      await expect(
        prisma.businessEntrySubmissionSnapshot.count({
          where: { projectId: target.projectId }
        })
      ).resolves.toBe(1);
    });

    it("enforces target revision uniqueness and both formal-object foreign keys", async () => {
      await expect(
        prisma.$transaction(async (tx) => {
          const snapshot = await createSnapshot(tx);
          await tx.businessEntrySubmissionSnapshot.create({ data: snapshot });
          await tx.businessEntrySubmissionSnapshot.create({
            data: { ...snapshot, id: randomUUID() }
          });
        })
      ).rejects.toMatchObject({ code: "P2002" });

      await expect(
        prisma.$transaction(async (tx) => {
          const snapshot = await createSnapshot(tx);
          await tx.businessEntrySubmissionSnapshot.create({
            data: { ...snapshot, id: randomUUID(), frozenByUserId: randomUUID() }
          });
        })
      ).rejects.toMatchObject({ code: "P2003" });

      await expect(
        prisma.$transaction(async (tx) => {
          const snapshot = await createSnapshot(tx);
          const invalidProjectId = randomUUID();
          await tx.businessEntrySubmissionSnapshot.create({
            data: {
              ...snapshot,
              id: randomUUID(),
              projectId: invalidProjectId,
              entityId: invalidProjectId
            }
          });
        })
      ).rejects.toMatchObject({ code: "P2003" });

      await expect(
        prisma.$transaction(async (tx) => {
          const snapshot = await createSnapshot(tx);
          await tx.businessEntrySubmissionSnapshot.create({
            data: { ...snapshot, id: randomUUID(), entityId: randomUUID() }
          });
        })
      ).rejects.toThrow("BusinessEntrySubmissionSnapshot_project_target_check");

      await expect(
        prisma.$transaction(async (tx) => {
          const snapshot = await createSnapshot(tx);
          await tx.businessEntrySubmissionSnapshot.create({
            data: { ...snapshot, id: randomUUID(), revision: 0 }
          });
        })
      ).rejects.toThrow("BusinessEntrySubmissionSnapshot_project_target_check");

      await expect(
        prisma.$transaction(async (tx) => {
          const snapshot = await createSnapshot(tx);
          await tx.businessEntrySubmissionSnapshot.create({
            data: { ...snapshot, id: randomUUID(), definitionVersion: 0 }
          });
        })
      ).rejects.toThrow("BusinessEntrySubmissionSnapshot_project_target_check");
    });

    it("rejects update and delete attempts against an immutable snapshot", async () => {
      await expect(
        prisma.$transaction(async (tx) => {
          const snapshot = await createSnapshot(tx);
          await tx.businessEntrySubmissionSnapshot.create({ data: snapshot });
          await tx.businessEntrySubmissionSnapshot.update({
            where: { id: snapshot.id },
            data: { valuesSnapshot: { takeoverStatus: "takeover_completed" } }
          });
        })
      ).rejects.toThrow("business_entry_submission_snapshot_immutable");

      await expect(
        prisma.$transaction(async (tx) => {
          const snapshot = await createSnapshot(tx);
          await tx.businessEntrySubmissionSnapshot.create({ data: snapshot });
          await tx.businessEntrySubmissionSnapshot.delete({ where: { id: snapshot.id } });
        })
      ).rejects.toThrow("business_entry_submission_snapshot_immutable");

      await expect(
        prisma.$transaction(async (tx) => {
          const snapshot = await createSnapshot(tx);
          await tx.businessEntrySubmissionSnapshot.create({ data: snapshot });
          await tx.$executeRawUnsafe('TRUNCATE TABLE "BusinessEntrySubmissionSnapshot"');
        })
      ).rejects.toThrow("business_entry_submission_snapshot_immutable");
    });
  });
});
