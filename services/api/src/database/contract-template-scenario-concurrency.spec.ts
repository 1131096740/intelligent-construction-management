import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { Prisma, PrismaClient } from "@prisma/client";
import { AuditService } from "../audit/audit.service";
import { ContractScenarioService } from "../contract-template/contract-scenario.service";
import { ContractTemplateService } from "../contract-template/contract-template.service";

type CommandResult = { stdout: string; stderr: string };
type DockerCommandOptions = {
  extraEnv?: Record<string, string>;
  forwardOutput?: boolean;
  timeoutMs?: number;
};
type DockerCommand = (
  args: string[],
  options?: DockerCommandOptions
) => Promise<CommandResult>;

const localRequire = createRequire(__filename);
const {
  createControlledDockerEnv,
  createDockerCommand
} = localRequire(
  "../../prisma/run-contract-template-scenario-concurrency-local.cjs"
) as {
  createControlledDockerEnv: (
    sourceEnv: NodeJS.ProcessEnv,
    fallbackHome: string
  ) => Record<string, string>;
  createDockerCommand: (
    dockerEnv: Record<string, string>,
    runCommand?: (
      commandName: string,
      args: string[],
      options?: Record<string, unknown>
    ) => Promise<CommandResult>,
    dockerBinary?: string
  ) => DockerCommand;
};

const TEST_DATABASE = "jiangkong_contract_template_scenario_concurrency";
const LIVE_TEST_ENABLED =
  process.env.RUN_CONTRACT_TEMPLATE_SCENARIO_CONCURRENCY === "1";

type Deferred<T> = {
  promise: Promise<T>;
  resolve(value: T | PromiseLike<T>): void;
};

type LockActivity = {
  state: string | null;
  waitEventType: string | null;
  waitEvent: string | null;
  query: string | null;
  blockingPids: number[];
};

type Fixture = {
  actorId: string;
  positionId: string;
  templateId: string;
  versionId: string;
  scenarioId: string;
  mappingId: string;
};

type MappingOperation = "create" | "reactivate";

