import { randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";

import { CompanyRoleResolverService } from "../auth/company-role-resolver.service";
import { AuditService } from "../audit/audit.service";
import { FileService, PrivateFileStorage } from "../file/file.service";
import { OperatingLedgerService } from "../operating-ledger/operating-ledger.service";
import { WageStatementService } from "../wage-statement/wage-statement.service";

type WageSourceInput = Parameters<WageStatementService["createApprovedSource"]>[1];

const TEST_DATABASE = "jiangkong_wage_statement_dynamic_test";
const LIVE_TEST_ENABLED =
  process.env.RUN_WAGE_STATEMENT_DATABASE === "1";

export function wageStatementDatabaseUrl(value: string | undefined) {
  if (!value || process.env.NODE_ENV === "production") {
    throw new Error("工资承担单动态测试必须连接非生产专用数据库");
  }
  const url = new URL(value);
  if (
    !["postgresql:", "postgres:"].includes(url.protocol) ||
    !["127.0.0.1", "localhost", "::1"].includes(url.hostname) ||
    url.pathname !== `/${TEST_DATABASE}`
  ) {
    throw new Error("工资承担单动态测试拒绝非本机专用数据库");
  }
  return url.toString();
}

function wageDownloadTicketInput(downloadUrl: string) {
  const url = new URL(`http://local${downloadUrl}`);
  return {
    actorUserId: url.searchParams.get("actorUserId") ?? "",
    expiresAt: url.searchParams.get("expiresAt") ?? "",
    downloadReason: url.searchParams.get("downloadReason") ?? "",
    accessMode: (url.searchParams.get("accessMode") ?? "download") as "download",
    token: url.searchParams.get("token") ?? ""
  };
}

describe("wage statement database target guard", () => {
  it("rejects a production or non-local database target", () => {
    expect(() =>
      wageStatementDatabaseUrl(
        "postgresql://user:pass@example.com/production"
      )
    ).toThrow("工资承担单动态测试拒绝非本机专用数据库");
  });
});

const databaseUrl = LIVE_TEST_ENABLED
  ? wageStatementDatabaseUrl(process.env.WAGE_STATEMENT_DATABASE_URL)
  : undefined;
const describeDatabase = LIVE_TEST_ENABLED ? describe : describe.skip;

describeDatabase("wage statement PostgreSQL constraints", () => {
  const createClient = () =>
    databaseUrl
      ? new PrismaClient({ datasources: { db: { url: databaseUrl } } })
      : new PrismaClient();
  const first = createClient();
  const second = createClient();
  const observer = createClient();

  afterAll(async () => {
    await Promise.all([first.$disconnect(), second.$disconnect(), observer.$disconnect()]);
  });

  it("allows exactly one statement for a contended employment-company month", async () => {
    const companyId = `wage-company-${randomUUID()}`;
    const wageMonth = "2026-08";
    const attempts = await Promise.allSettled([
      first.wageStatement.create({
        data: { employmentCompanyId: companyId, wageMonth, createdByUserId: "wage-maker-a" }
      }),
      second.wageStatement.create({
        data: { employmentCompanyId: companyId, wageMonth, createdByUserId: "wage-maker-b" }
      })
    ]);

    expect(attempts.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expectUniqueViolation(attempts);
    await expect(
      observer.wageStatement.count({ where: { employmentCompanyId: companyId, wageMonth } })
    ).resolves.toBe(1);

    await observer.wageStatement.deleteMany({
      where: { employmentCompanyId: companyId, wageMonth }
    });
  });

  it("makes one statement command idempotency key resolve to one durable receipt", async () => {
    const statement = await first.wageStatement.create({
      data: {
        employmentCompanyId: `wage-company-${randomUUID()}`,
        wageMonth: "2026-08",
        createdByUserId: "wage-maker"
      }
    });
    const idempotencyKey = randomUUID();
    const attempts = await Promise.allSettled([
      first.wageCommandReceipt.create({
        data: commandReceipt(statement.id, idempotencyKey, "fingerprint-a")
      }),
      second.wageCommandReceipt.create({
        data: commandReceipt(statement.id, idempotencyKey, "fingerprint-b")
      })
    ]);

    expect(attempts.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expectUniqueViolation(attempts);
    await expect(
      observer.wageCommandReceipt.count({ where: { idempotencyKey } })
    ).resolves.toBe(1);

    await observer.wageCommandReceipt.deleteMany({ where: { aggregateId: statement.id } });
    await observer.wageStatement.delete({ where: { id: statement.id } });
  });

  it("allows exactly one version for a statement revision under contention", async () => {
    const evidence = await first.fileObject.create({ data: evidenceFile() });
    const source = await first.wageApprovedSourceVersion.create({
      data: approvedSource(`wage-source-${randomUUID()}`, evidence.id)
    });
    const statement = await first.wageStatement.create({
      data: {
        employmentCompanyId: `wage-company-${randomUUID()}`,
        wageMonth: "2026-08",
        createdByUserId: "wage-maker"
      }
    });
    const attempts = await Promise.allSettled([
      first.wageStatementVersion.create({
        data: statementVersion(statement.id, source.id, "wage-version-a")
      }),
      second.wageStatementVersion.create({
        data: statementVersion(statement.id, source.id, "wage-version-b")
      })
    ]);

    expect(attempts.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expectUniqueViolation(attempts);
    await expect(
      observer.wageStatementVersion.count({ where: { statementId: statement.id, revision: 1 } })
    ).resolves.toBe(1);

    await observer.wageStatementVersion.deleteMany({ where: { statementId: statement.id } });
    await observer.wageStatement.delete({ where: { id: statement.id } });
    // Approved sources are intentionally append-only.  This disposable
    // database is dropped by the dynamic runner, so immutable fixture rows are
    // left in place instead of weakening the production trigger for cleanup.

    await expectCheckViolation(
      first.wageStatement.create({
        data: {
          employmentCompanyId: `wage-company-${randomUUID()}`,
          wageMonth: "2026-13",
          createdByUserId: "wage-maker"
        }
      }),
      "WageStatement_wage_month_check"
    );

    const constraintEvidence = await first.fileObject.create({ data: evidenceFile() });
    await expectCheckViolation(
      first.wageApprovedSourceVersion.create({
        data: approvedSource(`wage-source-${randomUUID()}`, constraintEvidence.id, {
          wageMonth: "2026-00"
        })
      }),
      "WageApprovedSourceVersion_wage_month_check"
    );

    const constraintSource = await first.wageApprovedSourceVersion.create({
      data: approvedSource(`wage-source-${randomUUID()}`, constraintEvidence.id)
    });
    const constraintStatement = await first.wageStatement.create({
      data: {
        employmentCompanyId: `wage-company-${randomUUID()}`,
        wageMonth: "2026-08",
        createdByUserId: "wage-maker"
      }
    });
    const constraintVersion = await first.wageStatementVersion.create({
      data: statementVersion(constraintStatement.id, constraintSource.id, `wage-version-${randomUUID()}`)
    });
    const personLine = await first.wagePersonLine.create({
      data: personLineData(constraintVersion.id)
    });

    await expect(
      first.wageServiceBasisBinding.create({
        data: {
          sourceVersionId: `missing-wage-source-${randomUUID()}`,
          projectId: "wage-project",
          serviceSnapshotId: "service-snapshot",
          serviceMonth: "2026-08",
          evidenceSha256: "a".repeat(64),
          authorityFingerprint: "b".repeat(64)
        }
      })
    ).rejects.toMatchObject({ code: "P2003" });

    await expectCheckViolation(
      first.wagePersonLine.create({
        data: personLineData(constraintVersion.id, { approvedAmountCents: -1n })
      }),
      "WagePersonLine_approved_amount_nonnegative_check"
    );
    await expectCheckViolation(
      first.wageCostComponent.create({
        data: {
          personLineId: personLine.id,
          componentCode: "uncontrolled_component",
          amountCents: 0n,
          sourceSnapshot: {}
        }
      }),
      "WageCostComponent_code_check"
    );
    await expectCheckViolation(
      first.wageCreditorBreakdown.create({
        data: {
          personLineId: personLine.id,
          creditorSubjectId: "wage-creditor",
          creditorCategory: "uncontrolled_creditor",
          amountCents: 0n,
          sourceSnapshot: {}
        }
      }),
      "WageCreditorBreakdown_category_check"
    );
    await expectCheckViolation(
      first.wageStatementVersion.create({
        data: { ...statementVersion(constraintStatement.id, constraintSource.id, `wage-version-${randomUUID()}`), revision: 2, kind: "uncontrolled_kind" }
      }),
      "WageStatementVersion_kind_check"
    );
    await expectCheckViolation(
      first.wageStatementVersion.create({
        data: { ...statementVersion(constraintStatement.id, constraintSource.id, `wage-version-${randomUUID()}`), revision: 2, status: "uncontrolled_status" }
      }),
      "WageStatementVersion_status_check"
    );

    await observer.wagePersonLine.deleteMany({ where: { statementVersionId: constraintVersion.id } });
    await observer.wageStatementVersion.deleteMany({ where: { statementId: constraintStatement.id } });
    await observer.wageStatement.delete({ where: { id: constraintStatement.id } });
    // Keep immutable source/evidence fixtures until the disposable database is
    // dropped by the runner.
  });

  it("serializes same-key source and draft creation before natural uniqueness can preempt replay", async () => {
    const fixture = await seedCanonicalWageFixture(first);
    const sourceInput = canonicalWageSourceInput(fixture);
    const sourceAttempts = await Promise.all([
      wageService(first).createApprovedSource(fixture.preparerUserId, sourceInput),
      wageService(second).createApprovedSource(fixture.preparerUserId, sourceInput)
    ]);
    expect(sourceAttempts[0]).toEqual(sourceAttempts[1]);
    expect(isSourceCreationResult(sourceAttempts[0])).toBe(true);
    await expect(observer.wageApprovedSourceCommandReceipt.count({
      where: { idempotencyKey: sourceInput.idempotencyKey }
    })).resolves.toBe(1);
    await expect(
      wageService(second).createApprovedSource(fixture.preparerUserId, {
        ...sourceInput,
        externalReference: `${sourceInput.externalReference}-changed`
      })
    ).rejects.toThrow("同一幂等键不能用于不同外部工资来源命令");

    const sourceResult = sourceAttempts[0];
    if (!isSourceCreationResult(sourceResult)) throw new Error("并发来源创建未返回正式来源标识");
    const draftInput = {
      sourceVersionId: sourceResult.id,
      idempotencyKey: randomUUID(),
      expectedRevision: 0,
      wageMonth: fixture.wageMonth,
      sourceTotalCents: "100000",
      personLines: [canonicalWagePersonLine(fixture, "100000")]
    };
    const draftAttempts = await Promise.all([
      wageService(first).createDraft(fixture.preparerUserId, draftInput),
      wageService(second).createDraft(fixture.preparerUserId, draftInput)
    ]);
    expect(draftAttempts[0]).toEqual(draftAttempts[1]);
    expect(isDraftCreationResult(draftAttempts[0])).toBe(true);
    await expect(observer.wageCommandReceipt.count({
      where: { idempotencyKey: draftInput.idempotencyKey }
    })).resolves.toBe(1);
    await expect(
      wageService(second).createDraft(fixture.preparerUserId, {
        ...draftInput,
        sourceVersionId: `${sourceResult.id}-changed`
      })
    ).rejects.toThrow("同一幂等键不能用于不同工资承担单命令");
  });

  it("keeps approved sources and submitted wage facts immutable in PostgreSQL", async () => {
    const fixture = await seedCanonicalWageFixture(first);
    const { sourceResult, draftResult } = await createSubmittedCanonicalWage(
      first,
      fixture,
      canonicalWageSourceInput(fixture),
      "100000"
    );
    const graph = await first.wageStatementVersion.findUniqueOrThrow({
      where: { id: draftResult.versionId },
      include: {
        personLines: {
          include: {
            costComponents: true,
            creditorBreakdowns: true,
            projectAllocations: {
              include: { componentAllocations: true, creditorAllocations: true }
            }
          }
        }
      }
    });
    const person = graph.personLines[0]!;
    const allocation = person.projectAllocations[0]!;
    const blocked: Array<() => Promise<unknown>> = [
      () => first.wageApprovedSourceVersion.update({ where: { id: sourceResult.id }, data: { externalReference: "forged" } }),
      () => first.wageApprovedSourceVersion.delete({ where: { id: sourceResult.id } }),
      () => first.wagePersonLine.update({ where: { id: person.id }, data: { approvedAmountCents: 99999n } }),
      () => first.wageCostComponent.update({ where: { id: person.costComponents[0]!.id }, data: { amountCents: 99999n } }),
      () => first.wageCreditorBreakdown.update({ where: { id: person.creditorBreakdowns[0]!.id }, data: { amountCents: 99999n } }),
      () => first.wageProjectAllocation.update({ where: { id: allocation.id }, data: { amountCents: 99999n } }),
      () => first.wageProjectCostComponentAllocation.update({ where: { id: allocation.componentAllocations[0]!.id }, data: { amountCents: 99999n } }),
      () => first.wageProjectCreditorAllocation.update({ where: { id: allocation.creditorAllocations[0]!.id }, data: { amountCents: 99999n } })
    ];
    for (const operation of blocked) {
      await expect(operation()).rejects.toThrow(/immutable/i);
    }
    await expect(first.wagePersonLine.delete({ where: { id: person.id } })).rejects.toThrow(/immutable/i);
  });

  it("edits only the new draft after review return and preserves the returned version history", async () => {
    const fixture = await seedCanonicalWageFixture(first);
    const { service, draftResult } = await createSubmittedCanonicalWage(
      first,
      fixture,
      canonicalWageSourceInput(fixture),
      "100000"
    );
    const returned = await service.returnForReview(fixture.confirmerUserId, draftResult.statementId, {
      idempotencyKey: randomUUID(),
      expectedRevision: 1,
      reason: "调整服务依据"
    });
    if (!isDraftCreationResult(returned)) throw new Error("退回重开未返回正式草稿标识");
    const editedLine = canonicalWagePersonLine(fixture, "100000");
    editedLine.projectAllocations[0]!.serviceSnapshotId = `${fixture.prefix}-service-edited`;
    editedLine.projectCostComponentAllocations[0]!.serviceSnapshotId = `${fixture.prefix}-service-edited`;
    editedLine.projectCreditorAllocations[0]!.serviceSnapshotId = `${fixture.prefix}-service-edited`;
    await service.updateDraft(fixture.preparerUserId, draftResult.statementId, {
      idempotencyKey: randomUUID(),
      expectedRevision: 2,
      wageMonth: fixture.wageMonth,
      sourceTotalCents: "100000",
      personLines: [editedLine]
    });

    const versions = await observer.wageStatementVersion.findMany({
      where: { statementId: draftResult.statementId },
      orderBy: { revision: "asc" },
      include: { personLines: { include: { projectAllocations: true } } }
    });
    expect(returned).toEqual(expect.objectContaining({ revision: 2, status: "draft" }));
    expect(versions[0]).toEqual(expect.objectContaining({ id: draftResult.versionId, status: "superseded" }));
    expect(versions[0]!.personLines[0]!.projectAllocations[0]!.serviceSnapshotId).toBe(`${fixture.prefix}-service`);
    expect(versions[1]).toEqual(expect.objectContaining({ id: returned.versionId, status: "draft" }));
    expect(versions[1]!.personLines[0]!.projectAllocations[0]!.serviceSnapshotId).toBe(`${fixture.prefix}-service-edited`);
  });

  it("rolls back every draft row when a controlled batch insert fails", async () => {
    const fixture = await seedCanonicalWageFixture(first);
    const service = wageService(first);
    const sourceResult = await service.createApprovedSource(
      fixture.preparerUserId,
      canonicalWageSourceInput(fixture)
    );
    if (!isSourceCreationResult(sourceResult)) throw new Error("工资来源创建未返回正式来源标识");
    await first.$executeRawUnsafe(`
      CREATE FUNCTION jg_test_fail_wage_creditor_matrix() RETURNS trigger
      LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'controlled batch failure'; END $$;
    `);
    await first.$executeRawUnsafe(`
      CREATE TRIGGER jg_test_fail_wage_creditor_matrix
      BEFORE INSERT ON "WageProjectCreditorAllocation"
      FOR EACH ROW EXECUTE FUNCTION jg_test_fail_wage_creditor_matrix();
    `);
    try {
      await expect(service.createDraft(fixture.preparerUserId, {
        sourceVersionId: sourceResult.id,
        idempotencyKey: randomUUID(),
        expectedRevision: 0,
        wageMonth: fixture.wageMonth,
        sourceTotalCents: "100000",
        personLines: [canonicalWagePersonLine(fixture, "100000")]
      })).rejects.toThrow("工资项目债权人矩阵批量写入失败");
    } finally {
      await first.$executeRawUnsafe(
        `DROP TRIGGER IF EXISTS jg_test_fail_wage_creditor_matrix ON "WageProjectCreditorAllocation";`
      );
      await first.$executeRawUnsafe(`DROP FUNCTION IF EXISTS jg_test_fail_wage_creditor_matrix();`);
    }
    await expect(observer.wageStatement.count({
      where: { employmentCompanyId: fixture.companyId, wageMonth: fixture.wageMonth }
    })).resolves.toBe(0);
    await expect(observer.wageStatementVersion.count({
      where: { sourceVersionId: sourceResult.id }
    })).resolves.toBe(0);
  });

  it("confirms an ordinary canonical wage source without an envelope payee", async () => {
    const fixture = await seedCanonicalWageFixture(first);
    const sourceInput = canonicalWageSourceInput(fixture);
    const { service, draftResult } = await createSubmittedCanonicalWage(
      first,
      fixture,
      sourceInput,
      "100000"
    );

    await expect(
      service.confirm(fixture.confirmerUserId, draftResult.statementId, {
        idempotencyKey: randomUUID(),
        expectedRevision: 1
      })
    ).resolves.toEqual(expect.objectContaining({
      statementId: draftResult.statementId,
      versionId: draftResult.versionId,
      revision: 1,
      status: "confirmed"
    }));

    const fact = await observer.operatingFact.findFirstOrThrow({
      where: {
        sourceType: "wage_statement_version",
        sourceBusinessId: `${draftResult.versionId}:${fixture.projectId}`
      }
    });
    expect(fact).toEqual(expect.objectContaining({
      projectId: fixture.projectId,
      factKind: "project_wage",
      debtorSubjectKind: "participating_company",
      debtorSubjectId: fixture.companyId,
      costBearingCompanySubjectKind: "participating_company",
      costBearingCompanySubjectId: fixture.companyId,
      creditorSubjectKind: null,
      creditorSubjectId: null,
      payeeSubjectKind: null,
      payeeSubjectId: null
    }));
    await expect(observer.wagePayableRef.findMany({
      where: { confirmedVersionId: draftResult.versionId },
      select: {
        projectId: true,
        debtorCompanyId: true,
        costBearingCompanyId: true,
        personLine: { select: { employeeId: true } },
        creditorBreakdown: { select: { creditorUserId: true } },
        amountCents: true
      }
    })).resolves.toEqual([{
      projectId: fixture.projectId,
      debtorCompanyId: fixture.companyId,
      costBearingCompanyId: fixture.companyId,
      personLine: { employeeId: fixture.employeeUserId },
      creditorBreakdown: { creditorUserId: fixture.employeeUserId },
      amountCents: 100000n
    }]);
  });

  it("rejects forged canonical coordinates, envelope payees and payable-ref drift", async () => {
    const fixture = await seedCanonicalWageFixture(first);
    const sourceInput = canonicalWageSourceInput(fixture);
    const { draftResult } = await createSubmittedCanonicalWage(
      first,
      fixture,
      sourceInput,
      "100000"
    );
    const confirmedAt = new Date();
    const projectSnapshot = {
      formalStatus: "confirmed",
      projectionOrigin: "ordinary",
      wageStatementVersionId: draftResult.versionId,
      sourceVersion: "1",
      wageVersionKind: "base",
      projectId: fixture.projectId,
      occurredAt: "2026-08-31T00:00:00.000Z",
      confirmedAt: confirmedAt.toISOString(),
      confirmedByUserId: fixture.confirmerUserId,
      employmentCompanyId: fixture.companyId,
      operatingLedgerEffectiveDate: "2026-08-01T00:00:00.000Z",
      affiliate: {
        assignmentId: fixture.affiliateAssignmentId,
        businessPartyVersionId: fixture.affiliateVersionId,
        name: "测试施工企业",
        creditCode: fixture.affiliateCreditCode
      },
      payableRefIds: ["forged-payable-ref"],
      costDeltaCells: []
    };
    await first.wageStatementVersion.update({
      where: { id: draftResult.versionId },
      data: {
        operatingProjectionSnapshot: {
          formalStatus: "confirmed",
          wageStatementVersionId: draftResult.versionId,
          sourceVersion: "1",
          wageVersionKind: "base",
          projects: { [fixture.projectId]: projectSnapshot }
        }
      }
    });
    const canonicalCandidate = canonicalOperatingFactCandidate(
      fixture,
      draftResult.versionId,
      confirmedAt,
      projectSnapshot
    );

    await expectCanonicalGuardRejection(
      first,
      { ...canonicalCandidate, sourceBusinessId: `forged:${fixture.projectId}` },
      "必须引用待确认的真实工资版本"
    );
    await expectCanonicalGuardRejection(
      first,
      { ...canonicalCandidate, payeeSubjectKind: "employee", payeeSubjectId: fixture.employeeUserId },
      "不得设置聚合收款主体"
    );
    await expectCanonicalGuardRejection(
      first,
      { ...canonicalCandidate, sourceVersion: 2 },
      "必须引用待确认的真实工资版本"
    );
    await expectCanonicalGuardRejection(
      first,
      {
        ...canonicalCandidate,
        debtorSubjectId: `${fixture.companyId}-forged`,
        costBearingCompanySubjectId: `${fixture.companyId}-forged`
      },
      "必须引用待确认的真实工资版本"
    );
    await expectCanonicalGuardRejection(
      first,
      canonicalCandidate,
      "不可变工资应付引用集合不一致"
    );

    await expect(observer.operatingFact.count({
      where: {
        sourceType: "wage_statement_version",
        sourceBusinessId: `${draftResult.versionId}:${fixture.projectId}`
      }
    })).resolves.toBe(0);
  });

  it("rolls back payable refs and the version transition when the canonical project context fails", async () => {
    const fixture = await seedCanonicalWageFixture(first);
    const sourceInput = canonicalWageSourceInput(fixture);
    const { service, draftResult } = await createSubmittedCanonicalWage(
      first,
      fixture,
      sourceInput,
      "100000"
    );
    await seedFallbackProjectParticipant(first, fixture);
    await first.projectParticipatingCompany.delete({ where: { id: fixture.participantId } });

    await expect(service.confirm(fixture.confirmerUserId, draftResult.statementId, {
      idempotencyKey: randomUUID(),
      expectedRevision: 1
    })).rejects.toThrow("工资劳动关系公司不是项目事实日有效参与公司");

    await expect(observer.wagePayableRef.count({
      where: { confirmedVersionId: draftResult.versionId }
    })).resolves.toBe(0);
    await expect(observer.operatingFact.count({
      where: {
        sourceType: "wage_statement_version",
        sourceBusinessId: `${draftResult.versionId}:${fixture.projectId}`
      }
    })).resolves.toBe(0);
    await expect(observer.wageStatementVersion.findUniqueOrThrow({
      where: { id: draftResult.versionId },
      select: { status: true, confirmedAt: true, confirmedByUserId: true }
    })).resolves.toEqual({ status: "submitted", confirmedAt: null, confirmedByUserId: null });
  });

  it("rejects evidence drift committed while confirmation waits in the stable lock sequence", async () => {
    const fixture = await seedCanonicalWageFixture(first);
    const { draftResult } = await createSubmittedCanonicalWage(
      first,
      fixture,
      canonicalWageSourceInput(fixture),
      "100000"
    );
    let confirmation: Promise<unknown> | undefined;
    await first.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`
        SELECT "id" FROM "FileObject" WHERE "id" = ${fixture.evidenceFileId} FOR UPDATE
      `);
      confirmation = wageService(second).confirm(fixture.confirmerUserId, draftResult.statementId, {
        idempotencyKey: randomUUID(),
        expectedRevision: 1
      });
      await new Promise((resolve) => setTimeout(resolve, 100));
      await tx.fileObject.update({
        where: { id: fixture.evidenceFileId },
        data: { contentSha256: "b".repeat(64) }
      });
    });
    if (!confirmation) throw new Error("工资确认并发测试未启动");
    await expect(confirmation).rejects.toThrow("外部批准工资资料证据已失效或校验值漂移");
    await expect(observer.wageStatementVersion.findUniqueOrThrow({
      where: { id: draftResult.versionId },
      select: { status: true, confirmedAt: true }
    })).resolves.toEqual({ status: "submitted", confirmedAt: null });
  });

  it("linearizes a sensitive wage read against concurrent global-role revocation", async () => {
    const fixture = await seedCanonicalWageFixture(first);
    const { draftResult } = await createSubmittedCanonicalWage(
      first,
      fixture,
      canonicalWageSourceInput(fixture),
      "100000"
    );
    const advisoryKey = 262_001;
    const pauseFunction = "jg_test_pause_wage_sensitive_read_audit";
    const pauseTrigger = "jg_test_pause_wage_sensitive_read_audit_trigger";
    let releaseBarrier: () => void = () => {};
    const barrier = new Promise<void>((resolve) => {
      releaseBarrier = resolve;
    });
    let announceLock: () => void = () => {};
    const lockReady = new Promise<void>((resolve) => {
      announceLock = resolve;
    });

    await first.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION ${pauseFunction}() RETURNS trigger AS $$
      BEGIN
        IF NEW.action = 'wage_sensitive_read' THEN
          PERFORM pg_advisory_xact_lock(${advisoryKey});
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await first.$executeRawUnsafe(`
      CREATE TRIGGER ${pauseTrigger}
      BEFORE INSERT ON "AuditLog"
      FOR EACH ROW EXECUTE FUNCTION ${pauseFunction}()
    `);

    const advisoryOwner = observer.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT pg_advisory_lock(${advisoryKey})::TEXT AS "lockAcquired"`);
      announceLock();
      await barrier;
      await tx.$queryRaw(Prisma.sql`SELECT pg_advisory_unlock(${advisoryKey})::TEXT AS "lockReleased"`);
    });
    await lockReady;

    let sensitiveRead: Promise<unknown> | undefined;
    let revocation: Promise<unknown> | undefined;
    let revocationCommittedBeforeReadAudit = false;
    try {
      sensitiveRead = wageService(first).readImportPreview(
        fixture.preparerUserId,
        draftResult.statementId
      );
      let auditReachedBarrier = false;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const [waiter] = await second.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
          SELECT COUNT(*)::BIGINT AS count
          FROM pg_locks
          WHERE locktype = 'advisory' AND NOT granted
        `);
        if ((waiter?.count ?? 0n) > 0n) {
          auditReachedBarrier = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(auditReachedBarrier).toBe(true);

      revocation = second.userPosition.delete({
        where: { id: `${fixture.prefix}-preparer-position` }
      });
      revocationCommittedBeforeReadAudit = await Promise.race([
        revocation.then(() => true),
        new Promise<false>((resolve) => setTimeout(() => resolve(false), 500))
      ]);
    } finally {
      releaseBarrier();
      await advisoryOwner;
    }

    const preview = await sensitiveRead;
    await revocation;
    await first.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${pauseTrigger} ON "AuditLog"`);
    await first.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${pauseFunction}()`);

    expect(revocationCommittedBeforeReadAudit).toBe(false);
    expect(preview).toEqual(expect.objectContaining({
      wageMonth: fixture.wageMonth,
      personLineCount: 1
    }));
    await expect(wageService(first).readImportPreview(
      fixture.preparerUserId,
      draftResult.statementId
    )).rejects.toThrow("当前公司岗位无权查看工资汇总");
    await expect(observer.auditLog.count({
      where: {
        actorUserId: fixture.preparerUserId,
        businessId: draftResult.statementId,
        action: "wage_sensitive_read.denied"
      }
    })).resolves.toBe(1);
  }, 20_000);

  it("rejects confirmation after a concurrent global-role revocation linearizes first", async () => {
    const fixture = await seedCanonicalWageFixture(first);
    const { draftResult } = await createSubmittedCanonicalWage(
      first,
      fixture,
      canonicalWageSourceInput(fixture),
      "100000"
    );
    const idempotencyKey = randomUUID();
    let releaseRevocation: () => void = () => {};
    const revocationBarrier = new Promise<void>((resolve) => {
      releaseRevocation = resolve;
    });
    let announceRevocation: () => void = () => {};
    const revocationReady = new Promise<void>((resolve) => {
      announceRevocation = resolve;
    });
    let revocationBackendPid = 0;

    const revocation = first.$transaction(async (tx) => {
      const [backend] = await tx.$queryRaw<Array<{ pid: number }>>(
        Prisma.sql`SELECT pg_backend_pid()::INTEGER AS pid`
      );
      revocationBackendPid = backend?.pid ?? 0;
      await tx.userPosition.delete({
        where: { id: `${fixture.prefix}-confirmer-position` }
      });
      announceRevocation();
      await revocationBarrier;
    });
    await revocationReady;

    let confirmation: Promise<unknown> | undefined;
    let confirmationSettledBeforeRevocationCommit = false;
    let confirmationBlockedOnRevocation = false;
    try {
      confirmation = wageService(second).confirm(
        fixture.confirmerUserId,
        draftResult.statementId,
        { idempotencyKey, expectedRevision: 1 }
      );
      void confirmation.then(
        () => { confirmationSettledBeforeRevocationCommit = true; },
        () => { confirmationSettledBeforeRevocationCommit = true; }
      );
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const [waiter] = await observer.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
          SELECT COUNT(*)::BIGINT AS count
          FROM pg_stat_activity activity
          WHERE ${revocationBackendPid} = ANY(pg_blocking_pids(activity.pid))
        `);
        if ((waiter?.count ?? 0n) > 0n) {
          confirmationBlockedOnRevocation = true;
          break;
        }
        if (confirmationSettledBeforeRevocationCommit) break;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    } finally {
      releaseRevocation();
      await revocation;
    }

    expect(confirmationSettledBeforeRevocationCommit).toBe(false);
    expect(confirmationBlockedOnRevocation).toBe(true);
    if (!confirmation) throw new Error("工资确认撤权线性化测试未启动");
    await expect(confirmation).rejects.toThrow("当前公司岗位无权确认工资承担单");
    await expect(observer.wageStatementVersion.findUniqueOrThrow({
      where: { id: draftResult.versionId },
      select: { status: true, confirmedAt: true, confirmedByUserId: true }
    })).resolves.toEqual({ status: "submitted", confirmedAt: null, confirmedByUserId: null });
    await expect(observer.wagePayableRef.count({
      where: { confirmedVersionId: draftResult.versionId }
    })).resolves.toBe(0);
    await expect(observer.operatingFact.count({
      where: {
        sourceType: "wage_statement_version",
        sourceBusinessId: `${draftResult.versionId}:${fixture.projectId}`
      }
    })).resolves.toBe(0);
    await expect(observer.wageCommandReceipt.count({
      where: { idempotencyKey }
    })).resolves.toBe(0);
    await expect(observer.auditLog.count({
      where: {
        actorUserId: fixture.confirmerUserId,
        businessId: draftResult.versionId,
        action: "wage_statement.confirm"
      }
    })).resolves.toBe(0);
  }, 20_000);

  it("rechecks a wage-evidence ticket after role revocation or account disable and persists reason-only deny audits", async () => {
    const fixture = await seedCanonicalWageFixture(first);
    const source = await wageService(first).createApprovedSource(
      fixture.preparerUserId,
      canonicalWageSourceInput(fixture)
    );
    if (!isSourceCreationResult(source)) throw new Error("工资来源创建未返回正式来源标识");
    const storage = {
      read: jest.fn().mockRejectedValue(new Error("denied reads must not reach storage"))
    } as unknown as PrivateFileStorage;
    const files = new FileService(
      first as never,
      new AuditService(),
      storage,
      undefined,
      new CompanyRoleResolverService(first as never)
    );
    const revokedReason = "岗位撤销后的工资依据复核";
    const revokedTicket = await files.createDownloadTicket(fixture.evidenceFileId, {
      actorUserId: fixture.preparerUserId,
      downloadReason: revokedReason
    });
    await second.userPosition.delete({
      where: { id: `${fixture.prefix}-preparer-position` }
    });
    await expect(files.readPrivateFile(
      fixture.evidenceFileId,
      wageDownloadTicketInput(revokedTicket.downloadUrl)
    )).rejects.toThrow("当前账号无权下载工资敏感依据");

    const financeStaff = await second.position.findUniqueOrThrow({
      where: { key: "finance_staff" },
      select: { id: true }
    });
    await second.userPosition.create({
      data: {
        id: `${fixture.prefix}-preparer-position-restored`,
        userId: fixture.preparerUserId,
        positionId: financeStaff.id
      }
    });
    const disabledReason = "账号停用后的工资依据复核";
    const disabledTicket = await files.createDownloadTicket(fixture.evidenceFileId, {
      actorUserId: fixture.preparerUserId,
      downloadReason: disabledReason
    });
    await second.user.update({
      where: { id: fixture.preparerUserId },
      data: { isActive: false }
    });
    await expect(files.readPrivateFile(
      fixture.evidenceFileId,
      wageDownloadTicketInput(disabledTicket.downloadUrl)
    )).rejects.toThrow("当前账号无权下载工资敏感依据");

    const attempts = await observer.auditLog.findMany({
      where: {
        actorUserId: fixture.preparerUserId,
        businessId: fixture.evidenceFileId,
        action: { in: ["file.download.ticket", "wage_sensitive_download.denied"] }
      },
      orderBy: { createdAt: "asc" },
      select: { action: true, metadata: true }
    });
    expect(attempts.filter((attempt) => attempt.action === "file.download.ticket")).toHaveLength(2);
    expect(attempts.filter((attempt) => attempt.action === "wage_sensitive_download.denied")).toEqual([
      {
        action: "wage_sensitive_download.denied",
        metadata: {
          reasonCode: "wage_sensitive_download_not_authorized",
          downloadReason: revokedReason
        }
      },
      {
        action: "wage_sensitive_download.denied",
        metadata: {
          reasonCode: "wage_sensitive_download_not_authorized",
          downloadReason: disabledReason
        }
      }
    ]);
    const auditPayload = JSON.stringify(attempts);
    expect(auditPayload).not.toContain("token");
    expect(auditPayload).not.toContain("100000");
    expect(auditPayload).not.toContain("sourceSnapshot");
    expect(storage.read).not.toHaveBeenCalled();
  });

  it("audits an expired wage-evidence ticket attempt without sensitive metadata", async () => {
    const fixture = await seedCanonicalWageFixture(first);
    const source = await wageService(first).createApprovedSource(
      fixture.preparerUserId,
      canonicalWageSourceInput(fixture)
    );
    if (!isSourceCreationResult(source)) throw new Error("工资来源创建未返回正式来源标识");
    const storage = {
      read: jest.fn().mockRejectedValue(new Error("denied reads must not reach storage"))
    } as unknown as PrivateFileStorage;
    const files = new FileService(
      first as never,
      new AuditService(),
      storage,
      undefined,
      new CompanyRoleResolverService(first as never)
    );
    const expiredTicket = await files.createDownloadTicket(fixture.evidenceFileId, {
      actorUserId: fixture.preparerUserId,
      downloadReason: "过期工资依据复核"
    });
    const expiredInput = wageDownloadTicketInput(expiredTicket.downloadUrl);
    const dateNow = jest.spyOn(Date, "now").mockReturnValue(Date.parse(expiredInput.expiresAt) + 1);
    try {
      await expect(files.readPrivateFile(fixture.evidenceFileId, expiredInput))
        .rejects.toThrow("下载链接已过期，请重新申请下载");
    } finally {
      dateNow.mockRestore();
    }

    const attempts = await observer.auditLog.findMany({
      where: {
        action: "wage_sensitive_download.denied",
        metadata: { equals: { reasonCode: "wage_sensitive_download_ticket_expired" } }
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 1,
      select: { actorUserId: true, action: true, businessId: true, metadata: true }
    });
    expect(attempts).toEqual([{
      actorUserId: null,
      action: "wage_sensitive_download.denied",
      businessId: null,
      metadata: { reasonCode: "wage_sensitive_download_ticket_expired" }
    }]);
    const auditPayload = JSON.stringify(attempts);
    expect(auditPayload).not.toContain(expiredInput.token);
    expect(auditPayload).not.toContain("100000");
    expect(auditPayload).not.toContain("approvedPersonLines");
    expect(auditPayload).not.toContain("外部批准工资资料.json");
    expect(auditPayload).not.toContain("复核");
    expect(storage.read).not.toHaveBeenCalled();
  });

  it("audits an invalid wage-evidence token attempt without sensitive metadata", async () => {
    const fixture = await seedCanonicalWageFixture(first);
    const source = await wageService(first).createApprovedSource(
      fixture.preparerUserId,
      canonicalWageSourceInput(fixture)
    );
    if (!isSourceCreationResult(source)) throw new Error("工资来源创建未返回正式来源标识");
    const storage = {
      read: jest.fn().mockRejectedValue(new Error("denied reads must not reach storage"))
    } as unknown as PrivateFileStorage;
    const files = new FileService(
      first as never,
      new AuditService(),
      storage,
      undefined,
      new CompanyRoleResolverService(first as never)
    );
    const invalidTicket = await files.createDownloadTicket(fixture.evidenceFileId, {
      actorUserId: fixture.preparerUserId,
      downloadReason: "无效工资依据复核"
    });
    const invalidInput = wageDownloadTicketInput(invalidTicket.downloadUrl);
    const signedToken = invalidInput.token;
    await expect(files.readPrivateFile(fixture.evidenceFileId, {
      ...invalidInput,
      token: `invalid-${signedToken}`
    })).rejects.toThrow("下载链接校验失败，请重新申请下载");

    const attempts = await observer.auditLog.findMany({
      where: {
        action: "wage_sensitive_download.denied",
        metadata: { equals: { reasonCode: "wage_sensitive_download_ticket_invalid" } }
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 1,
      select: { actorUserId: true, action: true, businessId: true, metadata: true }
    });
    expect(attempts).toEqual([{
      actorUserId: null,
      action: "wage_sensitive_download.denied",
      businessId: null,
      metadata: { reasonCode: "wage_sensitive_download_ticket_invalid" }
    }]);
    const auditPayload = JSON.stringify(attempts);
    expect(auditPayload).not.toContain(signedToken);
    expect(auditPayload).not.toContain("100000");
    expect(auditPayload).not.toContain("approvedPersonLines");
    expect(auditPayload).not.toContain("外部批准工资资料.json");
    expect(auditPayload).not.toContain("复核");
    expect(storage.read).not.toHaveBeenCalled();
  });

  it("prevents a second public wage source from creating an ambiguous evidence binding", async () => {
    const fixture = await seedCanonicalWageFixture(first);
    const source = await wageService(first).createApprovedSource(
      fixture.preparerUserId,
      canonicalWageSourceInput(fixture)
    );
    if (!isSourceCreationResult(source)) throw new Error("工资来源创建未返回正式来源标识");

    await expect(wageService(first).createApprovedSource(fixture.preparerUserId, {
      ...canonicalWageSourceInput(fixture),
      idempotencyKey: randomUUID(),
      externalReference: `${fixture.prefix}-DUPLICATE`,
      sourceVersion: "v2"
    })).rejects.toThrow("该我方公司的外部工资来源版本已存在");
    await expect(observer.wageApprovedSourceVersion.count({
      where: { evidenceFileId: fixture.evidenceFileId }
    })).resolves.toBe(1);
  });

  it("keeps SoD, active identity, idempotency and concurrent confirmation intact", async () => {
    const fixture = await seedCanonicalWageFixture(first);
    const { service, draftResult } = await createSubmittedCanonicalWage(
      first,
      fixture,
      canonicalWageSourceInput(fixture),
      "100000"
    );
    const directorPosition = await first.position.findUniqueOrThrow({
      where: { key: "finance_director" },
      select: { id: true }
    });
    await first.userPosition.create({
      data: {
        id: `${fixture.prefix}-preparer-director-position`,
        userId: fixture.preparerUserId,
        positionId: directorPosition.id
      }
    });

    await expect(service.confirm(fixture.preparerUserId, draftResult.statementId, {
      idempotencyKey: randomUUID(),
      expectedRevision: 1
    })).rejects.toThrow("职责分离冲突");
    await first.user.update({
      where: { id: fixture.confirmerUserId },
      data: { isActive: false }
    });
    await expect(service.confirm(fixture.confirmerUserId, draftResult.statementId, {
      idempotencyKey: randomUUID(),
      expectedRevision: 1
    })).rejects.toThrow();
    await first.user.update({
      where: { id: fixture.confirmerUserId },
      data: { isActive: true }
    });

    const idempotencyKey = randomUUID();
    const attempts = await Promise.allSettled([
      service.confirm(fixture.confirmerUserId, draftResult.statementId, {
        idempotencyKey,
        expectedRevision: 1
      }),
      wageService(second).confirm(fixture.confirmerUserId, draftResult.statementId, {
        idempotencyKey,
        expectedRevision: 1
      })
    ]);
    expect(attempts.every((attempt) => attempt.status === "fulfilled")).toBe(true);
    expect(attempts[0]).toEqual(attempts[1]);
    await expect(observer.wageCommandReceipt.count({ where: { idempotencyKey } })).resolves.toBe(1);
    await expect(observer.wagePayableRef.count({
      where: { confirmedVersionId: draftResult.versionId }
    })).resolves.toBe(1);
    await expect(observer.operatingFact.count({
      where: {
        sourceType: "wage_statement_version",
        sourceBusinessId: `${draftResult.versionId}:${fixture.projectId}`
      }
    })).resolves.toBe(1);
  });

  it("applies SoD only to active standing or exact current-version delegation closures", async () => {
    const fixture = await seedCanonicalWageFixture(first);
    const editorUserId = `${fixture.prefix}-editor`;
    const submitterUserId = `${fixture.prefix}-submitter`;
    await first.user.createMany({
      data: [
        { id: editorUserId, name: "工资编辑人", mustChangePassword: false, isActive: true },
        { id: submitterUserId, name: "工资提交人", mustChangePassword: false, isActive: true }
      ]
    });
    const [financeStaff, financeDirector] = await Promise.all([
      first.position.findUniqueOrThrow({ where: { key: "finance_staff" }, select: { id: true } }),
      first.position.findUniqueOrThrow({ where: { key: "finance_director" }, select: { id: true } })
    ]);
    await first.userPosition.createMany({
      data: [
        { id: `${fixture.prefix}-preparer-director`, userId: fixture.preparerUserId, positionId: financeDirector.id },
        { id: `${fixture.prefix}-editor-staff`, userId: editorUserId, positionId: financeStaff.id },
        { id: `${fixture.prefix}-editor-director`, userId: editorUserId, positionId: financeDirector.id },
        { id: `${fixture.prefix}-submitter-staff`, userId: submitterUserId, positionId: financeStaff.id },
        { id: `${fixture.prefix}-submitter-director`, userId: submitterUserId, positionId: financeDirector.id }
      ]
    });
    const service = wageService(first);
    const sourceResult = await service.createApprovedSource(
      fixture.preparerUserId,
      canonicalWageSourceInput(fixture)
    );
    if (!isSourceCreationResult(sourceResult)) throw new Error("工资来源创建未返回正式来源标识");
    const draftResult = await service.createDraft(fixture.preparerUserId, {
      sourceVersionId: sourceResult.id,
      idempotencyKey: randomUUID(),
      expectedRevision: 0,
      wageMonth: fixture.wageMonth,
      sourceTotalCents: "100000",
      personLines: [canonicalWagePersonLine(fixture, "100000")]
    });
    if (!isDraftCreationResult(draftResult)) throw new Error("工资草稿创建未返回正式单据标识");
    await service.updateDraft(editorUserId, draftResult.statementId, {
      idempotencyKey: randomUUID(),
      expectedRevision: 1,
      wageMonth: fixture.wageMonth,
      sourceTotalCents: "100000",
      personLines: [canonicalWagePersonLine(fixture, "100000")]
    });
    await service.submit(submitterUserId, draftResult.statementId, {
      idempotencyKey: randomUUID(),
      expectedRevision: 1
    });
    await expect(observer.wageStatementVersion.findUniqueOrThrow({
      where: { id: draftResult.versionId },
      select: { createdByUserId: true, lastEditedByUserId: true, submittedByUserId: true }
    })).resolves.toEqual({
      createdByUserId: fixture.preparerUserId,
      lastEditedByUserId: editorUserId,
      submittedByUserId: submitterUserId
    });

    const participants = [fixture.preparerUserId, editorUserId, submitterUserId];
    for (const participantUserId of participants) {
      await expect(service.confirm(participantUserId, draftResult.statementId, {
        idempotencyKey: randomUUID(),
        expectedRevision: 1
      })).rejects.toThrow("职责分离冲突");
    }
    const activeFrom = new Date("2026-01-01T00:00:00.000Z");
    const activeUntil = new Date("2030-01-01T00:00:00.000Z");
    for (const participantUserId of participants) {
      for (const scope of [
        {},
        {
          actionKey: "wage_statement.confirm",
          resourceType: "wage_statement_version",
          resourceId: draftResult.versionId
        }
      ]) {
        const delegation = await first.approvalDelegation.create({
          data: {
            fromUserId: participantUserId,
            toUserId: fixture.confirmerUserId,
            startsAt: activeFrom,
            endsAt: activeUntil,
            ...scope
          }
        });
        await expect(service.confirm(fixture.confirmerUserId, draftResult.statementId, {
          idempotencyKey: randomUUID(),
          expectedRevision: 1
        })).rejects.toThrow("职责分离冲突");
        await first.approvalDelegation.delete({ where: { id: delegation.id } });
      }
    }

    await expect(first.approvalDelegation.create({
      data: {
        fromUserId: fixture.preparerUserId,
        toUserId: fixture.confirmerUserId,
        startsAt: activeFrom,
        endsAt: activeUntil,
        actionKey: null,
        resourceType: "wage_statement_version",
        resourceId: draftResult.versionId
      }
    })).rejects.toThrow("ApprovalDelegation_scope_all_or_none");

    await first.approvalDelegation.createMany({
      data: [
        {
          fromUserId: fixture.preparerUserId,
          toUserId: fixture.confirmerUserId,
          startsAt: activeFrom,
          endsAt: activeUntil,
          actionKey: "payment.confirm",
          resourceType: "wage_statement_version",
          resourceId: draftResult.versionId
        },
        {
          fromUserId: editorUserId,
          toUserId: fixture.confirmerUserId,
          startsAt: activeFrom,
          endsAt: activeUntil,
          actionKey: "wage_statement.confirm",
          resourceType: "wage_statement",
          resourceId: draftResult.versionId
        },
        {
          fromUserId: submitterUserId,
          toUserId: fixture.confirmerUserId,
          startsAt: activeFrom,
          endsAt: activeUntil,
          actionKey: "wage_statement.confirm",
          resourceType: "wage_statement_version",
          resourceId: "wrong-version"
        },
        {
          fromUserId: editorUserId,
          toUserId: fixture.confirmerUserId,
          startsAt: new Date("2025-01-01T00:00:00.000Z"),
          endsAt: new Date("2026-01-01T00:00:00.000Z")
        },
        {
          fromUserId: fixture.preparerUserId,
          toUserId: fixture.confirmerUserId,
          startsAt: activeFrom,
          endsAt: activeUntil,
          enabled: false
        },
        {
          fromUserId: submitterUserId,
          toUserId: fixture.confirmerUserId,
          startsAt: activeFrom,
          endsAt: activeUntil
        }
      ]
    });
    await first.user.update({ where: { id: submitterUserId }, data: { isActive: false } });
    await expect(service.confirm(fixture.confirmerUserId, draftResult.statementId, {
      idempotencyKey: randomUUID(),
      expectedRevision: 1
    })).resolves.toEqual({
      statementId: draftResult.statementId,
      versionId: draftResult.versionId,
      revision: 1,
      status: "confirmed"
    });
    await expect(observer.wageStatementVersion.findUniqueOrThrow({
      where: { id: draftResult.versionId },
      select: { status: true, confirmedByUserId: true }
    })).resolves.toEqual({ status: "confirmed", confirmedByUserId: fixture.confirmerUserId });
  });

  it("keeps the existing payee requirement for every other project wage source", async () => {
    const fixture = await seedCanonicalWageFixture(first);
    const ledger = new OperatingLedgerService(first as never);
    const occurredAt = new Date("2026-08-31T00:00:00.000Z");
    const confirmedAt = new Date();
    const baseInput = {
      projectId: fixture.projectId,
      sourceType: "legacy_project_wage_test",
      sourceBusinessId: `${fixture.prefix}-legacy-wage`,
      sourceBusinessCode: "旧工资事实动态回归",
      sourceVersion: 1,
      idempotencyKey: randomUUID(),
      occurredAt,
      confirmedAt,
      confirmedByUserId: fixture.confirmerUserId,
      factKind: "project_wage" as const,
      operatingLevel: "participating_company" as const,
      evidenceLevel: "A" as const,
      amountCents: 100n,
      currencyCode: "CNY",
      direction: "neutral" as const,
      isBeforeOperatingLedgerEffectiveDate: false,
      affiliateAssignmentId: fixture.affiliateAssignmentId,
      affiliateBusinessPartyVersionId: fixture.affiliateVersionId,
      affiliateNameSnapshot: "测试施工企业",
      affiliateCreditCodeSnapshot: fixture.affiliateCreditCode,
      sourceSnapshot: {},
      subjects: {
        costBearingCompany: { kind: "participating_company" as const, id: fixture.companyId }
      },
      impacts: [{
        idempotencyKey: randomUUID(),
        sourceImpactKey: "cost",
        impactKind: "confirmed_cost" as const,
        amountCents: 100n,
        direction: "increase" as const,
        subjectRole: "cost_bearing_company" as const,
        subject: { kind: "participating_company" as const, id: fixture.companyId },
        costCategoryCode: "crew_and_labor" as const,
        impactSnapshot: {}
      }]
    };

    await expect(first.$transaction((tx) =>
      ledger.appendConfirmedSourceInTransaction(
        tx as never,
        baseInput,
        fixture.confirmerUserId
      )
    )).rejects.toThrow("事实种类project_wage必须填写payee主体");

    await expect(first.$transaction((tx) =>
      ledger.appendConfirmedSourceInTransaction(
        tx as never,
        {
          ...baseInput,
          sourceBusinessId: `${fixture.prefix}-legacy-wage-valid`,
          idempotencyKey: randomUUID(),
          subjects: {
            ...baseInput.subjects,
            payee: { kind: "construction_enterprise" as const, id: fixture.affiliatePartyId }
          }
        },
        fixture.confirmerUserId
      )
    )).resolves.toEqual(expect.objectContaining({
      projectId: fixture.projectId,
      sourceType: "legacy_project_wage_test"
    }));
  });

  it("keeps multiple people, creditors and projects balanced under the employment company", async () => {
    const fixture = await seedCanonicalWageFixture(first);
    const secondProject = await seedAdditionalProjectContext(first, fixture, "P2");
    const secondEmployeeUserId = `${fixture.prefix}-employee-2`;
    const externalCreditorPartyId = `${fixture.prefix}-social-party`;
    const externalCreditorVersionId = `${fixture.prefix}-social-party-v1`;
    await first.user.create({
      data: { id: secondEmployeeUserId, name: "项目员工乙", mustChangePassword: false, isActive: true }
    });
    await first.businessParty.create({
      data: {
        id: externalCreditorPartyId,
        name: "测试社保机构",
        normalizedName: `${fixture.prefix}-social-party`,
        unifiedSocialCreditCode: `91330000${fixture.prefix.slice(-10)}`,
        createdByUserId: fixture.preparerUserId
      }
    });
    await first.businessPartyVersion.create({
      data: {
        id: externalCreditorVersionId,
        businessPartyId: externalCreditorPartyId,
        versionNo: 1,
        snapshot: {
          name: "测试社保机构",
          unifiedSocialCreditCode: `91330000${fixture.prefix.slice(-10)}`
        },
        createdByUserId: fixture.preparerUserId
      }
    });
    const employeeLine = {
      employeeId: fixture.employeeUserId,
      employmentSnapshotId: `${fixture.prefix}-employment-a`,
      employmentCompanyId: fixture.companyId,
      employmentPeriodStart: "2026-08-01",
      employmentPeriodEnd: "2026-08-31",
      positionCategory: "project_manager",
      approvedAmountCents: "100000",
      costComponents: [
        { componentCode: "gross_wage", amountCents: "70000" },
        { componentCode: "employer_social_insurance", amountCents: "30000" }
      ],
      creditorBreakdowns: [
        { creditorSubjectType: "employee_user" as const, creditorUserId: fixture.employeeUserId, creditorCategory: "employee_net_pay", amountCents: "70000" },
        { creditorSubjectType: "business_party" as const, creditorBusinessPartyVersionId: externalCreditorVersionId, creditorCategory: "employer_social_insurance", amountCents: "30000" }
      ],
      projectAllocations: [
        { projectId: fixture.projectId, serviceSnapshotId: `${fixture.prefix}-service-a1`, serviceMonth: fixture.wageMonth, serviceEvidenceSha256: "a".repeat(64), amountCents: "60000" },
        { projectId: secondProject.projectId, serviceSnapshotId: `${fixture.prefix}-service-a2`, serviceMonth: fixture.wageMonth, serviceEvidenceSha256: "a".repeat(64), amountCents: "40000" }
      ],
      projectCostComponentAllocations: [
        { projectId: fixture.projectId, serviceSnapshotId: `${fixture.prefix}-service-a1`, componentCode: "gross_wage", amountCents: "40000" },
        { projectId: fixture.projectId, serviceSnapshotId: `${fixture.prefix}-service-a1`, componentCode: "employer_social_insurance", amountCents: "20000" },
        { projectId: secondProject.projectId, serviceSnapshotId: `${fixture.prefix}-service-a2`, componentCode: "gross_wage", amountCents: "30000" },
        { projectId: secondProject.projectId, serviceSnapshotId: `${fixture.prefix}-service-a2`, componentCode: "employer_social_insurance", amountCents: "10000" }
      ],
      projectCreditorAllocations: [
        { projectId: fixture.projectId, serviceSnapshotId: `${fixture.prefix}-service-a1`, creditorSubjectType: "employee_user" as const, creditorUserId: fixture.employeeUserId, creditorCategory: "employee_net_pay", amountCents: "45000" },
        { projectId: fixture.projectId, serviceSnapshotId: `${fixture.prefix}-service-a1`, creditorSubjectType: "business_party" as const, creditorBusinessPartyVersionId: externalCreditorVersionId, creditorCategory: "employer_social_insurance", amountCents: "15000" },
        { projectId: secondProject.projectId, serviceSnapshotId: `${fixture.prefix}-service-a2`, creditorSubjectType: "employee_user" as const, creditorUserId: fixture.employeeUserId, creditorCategory: "employee_net_pay", amountCents: "25000" },
        { projectId: secondProject.projectId, serviceSnapshotId: `${fixture.prefix}-service-a2`, creditorSubjectType: "business_party" as const, creditorBusinessPartyVersionId: externalCreditorVersionId, creditorCategory: "employer_social_insurance", amountCents: "15000" }
      ]
    };
    const secondEmployeeLine = {
      employeeId: secondEmployeeUserId,
      employmentSnapshotId: `${fixture.prefix}-employment-b`,
      employmentCompanyId: fixture.companyId,
      employmentPeriodStart: "2026-08-01",
      employmentPeriodEnd: "2026-08-31",
      positionCategory: "finance_staff",
      approvedAmountCents: "50000",
      costComponents: [{ componentCode: "gross_wage", amountCents: "50000" }],
      creditorBreakdowns: [{ creditorSubjectType: "employee_user" as const, creditorUserId: secondEmployeeUserId, creditorCategory: "employee_net_pay", amountCents: "50000" }],
      projectAllocations: [{ projectId: secondProject.projectId, serviceSnapshotId: `${fixture.prefix}-service-b2`, serviceMonth: fixture.wageMonth, serviceEvidenceSha256: "a".repeat(64), amountCents: "50000" }],
      projectCostComponentAllocations: [{ projectId: secondProject.projectId, serviceSnapshotId: `${fixture.prefix}-service-b2`, componentCode: "gross_wage", amountCents: "50000" }],
      projectCreditorAllocations: [{ projectId: secondProject.projectId, serviceSnapshotId: `${fixture.prefix}-service-b2`, creditorSubjectType: "employee_user" as const, creditorUserId: secondEmployeeUserId, creditorCategory: "employee_net_pay", amountCents: "50000" }]
    };
    const sourceInput: WageSourceInput = {
      idempotencyKey: randomUUID(),
      expectedRevision: 0,
      sourcePurpose: "ordinary",
      employmentCompanyId: fixture.companyId,
      wageMonth: fixture.wageMonth,
      periodStart: "2026-08-01",
      periodEnd: "2026-08-31",
      externalReference: `${fixture.prefix}-MULTI-PAYROLL`,
      sourceVersion: "v1",
      basisDate: "2026-08-31",
      evidenceFileId: fixture.evidenceFileId,
      approvedPersonLines: [approvedAuthorityLine(employeeLine), approvedAuthorityLine(secondEmployeeLine)]
    };
    const service = wageService(first);
    const sourceResult = await service.createApprovedSource(fixture.preparerUserId, sourceInput);
    if (!isSourceCreationResult(sourceResult)) throw new Error("多人工资来源创建未返回正式来源标识");
    const draftResult = await service.createDraft(fixture.preparerUserId, {
      sourceVersionId: sourceResult.id,
      idempotencyKey: randomUUID(),
      expectedRevision: 0,
      wageMonth: fixture.wageMonth,
      sourceTotalCents: "150000",
      personLines: [employeeLine, secondEmployeeLine]
    });
    if (!isDraftCreationResult(draftResult)) throw new Error("多人工资草稿创建未返回正式单据标识");
    await service.submit(fixture.preparerUserId, draftResult.statementId, {
      idempotencyKey: randomUUID(),
      expectedRevision: 1
    });
    await service.confirm(fixture.confirmerUserId, draftResult.statementId, {
      idempotencyKey: randomUUID(),
      expectedRevision: 1
    });

    const facts = await observer.operatingFact.findMany({
      where: { sourceType: "wage_statement_version", sourceBusinessId: { startsWith: draftResult.versionId } },
      orderBy: { projectId: "asc" }
    });
    expect(facts).toHaveLength(2);
    expect(facts.every((fact) =>
      fact.debtorSubjectId === fixture.companyId &&
      fact.costBearingCompanySubjectId === fixture.companyId &&
      fact.payeeSubjectId === null &&
      fact.creditorSubjectId === null
    )).toBe(true);
    expect(facts.reduce((sum, fact) => sum + fact.amountCents, 0n)).toBe(150000n);
    const refs = await observer.wagePayableRef.findMany({
      where: { confirmedVersionId: draftResult.versionId }
    });
    expect(refs).toHaveLength(5);
    expect(refs.reduce((sum, ref) => sum + ref.amountCents, 0n)).toBe(150000n);
    expect(refs.every((ref) =>
      ref.debtorCompanyId === fixture.companyId &&
      ref.costBearingCompanyId === fixture.companyId
    )).toBe(true);

    const reversalEvidenceFileId = `${fixture.prefix}-evidence-full-reversal`;
    await first.fileObject.create({
      data: {
        id: reversalEvidenceFileId,
        bucket: "local-test",
        objectKey: `${fixture.prefix}/approved-wage-full-reversal.json`,
        originalName: "全额冲销批准资料.json",
        mimeType: "application/json",
        sizeBytes: 1,
        uploadedByUserId: fixture.preparerUserId,
        contentSha256: "a".repeat(64),
        storageStatus: "active"
      }
    });
    const zeroLine = <T extends typeof employeeLine | typeof secondEmployeeLine>(line: T) => ({
      ...line,
      approvedAmountCents: "0",
      costComponents: line.costComponents.map((cell) => ({ ...cell, amountCents: "0" })),
      creditorBreakdowns: line.creditorBreakdowns.map((cell) => ({ ...cell, amountCents: "0" })),
      projectAllocations: line.projectAllocations.map((cell) => ({ ...cell, amountCents: "0" })),
      projectCostComponentAllocations: line.projectCostComponentAllocations.map((cell) => ({ ...cell, amountCents: "0" })),
      projectCreditorAllocations: line.projectCreditorAllocations.map((cell) => ({ ...cell, amountCents: "0" }))
    });
    const zeroLines = [zeroLine(employeeLine), zeroLine(secondEmployeeLine)];
    const reversalSourceInput: WageSourceInput = {
      ...sourceInput,
      idempotencyKey: randomUUID(),
      sourcePurpose: "full_reversal",
      externalReference: `${fixture.prefix}-MULTI-PAYROLL-REVERSAL`,
      sourceVersion: "v2-full-reversal",
      evidenceFileId: reversalEvidenceFileId,
      fullReversalTarget: {
        statementId: draftResult.statementId,
        priorConfirmedVersionId: draftResult.versionId,
        priorConfirmedRevision: 1,
        priorSourceVersionId: sourceResult.id
      },
      approvedPersonLines: zeroLines
    };
    const sourceAttempts = await Promise.all([
      service.createApprovedSource(fixture.preparerUserId, reversalSourceInput),
      wageService(second).createApprovedSource(fixture.preparerUserId, reversalSourceInput)
    ]);
    expect(sourceAttempts[0]).toEqual(sourceAttempts[1]);
    const reversalSource = sourceAttempts[0];
    if (!isSourceCreationResult(reversalSource)) throw new Error("并发全额冲销来源创建未返回正式来源标识");
    await expect(observer.wageApprovedSourceCommandReceipt.count({
      where: { idempotencyKey: reversalSourceInput.idempotencyKey }
    })).resolves.toBe(1);
    await expect(service.createApprovedSource(fixture.preparerUserId, {
      ...reversalSourceInput,
      sourceVersion: "v2-full-reversal-conflict"
    })).rejects.toThrow("同一幂等键不能用于不同外部工资来源命令");

    const revisionInput = {
      sourceVersionId: reversalSource.id,
      idempotencyKey: randomUUID(),
      expectedRevision: 1,
      disposition: "reversal" as const,
      wageMonth: fixture.wageMonth,
      sourceTotalCents: "0",
      personLines: zeroLines
    };
    const revisionAttempts = await Promise.all([
      service.createRevision(fixture.preparerUserId, draftResult.statementId, revisionInput),
      wageService(second).createRevision(fixture.preparerUserId, draftResult.statementId, revisionInput)
    ]);
    expect(revisionAttempts[0]).toEqual(revisionAttempts[1]);
    const reversal = revisionAttempts[0];
    if (!isDraftCreationResult(reversal)) throw new Error("并发全额冲销修订未返回正式版本标识");
    await expect(observer.wageCommandReceipt.count({
      where: { idempotencyKey: revisionInput.idempotencyKey }
    })).resolves.toBe(1);
    await service.submit(fixture.preparerUserId, draftResult.statementId, {
      idempotencyKey: randomUUID(),
      expectedRevision: 2
    });
    await service.confirm(fixture.confirmerUserId, draftResult.statementId, {
      idempotencyKey: randomUUID(),
      expectedRevision: 2
    });
    const sourceCountAfterReversal = await observer.wageApprovedSourceVersion.count();
    await expect(service.createApprovedSource(fixture.preparerUserId, {
      ...reversalSourceInput,
      idempotencyKey: randomUUID(),
      externalReference: `${fixture.prefix}-MULTI-PAYROLL-SECOND-REVERSAL`,
      sourceVersion: "v3-no-effect-reversal",
      fullReversalTarget: {
        statementId: draftResult.statementId,
        priorConfirmedVersionId: reversal.versionId,
        priorConfirmedRevision: 2,
        priorSourceVersionId: reversalSource.id
      }
    })).rejects.toThrow("全额冲销必须绑定当前紧邻的普通已确认工资版本");
    await expect(observer.wageApprovedSourceVersion.count()).resolves.toBe(sourceCountAfterReversal);

    const reversalRefs = await observer.wagePayableRef.findMany({
      where: { confirmedVersionId: reversal.versionId },
      select: {
        id: true,
        direction: true,
        amountCents: true,
        adjustsPayableRefId: true,
        projectAllocation: { select: { serviceSnapshotId: true } }
      }
    });
    expect(reversalRefs).toHaveLength(5);
    expect(reversalRefs.every((ref) => ref.direction === "decrease" && ref.amountCents > 0n && refs.some((root) => root.id === ref.adjustsPayableRefId))).toBe(true);
    expect(new Set(reversalRefs.map((ref) => ref.projectAllocation.serviceSnapshotId))).toEqual(new Set([
      `${fixture.prefix}-service-a1`,
      `${fixture.prefix}-service-a2`,
      `${fixture.prefix}-service-b2`
    ]));
    const closedRoots = await observer.wagePayableRef.findMany({
      where: { id: { in: refs.map((ref) => ref.id) } },
      select: { amountCents: true, adjustments: { select: { direction: true, amountCents: true } } }
    });
    expect(closedRoots.every((root) => root.amountCents === root.adjustments.reduce(
      (sum, adjustment) => sum + (adjustment.direction === "decrease" ? adjustment.amountCents : -adjustment.amountCents),
      0n
    ))).toBe(true);
    const versionBusinessIds = [
      ...new Set([
        ...facts.map((fact) => fact.sourceBusinessId),
        `${reversal.versionId}:${fixture.projectId}`,
        `${reversal.versionId}:${secondProject.projectId}`
      ])
    ];
    const effectiveImpacts = await observer.operatingImpactEntry.findMany({
      where: {
        sourceType: "wage_statement_version",
        sourceBusinessId: { in: versionBusinessIds },
        impactKind: { in: ["confirmed_cost", "payable_increase", "payable_decrease"] }
      },
      select: { amountCents: true, direction: true }
    });
    expect(effectiveImpacts.length).toBeGreaterThan(0);
    expect(effectiveImpacts.reduce(
      (sum, impact) => sum + (impact.direction === "decrease" ? -impact.amountCents : impact.amountCents),
      0n
    )).toBe(0n);
    await expect(first.wageApprovedSourceVersion.update({
      where: { id: reversalSource.id },
      data: { sourceVersion: "mutated" }
    })).rejects.toThrow(/immutable/i);
    await expect(first.wageApprovedSourceVersion.delete({ where: { id: reversalSource.id } })).rejects.toThrow(/immutable/i);
    await expect(first.wageStatementVersion.update({
      where: { id: reversal.versionId },
      data: { revision: 3 }
    })).rejects.toThrow(/immutable/i);
    await expect(first.wageStatementVersion.delete({ where: { id: reversal.versionId } })).rejects.toThrow(/immutable/i);
    const reversalPerson = await observer.wagePersonLine.findFirstOrThrow({
      where: { statementVersionId: reversal.versionId },
      select: { id: true }
    });
    await expect(first.wagePersonLine.update({
      where: { id: reversalPerson.id },
      data: { approvedAmountCents: 1n }
    })).rejects.toThrow(/immutable/i);
    await expect(first.wagePersonLine.delete({ where: { id: reversalPerson.id } })).rejects.toThrow(/immutable/i);
  });

  it("isolates two service snapshots for one employee, project and month through correction and full reversal", async () => {
    const fixture = await seedCanonicalWageFixture(first);
    const service = wageService(first);
    const serviceSnapshotIds = {
      first: `${fixture.prefix}-service-combination-a`,
      second: `${fixture.prefix}-service-combination-b`
    };
    const personLine = (firstAmountCents: string, secondAmountCents: string) => {
      const approvedAmountCents = (
        BigInt(firstAmountCents) + BigInt(secondAmountCents)
      ).toString();
      return {
        employeeId: fixture.employeeUserId,
        employmentSnapshotId: `${fixture.prefix}-employment-combination`,
        employmentCompanyId: fixture.companyId,
        employmentPeriodStart: "2026-08-01",
        employmentPeriodEnd: "2026-08-31",
        positionCategory: "project_manager",
        approvedAmountCents,
        costComponents: [{ componentCode: "gross_wage", amountCents: approvedAmountCents }],
        creditorBreakdowns: [{
          creditorSubjectType: "employee_user" as const,
          creditorUserId: fixture.employeeUserId,
          creditorCategory: "employee_net_pay",
          amountCents: approvedAmountCents
        }],
        projectAllocations: [
          {
            projectId: fixture.projectId,
            serviceSnapshotId: serviceSnapshotIds.first,
            serviceMonth: fixture.wageMonth,
            serviceEvidenceSha256: "a".repeat(64),
            amountCents: firstAmountCents
          },
          {
            projectId: fixture.projectId,
            serviceSnapshotId: serviceSnapshotIds.second,
            serviceMonth: fixture.wageMonth,
            serviceEvidenceSha256: "a".repeat(64),
            amountCents: secondAmountCents
          }
        ],
        projectCostComponentAllocations: [
          {
            projectId: fixture.projectId,
            serviceSnapshotId: serviceSnapshotIds.first,
            componentCode: "gross_wage",
            amountCents: firstAmountCents
          },
          {
            projectId: fixture.projectId,
            serviceSnapshotId: serviceSnapshotIds.second,
            componentCode: "gross_wage",
            amountCents: secondAmountCents
          }
        ],
        projectCreditorAllocations: [
          {
            projectId: fixture.projectId,
            serviceSnapshotId: serviceSnapshotIds.first,
            creditorSubjectType: "employee_user" as const,
            creditorUserId: fixture.employeeUserId,
            creditorCategory: "employee_net_pay",
            amountCents: firstAmountCents
          },
          {
            projectId: fixture.projectId,
            serviceSnapshotId: serviceSnapshotIds.second,
            creditorSubjectType: "employee_user" as const,
            creditorUserId: fixture.employeeUserId,
            creditorCategory: "employee_net_pay",
            amountCents: secondAmountCents
          }
        ]
      };
    };
    const createEvidence = async (label: string) => {
      const id = `${fixture.prefix}-combination-evidence-${label}`;
      await first.fileObject.create({
        data: {
          id,
          bucket: "local-test",
          objectKey: `${fixture.prefix}/combination-${label}.json`,
          originalName: `双服务工资批准资料-${label}.json`,
          mimeType: "application/json",
          sizeBytes: 1,
          uploadedByUserId: fixture.preparerUserId,
          contentSha256: "a".repeat(64),
          storageStatus: "active"
        }
      });
      return id;
    };
    const ordinarySourceInput = (
      line: ReturnType<typeof personLine>,
      label: string,
      evidenceFileId: string
    ): WageSourceInput => ({
      idempotencyKey: randomUUID(),
      expectedRevision: 0,
      sourcePurpose: "ordinary",
      employmentCompanyId: fixture.companyId,
      wageMonth: fixture.wageMonth,
      periodStart: "2026-08-01",
      periodEnd: "2026-08-31",
      externalReference: `${fixture.prefix}-COMBINATION-${label}`,
      sourceVersion: label,
      basisDate: "2026-08-31",
      evidenceFileId,
      approvedPersonLines: [approvedAuthorityLine(line)]
    });
    const refsForVersion = (versionId: string) => observer.wagePayableRef.findMany({
      where: { confirmedVersionId: versionId },
      select: {
        id: true,
        amountCents: true,
        direction: true,
        adjustsPayableRefId: true,
        projectAllocation: { select: { id: true, serviceSnapshotId: true } }
      },
      orderBy: { amountCents: "desc" }
    });

    const baseLine = personLine("60000", "40000");
    const baseSource = await service.createApprovedSource(
      fixture.preparerUserId,
      ordinarySourceInput(baseLine, "v1-base", fixture.evidenceFileId)
    );
    if (!isSourceCreationResult(baseSource)) throw new Error("双服务基础来源未返回正式来源标识");
    const baseDraft = await service.createDraft(fixture.preparerUserId, {
      sourceVersionId: baseSource.id,
      idempotencyKey: randomUUID(),
      expectedRevision: 0,
      wageMonth: fixture.wageMonth,
      sourceTotalCents: "100000",
      personLines: [baseLine]
    });
    if (!isDraftCreationResult(baseDraft)) throw new Error("双服务基础工资未返回正式单据标识");
    await service.submit(fixture.preparerUserId, baseDraft.statementId, {
      idempotencyKey: randomUUID(),
      expectedRevision: 1
    });
    const confirmIdempotencyKey = randomUUID();
    const baseConfirmationAttempts = await Promise.allSettled([
      service.confirm(fixture.confirmerUserId, baseDraft.statementId, {
        idempotencyKey: confirmIdempotencyKey,
        expectedRevision: 1
      }),
      wageService(second).confirm(fixture.confirmerUserId, baseDraft.statementId, {
        idempotencyKey: confirmIdempotencyKey,
        expectedRevision: 1
      })
    ]);
    expect(baseConfirmationAttempts.every((attempt) => attempt.status === "fulfilled")).toBe(true);
    expect(baseConfirmationAttempts[0]).toEqual(baseConfirmationAttempts[1]);
    await expect(observer.wageCommandReceipt.count({
      where: { idempotencyKey: confirmIdempotencyKey }
    })).resolves.toBe(1);

    const baseRefs = await refsForVersion(baseDraft.versionId);
    expect(baseRefs).toHaveLength(2);
    expect(baseRefs.map((ref) => [
      ref.projectAllocation.serviceSnapshotId,
      ref.direction,
      ref.amountCents,
      ref.adjustsPayableRefId
    ])).toEqual([
      [serviceSnapshotIds.first, "increase", 60000n, null],
      [serviceSnapshotIds.second, "increase", 40000n, null]
    ]);
    const baseRootByService = new Map(
      baseRefs.map((ref) => [ref.projectAllocation.serviceSnapshotId, ref.id])
    );
    expect(new Set(baseRootByService.values()).size).toBe(2);

    const correctionLine = personLine("50000", "30000");
    const correctionEvidenceFileId = await createEvidence("v2-correction");
    const correctionSource = await service.createApprovedSource(
      fixture.preparerUserId,
      ordinarySourceInput(correctionLine, "v2-correction", correctionEvidenceFileId)
    );
    if (!isSourceCreationResult(correctionSource)) throw new Error("双服务更正来源未返回正式来源标识");
    const correction = await service.createRevision(fixture.preparerUserId, baseDraft.statementId, {
      sourceVersionId: correctionSource.id,
      idempotencyKey: randomUUID(),
      expectedRevision: 1,
      disposition: "correction",
      wageMonth: fixture.wageMonth,
      sourceTotalCents: "80000",
      personLines: [correctionLine]
    });
    if (!isDraftCreationResult(correction)) throw new Error("双服务更正未返回正式版本标识");
    await service.submit(fixture.preparerUserId, baseDraft.statementId, {
      idempotencyKey: randomUUID(),
      expectedRevision: 2
    });
    await service.confirm(fixture.confirmerUserId, baseDraft.statementId, {
      idempotencyKey: randomUUID(),
      expectedRevision: 2
    });

    const correctionRefs = await refsForVersion(correction.versionId);
    expect(correctionRefs).toHaveLength(2);
    expect(correctionRefs.map((ref) => [
      ref.projectAllocation.serviceSnapshotId,
      ref.direction,
      ref.amountCents,
      ref.adjustsPayableRefId
    ])).toEqual(expect.arrayContaining([
      [serviceSnapshotIds.first, "decrease", 10000n, baseRootByService.get(serviceSnapshotIds.first)],
      [serviceSnapshotIds.second, "decrease", 10000n, baseRootByService.get(serviceSnapshotIds.second)]
    ]));
    const correctionProjection = await first.$queryRaw<Array<{ projection: Prisma.JsonValue }>>(Prisma.sql`
      SELECT jg_canonical_wage_delta_projection(
        ${correction.versionId},
        ${fixture.projectId}
      ) AS projection
    `);
    const correctionProjectionValue = correctionProjection[0]?.projection as {
      payableCells?: Array<{
        projectAllocationId?: string;
        expectedRootId?: string;
        expectedRootCount?: number;
      }>;
    };
    expect(correctionProjectionValue.payableCells).toHaveLength(2);
    for (const ref of correctionRefs) {
      expect(correctionProjectionValue.payableCells).toEqual(expect.arrayContaining([
        expect.objectContaining({
          projectAllocationId: ref.projectAllocation.id,
          expectedRootId: baseRootByService.get(ref.projectAllocation.serviceSnapshotId),
          expectedRootCount: 1
        })
      ]));
    }
    const firstCorrectionRef = correctionRefs.find(
      (ref) => ref.projectAllocation.serviceSnapshotId === serviceSnapshotIds.first
    );
    const secondBaseRootId = baseRootByService.get(serviceSnapshotIds.second);
    if (!firstCorrectionRef || !secondBaseRootId) throw new Error("双服务更正缺少交叉拒绝断言坐标");
    await expect(first.$queryRaw(Prisma.sql`
      SELECT jg_assert_canonical_wage_payable_root(
        ${secondBaseRootId},
        cell->>'expectedRootId',
        (cell->>'expectedRootCount')::BIGINT
      )::TEXT
      FROM jsonb_array_elements(
        jg_canonical_wage_delta_projection(
          ${correction.versionId},
          ${fixture.projectId}
        )->'payableCells'
      ) cell
      WHERE cell->>'projectAllocationId' = ${firstCorrectionRef.projectAllocation.id}
    `)).rejects.toThrow("唯一原始应付引用");

    const reversalLine = personLine("0", "0");
    const reversalEvidenceFileId = await createEvidence("v3-full-reversal");
    const reversalSource = await service.createApprovedSource(fixture.preparerUserId, {
      idempotencyKey: randomUUID(),
      expectedRevision: 0,
      sourcePurpose: "full_reversal",
      employmentCompanyId: fixture.companyId,
      wageMonth: fixture.wageMonth,
      periodStart: "2026-08-01",
      periodEnd: "2026-08-31",
      externalReference: `${fixture.prefix}-COMBINATION-v3-full-reversal`,
      sourceVersion: "v3-full-reversal",
      basisDate: "2026-08-31",
      evidenceFileId: reversalEvidenceFileId,
      fullReversalTarget: {
        statementId: baseDraft.statementId,
        priorConfirmedVersionId: correction.versionId,
        priorConfirmedRevision: 2,
        priorSourceVersionId: correctionSource.id
      },
      approvedPersonLines: [reversalLine]
    });
    if (!isSourceCreationResult(reversalSource)) throw new Error("双服务全额冲销来源未返回正式来源标识");
    const reversal = await service.createRevision(fixture.preparerUserId, baseDraft.statementId, {
      sourceVersionId: reversalSource.id,
      idempotencyKey: randomUUID(),
      expectedRevision: 2,
      disposition: "reversal",
      wageMonth: fixture.wageMonth,
      sourceTotalCents: "0",
      personLines: [reversalLine]
    });
    if (!isDraftCreationResult(reversal)) throw new Error("双服务全额冲销未返回正式版本标识");
    await service.submit(fixture.preparerUserId, baseDraft.statementId, {
      idempotencyKey: randomUUID(),
      expectedRevision: 3
    });
    await service.confirm(fixture.confirmerUserId, baseDraft.statementId, {
      idempotencyKey: randomUUID(),
      expectedRevision: 3
    });

    const reversalRefs = await refsForVersion(reversal.versionId);
    expect(reversalRefs).toHaveLength(2);
    expect(reversalRefs.map((ref) => [
      ref.projectAllocation.serviceSnapshotId,
      ref.direction,
      ref.amountCents,
      ref.adjustsPayableRefId
    ])).toEqual([
      [serviceSnapshotIds.first, "decrease", 50000n, baseRootByService.get(serviceSnapshotIds.first)],
      [serviceSnapshotIds.second, "decrease", 30000n, baseRootByService.get(serviceSnapshotIds.second)]
    ]);
    const rootBalances = await observer.wagePayableRef.findMany({
      where: { id: { in: [...baseRootByService.values()] } },
      select: {
        id: true,
        amountCents: true,
        projectAllocation: { select: { serviceSnapshotId: true } },
        adjustments: { select: { direction: true, amountCents: true } }
      }
    });
    expect(rootBalances).toHaveLength(2);
    expect(rootBalances.every((root) => root.amountCents === root.adjustments.reduce(
      (sum, adjustment) => sum + (
        adjustment.direction === "decrease" ? adjustment.amountCents : -adjustment.amountCents
      ),
      0n
    ))).toBe(true);
    expect(new Set(rootBalances.map((root) => root.projectAllocation.serviceSnapshotId))).toEqual(
      new Set(Object.values(serviceSnapshotIds))
    );
    await expect(observer.wageStatementVersion.findMany({
      where: { statementId: baseDraft.statementId },
      orderBy: { revision: "asc" },
      select: { revision: true, kind: true, status: true, sourceVersionId: true }
    })).resolves.toEqual([
      { revision: 1, kind: "base", status: "confirmed", sourceVersionId: baseSource.id },
      { revision: 2, kind: "correction", status: "confirmed", sourceVersionId: correctionSource.id },
      { revision: 3, kind: "reversal", status: "confirmed", sourceVersionId: reversalSource.id }
    ]);
    const effectiveImpacts = await observer.operatingImpactEntry.findMany({
      where: {
        sourceType: "wage_statement_version",
        sourceBusinessId: {
          in: [baseDraft.versionId, correction.versionId, reversal.versionId].map(
            (versionId) => `${versionId}:${fixture.projectId}`
          )
        },
        impactKind: { in: ["confirmed_cost", "payable_increase", "payable_decrease"] }
      },
      select: { amountCents: true, direction: true }
    });
    expect(effectiveImpacts.length).toBeGreaterThan(0);
    expect(effectiveImpacts.reduce(
      (sum, impact) => sum + (
        impact.direction === "decrease" ? -impact.amountCents : impact.amountCents
      ),
      0n
    )).toBe(0n);
  });

  it("binds correction deltas and permits only a target-bound explicit-zero full reversal", async () => {
    const fixture = await seedCanonicalWageFixture(first);
    const baseInput = canonicalWageSourceInput(fixture);
    const { service, draftResult: baseDraft } = await createSubmittedCanonicalWage(
      first,
      fixture,
      baseInput,
      "100000"
    );
    await service.confirm(fixture.confirmerUserId, baseDraft.statementId, {
      idempotencyKey: randomUUID(),
      expectedRevision: 1
    });

    const correction = await createSubmittedRevision(
      first,
      service,
      fixture,
      baseDraft.statementId,
      1,
      "correction",
      "60000",
      "v2"
    );
    await service.confirm(fixture.confirmerUserId, baseDraft.statementId, {
      idempotencyKey: randomUUID(),
      expectedRevision: 2
    });

    const correctionFact = await observer.operatingFact.findFirstOrThrow({
      where: {
        sourceType: "wage_statement_version",
        sourceBusinessId: `${correction.versionId}:${fixture.projectId}`
      }
    });
    expect(correctionFact.amountCents).toBe(40000n);
    expect(correctionFact.sourceSnapshot).toEqual(expect.objectContaining({
      costDeltaCells: [expect.objectContaining({ direction: "decrease" })]
    }));
    await expect(first.$queryRaw(Prisma.sql`
      SELECT jg_validate_canonical_wage_operating_deltas(fact, 'correction')::TEXT
      FROM "OperatingFact" fact
      WHERE fact."id" = ${correctionFact.id}
    `)).resolves.toBeDefined();
    await expect(first.$queryRaw(Prisma.sql`
      SELECT jg_validate_canonical_wage_operating_deltas(
        jsonb_populate_record(
          NULL::"OperatingFact",
          to_jsonb(fact) || jsonb_build_object('amountCents', (fact."amountCents" + 1)::TEXT)
        ),
        'correction'
      )::TEXT
      FROM "OperatingFact" fact
      WHERE fact."id" = ${correctionFact.id}
    `)).rejects.toThrow("相邻版本差额不一致");
    await expect(first.$queryRaw(Prisma.sql`
      SELECT jg_validate_canonical_wage_operating_deltas(
        jsonb_populate_record(
          NULL::"OperatingFact",
          to_jsonb(fact) || jsonb_build_object(
            'sourceSnapshot',
            jsonb_set(fact."sourceSnapshot", '{costDeltaCells,0,direction}', '"increase"'::jsonb)
          )
        ),
        'correction'
      )::TEXT
      FROM "OperatingFact" fact
      WHERE fact."id" = ${correctionFact.id}
    `)).rejects.toThrow("成本差额单元不一致");

    await expect(first.$queryRaw(Prisma.sql`
      SELECT jg_validate_canonical_wage_operating_deltas(fact, 'reversal')::TEXT
      FROM "OperatingFact" fact
      WHERE fact."id" = ${correctionFact.id}
    `)).rejects.toThrow("冲销版本必须为显式零金额矩阵");

    const zeroDelta = await createSubmittedRevision(
      first,
      service,
      fixture,
      baseDraft.statementId,
      2,
      "correction",
      "60000",
      "v3"
    );
    await service.confirm(fixture.confirmerUserId, baseDraft.statementId, {
      idempotencyKey: randomUUID(),
      expectedRevision: 3
    });

    await expect(createSubmittedRevision(
      first,
      service,
      fixture,
      baseDraft.statementId,
      3,
      "reversal",
      "1",
      "v4-ordinary"
    )).rejects.toThrow("冲销修订必须使用全额冲销批准来源");

    const prior = await observer.wageStatementVersion.findUniqueOrThrow({
      where: { id: zeroDelta.versionId },
      select: { sourceVersionId: true }
    });
    const reversalEvidenceFileId = `${fixture.prefix}-evidence-v4-reversal`;
    await first.fileObject.create({
      data: {
        id: reversalEvidenceFileId,
        bucket: "local-test",
        objectKey: `${fixture.prefix}/approved-wage-v4-reversal.json`,
        originalName: "全额冲销批准资料-v4.json",
        mimeType: "application/json",
        sizeBytes: 1,
        uploadedByUserId: fixture.preparerUserId,
        contentSha256: "a".repeat(64),
        storageStatus: "active"
      }
    });
    const zeroLine = canonicalWagePersonLine(fixture, "0");
    const correctionHeader = await observer.wageStatementVersion.findUniqueOrThrow({
      where: { id: correction.versionId },
      select: { sourceVersionId: true }
    });
    await expect(service.createApprovedSource(fixture.preparerUserId, {
      ...canonicalWageSourceForAmount(fixture, "0", "v4-stale"),
      sourcePurpose: "full_reversal",
      fullReversalTarget: {
        statementId: baseDraft.statementId,
        priorConfirmedVersionId: correction.versionId,
        priorConfirmedRevision: 2,
        priorSourceVersionId: correctionHeader.sourceVersionId
      },
      evidenceFileId: reversalEvidenceFileId,
      approvedPersonLines: [zeroLine]
    })).rejects.toThrow("全额冲销目标工资单的公司、月份或当前修订已漂移");
    const crossServiceLine = {
      ...zeroLine,
      projectAllocations: zeroLine.projectAllocations.map((line) => ({ ...line, serviceSnapshotId: `${line.serviceSnapshotId}-other` })),
      projectCostComponentAllocations: zeroLine.projectCostComponentAllocations.map((line) => ({ ...line, serviceSnapshotId: `${line.serviceSnapshotId}-other` })),
      projectCreditorAllocations: zeroLine.projectCreditorAllocations.map((line) => ({ ...line, serviceSnapshotId: `${line.serviceSnapshotId}-other` }))
    };
    await expect(service.createApprovedSource(fixture.preparerUserId, {
      ...canonicalWageSourceForAmount(fixture, "0", "v4-cross-service"),
      sourcePurpose: "full_reversal",
      fullReversalTarget: {
        statementId: baseDraft.statementId,
        priorConfirmedVersionId: zeroDelta.versionId,
        priorConfirmedRevision: 3,
        priorSourceVersionId: prior.sourceVersionId
      },
      evidenceFileId: reversalEvidenceFileId,
      approvedPersonLines: [crossServiceLine]
    })).rejects.toThrow("成本组成身份集合发生变化");
    const reversalSource = await service.createApprovedSource(fixture.preparerUserId, {
      ...canonicalWageSourceForAmount(fixture, "0", "v4-reversal"),
      sourcePurpose: "full_reversal",
      fullReversalTarget: {
        statementId: baseDraft.statementId,
        priorConfirmedVersionId: zeroDelta.versionId,
        priorConfirmedRevision: 3,
        priorSourceVersionId: prior.sourceVersionId
      },
      evidenceFileId: reversalEvidenceFileId,
      approvedPersonLines: [zeroLine]
    });
    if (!isSourceCreationResult(reversalSource)) throw new Error("全额冲销来源未返回正式来源标识");
    await expect(service.createDraft(fixture.preparerUserId, {
      sourceVersionId: reversalSource.id,
      idempotencyKey: randomUUID(),
      expectedRevision: 0,
      wageMonth: fixture.wageMonth,
      sourceTotalCents: "0",
      personLines: [zeroLine]
    })).rejects.toThrow("全额冲销批准来源只能创建冲销修订");
    await expect(service.createRevision(fixture.preparerUserId, baseDraft.statementId, {
      sourceVersionId: reversalSource.id,
      idempotencyKey: randomUUID(),
      expectedRevision: 3,
      disposition: "supplemental",
      wageMonth: fixture.wageMonth,
      sourceTotalCents: "0",
      personLines: [zeroLine]
    })).rejects.toThrow("全额冲销批准来源只能用于冲销修订");
    await expect(service.createRevision(fixture.preparerUserId, baseDraft.statementId, {
      sourceVersionId: reversalSource.id,
      idempotencyKey: randomUUID(),
      expectedRevision: 3,
      disposition: "correction",
      wageMonth: fixture.wageMonth,
      sourceTotalCents: "0",
      personLines: [zeroLine]
    })).rejects.toThrow("全额冲销批准来源只能用于冲销修订");
    const reversal = await service.createRevision(fixture.preparerUserId, baseDraft.statementId, {
      sourceVersionId: reversalSource.id,
      idempotencyKey: randomUUID(),
      expectedRevision: 3,
      disposition: "reversal",
      wageMonth: fixture.wageMonth,
      sourceTotalCents: "0",
      personLines: [zeroLine]
    });
    if (!isDraftCreationResult(reversal)) throw new Error("全额冲销修订未返回正式版本标识");
    await service.submit(fixture.preparerUserId, baseDraft.statementId, {
      idempotencyKey: randomUUID(),
      expectedRevision: 4
    });
    await service.confirm(fixture.confirmerUserId, baseDraft.statementId, {
      idempotencyKey: randomUUID(),
      expectedRevision: 4
    });
    await expect(service.createRevision(fixture.preparerUserId, baseDraft.statementId, {
      sourceVersionId: reversalSource.id,
      idempotencyKey: randomUUID(),
      expectedRevision: 4,
      disposition: "reversal",
      wageMonth: fixture.wageMonth,
      sourceTotalCents: "0",
      personLines: [zeroLine]
    })).rejects.toThrow("全额冲销目标工资单的公司、月份或当前修订已漂移");

    const refs = await observer.wagePayableRef.findMany({
      where: {
        confirmedVersionId: {
          in: [baseDraft.versionId, correction.versionId, zeroDelta.versionId, reversal.versionId]
        }
      },
      orderBy: { createdAt: "asc" }
    });
    expect(refs).toHaveLength(3);
    expect(refs.map((ref) => [ref.direction, ref.amountCents])).toEqual([
      ["increase", 100000n],
      ["decrease", 40000n],
      ["decrease", 60000n]
    ]);
    expect(refs[1]?.adjustsPayableRefId).toBe(refs[0]?.id);
    expect(refs[2]?.adjustsPayableRefId).toBe(refs[0]?.id);
    const rootProjection = await first.$queryRaw<Array<{ projection: Prisma.JsonValue }>>(Prisma.sql`
      SELECT jg_canonical_wage_delta_projection(
        ${correction.versionId},
        ${fixture.projectId}
      ) AS projection
    `);
    expect(rootProjection[0]?.projection).toEqual(expect.objectContaining({
      payableCells: [expect.objectContaining({
        expectedRootId: refs[0]?.id,
        expectedRootCount: 1
      })]
    }));
    await expect(first.$queryRaw(Prisma.sql`
      SELECT jg_assert_canonical_wage_payable_root(
        ${refs[1]?.id},
        ${refs[0]?.id},
        1
      )::TEXT
    `)).rejects.toThrow("唯一原始应付引用");
    await expect(observer.operatingFact.count({
      where: {
        sourceType: "wage_statement_version",
        sourceBusinessId: {
          in: [
            `${baseDraft.versionId}:${fixture.projectId}`,
            `${correction.versionId}:${fixture.projectId}`,
            `${zeroDelta.versionId}:${fixture.projectId}`,
            `${reversal.versionId}:${fixture.projectId}`
          ]
        }
      }
    })).resolves.toBe(3);
    await expect(observer.wageStatementVersion.findUniqueOrThrow({
      where: { id: zeroDelta.versionId },
      select: { status: true, operatingProjectionSnapshot: true }
    })).resolves.toEqual(expect.objectContaining({
      status: "confirmed",
      operatingProjectionSnapshot: expect.objectContaining({
        formalStatus: "confirmed",
        wageVersionKind: "correction",
        projects: {}
      })
    }));
    await expect(observer.wageStatementVersion.findUniqueOrThrow({
      where: { id: reversal.versionId },
      select: { status: true, confirmedAt: true, confirmedByUserId: true }
    })).resolves.toEqual(expect.objectContaining({ status: "confirmed" }));
  });

  it("fails closed on invalid full-reversal bindings, batch input and lock-after evidence drift", async () => {
    const fixture = await seedCanonicalWageFixture(first);
    const { service, sourceResult, draftResult } = await createSubmittedCanonicalWage(
      first,
      fixture,
      canonicalWageSourceInput(fixture),
      "100000"
    );
    await service.confirm(fixture.confirmerUserId, draftResult.statementId, {
      idempotencyKey: randomUUID(),
      expectedRevision: 1
    });
    const evidenceFileId = `${fixture.prefix}-full-reversal-drift-evidence`;
    await first.fileObject.create({
      data: {
        id: evidenceFileId,
        bucket: "local-test",
        objectKey: `${fixture.prefix}/full-reversal-drift.json`,
        originalName: "全额冲销漂移证据.json",
        mimeType: "application/json",
        sizeBytes: 1,
        uploadedByUserId: fixture.preparerUserId,
        contentSha256: "a".repeat(64),
        storageStatus: "active"
      }
    });
    const zeroLine = canonicalWagePersonLine(fixture, "0");
    const target = {
      statementId: draftResult.statementId,
      priorConfirmedVersionId: draftResult.versionId,
      priorConfirmedRevision: 1,
      priorSourceVersionId: sourceResult.id
    };
    const fullInput: WageSourceInput = {
      ...canonicalWageSourceForAmount(fixture, "0", "full-reversal-drift"),
      sourcePurpose: "full_reversal",
      fullReversalTarget: target,
      evidenceFileId,
      approvedPersonLines: [zeroLine]
    };
    await expect(service.createApprovedSource(fixture.preparerUserId, {
      ...fullInput,
      idempotencyKey: randomUUID(),
      fullReversalTarget: undefined
    })).rejects.toThrow("全额冲销批准来源必须绑定目标工资单和紧邻已确认版本");
    await expect(service.createApprovedSource(fixture.preparerUserId, {
      ...fullInput,
      idempotencyKey: randomUUID(),
      employmentCompanyId: `${fixture.companyId}-other`,
      approvedPersonLines: [{ ...zeroLine, employmentCompanyId: `${fixture.companyId}-other` }]
    })).rejects.toThrow("全额冲销目标工资单的公司、月份或当前修订已漂移");
    await expect(service.createApprovedSource(fixture.preparerUserId, {
      ...fullInput,
      idempotencyKey: randomUUID(),
      wageMonth: "2026-09",
      periodStart: "2026-09-01",
      periodEnd: "2026-09-30",
      approvedPersonLines: [{
        ...zeroLine,
        employmentPeriodStart: "2026-09-01",
        employmentPeriodEnd: "2026-09-30",
        projectAllocations: zeroLine.projectAllocations.map((allocation) => ({ ...allocation, serviceMonth: "2026-09" }))
      }]
    })).rejects.toThrow("全额冲销目标工资单的公司、月份或当前修订已漂移");
    await expect(service.createApprovedSource(fixture.preparerUserId, {
      ...fullInput,
      idempotencyKey: randomUUID(),
      fullReversalTarget: { ...target, statementId: `${target.statementId}-other` }
    })).rejects.toThrow("工资承担单不存在");

    const sourcesBeforeBatch = await observer.wageApprovedSourceVersion.count();
    await expect(service.createApprovedSource(fixture.preparerUserId, {
      ...fullInput,
      idempotencyKey: randomUUID(),
      externalReference: `${fullInput.externalReference}-invalid-batch`,
      approvedPersonLines: [zeroLine, zeroLine]
    })).rejects.toThrow();
    await expect(observer.wageApprovedSourceVersion.count()).resolves.toBe(sourcesBeforeBatch);

    const source = await service.createApprovedSource(fixture.preparerUserId, fullInput);
    if (!isSourceCreationResult(source)) throw new Error("漂移测试全额冲销来源未返回正式来源标识");
    const revisionIdempotencyKey = randomUUID();
    let revisionAttempt: Promise<unknown> | undefined;
    await first.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`
        SELECT "id" FROM "FileObject" WHERE "id" = ${evidenceFileId} FOR UPDATE
      `);
      revisionAttempt = wageService(second).createRevision(fixture.preparerUserId, draftResult.statementId, {
        sourceVersionId: source.id,
        idempotencyKey: revisionIdempotencyKey,
        expectedRevision: 1,
        disposition: "reversal",
        wageMonth: fixture.wageMonth,
        sourceTotalCents: "0",
        personLines: [zeroLine]
      });
      await new Promise((resolve) => setTimeout(resolve, 100));
      await tx.fileObject.update({
        where: { id: evidenceFileId },
        data: { contentSha256: "b".repeat(64) }
      });
    });
    if (!revisionAttempt) throw new Error("全额冲销锁后漂移测试未启动");
    await expect(revisionAttempt).rejects.toThrow("外部批准工资资料证据已失效或校验值漂移");
    await expect(observer.wageStatement.findUniqueOrThrow({
      where: { id: draftResult.statementId },
      select: { currentRevision: true }
    })).resolves.toEqual({ currentRevision: 1 });
    await expect(observer.wageCommandReceipt.count({
      where: { idempotencyKey: revisionIdempotencyKey }
    })).resolves.toBe(0);
  });
});

function isSourceCreationResult(value: unknown): value is { id: string } {
  return typeof value === "object" && value !== null && "id" in value && typeof value.id === "string";
}

function isDraftCreationResult(value: unknown): value is { statementId: string; versionId: string; revision: number } {
  return typeof value === "object" && value !== null &&
    "statementId" in value && typeof value.statementId === "string" &&
    "versionId" in value && typeof value.versionId === "string" &&
    "revision" in value && typeof value.revision === "number";
}

function wageService(client: PrismaClient) {
  return new WageStatementService(
    client as never,
    new CompanyRoleResolverService(client as never),
    new AuditService(),
    new OperatingLedgerService(client as never)
  );
}

async function createSubmittedCanonicalWage(
  client: PrismaClient,
  fixture: Awaited<ReturnType<typeof seedCanonicalWageFixture>>,
  sourceInput: WageSourceInput,
  sourceTotalCents: string
) {
  const service = wageService(client);
  const sourceResult = await service.createApprovedSource(fixture.preparerUserId, sourceInput);
  if (!isSourceCreationResult(sourceResult)) throw new Error("工资来源创建未返回正式来源标识");
  const draftResult = await service.createDraft(fixture.preparerUserId, {
    sourceVersionId: sourceResult.id,
    idempotencyKey: randomUUID(),
    expectedRevision: 0,
    wageMonth: fixture.wageMonth,
    sourceTotalCents,
    personLines: [canonicalWagePersonLine(fixture, sourceTotalCents)]
  });
  if (!isDraftCreationResult(draftResult)) throw new Error("工资草稿创建未返回正式单据标识");
  await service.submit(fixture.preparerUserId, draftResult.statementId, {
    idempotencyKey: randomUUID(),
    expectedRevision: 1
  });
  return { service, sourceResult, draftResult };
}

async function createSubmittedRevision(
  client: PrismaClient,
  service: WageStatementService,
  fixture: Awaited<ReturnType<typeof seedCanonicalWageFixture>>,
  statementId: string,
  expectedRevision: number,
  disposition: "correction" | "reversal",
  amountCents: string,
  sourceVersion: string
) {
  const evidenceFileId = `${fixture.prefix}-evidence-${sourceVersion}`;
  await client.fileObject.create({
    data: {
      id: evidenceFileId,
      bucket: "local-test",
      objectKey: `${fixture.prefix}/approved-wage-${sourceVersion}.json`,
      originalName: `外部批准工资资料-${sourceVersion}.json`,
      mimeType: "application/json",
      sizeBytes: 1,
      uploadedByUserId: fixture.preparerUserId,
      contentSha256: "a".repeat(64),
      storageStatus: "active"
    }
  });
  const sourceInput = {
    ...canonicalWageSourceForAmount(fixture, amountCents, sourceVersion),
    evidenceFileId
  };
  const sourceResult = await service.createApprovedSource(fixture.preparerUserId, sourceInput);
  if (!isSourceCreationResult(sourceResult)) throw new Error("工资修订来源创建未返回正式来源标识");
  const revisionResult = await service.createRevision(fixture.preparerUserId, statementId, {
    sourceVersionId: sourceResult.id,
    idempotencyKey: randomUUID(),
    expectedRevision,
    disposition,
    wageMonth: fixture.wageMonth,
    sourceTotalCents: amountCents,
    personLines: [canonicalWagePersonLine(fixture, amountCents)]
  });
  if (!isDraftCreationResult(revisionResult)) throw new Error("工资修订未返回正式版本标识");
  await service.submit(fixture.preparerUserId, statementId, {
    idempotencyKey: randomUUID(),
    expectedRevision: revisionResult.revision
  });
  return revisionResult;
}

function canonicalOperatingFactCandidate(
  fixture: Awaited<ReturnType<typeof seedCanonicalWageFixture>>,
  versionId: string,
  confirmedAt: Date,
  sourceSnapshot: Record<string, unknown>
) {
  return {
    id: randomUUID(),
    projectId: fixture.projectId,
    sourceType: "wage_statement_version",
    sourceBusinessId: `${versionId}:${fixture.projectId}`,
    sourceVersion: 1,
    sourceBusinessCode: "工资承担单-1",
    occurredAt: "2026-08-31T00:00:00.000Z",
    confirmedAt: confirmedAt.toISOString(),
    factKind: "project_wage",
    operatingLevel: "participating_company",
    evidenceLevel: "A",
    amountCents: "100000",
    currencyCode: "CNY",
    direction: "neutral",
    debtorSubjectKind: "participating_company",
    debtorSubjectId: fixture.companyId,
    costBearingCompanySubjectKind: "participating_company",
    costBearingCompanySubjectId: fixture.companyId,
    sourceSnapshot,
    entryKind: "original",
    idempotencyKey: randomUUID(),
    recordedByUserId: fixture.confirmerUserId,
    confirmedByUserId: fixture.confirmerUserId,
    status: "confirmed"
  };
}

async function expectCanonicalGuardRejection(
  client: PrismaClient,
  candidate: Record<string, unknown>,
  message: string
) {
  await expect(client.$queryRaw(Prisma.sql`
    SELECT jg_validate_canonical_wage_operating_fact(
      jsonb_populate_record(NULL::"OperatingFact", ${JSON.stringify(candidate)}::jsonb)
    )
  `)).rejects.toThrow(message);
}

async function seedCanonicalWageFixture(client: PrismaClient) {
  const prefix = `pol224-s1-${randomUUID()}`;
  const fixture = {
    prefix,
    preparerUserId: `${prefix}-preparer`,
    confirmerUserId: `${prefix}-confirmer`,
    employeeUserId: `${prefix}-employee`,
    companyId: `${prefix}-company`,
    companyVersionId: `${prefix}-company-v1`,
    projectId: `${prefix}-project`,
    affiliatePartyId: `${prefix}-affiliate`,
    affiliateVersionId: `${prefix}-affiliate-v1`,
    affiliateAssignmentId: `${prefix}-affiliate-assignment`,
    affiliateCreditCode: `91320000${prefix.slice(-10)}`,
    participantId: `${prefix}-participant`,
    evidenceFileId: `${prefix}-evidence`,
    wageMonth: "2026-08"
  };
  const writeSecret = process.env.OPERATING_LEDGER_DB_WRITE_SECRET;
  if (!writeSecret) throw new Error("工资承担单 PostgreSQL 测试缺少经营账写入密钥");
  await client.$executeRaw(Prisma.sql`
    INSERT INTO "OperatingLedgerWriteSecret" ("id", "secretHash")
    VALUES (1, crypt(${writeSecret}, gen_salt('bf')))
    ON CONFLICT ("id") DO UPDATE SET "secretHash" = EXCLUDED."secretHash"
  `);
  await client.user.createMany({
    data: [
      { id: fixture.preparerUserId, name: "工资填报人", mustChangePassword: false, isActive: true },
      { id: fixture.confirmerUserId, name: "工资确认人", mustChangePassword: false, isActive: true },
      { id: fixture.employeeUserId, name: "项目员工", mustChangePassword: false, isActive: true }
    ]
  });
  const preparerPosition = await client.position.upsert({
    where: { key: "finance_staff" },
    update: {},
    create: { id: `${prefix}-finance-staff`, key: "finance_staff", name: "财务人员" }
  });
  const confirmerPosition = await client.position.upsert({
    where: { key: "finance_director" },
    update: {},
    create: { id: `${prefix}-finance-director`, key: "finance_director", name: "财务负责人" }
  });
  await client.userPosition.createMany({ data: [
    { id: `${prefix}-preparer-position`, userId: fixture.preparerUserId, positionId: preparerPosition.id },
    { id: `${prefix}-confirmer-position`, userId: fixture.confirmerUserId, positionId: confirmerPosition.id }
  ] });
  await client.companyEntity.create({
    data: { id: fixture.companyId, name: "测试劳动关系公司", unifiedSocialCreditCode: `91310000${prefix.slice(-10)}`, dataStatus: "complete", currentVersionNo: 1, isActive: true }
  });
  await client.companyEntityVersion.create({
    data: { id: fixture.companyVersionId, companyEntityId: fixture.companyId, versionNo: 1, name: "测试劳动关系公司", unifiedSocialCreditCode: `91310000${prefix.slice(-10)}`, isActive: true, action: "create", actorUserId: fixture.preparerUserId, actorRoleKey: "finance_staff" }
  });
  await client.project.create({
    data: { id: fixture.projectId, code: `${prefix}-P1`, name: "工资动态回归项目", isActive: true }
  });
  await client.businessParty.create({
    data: { id: fixture.affiliatePartyId, name: "测试施工企业", normalizedName: `${prefix}-affiliate`, unifiedSocialCreditCode: fixture.affiliateCreditCode, createdByUserId: fixture.preparerUserId }
  });
  await client.businessPartyVersion.create({
    data: { id: fixture.affiliateVersionId, businessPartyId: fixture.affiliatePartyId, versionNo: 1, snapshot: { name: "测试施工企业", unifiedSocialCreditCode: fixture.affiliateCreditCode }, createdByUserId: fixture.preparerUserId }
  });
  await client.projectAffiliateAssignment.create({
    data: { id: fixture.affiliateAssignmentId, projectId: fixture.projectId, businessPartyId: fixture.affiliatePartyId, businessPartyVersionId: fixture.affiliateVersionId, affiliateNameSnapshot: "测试施工企业", affiliateCreditCodeSnapshot: fixture.affiliateCreditCode, effectiveFrom: new Date("2026-08-01T00:00:00.000Z"), changeReason: "工资动态回归", assignedByUserId: fixture.preparerUserId }
  });
  await client.projectParticipatingCompany.create({
    data: { id: fixture.participantId, projectId: fixture.projectId, companyEntityId: fixture.companyId, companyEntityVersionId: fixture.companyVersionId, companyNameSnapshot: "测试劳动关系公司", companyCreditCodeSnapshot: `91310000${prefix.slice(-10)}`, effectiveFrom: new Date("2026-08-01T00:00:00.000Z"), changeReason: "工资动态回归", addedByUserId: fixture.preparerUserId }
  });
  await client.project.update({
    where: { id: fixture.projectId },
    data: { operatingLedgerEffectiveDate: new Date("2026-08-01T00:00:00.000Z") }
  });
  await client.fileObject.create({
    data: { id: fixture.evidenceFileId, bucket: "local-test", objectKey: `${prefix}/approved-wage.json`, originalName: "外部批准工资资料.json", mimeType: "application/json", sizeBytes: 1, uploadedByUserId: fixture.preparerUserId, contentSha256: "a".repeat(64), storageStatus: "active" }
  });
  return fixture;
}

async function seedFallbackProjectParticipant(
  client: PrismaClient,
  fixture: Awaited<ReturnType<typeof seedCanonicalWageFixture>>
) {
  const companyId = `${fixture.prefix}-fallback-company`;
  const companyVersionId = `${companyId}-v1`;
  const creditCode = `91510000${fixture.prefix.slice(-10)}`;
  await client.companyEntity.create({
    data: {
      id: companyId,
      name: "测试兜底参与公司",
      unifiedSocialCreditCode: creditCode,
      dataStatus: "complete",
      currentVersionNo: 1,
      isActive: true
    }
  });
  await client.companyEntityVersion.create({
    data: {
      id: companyVersionId,
      companyEntityId: companyId,
      versionNo: 1,
      name: "测试兜底参与公司",
      unifiedSocialCreditCode: creditCode,
      isActive: true,
      action: "create",
      actorUserId: fixture.preparerUserId,
      actorRoleKey: "finance_staff"
    }
  });
  await client.projectParticipatingCompany.create({
    data: {
      id: `${fixture.prefix}-fallback-participant`,
      projectId: fixture.projectId,
      companyEntityId: companyId,
      companyEntityVersionId: companyVersionId,
      companyNameSnapshot: "测试兜底参与公司",
      companyCreditCodeSnapshot: creditCode,
      effectiveFrom: new Date("2026-08-01T00:00:00.000Z"),
      changeReason: "验证工资项目上下文失败回滚",
      addedByUserId: fixture.preparerUserId
    }
  });
}

async function seedAdditionalProjectContext(
  client: PrismaClient,
  fixture: Awaited<ReturnType<typeof seedCanonicalWageFixture>>,
  suffix: string
) {
  const projectId = `${fixture.prefix}-project-${suffix}`;
  const affiliatePartyId = `${fixture.prefix}-affiliate-${suffix}`;
  const affiliateVersionId = `${fixture.prefix}-affiliate-${suffix}-v1`;
  await client.project.create({
    data: { id: projectId, code: `${fixture.prefix}-${suffix}`, name: `工资动态回归项目${suffix}`, isActive: true }
  });
  await client.businessParty.create({
    data: {
      id: affiliatePartyId,
      name: `测试施工企业${suffix}`,
      normalizedName: `${fixture.prefix}-affiliate-${suffix}`,
      unifiedSocialCreditCode: `91440000${fixture.prefix.slice(-8)}${suffix}`,
      createdByUserId: fixture.preparerUserId
    }
  });
  await client.businessPartyVersion.create({
    data: {
      id: affiliateVersionId,
      businessPartyId: affiliatePartyId,
      versionNo: 1,
      snapshot: { name: `测试施工企业${suffix}` },
      createdByUserId: fixture.preparerUserId
    }
  });
  await client.projectAffiliateAssignment.create({
    data: {
      id: `${fixture.prefix}-affiliate-assignment-${suffix}`,
      projectId,
      businessPartyId: affiliatePartyId,
      businessPartyVersionId: affiliateVersionId,
      affiliateNameSnapshot: `测试施工企业${suffix}`,
      effectiveFrom: new Date("2026-08-01T00:00:00.000Z"),
      changeReason: "工资动态回归",
      assignedByUserId: fixture.preparerUserId
    }
  });
  await client.projectParticipatingCompany.create({
    data: {
      id: `${fixture.prefix}-participant-${suffix}`,
      projectId,
      companyEntityId: fixture.companyId,
      companyEntityVersionId: fixture.companyVersionId,
      companyNameSnapshot: "测试劳动关系公司",
      effectiveFrom: new Date("2026-08-01T00:00:00.000Z"),
      changeReason: "工资动态回归",
      addedByUserId: fixture.preparerUserId
    }
  });
  await client.project.update({
    where: { id: projectId },
    data: { operatingLedgerEffectiveDate: new Date("2026-08-01T00:00:00.000Z") }
  });
  return { projectId };
}

function canonicalWageSourceInput(fixture: Awaited<ReturnType<typeof seedCanonicalWageFixture>>) {
  const { projectAllocations: _allocations, projectCostComponentAllocations: _costMatrix, projectCreditorAllocations: _creditorMatrix, ...line } = canonicalWagePersonLine(fixture, "100000");
  void _allocations;
  void _costMatrix;
  void _creditorMatrix;
  return {
    idempotencyKey: randomUUID(),
    expectedRevision: 0,
    sourcePurpose: "ordinary" as const,
    employmentCompanyId: fixture.companyId,
    wageMonth: fixture.wageMonth,
    periodStart: "2026-08-01",
    periodEnd: "2026-08-31",
    externalReference: `${fixture.prefix}-PAYROLL`,
    sourceVersion: "v1",
    basisDate: "2026-08-31",
    evidenceFileId: fixture.evidenceFileId,
    approvedPersonLines: [line]
  };
}

function canonicalWagePersonLine(
  fixture: Awaited<ReturnType<typeof seedCanonicalWageFixture>>,
  amountCents: string
) {
  return {
    employeeId: fixture.employeeUserId,
    employmentSnapshotId: `${fixture.prefix}-employment`,
    employmentCompanyId: fixture.companyId,
    employmentPeriodStart: "2026-08-01",
    employmentPeriodEnd: "2026-08-31",
    positionCategory: "project_manager",
    approvedAmountCents: amountCents,
    costComponents: [{ componentCode: "gross_wage", amountCents }],
    creditorBreakdowns: [{ creditorSubjectType: "employee_user" as const, creditorUserId: fixture.employeeUserId, creditorCategory: "employee_net_pay", amountCents }],
    projectAllocations: [{ projectId: fixture.projectId, serviceSnapshotId: `${fixture.prefix}-service`, serviceMonth: fixture.wageMonth, serviceEvidenceSha256: "a".repeat(64), amountCents }],
    projectCostComponentAllocations: [{ projectId: fixture.projectId, serviceSnapshotId: `${fixture.prefix}-service`, componentCode: "gross_wage", amountCents }],
    projectCreditorAllocations: [{ projectId: fixture.projectId, serviceSnapshotId: `${fixture.prefix}-service`, creditorSubjectType: "employee_user" as const, creditorUserId: fixture.employeeUserId, creditorCategory: "employee_net_pay", amountCents }]
  };
}

function approvedAuthorityLine<T extends {
  projectAllocations: unknown;
  projectCostComponentAllocations: unknown;
  projectCreditorAllocations: unknown;
}>(line: T) {
  const {
    projectAllocations: _projectAllocations,
    projectCostComponentAllocations: _projectCostComponentAllocations,
    projectCreditorAllocations: _projectCreditorAllocations,
    ...authority
  } = line;
  void _projectAllocations;
  void _projectCostComponentAllocations;
  void _projectCreditorAllocations;
  return authority;
}

function canonicalWageSourceForAmount(
  fixture: Awaited<ReturnType<typeof seedCanonicalWageFixture>>,
  amountCents: string,
  sourceVersion: string
): WageSourceInput {
  const input = canonicalWageSourceInput(fixture);
  const line = input.approvedPersonLines[0]!;
  return {
    ...input,
    idempotencyKey: randomUUID(),
    externalReference: `${input.externalReference}-${sourceVersion}`,
    sourceVersion,
    approvedPersonLines: [{
      ...line,
      approvedAmountCents: amountCents,
      costComponents: line.costComponents.map((component) => ({ ...component, amountCents })),
      creditorBreakdowns: line.creditorBreakdowns.map((creditor) => ({ ...creditor, amountCents }))
    }]
  };
}

function commandReceipt(aggregateId: string, idempotencyKey: string, fingerprint: string) {
  return {
    idempotencyKey,
    action: "create_draft",
    aggregateId,
    expectedRevision: 0,
    actorUserId: "wage-maker",
    fingerprint,
    resultSnapshot: { statementId: aggregateId }
  };
}

async function expectCheckViolation(operation: Promise<unknown>, constraintName: string) {
  await expect(operation).rejects.toThrow(constraintName);
}

function evidenceFile() {
  const id = `wage-evidence-${randomUUID()}`;
  return {
    id,
    bucket: "local-test",
    objectKey: `wage-evidence/${id}.json`,
    originalName: "external-approved-wage.json",
    mimeType: "application/json",
    sizeBytes: 1,
    uploadedByUserId: "wage-maker",
    contentSha256: "a".repeat(64),
    storageStatus: "active"
  };
}

function approvedSource(
  id: string,
  evidenceFileId: string,
  overrides: Partial<ReturnType<typeof approvedSourceBase>> = {}
) {
  return { ...approvedSourceBase(id, evidenceFileId), ...overrides };
}

function approvedSourceBase(id: string, evidenceFileId: string) {
  return {
    id,
    sourcePurpose: "ordinary",
    employmentCompanyId: `wage-company-${randomUUID()}`,
    wageMonth: "2026-08",
    periodStart: new Date("2026-08-01T00:00:00.000Z"),
    periodEnd: new Date("2026-08-31T00:00:00.000Z"),
    sourceType: "external_approved_wage",
    externalReference: `external-${randomUUID()}`,
    sourceVersion: "v1",
    basisDate: new Date("2026-08-31T00:00:00.000Z"),
    evidenceFileId,
    evidenceSha256: "a".repeat(64),
    sourceFingerprint: "b".repeat(64),
    sourceSnapshot: { source: "dynamic-test" },
    createdByUserId: "wage-maker"
  };
}

function statementVersion(statementId: string, sourceVersionId: string, id: string) {
  return {
    id,
    statementId,
    revision: 1,
    kind: "base",
    status: "draft",
    sourceVersionId,
    sourceSnapshot: { sourceVersionId },
    createdByUserId: "wage-maker",
    lastEditedByUserId: "wage-maker"
  };
}

function personLineData(
  statementVersionId: string,
  overrides: Partial<{
    employeeId: string;
    employmentSnapshotId: string;
    approvedAmountCents: bigint;
  }> = {}
) {
  const employeeId = overrides.employeeId ?? `wage-employee-${randomUUID()}`;
  const employmentSnapshotId =
    overrides.employmentSnapshotId ?? `wage-employment-${randomUUID()}`;
  return {
    statementVersionId,
    employeeId,
    employmentSnapshotId,
    employeeSnapshot: { employeeId },
    employmentSnapshot: { employmentSnapshotId },
    periodSnapshot: { wageMonth: "2026-08" },
    positionCategorySnapshot: { category: "general_worker" },
    approvedAmountCents: overrides.approvedAmountCents ?? 0n
  };
}

function expectUniqueViolation(results: PromiseSettledResult<unknown>[]) {
  const rejected = results.filter(
    (result): result is PromiseRejectedResult => result.status === "rejected"
  );
  expect(rejected).toHaveLength(1);
  expect(rejected[0]?.reason).toMatchObject({ code: "P2002" });
}
