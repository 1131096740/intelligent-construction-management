const { randomUUID } = require("node:crypto");
const { mkdtemp, rm } = require("node:fs/promises");
const net = require("node:net");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { PrismaClient, Prisma } = require("@prisma/client");
const {
  createCommandRuntime,
  createRunnerCleanup,
  runInterruption
} = require("./money-bigint-runner-runtime.cjs");

const DATABASE_NAME = "jiangkong_pol214_authority_verify";
const root = path.resolve(__dirname, "../../..");
const docker = process.platform === "win32" ? "docker.exe" : "docker";
const prismaCli = require.resolve("prisma/build/index.js");
const commandRuntime = createCommandRuntime({ defaultCwd: root });
const { command } = commandRuntime;

function fail(message) {
  throw new Error(`POL-214 PostgreSQL 16 动态验收失败：${message}`);
}

function assertLocalUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    fail("DATABASE_URL 不是有效 URL");
  }
  if (
    !["postgresql:", "postgres:"].includes(url.protocol) ||
    !["127.0.0.1", "localhost", "::1"].includes(url.hostname) ||
    url.pathname !== `/${DATABASE_NAME}`
  ) {
    fail("拒绝非本机固定一次性数据库");
  }
  return url.toString();
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

async function waitForPostgres(containerName) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      await command(docker, ["exec", containerName, "pg_isready", "-U", "jiangkong", "-d", DATABASE_NAME]);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  fail("临时 PostgreSQL 16 未在 30 秒内就绪");
}

async function main() {
  if (process.env.NODE_ENV === "production") fail("禁止在 NODE_ENV=production 执行");
  if (process.env.DOCKER_HOST && !/^(unix|npipe):\/\//u.test(process.env.DOCKER_HOST)) fail("拒绝远程 Docker endpoint");
  const port = await freePort();
  const suffix = `${Date.now()}-${process.pid}`;
  const containerName = `jiangkong-pol214-authority-${suffix}`;
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "jiangkong-pol214-authority-"));
  const password = randomUUID();
  const databaseUrl = assertLocalUrl(`postgresql://jiangkong:${password}@127.0.0.1:${port}/${DATABASE_NAME}`);
  const runtimeEnv = {
    ...process.env,
    HOME: process.env.HOME ?? temporaryRoot,
    TMPDIR: temporaryRoot,
    NODE_ENV: "test",
    DATABASE_URL: databaseUrl,
    FILE_STORAGE_DRIVER: "local",
    FILE_STORAGE_ROOT: path.join(temporaryRoot, "storage", "private"),
    SEED_PASSWORD: `Local@1-${randomUUID()}`
  };
  const cleanup = createRunnerCleanup({
    stopChildren: () => commandRuntime.stopAll(),
    removeContainer: () => command(docker, ["rm", "--force", containerName], { timeoutMs: 60_000 }).catch((error) => {
      if (!String(error?.message).includes("No such container")) throw error;
    }),
    removeTemporaryRoot: () => rm(temporaryRoot, { recursive: true, force: true }),
    onComplete: () => console.log(`POL-214 动态验收清理完成：${containerName}`)
  });
  let interruptionPromise;
  const interrupt = (signal) => {
    interruptionPromise ??= runInterruption({
      signal,
      cleanup,
      reportError: (message) => console.error(message),
      exit: (code) => process.exit(code)
    });
    return interruptionPromise;
  };
  const onSigint = () => void interrupt("SIGINT");
  const onSigterm = () => void interrupt("SIGTERM");
  process.once("SIGINT", onSigint);
  process.once("SIGTERM", onSigterm);

  try {
    await command(docker, ["context", "inspect", "--format", "{{json .Endpoints.docker.Host}}"]);
    await command(docker, ["info"]);
    await command(docker, [
      "run", "--detach", "--rm", "--name", containerName,
      "--env", "POSTGRES_USER=jiangkong", "--env", "POSTGRES_PASSWORD", "--env", `POSTGRES_DB=${DATABASE_NAME}`,
      "--publish", `127.0.0.1:${port}:5432`, "postgres:16"
    ], { env: { ...process.env, POSTGRES_PASSWORD: password }, forwardOutput: true });
    await waitForPostgres(containerName);
    await command(process.execPath, [prismaCli, "migrate", "deploy", "--schema", path.join(root, "services/api/prisma/schema.prisma")], {
      env: runtimeEnv,
      forwardOutput: true,
      timeoutMs: 15 * 60 * 1000
    });
    await command(process.execPath, [path.join(root, "services/api/prisma/seed.cjs")], {
      cwd: root,
      env: runtimeEnv,
      forwardOutput: true,
      timeoutMs: 15 * 60 * 1000
    });
    const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    try {
      const fixture = await createFixture(prisma);
      await runAuthorityAssertions(prisma, fixture, databaseUrl);
      console.log("POL-214 PostgreSQL 16 动态验收通过：唯一性、PERSON/ROLE_SUMMARY、半开区间、保证金 cap、source balance 与 append-only。");
    } finally {
      await prisma.$disconnect();
    }
  } finally {
    process.removeListener("SIGINT", onSigint);
    process.removeListener("SIGTERM", onSigterm);
    await cleanup();
  }
}

