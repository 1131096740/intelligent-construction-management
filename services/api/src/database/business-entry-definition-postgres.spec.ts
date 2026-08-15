import { Prisma, PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";

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

  describeDatabase("live PostgreSQL constraints", () => {
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
