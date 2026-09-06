import { Prisma, PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import {
  createBusinessEntryDefinitionRegistry,
  type BusinessEntryFrozenSnapshot,
  type BusinessEntrySceneDefinition
} from "@jiangkong/shared-domain";
import { PrismaService } from "../database/prisma.service";
import {
  BusinessEntrySnapshotConflictError,
  PrismaBusinessEntrySnapshotStore
} from "../business-entry-definition/business-entry-definition.snapshot-store";
import { BusinessEntryTransactionService } from "../business-entry-definition/business-entry-transaction.service";
import {
  createBusinessEntryTransactionSceneRegistry,
  type BusinessEntryOwnershipResolver
} from "../business-entry-definition/business-entry-transaction-scene-registry";

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

  const formalDefinition: BusinessEntrySceneDefinition = {
    key: "contract_formal_entry",
    entityType: "contract",
    name: "合同正式对象事务录入",
    description: "POL-19P3 PostgreSQL 事务契约测试。",
    version: 1,
    fields: [{
      key: "name",
      label: "合同名称",
      description: "合同名称。",
      example: "示例合同",
      type: "text",
      scope: "header",
      unit: "",
      precision: 0,
      required: true,
      permissions: { view: ["contract_staff"], edit: ["contract_staff"] },
      display: {
        formHint: "填写合同名称",
        gridColumn: "合同名称",
        mobilePriority: 1,
        readonlyText: "以冻结值为准"
      },
      excel: { column: "合同名称", paste: "single", errorLocation: "cell" },
      bulk: { enabled: false, strategy: "replace" }
    }],
    rules: []
  };

  const defaultOwnershipResolver: BusinessEntryOwnershipResolver = async ({ tx, target }) =>
    tx.contract.findMany({
      where: { id: target.entityId },
      select: { projectId: true },
      take: 2
    });

  const formalService = (
    resolveOwnership: BusinessEntryOwnershipResolver = defaultOwnershipResolver
  ) => new BusinessEntryTransactionService(
    createBusinessEntryDefinitionRegistry([formalDefinition]),
    createBusinessEntryTransactionSceneRegistry([{
      sceneKey: formalDefinition.key,
      targetKind: "project_owned_entity",
      entityType: formalDefinition.entityType,
      action: "contract.create",
      resolveOwnership,
      resolveAuthorization: async ({ tx, actorUserId }) => {
        const actor = await tx.user.findUnique({
          where: { id: actorUserId },
          select: { isActive: true }
        });
        return actor?.isActive ? ["contract_staff"] : [];
      }
    }]),
    snapshotStore()
  );

  const createFormalContext = async () => {
    const userId = randomUUID();
    const projectId = randomUUID();
    const contractId = randomUUID();
    await prisma.user.create({ data: { id: userId, name: "POL-19P3 动态测试用户" } });
    await prisma.project.create({
      data: { id: projectId, code: `POL19P3-${randomUUID()}`, name: "POL-19P3 动态测试项目" }
    });
    return { userId, projectId, contractId };
  };

  const formalInput = (target: { userId: string; projectId: string; contractId: string }, name: string) => ({
    sceneKey: formalDefinition.key,
    definitionVersion: formalDefinition.version,
    target: {
      projectId: target.projectId,
      entityType: formalDefinition.entityType,
      entityId: target.contractId
    },
    values: { name }
  });

  describeDatabase("live PostgreSQL constraints", () => {
    it("sees a transaction-local formal object and commits it with one immutable snapshot", async () => {
      const context = await createFormalContext();
      const service = formalService();

      const saved = await prisma.$transaction(async (tx) => {
        await tx.contract.create({
          data: {
            id: context.contractId,
            projectId: context.projectId,
            code: `POL19P3-C-${randomUUID()}`,
            name: "事务内合同",
            counterparty: "测试相对方"
          }
        });
        return service.freezeSubmissionSnapshotInTransaction(
          tx,
          context.userId,
          formalInput(context, "事务内合同")
        );
      });

      expect(saved.target).toEqual({
        projectId: context.projectId,
        entityType: "contract",
        entityId: context.contractId
      });
      await expect(prisma.businessEntrySubmissionSnapshot.count({
        where: { projectId: context.projectId, entityId: context.contractId }
      })).resolves.toBe(1);
    });

    it("rolls back both sides when either the domain write or formal snapshot fails", async () => {
      const domainFailure = await createFormalContext();
      const service = formalService();
      await expect(prisma.$transaction(async (tx) => {
        await tx.contract.create({
          data: {
            id: domainFailure.contractId,
            projectId: domainFailure.projectId,
            code: `POL19P3-C-${randomUUID()}`,
            name: "应回滚合同",
            counterparty: "测试相对方"
          }
        });
        await service.freezeSubmissionSnapshotInTransaction(
          tx,
          domainFailure.userId,
          formalInput(domainFailure, "应回滚合同")
        );
        throw new Error("领域写入失败");
      })).rejects.toThrow("领域写入失败");
      await expect(prisma.contract.count({ where: { id: domainFailure.contractId } }))
        .resolves.toBe(0);
      await expect(prisma.businessEntrySubmissionSnapshot.count({
        where: { projectId: domainFailure.projectId }
      })).resolves.toBe(0);

      const snapshotFailure = await createFormalContext();
      await prisma.contract.create({
        data: {
          id: snapshotFailure.contractId,
          projectId: snapshotFailure.projectId,
          code: `POL19P3-C-${randomUUID()}`,
          name: "原始合同",
          counterparty: "测试相对方"
        }
      });
      await prisma.$transaction((tx) => service.freezeSubmissionSnapshotInTransaction(
        tx,
        snapshotFailure.userId,
        formalInput(snapshotFailure, "原始合同")
      ));
      await expect(prisma.$transaction(async (tx) => {
        await tx.contract.update({
          where: { id: snapshotFailure.contractId },
          data: { name: "不应提交的合同变更" }
        });
        await service.freezeSubmissionSnapshotInTransaction(
          tx,
          snapshotFailure.userId,
          formalInput(snapshotFailure, "冲突合同")
        );
      })).rejects.toBeInstanceOf(BusinessEntrySnapshotConflictError);
      await expect(prisma.contract.findUniqueOrThrow({
        where: { id: snapshotFailure.contractId }
      })).resolves.toMatchObject({ name: "原始合同" });
    });

    it("keeps invalid submission at zero writes and converges repeated/concurrent freezes", async () => {
      const invalid = await createFormalContext();
      const service = formalService();
      await expect(prisma.$transaction(async (tx) => {
        await tx.contract.create({
          data: {
            id: invalid.contractId,
            projectId: invalid.projectId,
            code: `POL19P3-C-${randomUUID()}`,
            name: "无效合同",
            counterparty: "测试相对方"
          }
        });
        await service.freezeSubmissionSnapshotInTransaction(
          tx,
          invalid.userId,
          { ...formalInput(invalid, "无效合同"), definitionVersion: 99 }
        );
      })).rejects.toThrow();
      await expect(prisma.contract.count({ where: { id: invalid.contractId } })).resolves.toBe(0);
      await expect(prisma.businessEntrySubmissionSnapshot.count({
        where: { projectId: invalid.projectId }
      })).resolves.toBe(0);

      const concurrent = await createFormalContext();
      await prisma.contract.create({
        data: {
          id: concurrent.contractId,
          projectId: concurrent.projectId,
          code: `POL19P3-C-${randomUUID()}`,
          name: "并发合同",
          counterparty: "测试相对方"
        }
      });
      const input = formalInput(concurrent, "并发合同");
      let secondResolutionArrivals = 0;
      let releaseSecondResolution!: () => void;
      const secondResolutionGate = new Promise<void>((resolve) => {
        releaseSecondResolution = resolve;
      });
      const callsByTransaction = new WeakMap<object, number>();
      const barrierOwnershipResolver: BusinessEntryOwnershipResolver = async (resolverContext) => {
        const rows = await defaultOwnershipResolver(resolverContext);
        const transactionKey = resolverContext.tx as object;
        const calls = (callsByTransaction.get(transactionKey) ?? 0) + 1;
        callsByTransaction.set(transactionKey, calls);
        if (calls === 2) {
          secondResolutionArrivals += 1;
          if (secondResolutionArrivals === 2) releaseSecondResolution();
          await secondResolutionGate;
        }
        return rows;
      };
      const concurrentService = formalService(barrierOwnershipResolver);
      const results = await Promise.allSettled([
        prisma.$transaction((tx) => concurrentService.freezeSubmissionSnapshotInTransaction(
          tx,
          concurrent.userId,
          input
        )),
        prisma.$transaction((tx) => concurrentService.freezeSubmissionSnapshotInTransaction(
          tx,
          concurrent.userId,
          input
        ))
      ]);
      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
      await expect(prisma.businessEntrySubmissionSnapshot.count({
        where: { projectId: concurrent.projectId, entityId: concurrent.contractId }
      })).resolves.toBe(1);
      await expect(prisma.$transaction((tx) => service.freezeSubmissionSnapshotInTransaction(
        tx,
        concurrent.userId,
        input
      ))).resolves.toMatchObject({ revision: 1 });
    });

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