async function createFixture(prisma) {
  const suffix = randomUUID();
  const contractFileId = `pol214-contract-file-${suffix}`;
  const signatureFileId = `pol214-signature-file-${suffix}`;
  const evidenceFileId = `pol214-evidence-file-${suffix}`;
  const contractId = `pol214-contract-${suffix}`;
  const authorityId = `pol214-authority-${suffix}`;
  const employeeId = "seed-user-employee";
  const directorId = "seed-user-finance-director";
  const recorderId = "seed-user-cashier";
  const projectId = "seed-project-jgxm-001";
  const assignmentId = "seed-construction-enterprise-assignment-jgxm-001";
  const partyVersionId = "seed-construction-enterprise-version-jgxm-001";
  const companyId = "seed-company-entity-jgzg";
  const companyVersionId = "seed-company-entity-version-jgzg-v1";

  await prisma.projectRosterMember.upsert({
    where: { projectId_userId: { projectId, userId: employeeId } },
    update: {},
    create: { projectId, userId: employeeId }
  });
  await prisma.fileObject.createMany({
    data: [
      { id: contractFileId, bucket: "private-local", objectKey: `pol214/${contractFileId}.pdf`, originalName: "pol214-contract.pdf", mimeType: "application/pdf", sizeBytes: 10, uploadedByUserId: recorderId, contentSha256: "1".repeat(64) },
      { id: signatureFileId, bucket: "private-local", objectKey: `pol214/${signatureFileId}.png`, originalName: "pol214-signature.png", mimeType: "image/png", sizeBytes: 10, uploadedByUserId: directorId, contentSha256: "2".repeat(64) },
      { id: evidenceFileId, bucket: "private-local", objectKey: `pol214/${evidenceFileId}.pdf`, originalName: "pol214-evidence.pdf", mimeType: "application/pdf", sizeBytes: 10, uploadedByUserId: recorderId, contentSha256: "3".repeat(64) }
    ]
  });
  const signatureVersion = await prisma.handwrittenSignatureVersion.create({ data: { userId: directorId, fileId: signatureFileId, contentSha256: "2".repeat(64), source: "canvas" } });
  await prisma.projectAffiliateCompanyContract.create({
    data: {
      id: contractId,
      projectId,
      contractReference: `POL214-${suffix}`,
      contractName: "挂靠清算权威协议",
      signedAt: new Date("2026-08-01T00:00:00.000Z"),
      rightsObligationsSummary: "冻结派驻工资与保证金义务",
      affiliateAssignmentId: assignmentId,
      affiliateBusinessPartyVersionId: partyVersionId,
      affiliateNameSnapshot: "示例施工企业",
      affiliateCreditCodeSnapshot: "91310000SEEDBUILD01",
      companyEntityId: companyId,
      companyEntityVersionId: companyVersionId,
      companyEntityNameSnapshot: "建工智管建设有限公司",
      companyEntityCreditCodeSnapshot: "91350211M000100Y46",
      companyEntityRegisteredAddressSnapshot: "云南省昆明市西山区",
      fileId: contractFileId,
      fileContentSha256Snapshot: "1".repeat(64),
      idempotencyKey: randomUUID(),
      requestFingerprint: "4".repeat(64),
      recordedByUserId: recorderId,
      recordedByRoleKey: "contract_staff"
    }
  });
  await prisma.$executeRaw(Prisma.sql`
    UPDATE "ProjectAffiliateCompanyContract"
       SET "status" = 'confirmed', "confirmedByUserId" = ${directorId}, "confirmedAt" = NOW(),
           "confirmationActionId" = ${randomUUID()}, "confirmationSignatureVersionId" = ${signatureVersion.id},
           "confirmationSignatureFileId" = ${signatureFileId}, "confirmationSignatureSha256" = ${"2".repeat(64)}
     WHERE "id" = ${contractId}
  `);
  await prisma.affiliateClearingAuthorityVersion.create({
    data: {
      id: authorityId,
      projectId,
      constructionEnterpriseAssignmentId: assignmentId,
      affiliateCompanyContractId: contractId,
      protocolNameSnapshot: "挂靠清算权威协议",
      protocolReferenceSnapshot: `POL214-${suffix}`,
      assignmentNameSnapshot: "示例施工企业",
      assignmentCreditCodeSnapshot: "91310000SEEDBUILD01",
      versionNo: 1,
      effectiveFrom: new Date("2026-08-01T00:00:00.000Z"),
      effectiveTo: new Date("2026-09-01T00:00:00.000Z"),
      coverageKind: "PERSON",
      evidenceFileId,
      evidenceSha256: "3".repeat(64),
      evidenceManifestSha256: "5".repeat(64),
      status: "draft",
      authoritySnapshotRef: `acv_${suffix}`,
      authorityFingerprint: "6".repeat(64),
      idempotencyKey: randomUUID(),
      requestFingerprint: "7".repeat(64),
      createdByUserId: recorderId
    }
  });
  return { projectId, assignmentId, contractId, authorityId, evidenceFileId, employeeId, directorId, recorderId };
}

