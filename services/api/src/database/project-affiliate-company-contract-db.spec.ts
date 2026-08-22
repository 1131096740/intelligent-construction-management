import { BadRequestException } from "@nestjs/common";
import { Prisma, PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { ProjectAffiliateCompanyContractService } from "../project/project-affiliate-company-contract.service";

const TEST_DATABASE = "jiangkong_project_affiliate_company_contract_test";
const LIVE_TEST_ENABLED =
  process.env.RUN_PROJECT_AFFILIATE_COMPANY_CONTRACT_DB_TESTS === "1";

export function projectAffiliateCompanyContractDatabaseUrl(
  value: string | undefined
) {
  if (!value || process.env.NODE_ENV === "production") {
    throw new Error(
      "挂靠公司合同并发测试必须连接非生产专用数据库"
    );
  }
  const url = new URL(value);
  if (
    !["postgresql:", "postgres:"].includes(url.protocol) ||
    !["127.0.0.1", "localhost", "::1"].includes(url.hostname) ||
    url.pathname !== `/${TEST_DATABASE}`
  ) {
    throw new Error("挂靠公司合同并发测试拒绝非本机专用数据库");
  }
  return url.toString();
}

describe("project affiliate-company contract database target guard", () => {
  it("rejects a production or non-local database target", () => {
    expect(() =>
      projectAffiliateCompanyContractDatabaseUrl(
        "postgresql://user:pass@example.com/production"
      )
    ).toThrow("挂靠公司合同并发测试拒绝非本机专用数据库");
  });
});

const databaseUrl = LIVE_TEST_ENABLED
  ? projectAffiliateCompanyContractDatabaseUrl(
      process.env.PROJECT_AFFILIATE_COMPANY_CONTRACT_DATABASE_URL
    )
  : undefined;
const describeDatabase = LIVE_TEST_ENABLED ? describe : describe.skip;

describeDatabase("project affiliate-company contract PostgreSQL constraints", () => {
  const createTestClient = () =>
    databaseUrl
      ? new PrismaClient({
          datasources: { db: { url: databaseUrl } }
        })
      : new PrismaClient();
  const prisma = createTestClient();

  jest.setTimeout(15_000);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("accepts only a complete signed confirmation and then rejects update and delete", async () => {
    const fixture = await createFixture(prisma);
    const contractId = randomUUID();
    await prisma.projectAffiliateCompanyContract.create({
      data: {
        id: contractId,
        projectId: fixture.projectId,
        contractReference: `GL-${contractId}`,
        contractName: "项目挂靠管理协议",
        signedAt: new Date("2026-07-20T00:00:00.000Z"),
        rightsObligationsSummary: "双方已线下约定项目管理、资金核对与责任边界。",
        affiliateAssignmentId: fixture.assignmentId,
        affiliateBusinessPartyVersionId: fixture.partyVersionId,
        affiliateNameSnapshot: "挂靠建设集团",
        affiliateCreditCodeSnapshot: fixture.affiliateCreditCode,
        companyEntityId: fixture.companyId,
        companyEntityVersionId: fixture.companyVersionId,
        companyEntityNameSnapshot: "我方建设有限公司",
        companyEntityCreditCodeSnapshot: fixture.companyCreditCode,
        companyEntityRegisteredAddressSnapshot: "厦门市",
        fileId: fixture.contractFileId,
        fileContentSha256Snapshot: "a".repeat(64),
        idempotencyKey: randomUUID(),
        requestFingerprint: "b".repeat(64),
        recordedByUserId: fixture.recorderId,
        recordedByRoleKey: "contract_staff"
      }
    });

    await expect(
      prisma.$executeRaw(Prisma.sql`
        UPDATE "ProjectAffiliateCompanyContract"
        SET "status" = 'confirmed',
            "confirmedByUserId" = ${fixture.directorId},
            "confirmedAt" = NOW()
        WHERE "id" = ${contractId}
      `)
    ).rejects.toThrow("ProjectAffiliateCompanyContract_confirmation_check");

    await prisma.$executeRaw(Prisma.sql`
      UPDATE "ProjectAffiliateCompanyContract"
      SET "status" = 'confirmed',
          "confirmedByUserId" = ${fixture.directorId},
          "confirmedAt" = NOW(),
          "confirmationActionId" = ${randomUUID()},
          "confirmationSignatureVersionId" = ${fixture.signatureVersionId},
          "confirmationSignatureFileId" = ${fixture.signatureFileId},
          "confirmationSignatureSha256" = ${"c".repeat(64)}
      WHERE "id" = ${contractId}
    `);

    await expect(
      prisma.projectAffiliateCompanyContract.update({
        where: { id: contractId },
        data: { rightsObligationsSummary: "试图覆盖已确认权利义务" }
      })
    ).rejects.toThrow("confirmed affiliate-company contracts are append-only");
    await expect(
      prisma.projectAffiliateCompanyContract.delete({ where: { id: contractId } })
    ).rejects.toThrow("affiliate-company contracts cannot be deleted");
  });

  it("rejects reusing the same signed file for a second contract", async () => {
    const fixture = await createFixture(prisma);
    const firstId = randomUUID();
    const base = {
      projectId: fixture.projectId,
      contractName: "项目挂靠管理协议",
      signedAt: new Date("2026-07-20T00:00:00.000Z"),
      rightsObligationsSummary: "双方已线下约定项目管理、资金核对与责任边界。",
      affiliateAssignmentId: fixture.assignmentId,
      affiliateBusinessPartyVersionId: fixture.partyVersionId,
      affiliateNameSnapshot: "挂靠建设集团",
      affiliateCreditCodeSnapshot: fixture.affiliateCreditCode,
      companyEntityId: fixture.companyId,
      companyEntityVersionId: fixture.companyVersionId,
      companyEntityNameSnapshot: "我方建设有限公司",
      companyEntityCreditCodeSnapshot: fixture.companyCreditCode,
      companyEntityRegisteredAddressSnapshot: "厦门市",
      fileId: fixture.contractFileId,
      fileContentSha256Snapshot: "a".repeat(64),
      requestFingerprint: "d".repeat(64),
      recordedByUserId: fixture.recorderId,
      recordedByRoleKey: "contract_staff"
    };
    await prisma.projectAffiliateCompanyContract.create({
      data: {
        id: firstId,
        contractReference: `GL-A-${firstId}`,
        idempotencyKey: randomUUID(),
        ...base
      }
    });

    await expect(
      prisma.projectAffiliateCompanyContract.create({
        data: {
          id: randomUUID(),
          contractReference: `GL-B-${firstId}`,
          idempotencyKey: randomUUID(),
          ...base
        }
      })
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("serializes advisory-to-company lock order without a deadlock", async () => {
    const fixture = await createFixture(prisma);
    const first = createTestClient();
    const second = createTestClient();
    const firstHasAdvisory = deferred<number>();
    const releaseFirst = deferred<void>();

    const firstTransaction = first.$transaction(async (tx) => {
      const [{ pid }] = await tx.$queryRaw<Array<{ pid: number }>>(
        Prisma.sql`SELECT pg_backend_pid()::int AS "pid"`
      );
      await setLocalConcurrencyTimeouts(tx);
      await acquireTestFileBindingLock(tx);
      firstHasAdvisory.resolve(pid);
      await releaseFirst.promise;
      await lockTestCompany(tx, fixture.companyId);
      return "first";
    });

    const firstPid = await firstHasAdvisory.promise;
    const secondStarted = deferred<number>();
    const secondTransaction = second.$transaction(async (tx) => {
      const [{ pid }] = await tx.$queryRaw<Array<{ pid: number }>>(
        Prisma.sql`SELECT pg_backend_pid()::int AS "pid"`
      );
      await setLocalConcurrencyTimeouts(tx);
      secondStarted.resolve(pid);
      await acquireTestFileBindingLock(tx);
      await lockTestCompany(tx, fixture.companyId);
      return "second";
    });

    try {
      const secondPid = await secondStarted.promise;
      await expectDirectBlocker(prisma, secondPid, firstPid);
    } finally {
      releaseFirst.resolve();
    }

    await expect(
      Promise.all([firstTransaction, secondTransaction])
    ).resolves.toEqual(["first", "second"]);
    await Promise.all([first.$disconnect(), second.$disconnect()]);
  });

  it("waits for an in-flight FileObject discard and refuses to bind the discarded row", async () => {
    const fixture = await createFixture(prisma);
    const discarder = createTestClient();
    const binder = createTestClient();
    const discardHasFileRow = deferred<number>();
    const releaseDiscard = deferred<void>();

    const discardTransaction = discarder.$transaction(async (tx) => {
      const [{ pid }] = await tx.$queryRaw<Array<{ pid: number }>>(
        Prisma.sql`SELECT pg_backend_pid()::int AS "pid"`
      );
      await setLocalConcurrencyTimeouts(tx);
      await tx.$queryRaw(Prisma.sql`
        SELECT "id"
        FROM "FileObject"
        WHERE "id" = ${fixture.contractFileId}
        FOR UPDATE
      `);
      await tx.fileObject.update({
        where: { id: fixture.contractFileId },
        data: { storageStatus: "discarded" }
      });
      discardHasFileRow.resolve(pid);
      await releaseDiscard.promise;
    });

    const discardPid = await discardHasFileRow.promise;
    const binderStarted = deferred<number>();
    const servicePrisma = withTransactionPidProbe(binder, (pid) =>
      binderStarted.resolve(pid)
    );
    const service = new ProjectAffiliateCompanyContractService(
      servicePrisma as never,
      { record: jest.fn() } as never
    );
    const bindOutcome = service
      .record(fixture.projectId, fixture.recorderId, {
        contractReference: `GL-CONCURRENCY-${randomUUID()}`,
        contractName: "项目挂靠管理协议",
        signedAt: "2026-07-20",
        rightsObligationsSummary:
          "双方已线下约定项目管理、资金核对与责任边界。",
        companyEntityId: fixture.companyId,
        fileId: fixture.contractFileId,
        idempotencyKey: randomUUID()
      })
      .then(
        (value) => ({ status: "resolved" as const, value }),
        (error: unknown) => ({ status: "rejected" as const, error })
      );

    try {
      const binderPid = await binderStarted.promise;
      await expectDirectBlocker(prisma, binderPid, discardPid);
    } finally {
      releaseDiscard.resolve();
    }

    await discardTransaction;
    const outcome = await bindOutcome;
    expect(outcome.status).toBe("rejected");
    if (outcome.status !== "rejected") {
      throw new Error("discarded FileObject was unexpectedly bound");
    }
    expect(outcome.error).toBeInstanceOf(BadRequestException);
    await expect(
      prisma.projectAffiliateCompanyContract.count({
        where: { fileId: fixture.contractFileId }
      })
    ).resolves.toBe(0);
    await Promise.all([discarder.$disconnect(), binder.$disconnect()]);
  });
});

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function withTransactionPidProbe(
  client: PrismaClient,
  onTransactionPid: (pid: number) => void
) {
  return new Proxy(client, {
    get(target, property) {
      if (property === "$transaction") {
        return (
          work: (tx: Prisma.TransactionClient) => Promise<unknown>
        ) =>
          target.$transaction(async (tx) => {
            const [{ pid }] = await tx.$queryRaw<Array<{ pid: number }>>(
              Prisma.sql`SELECT pg_backend_pid()::int AS "pid"`
            );
            await setLocalConcurrencyTimeouts(tx);
            onTransactionPid(pid);
            return work(tx);
          });
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
}

async function setLocalConcurrencyTimeouts(tx: Prisma.TransactionClient) {
  await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '5s'");
  await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '8s'");
}

function acquireTestFileBindingLock(tx: Prisma.TransactionClient) {
  return tx.$queryRaw(Prisma.sql`
    SELECT pg_advisory_xact_lock(190731::int, 13::int)::text AS "lockResult"
  `);
}

function lockTestCompany(
  tx: Prisma.TransactionClient,
  companyEntityId: string
) {
  return tx.$queryRaw(Prisma.sql`
    SELECT "id"
    FROM "CompanyEntity"
    WHERE "id" = ${companyEntityId}
    FOR UPDATE
  `);
}

async function expectDirectBlocker(
  monitor: PrismaClient,
  blockedPid: number,
  expectedBlockerPid: number
) {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    const [row] = await monitor.$queryRaw<Array<{ blockerPids: number[] }>>(
      Prisma.sql`
        SELECT pg_blocking_pids(${blockedPid}::int)::int[] AS "blockerPids"
      `
    );
    if (row?.blockerPids.includes(expectedBlockerPid)) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(
    `backend ${blockedPid} was not directly blocked by ${expectedBlockerPid}`
  );
}

async function createFixture(prisma: PrismaClient) {
  const suffix = randomUUID();
  const recorderId = `contract-recorder-${suffix}`;
  const directorId = `contract-director-${suffix}`;
  const projectId = `project-${suffix}`;
  const partyId = `party-${suffix}`;
  const partyVersionId = `party-version-${suffix}`;
  const assignmentId = `assignment-${suffix}`;
  const companyId = `company-${suffix}`;
  const companyVersionId = `company-version-${suffix}`;
  const contractFileId = `contract-file-${suffix}`;
  const signatureFileId = `signature-file-${suffix}`;
  const signatureVersionId = `signature-version-${suffix}`;
  const affiliateCreditCode = `AFFILIATE-${suffix}`;
  const companyCreditCode = `COMPANY-${suffix}`;

  await prisma.user.createMany({
    data: [
      { id: recorderId, name: "合同人员", isActive: true },
      { id: directorId, name: "合同主管", isActive: true }
    ]
  });
  await prisma.project.create({
    data: { id: projectId, code: `P-${suffix}`, name: "隔离迁移测试项目" }
  });
  await prisma.projectMember.create({
    data: {
      projectId,
      userId: recorderId,
      positionKey: "contract_staff"
    }
  });
  await prisma.businessParty.create({
    data: {
      id: partyId,
      name: "挂靠建设集团",
      normalizedName: "挂靠建设集团",
      unifiedSocialCreditCode: affiliateCreditCode,
      createdByUserId: recorderId
    }
  });
  await prisma.businessPartyVersion.create({
    data: {
      id: partyVersionId,
      businessPartyId: partyId,
      versionNo: 1,
      snapshot: {
        name: "挂靠建设集团",
        unifiedSocialCreditCode: affiliateCreditCode
      },
      createdByUserId: recorderId
    }
  });
  await prisma.projectAffiliateAssignment.create({
    data: {
      id: assignmentId,
      projectId,
      businessPartyId: partyId,
      businessPartyVersionId: partyVersionId,
      affiliateNameSnapshot: "挂靠建设集团",
      affiliateCreditCodeSnapshot: affiliateCreditCode,
      effectiveFrom: new Date("2026-07-01T00:00:00.000Z"),
      changeReason: "隔离数据库约束验证",
      assignedByUserId: recorderId
    }
  });
  await prisma.companyEntity.create({
    data: {
      id: companyId,
      name: "我方建设有限公司",
      unifiedSocialCreditCode: companyCreditCode,
      registeredAddress: "厦门市",
      dataStatus: "complete",
      currentVersionNo: 1,
      isActive: true
    }
  });
  await prisma.companyEntityVersion.create({
    data: {
      id: companyVersionId,
      companyEntityId: companyId,
      versionNo: 1,
      name: "我方建设有限公司",
      unifiedSocialCreditCode: companyCreditCode,
      registeredAddress: "厦门市",
      isActive: true,
      action: "create",
      actorUserId: recorderId,
      actorRoleKey: "contract_staff"
    }
  });
  await prisma.fileObject.createMany({
    data: [
      {
        id: contractFileId,
        bucket: "private-local",
        objectKey: `tests/${contractFileId}.pdf`,
        originalName: "挂靠管理协议.pdf",
        mimeType: "application/pdf",
        sizeBytes: 100,
        uploadedByUserId: recorderId,
        contentSha256: "a".repeat(64),
        storageStatus: "active"
      },
      {
        id: signatureFileId,
        bucket: "private-local",
        objectKey: `tests/${signatureFileId}.png`,
        originalName: "合同主管签名.png",
        mimeType: "image/png",
        sizeBytes: 100,
        uploadedByUserId: directorId,
        contentSha256: "c".repeat(64),
        storageStatus: "active"
      }
    ]
  });
  await prisma.handwrittenSignatureVersion.create({
    data: {
      id: signatureVersionId,
      userId: directorId,
      fileId: signatureFileId,
      contentSha256: "c".repeat(64),
      source: "canvas"
    }
  });

  return {
    recorderId,
    directorId,
    projectId,
    partyVersionId,
    assignmentId,
    companyId,
    companyVersionId,
    contractFileId,
    signatureFileId,
    signatureVersionId,
    affiliateCreditCode,
    companyCreditCode
  };
}
