import { WageStatementService } from "./wage-statement.service";
import { fingerprint } from "../operating-takeover/operating-takeover.utils";

const SHA = "a".repeat(64);

const authorityLine = {
  employeeId: "employee-1",
  employmentSnapshotId: "employment-1",
  employmentCompanyId: "company-1",
  employmentPeriodStart: "2026-08-01",
  employmentPeriodEnd: "2026-08-31",
  positionCategory: "project_manager",
  approvedAmountCents: "100000",
  costComponents: [{ componentCode: "gross_wage", amountCents: "100000" }],
  creditorBreakdowns: [{
    creditorSubjectType: "employee_user",
    creditorUserId: "employee-1",
    creditorCategory: "employee_net_pay",
    amountCents: "100000"
  }],
  projectAllocations: [{
    projectId: "project-1",
    serviceSnapshotId: "service-1",
    serviceMonth: "2026-08",
    serviceEvidenceSha256: SHA,
    amountCents: "100000"
  }],
  projectCostComponentAllocations: [{
    projectId: "project-1",
    serviceSnapshotId: "service-1",
    componentCode: "gross_wage",
    amountCents: "100000"
  }],
  projectCreditorAllocations: [{
    projectId: "project-1",
    serviceSnapshotId: "service-1",
    creditorSubjectType: "employee_user",
    creditorUserId: "employee-1",
    creditorCategory: "employee_net_pay",
    amountCents: "100000"
  }]
};

function authorityLineWithAmount(amountCents: string) {
  const line = structuredClone(authorityLine);
  line.approvedAmountCents = amountCents;
  line.costComponents[0]!.amountCents = amountCents;
  line.creditorBreakdowns[0]!.amountCents = amountCents;
  line.projectAllocations[0]!.amountCents = amountCents;
  line.projectCostComponentAllocations[0]!.amountCents = amountCents;
  line.projectCreditorAllocations[0]!.amountCents = amountCents;
  return line;
}

function approvedSourceSnapshot(
  approvedPersonLine: typeof authorityLine,
  options: { externalReference?: string; sourceVersion?: string; evidenceFileId?: string } = {}
) {
  return {
    employmentCompany: { id: "company-1", name: "工资承担公司" },
    wageMonth: "2026-08",
    periodStart: "2026-08-01",
    periodEnd: "2026-08-31",
    externalReference: options.externalReference ?? "WAGE-2026-08",
    sourceVersion: options.sourceVersion ?? "1",
    basisDate: "2026-08-31",
    evidence: { fileId: options.evidenceFileId ?? "file-1", sha256: SHA },
    approvedPersonLines: [approvedPersonLine]
  };
}

function confirmedMatrixVersion(
  id: string,
  revision: number,
  kind: "base" | "correction" | "reversal",
  amountCents: bigint
) {
  const creditor = {
    id: `creditor-${revision}`,
    creditorSubjectId: null,
    creditorSubjectType: "employee_user",
    creditorUserId: "employee-1",
    creditorBusinessPartyVersionId: null,
    creditorSubjectIdentityKey: "employee_user:employee-1",
    creditorCategory: "employee_net_pay",
    creditorNameSnapshot: "张三",
    creditorUnifiedIdentitySnapshot: null,
    creditorVersionFingerprint: SHA,
    amountCents,
    projectAllocations: []
  };
  return {
    id,
    statementId: "statement-1",
    revision,
    kind,
    projectionOrigin: "historical_takeover_legacy_link",
    sourceVersion: { periodEnd: new Date("2026-08-31T00:00:00.000Z") },
    personLines: [{
      id: `person-${revision}`,
      employeeId: "employee-1",
      employmentSnapshotId: "employment-1",
      costComponents: [{
        id: `cost-${revision}`,
        componentCode: "gross_wage",
        amountCents,
        projectAllocations: []
      }],
      creditorBreakdowns: [creditor],
      projectAllocations: [{
        id: `allocation-${revision}`,
        projectId: "project-1",
        serviceSnapshotId: "service-1",
        amountCents,
        componentAllocations: [{
          id: `cost-cell-${revision}`,
          projectAllocationId: `allocation-${revision}`,
          costComponentId: `cost-${revision}`,
          amountCents,
          costComponent: { componentCode: "gross_wage" }
        }],
        creditorAllocations: [{
          id: `creditor-cell-${revision}`,
          projectAllocationId: `allocation-${revision}`,
          creditorBreakdownId: `creditor-${revision}`,
          amountCents,
          creditorBreakdown: creditor
        }]
      }]
    }]
  };
}