async function runAuthorityAssertions(prisma, fixture, databaseUrl) {
  const wageLineId = `pol214-line-${randomUUID()}`;
  const lineBase = {
    authorityVersionId: fixture.authorityId,
    projectId: fixture.projectId,
    constructionEnterpriseAssignmentId: fixture.assignmentId,
    affiliateCompanyContractId: fixture.contractId,
    coverageKind: "PERSON",
    coverageKey: `person:${fixture.employeeId}`,
    personAuthorityKey: fixture.employeeId,
    personNameSnapshot: "员工 杨工",
    employerNameSnapshot: "建工智管建设有限公司",
    employerCreditCodeSnapshot: "91350211M000100Y46",
    wageMonth: new Date("2026-08-01T00:00:00.000Z"),
    amountRuleVersion: 1,
    amountMode: "CONFIRMED_AMOUNT",
    approvedAmountCents: 10000n,
    grossCapCents: 10000n,
    currencyCode: "CNY",
    midMonthPolicy: "NOT_APPLICABLE",
    evidenceLevel: "A",
    evidenceCoordinate: "fixture",
    evidenceSha256: "3".repeat(64),
    lineFingerprint: "8".repeat(64)
  };
  const first = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const second = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  try {
    const parentVersionBase = {
      projectId: fixture.projectId,
      constructionEnterpriseAssignmentId: fixture.assignmentId,
      affiliateCompanyContractId: fixture.contractId,
      protocolNameSnapshot: "挂靠清算权威协议",
      protocolReferenceSnapshot: "POL214-DYNAMIC-V2",
      assignmentNameSnapshot: "示例施工企业",
      assignmentCreditCodeSnapshot: "91310000SEEDBUILD01",
      versionNo: 2,
      supersedesVersionId: fixture.authorityId,
      coverageKind: "PERSON",
      evidenceFileId: fixture.evidenceFileId,
      evidenceSha256: "3".repeat(64),
      evidenceManifestSha256: "5".repeat(64),
      status: "draft",
      createdByUserId: fixture.recorderId
    };
    await expectReject(
      prisma.affiliateClearingAuthorityVersion.create({
        data: {
          ...parentVersionBase,
          id: `pol214-authority-overlap-${randomUUID()}`,
          effectiveFrom: new Date("2026-08-15T00:00:00.000Z"),
          effectiveTo: new Date("2026-09-15T00:00:00.000Z"),
          authoritySnapshotRef: `acv_overlap_${randomUUID()}`,
          authorityFingerprint: "9".repeat(64),
          idempotencyKey: randomUUID(),
          requestFingerprint: "a".repeat(64)
        }
      }),
      "权威版本半开区间重叠约束"
    );
    const adjacentAuthority = await prisma.affiliateClearingAuthorityVersion.create({
      data: {
        ...parentVersionBase,
        id: `pol214-authority-adjacent-${randomUUID()}`,
        effectiveFrom: new Date("2026-09-01T00:00:00.000Z"),
        effectiveTo: new Date("2026-10-01T00:00:00.000Z"),
        authoritySnapshotRef: `acv_adjacent_${randomUUID()}`,
        authorityFingerprint: "b".repeat(64),
        idempotencyKey: randomUUID(),
        requestFingerprint: "c".repeat(64)
      }
    });
    if (adjacentAuthority.supersedesVersionId !== fixture.authorityId || adjacentAuthority.versionNo !== 2) {
      fail("权威版本链未保留 supersedes/versionNo");
    }
    const roleAuthority = await prisma.affiliateClearingAuthorityVersion.create({
      data: {
        ...parentVersionBase,
        id: `pol214-authority-role-${randomUUID()}`,
        supersedesVersionId: adjacentAuthority.id,
        versionNo: 3,
        effectiveFrom: new Date("2026-10-01T00:00:00.000Z"),
        effectiveTo: new Date("2026-11-01T00:00:00.000Z"),
        coverageKind: "ROLE_SUMMARY",
        authoritySnapshotRef: `acv_role_${randomUUID()}`,
        authorityFingerprint: "d".repeat(64),
        idempotencyKey: randomUUID(),
        requestFingerprint: "e".repeat(64)
      }
    });

    const outcomes = await Promise.allSettled([
      first.assignedWageAuthorityLine.create({ data: { ...lineBase, id: wageLineId } }),
      second.assignedWageAuthorityLine.create({ data: { ...lineBase, id: `pol214-line-b-${randomUUID()}` } })
    ]);
    if (outcomes.filter((outcome) => outcome.status === "fulfilled").length !== 1) fail("工资自然键并发写入未做到恰好一次成功");

    await expectReject(
      prisma.assignedWageAuthorityLine.create({
        data: {
          ...lineBase,
          id: `pol214-role-invalid-${randomUUID()}`,
          authorityVersionId: roleAuthority.id,
          coverageKind: "ROLE_SUMMARY",
          coverageKey: "role:project_manager",
          personAuthorityKey: fixture.employeeId,
          personNameSnapshot: "员工 杨工",
          roleCategoryKey: "project_manager",
          roleNameSnapshot: "项目经理",
          wageMonth: new Date("2026-09-01T00:00:00.000Z"),
          lineFingerprint: "9".repeat(64)
        }
      }),
      "岗位汇总/人员混用约束"
    );
    const roleLine = await prisma.assignedWageAuthorityLine.create({
      data: {
        ...lineBase,
        id: `pol214-role-valid-${randomUUID()}`,
        authorityVersionId: roleAuthority.id,
        coverageKind: "ROLE_SUMMARY",
        coverageKey: "role:project_manager",
        personAuthorityKey: null,
        personNameSnapshot: null,
        roleCategoryKey: "project_manager",
        roleNameSnapshot: "项目经理",
        wageMonth: new Date("2026-10-01T00:00:00.000Z"),
        lineFingerprint: "f".repeat(64),
        evidenceLevel: "B"
      }
    });
    if (roleLine.personAuthorityKey !== null || roleLine.personNameSnapshot !== null) {
      fail("B 级岗位汇总错误生成了人员身份");
    }

    const guaranteeA = await prisma.guaranteeObligationVersion.create({
      data: {
        id: `pol214-guarantee-a-${randomUUID()}`,
        authorityVersionId: fixture.authorityId,
        projectId: fixture.projectId,
        constructionEnterpriseAssignmentId: fixture.assignmentId,
        affiliateCompanyContractId: fixture.contractId,
        obligationId: `pol214-obligation-${randomUUID()}`,
        versionNo: 1,
        baseAmountCents: 100000n,
        calculationMode: "RATE_BPS",
        rateBps: 1000,
        capCents: 10000n,
        effectiveFrom: new Date("2026-08-01T00:00:00.000Z"),
        effectiveTo: new Date("2026-09-01T00:00:00.000Z"),
        returnCondition: "结算确认后返还",
        evidenceLevel: "A",
        evidenceCoordinate: "fixture",
        evidenceSha256: "3".repeat(64),
        obligationFingerprint: "a".repeat(64),
        createdByUserId: fixture.recorderId
      }
    });
    await expectReject(
      prisma.guaranteeObligationVersion.create({
        data: {
          id: `pol214-guarantee-overlap-${randomUUID()}`,
          authorityVersionId: fixture.authorityId,
          projectId: fixture.projectId,
          constructionEnterpriseAssignmentId: fixture.assignmentId,
          affiliateCompanyContractId: fixture.contractId,
          obligationId: guaranteeA.obligationId,
          versionNo: 2,
          baseAmountCents: 100000n,
          calculationMode: "FIXED_AMOUNT",
          fixedAmountCents: 10000n,
          capCents: 10000n,
          effectiveFrom: new Date("2026-08-15T00:00:00.000Z"),
          effectiveTo: new Date("2026-09-15T00:00:00.000Z"),
          returnCondition: "结算确认后返还",
          evidenceLevel: "A",
          evidenceCoordinate: "fixture",
          evidenceSha256: "3".repeat(64),
          obligationFingerprint: "b".repeat(64),
          createdByUserId: fixture.recorderId
        }
      }),
      "保证金半开区间重叠约束"
    );
    await prisma.guaranteeObligationVersion.create({
      data: {
        id: `pol214-guarantee-adjacent-${randomUUID()}`,
        authorityVersionId: fixture.authorityId,
        projectId: fixture.projectId,
        constructionEnterpriseAssignmentId: fixture.assignmentId,
        affiliateCompanyContractId: fixture.contractId,
        obligationId: guaranteeA.obligationId,
        versionNo: 2,
        baseAmountCents: 100000n,
        calculationMode: "FIXED_AMOUNT",
        fixedAmountCents: 10000n,
        capCents: 10000n,
        effectiveFrom: new Date("2026-09-01T00:00:00.000Z"),
        effectiveTo: new Date("2026-10-01T00:00:00.000Z"),
        returnCondition: "结算确认后返还",
        evidenceLevel: "A",
        evidenceCoordinate: "fixture",
        evidenceSha256: "3".repeat(64),
        obligationFingerprint: "c".repeat(64),
        createdByUserId: fixture.recorderId
      }
    });

    await prisma.affiliateClearingAuthorityVersion.update({ where: { id: fixture.authorityId }, data: { status: "confirmed", confirmedByUserId: fixture.directorId, confirmedAt: new Date() } });
    await expectReject(
      prisma.assignedWageAuthorityLine.update({ where: { id: wageLineId }, data: { approvedAmountCents: 9000n } }),
      "确认前工资行不可伪造更新"
    );

    const caseId = `pol214-case-${randomUUID()}`;
    await prisma.clearingCase.create({
      data: {
        id: caseId,
        projectId: fixture.projectId,
        constructionEnterpriseAssignmentId: fixture.assignmentId,
        category: "deposit",
        governedSubjectKey: `construction_enterprise_guarantee/${fixture.projectId}/${fixture.assignmentId}/${guaranteeA.obligationId}`,
        authoritativeGrossCapCents: 10000n,
        authorityVersionId: fixture.authorityId,
        authoritySnapshotRef: `acv_${randomUUID()}`,
        sourceDiscriminator: "construction_enterprise_guarantee",
        coverageKind: "PERSON",
        createdByUserId: fixture.recorderId
      }
    });
    const eventOne = await createSubmittedWithheld(prisma, caseId, 6000n, "pol214-one");
    const eventTwo = await createSubmittedWithheld(prisma, caseId, 6000n, "pol214-two");
    const capOutcomes = await Promise.allSettled([
      first.clearingConfirmation.create({ data: { eventVersionId: eventOne, confirmedByUserId: fixture.directorId, confirmerActorSetSnapshot: [fixture.directorId] } }),
      second.clearingConfirmation.create({ data: { eventVersionId: eventTwo, confirmedByUserId: fixture.directorId, confirmerActorSetSnapshot: [fixture.directorId] } })
    ]);
    if (capOutcomes.filter((outcome) => outcome.status === "fulfilled").length !== 1) fail("两笔并发保证金暂扣未做到恰好一笔成功");

    const sourceVersionId = await createSubmittedWithheld(prisma, caseId, 100n, "pol214-source");
    await prisma.clearingConfirmation.create({ data: { eventVersionId: sourceVersionId, confirmedByUserId: fixture.directorId, confirmerActorSetSnapshot: [fixture.directorId] } });
    const targetOne = await createTargetVersion(prisma, caseId, "pol214-target-one");
    const targetTwo = await createTargetVersion(prisma, caseId, "pol214-target-two");
    const balanceOutcomes = await Promise.allSettled([
      first.clearingAllocation.create({ data: { eventVersionId: targetOne, sourceEventVersionId: sourceVersionId, sourceKind: "withheld", amountCents: 70n, sourceRemainingAfterCents: 30n } }),
      second.clearingAllocation.create({ data: { eventVersionId: targetTwo, sourceEventVersionId: sourceVersionId, sourceKind: "withheld", amountCents: 70n, sourceRemainingAfterCents: 30n } })
    ]);
    if (balanceOutcomes.filter((outcome) => outcome.status === "fulfilled").length !== 1) fail("并发 allocation 未做到恰好一次消费来源余额");
  } finally {
    await Promise.all([first.$disconnect(), second.$disconnect()]);
  }
}

