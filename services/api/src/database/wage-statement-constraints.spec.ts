import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";

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
    await observer.wageApprovedSourceVersion.delete({ where: { id: source.id } });
    await observer.fileObject.delete({ where: { id: evidence.id } });

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
    await observer.wageApprovedSourceVersion.delete({ where: { id: constraintSource.id } });
    await observer.fileObject.delete({ where: { id: constraintEvidence.id } });
  });
});

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