describe("WageStatementService historical takeover confirmation", () => {
  function createService() {
    const prisma = {};
    const roles = {};
    return new WageStatementService(prisma as never, roles as never);
  }

  function captureMutationCalls(tx: Record<string, unknown>) {
    const snapshot = new Map<string, string[]>();
    const methods = ["create", "createMany", "update", "updateMany", "upsert", "delete", "deleteMany"] as const;
    for (const [delegateName, delegate] of Object.entries(tx)) {
      if (!delegate || typeof delegate !== "object") continue;
      for (const methodName of methods) {
        const method = (delegate as Record<string, unknown>)[methodName];
        if (jest.isMockFunction(method)) {
          snapshot.set(`${delegateName}.${methodName}`, method.mock.calls.map((call) => fingerprint(call)));
        }
      }
    }
    return snapshot;
  }

  function expectMutationCallsUnchanged(tx: Record<string, unknown>, before: Map<string, string[]>) {
    const after = captureMutationCalls(tx);
    expect([...after.keys()].sort()).toEqual([...before.keys()].sort());
    for (const [key, calls] of after) expect(calls).toEqual(before.get(key));
  }

  function setupBaseConfirmationFixture(options: {
    company?: { id: string } | null;
    evidence?: { id: string; storageStatus: string; contentSha256: string | null } | null;
    employees?: Array<{ id: string; name: string; departmentId: string | null }>;
    projects?: Array<{ id: string; code: string; name: string }>;
    serviceBasisBindings?: Array<{
      id: string;
      projectId: string;
      serviceSnapshotId: string;
      serviceMonth: string;
      evidenceSha256: string;
      authorityFingerprint: string;
    }>;
    businessPartyCreditor?: boolean;
    businessPartyVersions?: Array<{
      id: string;
      businessPartyId: string;
      versionNo: number;
      snapshot: unknown;
    }>;
  } = {}) {
    const line = options.businessPartyCreditor
      ? ({
          ...structuredClone(authorityLine),
          creditorBreakdowns: [
            {
              creditorSubjectType: "employee_user",
              creditorUserId: "employee-1",
              creditorCategory: "employee_net_pay",
              amountCents: "80000"
            },
            {
              creditorSubjectType: "business_party",
              creditorBusinessPartyVersionId: "party-version-1",
              creditorCategory: "withheld_individual_income_tax",
              amountCents: "20000"
            }
          ],
          projectCreditorAllocations: [
            {
              projectId: "project-1",
              serviceSnapshotId: "service-1",
              creditorSubjectType: "employee_user",
              creditorUserId: "employee-1",
              creditorCategory: "employee_net_pay",
              amountCents: "80000"
            },
            {
              projectId: "project-1",
              serviceSnapshotId: "service-1",
              creditorSubjectType: "business_party",
              creditorBusinessPartyVersionId: "party-version-1",
              creditorCategory: "withheld_individual_income_tax",
              amountCents: "20000"
            }
          ]
        } as unknown as typeof authorityLine)
      : structuredClone(authorityLine);
    const sourceSnapshot = approvedSourceSnapshot(line);
    const source = {
      id: "source-1",
      employmentCompanyId: "company-1",
      wageMonth: "2026-08",
      periodStart: new Date("2026-08-01T00:00:00.000Z"),
      periodEnd: new Date("2026-08-31T00:00:00.000Z"),
      evidenceFileId: "file-1",
      evidenceSha256: SHA,
      sourceType: "external_approved_wage",
      externalReference: "WAGE-2026-08",
      sourceVersion: "1",
      basisDate: new Date("2026-08-31T00:00:00.000Z"),
      sourceFingerprint: fingerprint(sourceSnapshot),
      sourceSnapshot
    };
    const sourceDeltaFingerprint = "9bf9f08eb661a0ebe47a330b2f25bcdb7d77a7e3d5a21103565ff745d1c67e23";
    const canonicalRootClosureFingerprint = "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945";
    const reservation = {
      id: "reserved-version-1",
      atomicScopeVersionId: "scope-1",
      atomicScope: {
        id: "scope-1",
        reservedWageStatementVersionId: "reserved-version-1",
        authoritySourceRef: "source-1",
        authoritySourceFingerprint: source.sourceFingerprint,
        sourceClosureFingerprint: "c".repeat(64),
        projects: [{ projectId: "project-1" }]
      },
      targetWageStatementId: "statement-1",
      expectedCurrentRevision: 0,
      reservedRevision: 1,
      versionKind: "base",
      priorConfirmedVersionId: null,
      priorSourceVersionId: null,
      sourceDeltaFingerprint,
      canonicalRootClosureFingerprint,
      mappings: [{
        adapterKind: "historical_wage",
        evidenceLevel: "A",
        mappingDecision: "FORMAL",
        projectId: "project-1",
        wageApprovedSourceVersionId: "source-1",
        wageStatementReservationId: "reserved-version-1",
        manifest: { atomicScopeVersionId: "scope-1", projectId: "project-1" }
      }]
    };
    const events: string[] = [];
    const read = <T>(event: string, value: T) => jest.fn().mockImplementation(() => {
      events.push(event);
      return Promise.resolve(value);
    });
    let versionCreated = false;
    const confirmedVersion = {
      ...confirmedMatrixVersion("reserved-version-1", 1, "base", 100000n),
      status: "submitted",
      sourceVersionId: "source-1"
    };
    const tx = {
      wageTakeoverWageStatementReservation: { findUnique: jest.fn().mockResolvedValue(reservation) },
      wageApprovedSourceVersion: { findUnique: jest.fn().mockResolvedValue(source) },
      wageStatementVersion: {
        findUnique: jest.fn().mockImplementation(({ where, include }) => Promise.resolve(
          where?.id === "reserved-version-1" && include && versionCreated ? confirmedVersion : null
        )),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(() => {
          versionCreated = true;
          return Promise.resolve({ id: "reserved-version-1" });
        }),
        update: jest.fn().mockResolvedValue({ id: "reserved-version-1" })
      },
      wageStatement: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(() => {
          events.push("wageStatement.create");
          return Promise.resolve({
            id: "statement-1",
            employmentCompanyId: "company-1",
            wageMonth: "2026-08",
            currentRevision: 0
          });
        }),
        update: jest.fn().mockResolvedValue({ id: "statement-1", currentRevision: 1 })
      },
      companyEntity: {
        findUnique: read("company.read", options.company === undefined ? { id: "company-1" } : options.company)
      },
      fileObject: {
        findUnique: read("evidence.read", options.evidence === undefined
          ? { id: "file-1", storageStatus: "active", contentSha256: SHA }
          : options.evidence)
      },
      user: {
        findMany: read("employees.read", options.employees ?? [{ id: "employee-1", name: "张三", departmentId: null }])
      },
      project: {
        findMany: read("projects.read", options.projects ?? [{ id: "project-1", code: "P1", name: "项目一" }])
      },
      wageServiceBasisBinding: {
        findMany: read("bindings.read", options.serviceBasisBindings ?? [{
          id: "basis-1",
          projectId: "project-1",
          serviceSnapshotId: "service-1",
          serviceMonth: "2026-08",
          evidenceSha256: SHA,
          authorityFingerprint: "aae917f236292fe8521991c798df734666581521306df6ce3f4bfd7e90217a30"
        }])
      },
      businessPartyVersion: {
        findMany: read("businessParties.read", options.businessPartyVersions ?? (options.businessPartyCreditor
          ? [{
              id: "party-version-1",
              businessPartyId: "party-1",
              versionNo: 1,
              snapshot: { name: "税务机关", unifiedSocialCreditCode: "913100000000000001" }
            }]
          : []))
      },
      wagePersonLine: { create: jest.fn().mockResolvedValue({ id: "person-1" }) },
      wageCostComponent: { create: jest.fn().mockResolvedValue({ id: "cost-1", componentCode: "gross_wage" }) },
      wageCreditorBreakdown: {
        create: jest.fn().mockResolvedValue({
          id: "creditor-1",
          creditorCategory: "employee_net_pay",
          creditorSubjectType: "employee_user",
          creditorUserId: "employee-1",
          creditorBusinessPartyVersionId: null
        })
      },
      wageProjectAllocation: {
        create: jest.fn().mockResolvedValue({ id: "allocation-1", projectId: "project-1", serviceSnapshotId: "service-1" })
      },
      wageProjectCostComponentAllocation: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
      wageProjectCreditorAllocation: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
      wagePayableRef: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({ id: "payable-1" })
      },
      auditLog: { create: jest.fn().mockResolvedValue({ id: "audit-1" }) }
    };
    const service = createService();
    const projectConfirmedVersion = jest.spyOn(
      service as unknown as { projectConfirmedVersion: (...args: unknown[]) => Promise<void> },
      "projectConfirmedVersion"
    );
    const input = {
      atomicScopeVersionId: "scope-1",
      reservedVersionId: "reserved-version-1",
      sourceVersionId: "source-1",
      sourceFingerprint: source.sourceFingerprint,
      expectedProjectIds: ["project-1"],
      sourceClosureFingerprint: "c".repeat(64),
      targetWageStatementId: "statement-1",
      expectedCurrentRevision: 0,
      reservedRevision: 1,
      versionKind: "base" as const,
      priorConfirmedVersionId: null,
      priorSourceVersionId: null,
      sourceDeltaFingerprint,
      canonicalRootClosureFingerprint,
      actorUserId: "operator-1"
    };
    return { service, tx, input, events, projectConfirmedVersion };
  }

  it("rejects an inactive historical wage company before the first canonical mutation", async () => {
    const { service, tx, input, projectConfirmedVersion } = setupBaseConfirmationFixture({ company: null });
    const mutationsBefore = captureMutationCalls(tx);
    const projectionCallsBefore = projectConfirmedVersion.mock.calls.length;

    await expect(service.confirmHistoricalTakeoverInTransaction(tx as never, input))
      .rejects.toThrow("历史工资接管劳动关系公司已失效，不能确认");

    expectMutationCallsUnchanged(tx, mutationsBefore);
    expect(projectConfirmedVersion).toHaveBeenCalledTimes(projectionCallsBefore);
  });

  it.each([
    [
      "missing evidence",
      () => setupBaseConfirmationFixture({ evidence: null }),
      "外部批准工资资料证据已失效或校验值漂移，不能创建工资承担单"
    ],
    [
      "inactive evidence",
      () => setupBaseConfirmationFixture({ evidence: { id: "file-1", storageStatus: "inactive", contentSha256: SHA } }),
      "外部批准工资资料证据已失效或校验值漂移，不能创建工资承担单"
    ],
    [
      "evidence hash drift",
      () => setupBaseConfirmationFixture({ evidence: { id: "file-1", storageStatus: "active", contentSha256: "b".repeat(64) } }),
      "外部批准工资资料证据已失效或校验值漂移，不能创建工资承担单"
    ],
    [
      "missing active employee",
      () => setupBaseConfirmationFixture({ employees: [] }),
      "工资人员不存在或已停用"
    ],
    [
      "employee without a frozen creditor name",
      () => setupBaseConfirmationFixture({ employees: [{ id: "employee-1", name: "", departmentId: null }] }),
      "新工资债权人必须冻结名称"
    ],
    [
      "missing active project",
      () => setupBaseConfirmationFixture({ projects: [] }),
      "分摊项目不存在或已停用"
    ],
    [
      "missing service-basis binding",
      () => setupBaseConfirmationFixture({ serviceBasisBindings: [] }),
      "外部批准工资来源的服务依据绑定不完整，不能创建工资承担单"
    ],
    [
      "service-basis authority fingerprint drift",
      () => setupBaseConfirmationFixture({
        serviceBasisBindings: [{
          id: "basis-1",
          projectId: "project-1",
          serviceSnapshotId: "service-1",
          serviceMonth: "2026-08",
          evidenceSha256: SHA,
          authorityFingerprint: "b".repeat(64)
        }]
      }),
      "外部批准工资来源的服务依据绑定已失效或漂移，不能创建工资承担单"
    ],
    [
      "missing business-party creditor version",
      () => setupBaseConfirmationFixture({ businessPartyCreditor: true, businessPartyVersions: [] }),
      "新工资债权人必须冻结名称"
    ],
    [
      "business-party snapshot without a frozen creditor name",
      () => setupBaseConfirmationFixture({
        businessPartyCreditor: true,
        businessPartyVersions: [{
          id: "party-version-1",
          businessPartyId: "party-1",
          versionNo: 1,
          snapshot: { unifiedSocialCreditCode: "913100000000000001" }
        }]
      }),
      "新工资债权人必须冻结名称"
    ]
  ] as const)("rejects historical materialization %s before the first canonical mutation", async (_label, setupFixture, message) => {
    const { service, tx, input, projectConfirmedVersion } = setupFixture();
    const mutationsBefore = captureMutationCalls(tx);
    const projectionCallsBefore = projectConfirmedVersion.mock.calls.length;

    await expect(service.confirmHistoricalTakeoverInTransaction(tx as never, input)).rejects.toThrow(message);

    expectMutationCallsUnchanged(tx, mutationsBefore);
    expect(projectConfirmedVersion).toHaveBeenCalledTimes(projectionCallsBefore);
  });

  it("finishes every historical materialization read and frozen creditor preflight before base writes", async () => {
    const { service, tx, input, events, projectConfirmedVersion } = setupBaseConfirmationFixture();

    await expect(service.confirmHistoricalTakeoverInTransaction(tx as never, input)).resolves.toEqual({
      decision: "FORMAL",
      statementId: "statement-1",
      versionId: "reserved-version-1",
      projectionOrigin: "historical_takeover_legacy_link"
    });

    const firstWriteIndex = events.indexOf("wageStatement.create");
    expect(firstWriteIndex).toBeGreaterThan(-1);
    for (const readEvent of [
      "company.read",
      "evidence.read",
      "employees.read",
      "projects.read",
      "bindings.read",
      "businessParties.read"
    ]) {
      expect(events.indexOf(readEvent)).toBeGreaterThan(-1);
      expect(events.indexOf(readEvent)).toBeLessThan(firstWriteIndex);
    }
    expect(projectConfirmedVersion).toHaveBeenCalledTimes(1);
    expect(tx.wageStatement.create.mock.calls).toEqual([{
      data: {
        id: "statement-1",
        employmentCompanyId: "company-1",
        wageMonth: "2026-08",
        currentRevision: 0,
        createdByUserId: "operator-1"
      },
      select: { id: true, employmentCompanyId: true, wageMonth: true, currentRevision: true }
    }].map((call) => [call]));
    expect(tx.wageCreditorBreakdown.create.mock.calls).toEqual([[{
      data: {
        personLineId: "person-1",
        creditorSubjectId: undefined,
        creditorSubjectType: "employee_user",
        creditorUserId: "employee-1",
        creditorBusinessPartyVersionId: undefined,
        creditorSubjectIdentityKey: "employee_user:employee-1",
        creditorNameSnapshot: "张三",
        creditorUnifiedIdentitySnapshot: null,
        creditorVersionFingerprint: fingerprint({
          subjectType: "employee_user",
          userId: "employee-1",
          nameSnapshot: "张三"
        }),
        creditorCategory: "employee_net_pay",
        amountCents: 100000n,
        sourceSnapshot: {
          creditorSubjectType: "employee_user",
          creditorUserId: "employee-1",
          creditorCategory: "employee_net_pay",
          amountCents: "100000"
        }
      },
      select: {
        id: true,
        creditorCategory: true,
        creditorSubjectType: true,
        creditorUserId: true,
        creditorBusinessPartyVersionId: true
      }
    }]]);
    expect(tx.wageStatementVersion.update.mock.calls.at(-1)![0]).toEqual({
      where: { id: "reserved-version-1" },
      data: {
        status: "confirmed",
        confirmedByUserId: "operator-1",
        confirmedAt: expect.any(Date)
      }
    });
    expect(tx.auditLog.create.mock.calls).toHaveLength(1);
  });

  it("materializes a reserved historical version through the internal transaction-only seam", async () => {
    const sourceSnapshot = approvedSourceSnapshot(authorityLine);
    const source = {
      id: "source-1",
      employmentCompanyId: "company-1",
      wageMonth: "2026-08",
      periodStart: new Date("2026-08-01T00:00:00.000Z"),
      periodEnd: new Date("2026-08-31T00:00:00.000Z"),
      evidenceFileId: "file-1",
      evidenceSha256: SHA,
      sourceType: "external_approved_wage",
      externalReference: "WAGE-2026-08",
      sourceVersion: "1",
      basisDate: new Date("2026-08-31T00:00:00.000Z"),
      sourceFingerprint: fingerprint(sourceSnapshot),
      sourceSnapshot
    };
    const tx = {
      wageTakeoverWageStatementReservation: {
        findUnique: jest.fn().mockResolvedValue({
          id: "reserved-version-1",
          atomicScopeVersionId: "scope-1",
          atomicScope: {
            id: "scope-1",
            reservedWageStatementVersionId: "reserved-version-1",
            authoritySourceRef: "source-1",
            authoritySourceFingerprint: source.sourceFingerprint,
            sourceClosureFingerprint: "c".repeat(64),
            projects: [{ projectId: "project-1" }]
          },
          targetWageStatementId: "statement-1",
          expectedCurrentRevision: 0,
          reservedRevision: 1,
          versionKind: "base",
          priorConfirmedVersionId: null,
          priorSourceVersionId: null,
          sourceDeltaFingerprint: "d".repeat(64),
          canonicalRootClosureFingerprint: "e".repeat(64),
          mappings: [{
            adapterKind: "historical_wage",
            evidenceLevel: "A",
            mappingDecision: "FORMAL",
            projectId: "project-1",
            wageApprovedSourceVersionId: "source-1",
            wageStatementReservationId: "reserved-version-1",
            manifest: { atomicScopeVersionId: "scope-1", projectId: "project-1" }
          }]
        })
      },
      wageApprovedSourceVersion: { findUnique: jest.fn().mockResolvedValue(source) },
      wageStatementVersion: {
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: "reserved-version-1" }),
        update: jest.fn().mockResolvedValue({ id: "reserved-version-1" })
      },
      wageStatement: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({
          id: "statement-1",
          employmentCompanyId: "company-1",
          wageMonth: "2026-08",
          currentRevision: 0
        }),
        update: jest.fn().mockResolvedValue({ id: "statement-1", currentRevision: 1 })
      },
      companyEntity: { findUnique: jest.fn().mockResolvedValue({ id: "company-1" }) },
      fileObject: { findUnique: jest.fn().mockResolvedValue({ id: "file-1", storageStatus: "active", contentSha256: SHA }) },
      user: { findMany: jest.fn().mockResolvedValue([{ id: "employee-1", name: "张三", departmentId: null }]) },
      project: { findMany: jest.fn().mockResolvedValue([{ id: "project-1", code: "P1", name: "项目一" }]) },
      wageServiceBasisBinding: {
        findMany: jest.fn().mockResolvedValue([{
          id: "basis-1", projectId: "project-1", serviceSnapshotId: "service-1", serviceMonth: "2026-08",
          evidenceSha256: SHA,
          authorityFingerprint: "aae917f236292fe8521991c798df734666581521306df6ce3f4bfd7e90217a30"
        }])
      },
      businessPartyVersion: { findMany: jest.fn().mockResolvedValue([]) },
      wagePersonLine: { create: jest.fn().mockResolvedValue({ id: "person-1" }) },
      wageCostComponent: { create: jest.fn().mockResolvedValue({ id: "cost-1", componentCode: "gross_wage" }) },
      wageCreditorBreakdown: {
        create: jest.fn().mockResolvedValue({
          id: "creditor-1", creditorCategory: "employee_net_pay", creditorSubjectType: "employee_user",
          creditorUserId: "employee-1", creditorBusinessPartyVersionId: null
        })
      },
      wageProjectAllocation: { create: jest.fn().mockResolvedValue({ id: "allocation-1", projectId: "project-1", serviceSnapshotId: "service-1" }) },
      wageProjectCostComponentAllocation: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
      wageProjectCreditorAllocation: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
      auditLog: { create: jest.fn().mockResolvedValue({ id: "audit-1" }) }
    };
    const service = createService();
    const projection = jest.spyOn(
      service as unknown as { projectConfirmedVersion: (...args: unknown[]) => Promise<void> },
      "projectConfirmedVersion"
    ).mockResolvedValue(undefined);

    await expect(service.confirmHistoricalTakeoverInTransaction(tx as never, {
      atomicScopeVersionId: "scope-1",
      reservedVersionId: "reserved-version-1",
      sourceVersionId: "source-1",
      sourceFingerprint: source.sourceFingerprint,
      expectedProjectIds: ["project-1"],
      sourceClosureFingerprint: "c".repeat(64),
      targetWageStatementId: "statement-1",
      expectedCurrentRevision: 0,
      reservedRevision: 1,
      versionKind: "base",
      priorConfirmedVersionId: null,
      priorSourceVersionId: null,
      sourceDeltaFingerprint: "d".repeat(64),
      canonicalRootClosureFingerprint: "e".repeat(64),
      actorUserId: "operator-1"
    })).resolves.toEqual({
      decision: "FORMAL",
      statementId: "statement-1",
      versionId: "reserved-version-1",
      projectionOrigin: "historical_takeover_legacy_link"
    });

    expect(tx.wageStatementVersion.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        id: "reserved-version-1",
        projectionOrigin: "historical_takeover_legacy_link",
        status: "submitted"
      })
    }));
    expect(tx.wageStatement.create).toHaveBeenCalledWith({
      data: {
        id: "statement-1",
        employmentCompanyId: "company-1",
        wageMonth: "2026-08",
        currentRevision: 0,
        createdByUserId: "operator-1"
      },
      select: { id: true, employmentCompanyId: true, wageMonth: true, currentRevision: true }
    });
    expect(tx.wageStatement.update).toHaveBeenCalledWith({
      where: { id: "statement-1" },
      data: { currentRevision: 1 }
    });
    expect(projection).toHaveBeenCalledWith(
      tx,
      "reserved-version-1",
      "company-1",
      1,
      "operator-1",
      "historical_takeover_legacy_link",
      expect.objectContaining({ atomicScopeVersionId: "scope-1" })
    );
    expect(tx.wageTakeoverWageStatementReservation.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "reserved-version-1" }
    }));
  });

  it("plans the adjacent correction and immutable root closure without writing a scope or canonical wage row", async () => {
    const sourceSnapshot = approvedSourceSnapshot(authorityLineWithAmount("80000"), {
      sourceVersion: "2",
      evidenceFileId: "file-2"
    });
    const source = {
      id: "source-2",
      employmentCompanyId: "company-1",
      wageMonth: "2026-08",
      evidenceFileId: "file-2",
      evidenceSha256: SHA,
      periodStart: new Date("2026-08-01T00:00:00.000Z"),
      periodEnd: new Date("2026-08-31T00:00:00.000Z"),
      sourceType: "external_approved_wage",
      externalReference: "WAGE-2026-08",
      sourceVersion: "2",
      basisDate: new Date("2026-08-31T00:00:00.000Z"),
      sourceFingerprint: fingerprint(sourceSnapshot),
      sourceSnapshot
    };
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: "statement-1" }]),
      wageApprovedSourceVersion: { findUnique: jest.fn().mockResolvedValue(source) },
      fileObject: { findUnique: jest.fn().mockResolvedValue({ id: "file-2", storageStatus: "active", contentSha256: SHA }) },
      wageStatement: {
        findUnique: jest.fn()
          .mockResolvedValueOnce({ id: "statement-1", currentRevision: 1 })
          .mockResolvedValueOnce({
            id: "statement-1", employmentCompanyId: "company-1", wageMonth: "2026-08", currentRevision: 1
          })
      },
      wageStatementVersion: {
        findUnique: jest.fn().mockResolvedValue({
          ...confirmedMatrixVersion("version-1", 1, "base", 100000n),
          status: "confirmed",
          sourceVersionId: "source-1"
        }),
        create: jest.fn()
      },
      wagePayableRef: {
        findMany: jest.fn().mockResolvedValue([{
          id: "payable-root-1",
          amountCents: 100000n,
          debtorCompanyId: "company-1",
          costBearingCompanyId: "company-1",
          projectId: "project-1",
          projectAllocation: { serviceSnapshotId: "service-1" },
          personLine: { employeeId: "employee-1", employmentSnapshotId: "employment-1" },
          creditorBreakdown: {
            creditorSubjectType: "employee_user",
            creditorSubjectIdentityKey: "employee_user:employee-1",
            creditorCategory: "employee_net_pay"
          },
          adjustments: []
        }]),
        create: jest.fn()
      }
    };
    const service = createService();

    await expect(service.planHistoricalTakeoverInTransaction(tx as never, {
      sourceVersionId: "source-2",
      sourceFingerprint: source.sourceFingerprint
    })).resolves.toEqual(expect.objectContaining({
      targetWageStatementId: "statement-1",
      expectedCurrentRevision: 1,
      reservedRevision: 2,
      versionKind: "correction",
      priorConfirmedVersionId: "version-1",
      priorSourceVersionId: "source-1",
      sourceDeltaFingerprint: "3af33a0825f49c9c2d7c1a89f8f3e1a7a36c0bcbabca05bed2e6810486ff6aff",
      canonicalRootClosureFingerprint: "6b82364c0a3dcde95ac7b82d8d151d8374e7c293e7d916f349ee3e9f69e7b2e7",
      canonicalRootPayableRefIds: ["payable-root-1"],
      projects: [{
        projectId: "project-1",
        signedCostDeltaCents: "-20000",
        signedPayableDeltaCents: "-20000"
      }]
    }));
    expect(tx.wageStatementVersion.create).not.toHaveBeenCalled();
    expect(tx.wagePayableRef.create).not.toHaveBeenCalled();
  });

  it("rejects planning a historical correction on an ordinary wage version", async () => {
    const sourceSnapshot = approvedSourceSnapshot(authorityLineWithAmount("80000"), {
      sourceVersion: "2",
      evidenceFileId: "file-2"
    });
    const source = {
      id: "source-2",
      employmentCompanyId: "company-1",
      wageMonth: "2026-08",
      evidenceFileId: "file-2",
      evidenceSha256: SHA,
      periodStart: new Date("2026-08-01T00:00:00.000Z"),
      periodEnd: new Date("2026-08-31T00:00:00.000Z"),
      sourceType: "external_approved_wage",
      externalReference: "WAGE-2026-08",
      sourceVersion: "2",
      basisDate: new Date("2026-08-31T00:00:00.000Z"),
      sourceFingerprint: fingerprint(sourceSnapshot),
      sourceSnapshot
    };
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: "statement-1" }]),
      wageApprovedSourceVersion: { findUnique: jest.fn().mockResolvedValue(source) },
      fileObject: { findUnique: jest.fn().mockResolvedValue({ id: "file-2", storageStatus: "active", contentSha256: SHA }) },
      wageStatement: {
        findUnique: jest.fn()
          .mockResolvedValueOnce({ id: "statement-1", currentRevision: 1 })
          .mockResolvedValueOnce({
            id: "statement-1", employmentCompanyId: "company-1", wageMonth: "2026-08", currentRevision: 1
          })
      },
      wageStatementVersion: {
        findUnique: jest.fn().mockResolvedValue({
          ...confirmedMatrixVersion("version-1", 1, "base", 100000n),
          projectionOrigin: "ordinary",
          status: "confirmed",
          sourceVersionId: "source-1"
        })
      },
      wagePayableRef: {
        findMany: jest.fn().mockResolvedValue([{
          id: "payable-root-1",
          amountCents: 100000n,
          debtorCompanyId: "company-1",
          costBearingCompanyId: "company-1",
          projectId: "project-1",
          projectAllocation: { serviceSnapshotId: "service-1" },
          personLine: { employeeId: "employee-1", employmentSnapshotId: "employment-1" },
          creditorBreakdown: {
            creditorSubjectType: "employee_user",
            creditorSubjectIdentityKey: "employee_user:employee-1",
            creditorCategory: "employee_net_pay"
          },
          adjustments: []
        }])
      }
    };

    await expect(createService().planHistoricalTakeoverInTransaction(tx as never, {
      sourceVersionId: source.id,
      sourceFingerprint: source.sourceFingerprint
    })).rejects.toThrow("前置工资版本");

    expect(tx.wagePayableRef.findMany).not.toHaveBeenCalled();
  });

  it("reuses the scope-reserved logical statement id while revalidating an unmaterialized base", async () => {
    const sourceSnapshot = approvedSourceSnapshot(authorityLine);
    const source = {
      id: "source-1",
      employmentCompanyId: "company-1",
      wageMonth: "2026-08",
      evidenceFileId: "file-1",
      evidenceSha256: SHA,
      periodStart: new Date("2026-08-01T00:00:00.000Z"),
      periodEnd: new Date("2026-08-31T00:00:00.000Z"),
      sourceType: "external_approved_wage",
      externalReference: "WAGE-2026-08",
      sourceVersion: "1",
      basisDate: new Date("2026-08-31T00:00:00.000Z"),
      sourceFingerprint: fingerprint(sourceSnapshot),
      sourceSnapshot
    };
    const tx = {
      wageApprovedSourceVersion: { findUnique: jest.fn().mockResolvedValue(source) },
      fileObject: { findUnique: jest.fn().mockResolvedValue({ id: "file-1", storageStatus: "active", contentSha256: SHA }) },
      wageStatement: { findUnique: jest.fn().mockResolvedValue(null) },
      wagePayableRef: { findMany: jest.fn().mockResolvedValue([]) }
    };

    await expect(createService().planHistoricalTakeoverInTransaction(tx as never, {
      sourceVersionId: source.id,
      sourceFingerprint: source.sourceFingerprint,
      reservedTargetWageStatementId: "scope-reserved-statement-1"
    })).resolves.toEqual(expect.objectContaining({
      targetWageStatementId: "scope-reserved-statement-1",
      expectedCurrentRevision: 0,
      reservedRevision: 1,
      versionKind: "base"
    }));
  });

  it("keeps service snapshot identity distinct inside one employee and project", async () => {
    const splitLine = structuredClone(authorityLine);
    splitLine.projectAllocations = [
      { ...splitLine.projectAllocations[0]!, amountCents: "60000" },
      { ...splitLine.projectAllocations[0]!, serviceSnapshotId: "service-2", amountCents: "40000" }
    ];
    splitLine.projectCostComponentAllocations = [
      { ...splitLine.projectCostComponentAllocations[0]!, amountCents: "60000" },
      { ...splitLine.projectCostComponentAllocations[0]!, serviceSnapshotId: "service-2", amountCents: "40000" }
    ];
    splitLine.projectCreditorAllocations = [
      { ...splitLine.projectCreditorAllocations[0]!, amountCents: "60000" },
      { ...splitLine.projectCreditorAllocations[0]!, serviceSnapshotId: "service-2", amountCents: "40000" }
    ];
    const sourceSnapshot = approvedSourceSnapshot(splitLine);
    const source = {
      id: "source-split-services",
      employmentCompanyId: "company-1",
      wageMonth: "2026-08",
      periodStart: new Date("2026-08-01T00:00:00.000Z"),
      periodEnd: new Date("2026-08-31T00:00:00.000Z"),
      evidenceFileId: "file-1",
      evidenceSha256: SHA,
      sourceType: "external_approved_wage",
      externalReference: "WAGE-2026-08",
      sourceVersion: "1",
      basisDate: new Date("2026-08-31T00:00:00.000Z"),
      sourceFingerprint: fingerprint(sourceSnapshot),
      sourceSnapshot
    };
    const tx = {
      wageApprovedSourceVersion: { findUnique: jest.fn().mockResolvedValue(source) },
      fileObject: { findUnique: jest.fn().mockResolvedValue({ id: "file-1", storageStatus: "active", contentSha256: SHA }) },
      wageStatement: { findUnique: jest.fn().mockResolvedValue(null) },
      wagePayableRef: { findMany: jest.fn().mockResolvedValue([]) }
    };

    await expect(createService().planHistoricalTakeoverInTransaction(tx as never, {
      sourceVersionId: source.id,
      sourceFingerprint: source.sourceFingerprint,
      reservedTargetWageStatementId: "scope-reserved-statement-1"
    })).resolves.toEqual(expect.objectContaining({
      projects: [{
        projectId: "project-1",
        signedCostDeltaCents: "100000",
        signedPayableDeltaCents: "100000"
      }]
    }));
  });

  it("rejects a changed approved-source snapshot even when its stored fingerprint column is unchanged", async () => {
    const sourceSnapshot = approvedSourceSnapshot(authorityLine, { evidenceFileId: "file-1" });
    const storedFingerprint = fingerprint(sourceSnapshot);
    sourceSnapshot.externalReference = "TAMPERED-AFTER-FINGERPRINT";
    const source = {
      id: "source-drifted",
      employmentCompanyId: "company-1",
      wageMonth: "2026-08",
      periodStart: new Date("2026-08-01T00:00:00.000Z"),
      periodEnd: new Date("2026-08-31T00:00:00.000Z"),
      sourceType: "external_approved_wage",
      externalReference: "WAGE-2026-08",
      sourceVersion: "1",
      basisDate: new Date("2026-08-31T00:00:00.000Z"),
      evidenceFileId: "file-1",
      evidenceSha256: SHA,
      sourceFingerprint: storedFingerprint,
      sourceSnapshot
    };
    const tx = {
      wageApprovedSourceVersion: { findUnique: jest.fn().mockResolvedValue(source) },
      fileObject: { findUnique: jest.fn().mockResolvedValue({ id: "file-1", storageStatus: "active", contentSha256: SHA }) },
      wageStatement: { findUnique: jest.fn().mockResolvedValue(null) }
    };

    await expect(createService().planHistoricalTakeoverInTransaction(tx as never, {
      sourceVersionId: source.id,
      sourceFingerprint: storedFingerprint
    })).rejects.toThrow("来源快照指纹");

    expect(tx.wageStatement.findUnique).not.toHaveBeenCalled();
  });

  it("rejects a correction that adds even a zero-valued canonical cost identity", async () => {
    const nextLine = authorityLineWithAmount("80000");
    nextLine.costComponents.push({ componentCode: "project_bonus", amountCents: "0" });
    nextLine.projectCostComponentAllocations.push({
      projectId: "project-1",
      serviceSnapshotId: "service-1",
      componentCode: "project_bonus",
      amountCents: "0"
    });
    const sourceSnapshot = approvedSourceSnapshot(nextLine, {
      sourceVersion: "2",
      evidenceFileId: "file-2"
    });
    const source = {
      id: "source-2",
      employmentCompanyId: "company-1",
      wageMonth: "2026-08",
      evidenceFileId: "file-2",
      evidenceSha256: SHA,
      periodStart: new Date("2026-08-01T00:00:00.000Z"),
      periodEnd: new Date("2026-08-31T00:00:00.000Z"),
      sourceType: "external_approved_wage",
      externalReference: "WAGE-2026-08",
      sourceVersion: "2",
      basisDate: new Date("2026-08-31T00:00:00.000Z"),
      sourceFingerprint: fingerprint(sourceSnapshot),
      sourceSnapshot
    };
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: "statement-1" }]),
      wageApprovedSourceVersion: { findUnique: jest.fn().mockResolvedValue(source) },
      fileObject: { findUnique: jest.fn().mockResolvedValue({ id: "file-2", storageStatus: "active", contentSha256: SHA }) },
      wageStatement: {
        findUnique: jest.fn()
          .mockResolvedValueOnce({ id: "statement-1", currentRevision: 1 })
          .mockResolvedValueOnce({
            id: "statement-1", employmentCompanyId: "company-1", wageMonth: "2026-08", currentRevision: 1
          })
      },
      wageStatementVersion: {
        findUnique: jest.fn().mockResolvedValue({
          ...confirmedMatrixVersion("version-1", 1, "base", 100000n),
          status: "confirmed",
          sourceVersionId: "source-1"
        })
      },
      wagePayableRef: { findMany: jest.fn() }
    };

    await expect(createService().planHistoricalTakeoverInTransaction(tx as never, {
      sourceVersionId: source.id,
      sourceFingerprint: source.sourceFingerprint
    })).rejects.toThrow("身份集合发生变化");

    expect(tx.wagePayableRef.findMany).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: "correction",
      sourceVersionId: "source-2",
      currentAmountText: "80000",
      currentAmountCents: 80000n,
      versionKind: "correction" as const,
      expectedDeltaAmountCents: 20000n,
      sourceDeltaFingerprint: "3af33a0825f49c9c2d7c1a89f8f3e1a7a36c0bcbabca05bed2e6810486ff6aff",
      serviceBindingFingerprint: "82a9f6da7faf2fab0e85e2794abd4a515ed5469b578c9f107b8cf2573cd72a0e"
    },
    {
      label: "full reversal",
      sourceVersionId: "source-3",
      currentAmountText: "0",
      currentAmountCents: 0n,
      versionKind: "reversal" as const,
      expectedDeltaAmountCents: 100000n,
      sourceDeltaFingerprint: "5e74a6397f6952e778a394bf57cbfdcd8b4f58c47cb285315c34e8099266a58f",
      serviceBindingFingerprint: "407528d435371f89527256825ec68ae4840557010bfa89559787f570f831d000"
    }
  ])("confirms a reserved $label against the exact service-snapshot root without publishing a new operating fact", async ({
    sourceVersionId,
    currentAmountText,
    currentAmountCents,
    versionKind,
    expectedDeltaAmountCents,
    sourceDeltaFingerprint,
    serviceBindingFingerprint
  }) => {
    const sourceSnapshot = approvedSourceSnapshot(authorityLineWithAmount(currentAmountText), {
      sourceVersion: sourceVersionId,
      evidenceFileId: "file-2"
    });
    const source = {
      id: sourceVersionId,
      employmentCompanyId: "company-1",
      wageMonth: "2026-08",
      periodStart: new Date("2026-08-01T00:00:00.000Z"),
      periodEnd: new Date("2026-08-31T00:00:00.000Z"),
      evidenceFileId: "file-2",
      evidenceSha256: SHA,
      sourceType: "external_approved_wage",
      externalReference: "WAGE-2026-08",
      sourceVersion: sourceVersionId,
      basisDate: new Date("2026-08-31T00:00:00.000Z"),
      sourceFingerprint: fingerprint(sourceSnapshot),
      sourceSnapshot
    };
    const prior = confirmedMatrixVersion("version-1", 1, "base", 100000n);
    const current = {
      ...confirmedMatrixVersion("reserved-version-2", 2, versionKind, currentAmountCents),
      sourceVersionId
    };
    const priorWithSource = { ...prior, sourceVersionId: "source-1", status: "confirmed" };
    const operatingLedger = { appendConfirmedSourceInTransaction: jest.fn() };
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: "statement-1" }]),
      wageTakeoverWageStatementReservation: {
        findUnique: jest.fn().mockResolvedValue({
          id: "reserved-version-2",
          atomicScopeVersionId: "scope-2",
          targetWageStatementId: "statement-1",
          expectedCurrentRevision: 1,
          reservedRevision: 2,
          versionKind,
          priorConfirmedVersionId: "version-1",
          priorSourceVersionId: "source-1",
          sourceDeltaFingerprint,
          canonicalRootClosureFingerprint: "6b82364c0a3dcde95ac7b82d8d151d8374e7c293e7d916f349ee3e9f69e7b2e7",
          atomicScope: {
            id: "scope-2",
            reservedWageStatementVersionId: "reserved-version-2",
            authoritySourceRef: sourceVersionId,
            authoritySourceFingerprint: source.sourceFingerprint,
            sourceClosureFingerprint: "c".repeat(64),
            projects: [{ projectId: "project-1" }]
          },
          mappings: [{
            adapterKind: "historical_wage",
            evidenceLevel: "A",
            mappingDecision: "FORMAL",
            projectId: "project-1",
            wageApprovedSourceVersionId: sourceVersionId,
            wageStatementReservationId: "reserved-version-2",
            manifest: { atomicScopeVersionId: "scope-2", projectId: "project-1" }
          }]
        })
      },
      wageApprovedSourceVersion: { findUnique: jest.fn().mockResolvedValue(source) },
      wageStatement: {
        findUnique: jest.fn().mockResolvedValue({
          id: "statement-1", employmentCompanyId: "company-1", wageMonth: "2026-08", currentRevision: 1
        }),
        update: jest.fn().mockResolvedValue({ id: "statement-1", currentRevision: 2 })
      },
      wageStatementVersion: {
        findUnique: jest.fn().mockResolvedValueOnce(null)
          .mockResolvedValueOnce({
            id: "version-1",
            sourceVersionId: "source-1",
            projectionOrigin: "historical_takeover_legacy_link",
            status: "confirmed"
          })
          .mockResolvedValueOnce(current)
          .mockResolvedValueOnce(priorWithSource),
        findFirst: jest.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(prior),
        create: jest.fn().mockResolvedValue({ id: "reserved-version-2" }),
        update: jest.fn().mockResolvedValue({ id: "reserved-version-2" })
      },
      companyEntity: { findUnique: jest.fn().mockResolvedValue({ id: "company-1" }) },
      fileObject: { findUnique: jest.fn().mockResolvedValue({ id: "file-2", storageStatus: "active", contentSha256: SHA }) },
      user: { findMany: jest.fn().mockResolvedValue([{ id: "employee-1", name: "张三", departmentId: null }]) },
      project: {
        findMany: jest.fn().mockResolvedValue([{ id: "project-1", code: "P1", name: "项目一" }]),
        findUnique: jest.fn().mockResolvedValue({ operatingLedgerEffectiveDate: new Date("2026-08-01T00:00:00.000Z") })
      },
      wageServiceBasisBinding: {
        findMany: jest.fn().mockResolvedValue([{
          id: "basis-2", projectId: "project-1", serviceSnapshotId: "service-1", serviceMonth: "2026-08",
          evidenceSha256: SHA,
          authorityFingerprint: serviceBindingFingerprint
        }])
      },
      businessPartyVersion: { findMany: jest.fn().mockResolvedValue([]) },
      wagePersonLine: { create: jest.fn().mockResolvedValue({ id: "person-2" }) },
      wageCostComponent: { create: jest.fn().mockResolvedValue({ id: "cost-2", componentCode: "gross_wage" }) },
      wageCreditorBreakdown: {
        create: jest.fn().mockResolvedValue({
          id: "creditor-2", creditorCategory: "employee_net_pay", creditorSubjectType: "employee_user",
          creditorUserId: "employee-1", creditorBusinessPartyVersionId: null
        })
      },
      wageProjectAllocation: { create: jest.fn().mockResolvedValue({ id: "allocation-2", projectId: "project-1", serviceSnapshotId: "service-1" }) },
      wageProjectCostComponentAllocation: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
      wageProjectCreditorAllocation: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
      wagePayableRef: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "payable-root-1",
            amountCents: 100000n,
            debtorCompanyId: "company-1",
            costBearingCompanyId: "company-1",
            projectId: "project-1",
            projectAllocation: { serviceSnapshotId: "service-1" },
            personLine: { employeeId: "employee-1", employmentSnapshotId: "employment-1" },
            creditorBreakdown: {
              creditorSubjectType: "employee_user",
              creditorSubjectIdentityKey: "employee_user:employee-1",
              creditorCategory: "employee_net_pay"
            },
            adjustments: []
          },
          {
            id: "payable-root-other-service",
            amountCents: 100000n,
            debtorCompanyId: "company-1",
            costBearingCompanyId: "company-1",
            projectId: "project-1",
            projectAllocation: { serviceSnapshotId: "service-2" },
            personLine: { employeeId: "employee-1", employmentSnapshotId: "employment-1" },
            creditorBreakdown: {
              creditorSubjectType: "employee_user",
              creditorSubjectIdentityKey: "employee_user:employee-1",
              creditorCategory: "employee_net_pay"
            },
            adjustments: []
          }
        ]),
        create: jest.fn().mockResolvedValue({ id: "payable-adjustment-2" })
      },
      projectParticipatingCompany: { findFirst: jest.fn().mockResolvedValue({ companyEntityId: "company-1" }) },
      projectAffiliateAssignment: {
        findFirst: jest.fn().mockResolvedValue({
          id: "affiliate-1", businessPartyVersionId: "affiliate-version-1",
          affiliateNameSnapshot: "施工企业甲", affiliateCreditCodeSnapshot: null
        })
      },
      auditLog: { create: jest.fn().mockResolvedValue({ id: "audit-2" }) }
    };
    const service = new WageStatementService({} as never, {} as never, undefined, operatingLedger as never);

    await expect(service.confirmHistoricalTakeoverInTransaction(tx as never, {
      atomicScopeVersionId: "scope-2",
      reservedVersionId: "reserved-version-2",
      sourceVersionId,
      sourceFingerprint: source.sourceFingerprint,
      expectedProjectIds: ["project-1"],
      sourceClosureFingerprint: "c".repeat(64),
      targetWageStatementId: "statement-1",
      expectedCurrentRevision: 1,
      reservedRevision: 2,
      versionKind,
      priorConfirmedVersionId: "version-1",
      priorSourceVersionId: "source-1",
      sourceDeltaFingerprint,
      canonicalRootClosureFingerprint: "6b82364c0a3dcde95ac7b82d8d151d8374e7c293e7d916f349ee3e9f69e7b2e7",
      actorUserId: "operator-2"
    })).resolves.toEqual({
      decision: "FORMAL",
      statementId: "statement-1",
      versionId: "reserved-version-2",
      projectionOrigin: "historical_takeover_legacy_link"
    });

    expect(tx.wagePayableRef.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        confirmedVersionId: "reserved-version-2",
        amountCents: expectedDeltaAmountCents,
        direction: "decrease",
        adjustsPayableRefId: "payable-root-1"
      })
    }));
    expect(tx.wagePayableRef.findMany).toHaveBeenCalledWith(expect.objectContaining({
      select: expect.objectContaining({
        projectAllocation: { select: { serviceSnapshotId: true } }
      })
    }));
    expect(operatingLedger.appendConfirmedSourceInTransaction).not.toHaveBeenCalled();
    expect(tx.wageStatementVersion.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "reserved-version-2" },
      data: expect.objectContaining({
        operatingProjectionSnapshot: expect.objectContaining({ projectionOrigin: "historical_takeover_legacy_link" })
      })
    }));
  });

  it("rejects activation when the immediately preceding wage version is ordinary", async () => {
    const sourceSnapshot = approvedSourceSnapshot(authorityLineWithAmount("80000"), {
      sourceVersion: "source-2",
      evidenceFileId: "file-2"
    });
    const source = {
      id: "source-2",
      employmentCompanyId: "company-1",
      wageMonth: "2026-08",
      evidenceFileId: "file-2",
      evidenceSha256: SHA,
      periodStart: new Date("2026-08-01T00:00:00.000Z"),
      periodEnd: new Date("2026-08-31T00:00:00.000Z"),
      sourceType: "external_approved_wage",
      externalReference: "WAGE-2026-08",
      sourceVersion: "source-2",
      basisDate: new Date("2026-08-31T00:00:00.000Z"),
      sourceFingerprint: fingerprint(sourceSnapshot),
      sourceSnapshot
    };
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: "statement-1" }]),
      wageTakeoverWageStatementReservation: {
        findUnique: jest.fn().mockResolvedValue({
          id: "reserved-version-2",
          atomicScopeVersionId: "scope-2",
          targetWageStatementId: "statement-1",
          expectedCurrentRevision: 1,
          reservedRevision: 2,
          versionKind: "correction",
          priorConfirmedVersionId: "version-1",
          priorSourceVersionId: "source-1",
          sourceDeltaFingerprint: "d".repeat(64),
          canonicalRootClosureFingerprint: "e".repeat(64),
          atomicScope: {
            id: "scope-2",
            reservedWageStatementVersionId: "reserved-version-2",
            authoritySourceRef: source.id,
            authoritySourceFingerprint: source.sourceFingerprint,
            sourceClosureFingerprint: "c".repeat(64),
            projects: [{ projectId: "project-1" }]
          },
          mappings: [{
            adapterKind: "historical_wage",
            evidenceLevel: "A",
            mappingDecision: "FORMAL",
            projectId: "project-1",
            wageApprovedSourceVersionId: source.id,
            wageStatementReservationId: "reserved-version-2",
            manifest: { atomicScopeVersionId: "scope-2", projectId: "project-1" }
          }]
        })
      },
      wageApprovedSourceVersion: { findUnique: jest.fn().mockResolvedValue(source) },
      wageStatement: {
        findUnique: jest.fn().mockResolvedValue({
          id: "statement-1", employmentCompanyId: "company-1", wageMonth: "2026-08", currentRevision: 1
        })
      },
      wageStatementVersion: {
        findUnique: jest.fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({
            id: "version-1",
            statementId: "statement-1",
            revision: 1,
            sourceVersionId: "source-1",
            projectionOrigin: "ordinary",
            status: "confirmed"
          }),
        findFirst: jest.fn().mockResolvedValue(null)
      },
      companyEntity: {
        findUnique: jest.fn().mockRejectedValue(new Error("ORDINARY_PRIOR_CONTINUED"))
      },
      fileObject: { findUnique: jest.fn().mockResolvedValue(null) },
      user: { findMany: jest.fn().mockResolvedValue([]) },
      project: { findMany: jest.fn().mockResolvedValue([]) },
      wageServiceBasisBinding: { findMany: jest.fn().mockResolvedValue([]) },
      businessPartyVersion: { findMany: jest.fn().mockResolvedValue([]) }
    };

    await expect(createService().confirmHistoricalTakeoverInTransaction(tx as never, {
      atomicScopeVersionId: "scope-2",
      reservedVersionId: "reserved-version-2",
      sourceVersionId: source.id,
      sourceFingerprint: source.sourceFingerprint,
      expectedProjectIds: ["project-1"],
      sourceClosureFingerprint: "c".repeat(64),
      targetWageStatementId: "statement-1",
      expectedCurrentRevision: 1,
      reservedRevision: 2,
      versionKind: "correction",
      priorConfirmedVersionId: "version-1",
      priorSourceVersionId: "source-1",
      sourceDeltaFingerprint: "d".repeat(64),
      canonicalRootClosureFingerprint: "e".repeat(64),
      actorUserId: "operator-2"
    })).rejects.toThrow("前置工资版本");

    expect(tx.companyEntity.findUnique).not.toHaveBeenCalled();
  });

  it("rejects a reserved UUID that is not owned by the activating atomic scope before reading wage authority", async () => {
    const tx = {
      wageTakeoverWageStatementReservation: {
        findUnique: jest.fn().mockResolvedValue({
          id: "reserved-version-1",
          atomicScopeVersionId: "another-scope",
          atomicScope: {
            id: "another-scope",
            reservedWageStatementVersionId: "reserved-version-1",
            authoritySourceRef: "source-1",
            authoritySourceFingerprint: "b".repeat(64),
            sourceClosureFingerprint: "c".repeat(64)
          },
          mappings: []
        })
      },
      wageApprovedSourceVersion: { findUnique: jest.fn() }
    };
    const service = createService();

    await expect(service.confirmHistoricalTakeoverInTransaction(tx as never, {
      atomicScopeVersionId: "scope-1",
      reservedVersionId: "reserved-version-1",
      sourceVersionId: "source-1",
      sourceFingerprint: "b".repeat(64),
      expectedProjectIds: ["project-1"],
      sourceClosureFingerprint: "c".repeat(64),
      targetWageStatementId: "statement-1",
      expectedCurrentRevision: 0,
      reservedRevision: 1,
      versionKind: "base",
      priorConfirmedVersionId: null,
      priorSourceVersionId: null,
      sourceDeltaFingerprint: "d".repeat(64),
      canonicalRootClosureFingerprint: "e".repeat(64),
      actorUserId: "operator-1"
    })).rejects.toThrow("预留版本不属于当前原子范围");

    expect(tx.wageApprovedSourceVersion.findUnique).not.toHaveBeenCalled();
  });

  it("rejects any wage version that already exists at the reserved UUID instead of treating activation as LINK", async () => {
    const sourceSnapshot = approvedSourceSnapshot(authorityLine);
    const source = {
      id: "source-1",
      employmentCompanyId: "company-1",
      wageMonth: "2026-08",
      periodStart: new Date("2026-08-01T00:00:00.000Z"),
      periodEnd: new Date("2026-08-31T00:00:00.000Z"),
      evidenceFileId: "file-1",
      evidenceSha256: SHA,
      sourceType: "external_approved_wage",
      externalReference: "WAGE-2026-08",
      sourceVersion: "1",
      basisDate: new Date("2026-08-31T00:00:00.000Z"),
      sourceFingerprint: fingerprint(sourceSnapshot),
      sourceSnapshot
    };
    const tx = {
      wageTakeoverWageStatementReservation: {
        findUnique: jest.fn().mockResolvedValue({
          id: "reserved-version-1",
          atomicScopeVersionId: "scope-1",
          atomicScope: {
            id: "scope-1",
            reservedWageStatementVersionId: "reserved-version-1",
            authoritySourceRef: "source-1",
            authoritySourceFingerprint: source.sourceFingerprint,
            sourceClosureFingerprint: "c".repeat(64),
            projects: [{ projectId: "project-1" }]
          },
          targetWageStatementId: "statement-1",
          expectedCurrentRevision: 0,
          reservedRevision: 1,
          versionKind: "base",
          priorConfirmedVersionId: null,
          priorSourceVersionId: null,
          sourceDeltaFingerprint: "d".repeat(64),
          canonicalRootClosureFingerprint: "e".repeat(64),
          mappings: [{
            adapterKind: "historical_wage",
            evidenceLevel: "A",
            mappingDecision: "FORMAL",
            projectId: "project-1",
            wageApprovedSourceVersionId: "source-1",
            wageStatementReservationId: "reserved-version-1",
            manifest: { atomicScopeVersionId: "scope-1", projectId: "project-1" }
          }]
        })
      },
      wageApprovedSourceVersion: { findUnique: jest.fn().mockResolvedValue(source) },
      wageStatementVersion: {
        findUnique: jest.fn().mockResolvedValue({ id: "reserved-version-1", statementId: "statement-existing" }),
        findFirst: jest.fn().mockResolvedValue(null)
      }
    };
    const service = createService();

    await expect(service.confirmHistoricalTakeoverInTransaction(tx as never, {
      atomicScopeVersionId: "scope-1",
      reservedVersionId: "reserved-version-1",
      sourceVersionId: "source-1",
      sourceFingerprint: source.sourceFingerprint,
      expectedProjectIds: ["project-1"],
      sourceClosureFingerprint: "c".repeat(64),
      targetWageStatementId: "statement-1",
      expectedCurrentRevision: 0,
      reservedRevision: 1,
      versionKind: "base",
      priorConfirmedVersionId: null,
      priorSourceVersionId: null,
      sourceDeltaFingerprint: "d".repeat(64),
      canonicalRootClosureFingerprint: "e".repeat(64),
      actorUserId: "operator-1"
    })).rejects.toThrow("预留版本在激活前已存在");

    expect(tx.wageStatementVersion.findUnique).toHaveBeenCalledWith({
      where: { id: "reserved-version-1" },
      select: { id: true, statementId: true }
    });
    expect(tx.wageApprovedSourceVersion.findUnique).not.toHaveBeenCalled();
  });

  it("never invokes the ordinary operating-ledger append for a historical-link projection", async () => {
    const tx = {
      wageStatementVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "version-1",
          statementId: "statement-1",
          revision: 1,
          kind: "base",
          sourceVersionId: "source-1",
          sourceVersion: { periodEnd: new Date("2026-08-31T00:00:00.000Z") },
          personLines: [{
            id: "person-1",
            employeeId: "employee-1",
            employmentSnapshotId: "employment-1",
            costComponents: [{ id: "cost-1", componentCode: "gross_wage", amountCents: 100000n }],
            creditorBreakdowns: [{
              id: "creditor-1", creditorSubjectId: null, creditorSubjectType: "employee_user", creditorUserId: "employee-1", creditorBusinessPartyVersionId: null, creditorSubjectIdentityKey: "employee_user:employee-1",
              creditorCategory: "employee_net_pay", creditorNameSnapshot: "张三", creditorUnifiedIdentitySnapshot: null,
              creditorVersionFingerprint: SHA, amountCents: 100000n
            }],
            projectAllocations: [{
              id: "allocation-1", projectId: "project-1", serviceSnapshotId: "service-1", amountCents: 100000n,
              componentAllocations: [{ id: "cost-cell-1", amountCents: 100000n, costComponentId: "cost-1", costComponent: { componentCode: "gross_wage" } }],
              creditorAllocations: [{ id: "creditor-cell-1", amountCents: 100000n, creditorBreakdownId: "creditor-1", creditorBreakdown: {
                id: "creditor-1", creditorSubjectId: null, creditorSubjectType: "employee_user", creditorUserId: "employee-1", creditorBusinessPartyVersionId: null, creditorSubjectIdentityKey: "employee_user:employee-1",
                creditorCategory: "employee_net_pay", creditorNameSnapshot: "张三", creditorUnifiedIdentitySnapshot: null,
                creditorVersionFingerprint: SHA
              } }]
            }]
          }]
        }),
        update: jest.fn().mockResolvedValue({ id: "version-1" })
      },
      wagePayableRef: { create: jest.fn().mockResolvedValue({ id: "payable-1" }), findMany: jest.fn().mockResolvedValue([]) }
    };
    const service = createService();

    await expect((service as unknown as {
      projectConfirmedVersion: (...args: unknown[]) => Promise<void>;
    }).projectConfirmedVersion(
      tx,
      "version-1",
      "company-1",
      1,
      "operator-1",
      "historical_takeover_legacy_link",
      {
        atomicScopeVersionId: "scope-1",
        sourceVersionId: "source-1",
        expectedProjectIds: ["project-1"],
        sourceClosureFingerprint: "c".repeat(64),
        targetWageStatementId: "statement-1",
        expectedCurrentRevision: 0,
        reservedRevision: 1,
        versionKind: "base",
        priorConfirmedVersionId: null,
        priorSourceVersionId: null,
        sourceDeltaFingerprint: "9bf9f08eb661a0ebe47a330b2f25bcdb7d77a7e3d5a21103565ff745d1c67e23",
        canonicalRootClosureFingerprint: "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945"
      }
    )).resolves.toBeUndefined();

    expect(tx.wagePayableRef.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ confirmedVersionId: "version-1", projectId: "project-1" })
    }));
    expect(tx.wageStatementVersion.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ operatingProjectionSnapshot: expect.objectContaining({ projectionOrigin: "historical_takeover_legacy_link" }) })
    }));
  });
});