async function createSubmittedWithheld(prisma, caseId, amountCents, prefix) {
  const eventId = `${prefix}-event-${randomUUID()}`;
  const versionId = `${prefix}-version-${randomUUID()}`;
  await prisma.clearingEvent.create({ data: { id: eventId, clearingCaseId: caseId, kind: "withheld", workflowStatus: "submitted", revision: 1, currentVersionNo: 1, createdByUserId: "seed-user-cashier" } });
  await prisma.clearingEventVersion.create({ data: { id: versionId, clearingEventId: eventId, clearingCaseId: caseId, versionNo: 1, workflowStatus: "submitted", amountCents, evidenceLevel: "A", payloadSnapshot: {}, actorSetSnapshot: ["seed-user-cashier"], fingerprint: "d".repeat(64), createdByUserId: "seed-user-cashier" } });
  return versionId;
}

async function createTargetVersion(prisma, caseId, prefix) {
  const eventId = `${prefix}-event-${randomUUID()}`;
  const versionId = `${prefix}-version-${randomUUID()}`;
  await prisma.clearingEvent.create({ data: { id: eventId, clearingCaseId: caseId, kind: "final_confirmed", workflowStatus: "submitted", revision: 1, currentVersionNo: 1, createdByUserId: "seed-user-cashier" } });
  await prisma.clearingEventVersion.create({ data: { id: versionId, clearingEventId: eventId, clearingCaseId: caseId, versionNo: 1, workflowStatus: "submitted", amountCents: 70n, evidenceLevel: "A", payloadSnapshot: {}, actorSetSnapshot: ["seed-user-cashier"], fingerprint: "e".repeat(64), createdByUserId: "seed-user-cashier" } });
  return versionId;
}

async function expectReject(promise, label) {
  try {
    await promise;
  } catch {
    return;
  }
  fail(`${label}未拒绝`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
