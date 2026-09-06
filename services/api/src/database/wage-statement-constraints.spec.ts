import { randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";

import { CompanyRoleResolverService } from "../auth/company-role-resolver.service";
import { AuditService } from "../audit/audit.service";
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

  it("rejects forged canonical coordinates, envelope payees, matrix drift and payable-ref drift", async () => {
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

    const allocation = await first.wageProjectAllocation.findFirstOrThrow({
      where: { personLine: { statementVersionId: draftResult.versionId } }
    });
    await first.wageProjectCreditorAllocation.updateMany({
      where: { projectAllocationId: allocation.id },
      data: { amountCents: 99999n }
    });
    await expectCanonicalGuardRejection(
      first,
      canonicalCandidate,
      "矩阵不完整或未逐分平衡"
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
      employmentCompanyId: fixture.companyId,
      wageMonth: fixture.wageMonth,
      periodStart: "2026-08-01",
      periodEnd: "2026-08-31",
      externalReference: `${fixture.prefix}-MULTI-PAYROLL`,
      sourceVersion: "v1",
      basisDate: "2026-08-31",
      evidenceFileId: fixture.evidenceFileId,
      approvedPersonLines: [employeeLine, secondEmployeeLine]
    };
    const { service, draftResult } = await createSubmittedCanonicalWage(
      first,
      fixture,
      sourceInput,
      "150000"
    );
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
  });

  it("binds correction deltas, preserves zero deltas and rejects nonzero reversal snapshots", async () => {
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

    const invalidReversal = await createSubmittedRevision(
      first,
      service,
      fixture,
      baseDraft.statementId,
      3,
      "reversal",
      "1",
      "v4"
    );
    await expect(service.confirm(fixture.confirmerUserId, baseDraft.statementId, {
      idempotencyKey: randomUUID(),
      expectedRevision: 4
    })).rejects.toThrow("工资全额冲销必须保留完整身份并提交显式零金额快照");

    const refs = await observer.wagePayableRef.findMany({
      where: {
        confirmedVersionId: {
          in: [baseDraft.versionId, correction.versionId, zeroDelta.versionId, invalidReversal.versionId]
        }
      },
      orderBy: { createdAt: "asc" }
    });
    expect(refs).toHaveLength(2);
    expect(refs.map((ref) => [ref.direction, ref.amountCents])).toEqual([
      ["increase", 100000n],
      ["decrease", 40000n]
    ]);
    expect(refs[1]?.adjustsPayableRefId).toBe(refs[0]?.id);
    await expect(observer.operatingFact.count({
      where: {
        sourceType: "wage_statement_version",
        sourceBusinessId: {
          in: [
            `${baseDraft.versionId}:${fixture.projectId}`,
            `${correction.versionId}:${fixture.projectId}`,
            `${zeroDelta.versionId}:${fixture.projectId}`,
            `${invalidReversal.versionId}:${fixture.projectId}`
          ]
        }
      }
    })).resolves.toBe(2);
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
      where: { id: invalidReversal.versionId },
      select: { status: true, confirmedAt: true, confirmedByUserId: true }
    })).resolves.toEqual({ status: "submitted", confirmedAt: null, confirmedByUserId: null });
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
    personLines: sourceInput.approvedPersonLines
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
    personLines: sourceInput.approvedPersonLines
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
  const line = {
    employeeId: fixture.employeeUserId,
    employmentSnapshotId: `${fixture.prefix}-employment`,
    employmentCompanyId: fixture.companyId,
    employmentPeriodStart: "2026-08-01",
    employmentPeriodEnd: "2026-08-31",
    positionCategory: "project_manager",
    approvedAmountCents: "100000",
    costComponents: [{ componentCode: "gross_wage", amountCents: "100000" }],
    creditorBreakdowns: [{ creditorSubjectType: "employee_user" as const, creditorUserId: fixture.employeeUserId, creditorCategory: "employee_net_pay", amountCents: "100000" }],
    projectAllocations: [{ projectId: fixture.projectId, serviceSnapshotId: `${fixture.prefix}-service`, serviceMonth: fixture.wageMonth, serviceEvidenceSha256: "a".repeat(64), amountCents: "100000" }],
    projectCostComponentAllocations: [{ projectId: fixture.projectId, serviceSnapshotId: `${fixture.prefix}-service`, componentCode: "gross_wage", amountCents: "100000" }],
    projectCreditorAllocations: [{ projectId: fixture.projectId, serviceSnapshotId: `${fixture.prefix}-service`, creditorSubjectType: "employee_user" as const, creditorUserId: fixture.employeeUserId, creditorCategory: "employee_net_pay", amountCents: "100000" }]
  };
  return {
    idempotencyKey: randomUUID(),
    expectedRevision: 0,
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
      creditorBreakdowns: line.creditorBreakdowns.map((creditor) => ({ ...creditor, amountCents })),
      projectAllocations: line.projectAllocations.map((allocation) => ({ ...allocation, amountCents })),
      projectCostComponentAllocations: line.projectCostComponentAllocations.map((cell) => ({ ...cell, amountCents })),
      projectCreditorAllocations: line.projectCreditorAllocations.map((cell) => ({ ...cell, amountCents }))
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