export function contractTemplateScenarioDatabaseUrl(value: string | undefined) {
  if (!value || process.env.NODE_ENV === "production") {
    throw new Error(
      "合同模板场景并发测试必须连接非生产专用数据库"
    );
  }
  const url = new URL(value);
  if (
    !["postgresql:", "postgres:"].includes(url.protocol) ||
    !["127.0.0.1", "localhost", "::1"].includes(url.hostname) ||
    url.pathname !== `/${TEST_DATABASE}`
  ) {
    throw new Error(
      "合同模板场景并发测试拒绝非本机或非专用数据库"
    );
  }
  return url.toString();
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

function isBusinessTemplateVersionLock(query: Prisma.Sql) {
  const text = query.strings.join(" ");
  return (
    text.includes('FROM "ContractBusinessTemplateVersion"') &&
    text.includes("FOR UPDATE")
  );
}

function transactionHarness(
  client: PrismaClient,
  options: {
    backendPid?: Deferred<number>;
    locked?: Deferred<void>;
    release?: Promise<void>;
  }
) {
  return {
    $transaction: <T>(
      work: (tx: Prisma.TransactionClient) => Promise<T>,
      transactionOptions?: {
        isolationLevel?: Prisma.TransactionIsolationLevel;
      }
    ) =>
      client.$transaction(async (tx) => {
        await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '8s'");
        await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '12s'");
        const [backend] = await tx.$queryRaw<Array<{ pid: number }>>(
          Prisma.sql`SELECT pg_backend_pid()::int AS "pid"`
        );
        if (!backend) {
          throw new Error("无法读取 PostgreSQL 事务连接 PID");
        }
        options.backendPid?.resolve(backend.pid);

        const queryRaw = tx.$queryRaw.bind(tx) as (
          query: Prisma.Sql
        ) => Promise<unknown>;
        let paused = false;
        const instrumented = new Proxy(tx, {
          get(target, property, receiver) {
            if (property !== "$queryRaw") {
              return Reflect.get(target, property, receiver);
            }
            return async (query: Prisma.Sql) => {
              const result = await queryRaw(query);
              if (
                !paused &&
                options.locked &&
                options.release &&
                isBusinessTemplateVersionLock(query)
              ) {
                paused = true;
                options.locked.resolve(undefined);
                await options.release;
              }
              return result;
            };
          }
        }) as Prisma.TransactionClient;
        return work(instrumented);
      }, transactionOptions)
  };
}

async function waitForPostgresLock(
  observer: PrismaClient,
  backendPid: number,
  expectedBlockerPid: number,
  timeoutMs = 8_000
) {
  const deadline = Date.now() + timeoutMs;
  let lastActivity: LockActivity | null = null;
  while (Date.now() < deadline) {
    const [activity] = await observer.$queryRaw<LockActivity[]>(Prisma.sql`
      SELECT
        "state",
        "wait_event_type" AS "waitEventType",
        "wait_event" AS "waitEvent",
        "query",
        pg_blocking_pids("pid")::int[] AS "blockingPids"
      FROM "pg_stat_activity"
      WHERE "pid" = ${backendPid}
    `);
    lastActivity = activity ?? null;
    if (
      activity?.waitEventType === "Lock" &&
      activity.blockingPids.length === 1 &&
      activity.blockingPids[0] === expectedBlockerPid
    ) {
      return activity;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(
    "第二事务未被第一事务直接阻塞：" +
      JSON.stringify({ backendPid, expectedBlockerPid, lastActivity })
  );
}

async function proveContendedLocksReleased(
  observer: PrismaClient,
  ids: Fixture
) {
  await withTimeout(
    observer.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '1s'");
      await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '3s'");
      await tx.$queryRaw(Prisma.sql`
        SELECT "id"
        FROM "ContractBusinessTemplate"
        WHERE "id" = ${ids.templateId}
        FOR UPDATE
      `);
      await tx.$queryRaw(Prisma.sql`
        SELECT "id"
        FROM "ContractBusinessTemplateVersion"
        WHERE "id" = ${ids.versionId}
        FOR UPDATE
      `);
      await tx.$queryRaw(Prisma.sql`
        SELECT "id"
        FROM "ContractBusinessScenario"
        WHERE "id" = ${ids.scenarioId}
        FOR UPDATE
      `);
      await tx.$queryRaw(Prisma.sql`
        SELECT "id"
        FROM "ContractScenarioTemplateMapping"
        WHERE "businessTemplateVersionId" = ${ids.versionId}
        ORDER BY "id"
        FOR UPDATE
      `);
    }),
    4_000,
    "冲突事务结束后模板版本或映射行锁未在时限内释放"
  );
}

function fixture(): Fixture {
  const suffix = randomUUID();
  return {
    actorId: `template-concurrency-actor-${suffix}`,
    positionId: `template-concurrency-position-${suffix}`,
    templateId: `template-concurrency-template-${suffix}`,
    versionId: `template-concurrency-version-${suffix}`,
    scenarioId: `template-concurrency-scenario-${suffix}`,
    mappingId: `template-concurrency-mapping-${suffix}`
  };
}

async function seedFixture(
  client: PrismaClient,
  ids: Fixture,
  mappingOperation: MappingOperation
) {
  await client.user.create({
    data: { id: ids.actorId, name: "合同模板并发验证主管" }
  });
  await client.position.create({
    data: {
      id: ids.positionId,
      key: "contract_director",
      name: "合同部主管"
    }
  });
  await client.userPosition.create({
    data: {
      userId: ids.actorId,
      positionId: ids.positionId,
      projectId: null
    }
  });
  await client.contractBusinessTemplate.create({
    data: {
      id: ids.templateId,
      code: `CONCURRENCY-${ids.templateId}`,
      name: "合同模板并发验证",
      contractTypeKey: "material_purchase",
      status: "published",
      createdByUserId: ids.actorId
    }
  });
  await client.contractBusinessTemplateVersion.create({
    data: {
      id: ids.versionId,
      templateId: ids.templateId,
      versionNo: 1,
      status: "published",
      fieldSchema: [],
      billSchema: [],
      clauseSchema: [],
      attachmentSchema: [],
      validationSchema: [],
      submittedByUserId: ids.actorId,
      publishedByUserId: ids.actorId,
      publishedAt: new Date()
    }
  });
  await client.contractBusinessScenario.create({
    data: {
      id: ids.scenarioId,
      code: `CONCURRENCY-${ids.scenarioId}`,
      name: "合同模板并发验证场景",
      revision: 1,
      createdByUserId: ids.actorId,
      updatedByUserId: ids.actorId
    }
  });
  if (mappingOperation === "reactivate") {
    await client.contractScenarioTemplateMapping.create({
      data: {
        id: ids.mappingId,
        businessScenarioId: ids.scenarioId,
        contractTypeKey: "material_purchase",
        businessTemplateVersionId: ids.versionId,
        reason: "并发验证停用映射",
        active: false,
        revision: 1,
        createdByUserId: ids.actorId,
        updatedByUserId: ids.actorId
      }
    });
  }
}

async function cleanupFixture(client: PrismaClient, ids: Fixture) {
  await client.auditLog.deleteMany({
    where: { actorUserId: ids.actorId }
  });
  await client.contractScenarioTemplateMapping.deleteMany({
    where: { businessScenarioId: ids.scenarioId }
  });
  await client.contractBusinessScenario.deleteMany({
    where: { id: ids.scenarioId }
  });
  await client.contractBusinessTemplateVersion.deleteMany({
    where: { id: ids.versionId }
  });
  await client.contractBusinessTemplate.deleteMany({
    where: { id: ids.templateId }
  });
  await client.userPosition.deleteMany({
    where: { userId: ids.actorId }
  });
  await client.position.deleteMany({
    where: { id: ids.positionId }
  });
  await client.user.deleteMany({
    where: { id: ids.actorId }
  });
}

function services(prisma: ReturnType<typeof transactionHarness>) {
  const audit = new AuditService();
  const templates = new ContractTemplateService(prisma as never, audit);
  const scenarios = new ContractScenarioService(
    prisma as never,
    audit,
    templates
  );
  return { templates, scenarios };
}

function mappingMutation(
  operation: MappingOperation,
  scenarioService: ContractScenarioService,
  ids: Fixture
) {
  if (operation === "create") {
    return scenarioService.createMapping(ids.scenarioId, ids.actorId, {
      expectedScenarioRevision: 1,
      businessTemplateVersionId: ids.versionId,
      reason: "真实 PostgreSQL 并发验证",
      priority: 1
    });
  }
  return scenarioService.updateMapping(ids.mappingId, ids.actorId, {
    expectedRevision: 1,
    active: true
  });
}

describe("contract template scenario PostgreSQL concurrency", () => {
  it("builds one controlled Docker environment and adds only the run password", async () => {
    const dockerEnv = createControlledDockerEnv(
      {
        PATH: "/controlled/bin",
        HOME: "/controlled/home",
        DOCKER_HOST: "unix:///controlled/docker.sock",
        DOCKER_CONTEXT: "controlled-context",
        DATABASE_URL: "postgresql://must-not-leak"
      },
      "/fallback/home"
    );
    expect(dockerEnv).toEqual({
      PATH: "/controlled/bin",
      HOME: "/controlled/home",
      DOCKER_HOST: "unix:///controlled/docker.sock",
      DOCKER_CONTEXT: "controlled-context"
    });

    const runCommand = jest.fn().mockResolvedValue({
      stdout: "",
      stderr: ""
    });
    const dockerCommand = createDockerCommand(
      dockerEnv,
      runCommand,
      "controlled-docker"
    );
    await dockerCommand(["info"], { timeoutMs: 1_000 });
    await dockerCommand(["run"], {
      extraEnv: { POSTGRES_PASSWORD: "controlled-password" },
      forwardOutput: true
    });

    expect(runCommand).toHaveBeenNthCalledWith(
      1,
      "controlled-docker",
      ["info"],
      {
        timeoutMs: 1_000,
        env: dockerEnv
      }
    );
    expect(runCommand).toHaveBeenNthCalledWith(
      2,
      "controlled-docker",
      ["run"],
      {
        forwardOutput: true,
        env: {
          ...dockerEnv,
          POSTGRES_PASSWORD: "controlled-password"
        }
      }
    );
  });

  it("routes every Docker lifecycle operation through the controlled command", () => {
    const runner = readFileSync(
      join(
        process.cwd(),
        "prisma/run-contract-template-scenario-concurrency-local.cjs"
      ),
      "utf8"
    );

    expect(runner).toContain(
      "const dockerCommand = createDockerCommand(dockerEnv);"
    );
    expect(runner).toMatch(/dockerCommand\(\s*\[\s*"context"/u);
    expect(runner).toContain('dockerCommand(["info"])');
    expect(runner).toMatch(/dockerCommand\(\s*\[\s*"run"/u);
    expect(runner).toMatch(/dockerCommand\(\s*\[\s*"exec"/u);
    expect(runner).toMatch(/dockerCommand\(\s*\["rm"/u);
    expect(runner).toContain(
      "waitForPostgres(containerName, dockerCommand)"
    );
    expect(runner).not.toMatch(/command\(\s*docker\s*,/u);
  });

  it("rejects a non-local or wrong database target", () => {
    expect(() =>
      contractTemplateScenarioDatabaseUrl(
        "postgresql://user:pass@example.com/production"
      )
    ).toThrow("拒绝非本机或非专用数据库");
    expect(() =>
      contractTemplateScenarioDatabaseUrl(
        "postgresql://user:pass@127.0.0.1/jiangkong"
      )
    ).toThrow("拒绝非本机或非专用数据库");
  });

  const integrationTest = LIVE_TEST_ENABLED ? it : it.skip;

  integrationTest.each([
    ["create", "stop"],
    ["create", "create"],
    ["reactivate", "stop"],
    ["reactivate", "reactivate"]
  ] as const)(
    "serializes stop against mapping %s when %s obtains the template lock first",
    async (mappingOperation, firstOperation) => {
      const databaseUrl = contractTemplateScenarioDatabaseUrl(
        process.env.CONTRACT_TEMPLATE_SCENARIO_DATABASE_URL
      );
      const first = new PrismaClient({
        datasources: { db: { url: databaseUrl } }
      });
      const second = new PrismaClient({
        datasources: { db: { url: databaseUrl } }
      });
      const observer = new PrismaClient({
        datasources: { db: { url: databaseUrl } }
      });
      const ids = fixture();
      const locked = deferred<void>();
      const release = deferred<void>();
      const firstBackendPid = deferred<number>();
      const secondBackendPid = deferred<number>();
      let firstPromise: Promise<unknown> | undefined;
      let secondPromise: Promise<unknown> | undefined;
      let bodyError: unknown;
      let bodyFailed = false;
      const cleanupErrors: unknown[] = [];

      try {
        await seedFixture(observer, ids, mappingOperation);
        const firstServices = services(
          transactionHarness(first, {
            backendPid: firstBackendPid,
            locked,
            release: release.promise
          })
        );
        const secondServices = services(
          transactionHarness(second, {
            backendPid: secondBackendPid
          })
        );

        firstPromise =
          firstOperation === "stop"
            ? firstServices.templates.stopVersion(ids.versionId, ids.actorId)
            : mappingMutation(mappingOperation, firstServices.scenarios, ids);
        await withTimeout(
          locked.promise,
          8_000,
          "第一事务未取得业务模板版本行锁"
        );
        const blockerPid = await withTimeout(
          firstBackendPid.promise,
          8_000,
          "无法读取第一事务 PostgreSQL PID"
        );

        secondPromise =
          firstOperation === "stop"
            ? mappingMutation(mappingOperation, secondServices.scenarios, ids)
            : secondServices.templates.stopVersion(
                ids.versionId,
                ids.actorId
              );
        const backendPid = await withTimeout(
          secondBackendPid.promise,
          8_000,
          "无法读取第二事务 PostgreSQL PID"
        );
        expect(backendPid).not.toBe(blockerPid);
        const blocked = await waitForPostgresLock(
          observer,
          backendPid,
          blockerPid
        );
        expect(blocked).toMatchObject({
          state: "active",
          waitEventType: "Lock",
          blockingPids: [blockerPid]
        });
        expect(blocked.waitEvent).toBeTruthy();
        expect(blocked.query).toContain("ContractBusinessTemplate");

        release.resolve(undefined);
        const results = await withTimeout(
          Promise.allSettled([firstPromise, secondPromise]),
          20_000,
          "合同模板场景并发事务未在时限内完成"
        );
        expect(results[0].status).toBe("fulfilled");
        expect(results[1].status).toBe("rejected");
        await proveContendedLocksReleased(observer, ids);

        const version =
          await observer.contractBusinessTemplateVersion.findUniqueOrThrow({
            where: { id: ids.versionId }
          });
        const mappings =
          await observer.contractScenarioTemplateMapping.findMany({
            where: {
              businessScenarioId: ids.scenarioId,
              businessTemplateVersionId: ids.versionId
            }
          });
        if (firstOperation === "stop") {
          expect(version.status).toBe("stopped");
          if (mappingOperation === "create") {
            expect(mappings).toHaveLength(0);
          } else {
            expect(mappings).toMatchObject([
              { id: ids.mappingId, active: false, revision: 1 }
            ]);
          }
          expect((results[1] as PromiseRejectedResult).reason).toEqual(
            expect.objectContaining({
              message: expect.stringMatching(
                /必须绑定已发布|精确模板版本仍已发布/
              )
            })
          );
        } else {
          expect(version.status).toBe("published");
          expect(mappings).toHaveLength(1);
          expect(mappings[0]).toMatchObject({
            active: true,
            revision: mappingOperation === "create" ? 1 : 2
          });
          expect((results[1] as PromiseRejectedResult).reason).toEqual(
            expect.objectContaining({
              message: expect.stringContaining("请先停用映射")
            })
          );
        }
        await expect(
          observer.auditLog.count({
            where: { actorUserId: ids.actorId }
          })
        ).resolves.toBe(1);
      } catch (error) {
        bodyFailed = true;
        bodyError = error;
      } finally {
        release.resolve(undefined);
        const pending = [firstPromise, secondPromise].filter(
          (promise): promise is Promise<unknown> => Boolean(promise)
        );
        try {
          await withTimeout(
            Promise.allSettled(pending),
            15_000,
            "并发测试清理等待事务结束超时"
          );
        } catch (error) {
          cleanupErrors.push(error);
        }
        try {
          await cleanupFixture(observer, ids);
        } catch (error) {
          cleanupErrors.push(error);
        }
        const disconnectResults = await Promise.allSettled([
          first.$disconnect(),
          second.$disconnect(),
          observer.$disconnect()
        ]);
        for (const result of disconnectResults) {
          if (result.status === "rejected") {
            cleanupErrors.push(result.reason);
          }
        }
      }
      if (bodyFailed && cleanupErrors.length > 0) {
        throw new AggregateError(
          [bodyError, ...cleanupErrors],
          "合同模板场景并发验证失败且清理不完整"
        );
      }
      if (bodyFailed) throw bodyError;
      if (cleanupErrors.length > 0) {
        throw new AggregateError(
          cleanupErrors,
          "合同模板场景并发验证清理失败"
        );
      }
    },
    50_000
  );
});
