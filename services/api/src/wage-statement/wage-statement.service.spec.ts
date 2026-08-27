import { createHash } from "node:crypto";

import { ConflictException, ForbiddenException } from "@nestjs/common";

import { WageStatementService } from "./wage-statement.service";

describe("WageStatementService", () => {
  const approvedSource = {
    idempotencyKey: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    expectedRevision: 0,
    employmentCompanyId: "company-1",
    wageMonth: "2026-08",
    periodStart: "2026-08-01",
    periodEnd: "2026-08-31",
    externalReference: "PAYROLL-2026-08",
    sourceVersion: "v1",
    basisDate: "2026-08-31",
    evidenceFileId: "file-1",
    approvedPersonLines: [
      {
        employeeId: "employee-1",
        employmentSnapshotId: "employment-1",
        employmentCompanyId: "company-1",
        employmentPeriodStart: "2026-08-01",
        employmentPeriodEnd: "2026-08-31",
        positionCategory: "project_manager",
        approvedAmountCents: "100000",
        costComponents: [{ componentCode: "gross_wage", amountCents: "100000" }],
        creditorBreakdowns: [{ creditorSubjectType: "employee_user" as const, creditorUserId: "employee-1", creditorCategory: "employee_net_pay", amountCents: "100000" }],
        projectAllocations: [{ projectId: "project-1", serviceSnapshotId: "service-1", serviceMonth: "2026-08", serviceEvidenceSha256: "a".repeat(64), amountCents: "100000" }],
        projectCostComponentAllocations: [{ projectId: "project-1", serviceSnapshotId: "service-1", componentCode: "gross_wage", amountCents: "100000" }],
        projectCreditorAllocations: [{ projectId: "project-1", serviceSnapshotId: "service-1", creditorSubjectType: "employee_user" as const, creditorUserId: "employee-1", creditorCategory: "employee_net_pay", amountCents: "100000" }]
      }
    ]
  };

  const draft = {
    sourceVersionId: "source-1",
    idempotencyKey: "11111111-1111-4111-8111-111111111111",
    expectedRevision: 0,
    wageMonth: "2026-08",
    sourceTotalCents: "100000",
    personLines: [
      {
        employeeId: "employee-1",
        employmentSnapshotId: "employment-1",
        employmentCompanyId: "company-1",
        employmentPeriodStart: "2026-08-01",
        employmentPeriodEnd: "2026-08-31",
        positionCategory: "project_manager",
        approvedAmountCents: "100000",
        costComponents: [{ componentCode: "gross_wage", amountCents: "100000" }],
        creditorBreakdowns: [{ creditorSubjectType: "employee_user" as const, creditorUserId: "employee-1", creditorCategory: "employee_net_pay", amountCents: "100000" }],
        projectAllocations: [{ projectId: "project-1", serviceSnapshotId: "service-1", serviceMonth: "2026-08", serviceEvidenceSha256: "a".repeat(64), amountCents: "100000" }],
        projectCostComponentAllocations: [{ projectId: "project-1", serviceSnapshotId: "service-1", componentCode: "gross_wage", amountCents: "100000" }],
        projectCreditorAllocations: [{ projectId: "project-1", serviceSnapshotId: "service-1", creditorSubjectType: "employee_user" as const, creditorUserId: "employee-1", creditorCategory: "employee_net_pay", amountCents: "100000" }]
      }
    ]
  };

  function setup() {
    const tx = {
      companyEntity: { findUnique: jest.fn().mockResolvedValue({ id: "company-1", name: "甲公司" }) },
      fileObject: { findUnique: jest.fn().mockResolvedValue({ id: "file-1", storageStatus: "active", contentSha256: "a".repeat(64) }) },
      user: { findMany: jest.fn().mockResolvedValue([{ id: "employee-1", name: "张三", departmentId: "dept-1" }]) },
      project: { findMany: jest.fn().mockResolvedValue([{ id: "project-1", code: "P1", name: "一号项目" }]), findUnique: jest.fn() },
      wageApprovedSourceVersion: { create: jest.fn().mockResolvedValue({ id: "source-1" }), findUnique: jest.fn() },
      wageServiceBasisBinding: { create: jest.fn().mockResolvedValue({ id: "basis-1" }), findMany: jest.fn().mockResolvedValue([{ id: "basis-1", projectId: "project-1", serviceSnapshotId: "service-1", serviceMonth: "2026-08", evidenceSha256: "a".repeat(64), authorityFingerprint: "aae917f236292fe8521991c798df734666581521306df6ce3f4bfd7e90217a30" }]) },
      wageApprovedSourceCommandReceipt: { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({ idempotencyKey: "source-receipt-1" }) },
      $queryRaw: jest.fn(),
      wageStatement: { create: jest.fn().mockResolvedValue({ id: "statement-1" }), findUnique: jest.fn(), update: jest.fn() },
      wageStatementVersion: { create: jest.fn().mockResolvedValue({ id: "version-1" }), findUnique: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
      wageCommandReceipt: { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({ idempotencyKey: "receipt-1" }) },
      wagePersonLine: { create: jest.fn().mockResolvedValue({ id: "person-1" }) },
      wageCostComponent: { create: jest.fn().mockResolvedValue({ id: "cost-1", componentCode: "gross_wage" }), createMany: jest.fn().mockResolvedValue({ count: 1 }) },
      wageCreditorBreakdown: { create: jest.fn().mockResolvedValue({ id: "creditor-1", creditorCategory: "employee_net_pay", creditorSubjectType: "employee_user", creditorUserId: "employee-1", creditorBusinessPartyVersionId: null }), createMany: jest.fn().mockResolvedValue({ count: 1 }) },
      wageProjectAllocation: { create: jest.fn().mockResolvedValue({ id: "allocation-1", projectId: "project-1", serviceSnapshotId: "service-1" }), createMany: jest.fn().mockResolvedValue({ count: 1 }) },
      wageProjectCostComponentAllocation: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
      wageProjectCreditorAllocation: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
      wagePayableRef: { findMany: jest.fn(), create: jest.fn() },
      projectParticipatingCompany: { findFirst: jest.fn() },
      projectAffiliateAssignment: { findFirst: jest.fn() },
      businessPartyVersion: { findMany: jest.fn().mockResolvedValue([]) },
      auditLog: { create: jest.fn().mockResolvedValue({ id: "audit-1" }) }
    };
    const prisma = {
      $transaction: jest.fn((work) => work(tx)),
      wageCommandReceipt: { findUnique: jest.fn() },
      wageApprovedSourceCommandReceipt: { findUnique: jest.fn() }
    };
    const roles = { resolveActiveRoleScopes: jest.fn().mockResolvedValue(["finance_staff"]) };
    const operatingLedger = { appendConfirmedSourceInTransaction: jest.fn().mockResolvedValue({ id: "operating-1" }) };
    const service = new WageStatementService(prisma as never, roles as never, undefined, operatingLedger as never);
    // Legacy command tests isolate receipt/segregation behavior. Projection's
    // own matrix and append-only tests construct the complete confirmed graph.
    const servicePrototype = Object.getPrototypeOf(service) as {
      projectConfirmedVersion: () => Promise<void>;
    };
    jest.spyOn(servicePrototype, "projectConfirmedVersion").mockResolvedValue(undefined);
    return { service, tx, roles, prisma, operatingLedger };
  }

  it("creates a server-fingerprinted approved source only from an active company, active people, and active evidence", async () => {
    const { service, tx } = setup();

    await expect(service.createApprovedSource("actor-1", approvedSource)).resolves.toEqual({ id: "source-1" });

    expect(tx.wageApprovedSourceVersion.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        employmentCompanyId: "company-1",
        sourceType: "external_approved_wage",
        evidenceSha256: "a".repeat(64),
        sourceFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/),
        createdByUserId: "actor-1"
      })
    }));
  });

  it("fails closed when the named company, person, or evidence cannot be verified as active", async () => {
    const { service, tx } = setup();
    tx.fileObject.findUnique.mockResolvedValue({ id: "file-1", storageStatus: "deleted", contentSha256: "a".repeat(64) });

    await expect(service.createApprovedSource("actor-1", approvedSource)).rejects.toThrow("外部批准工资资料不存在、不可用或缺少内容校验值");
    expect(tx.wageApprovedSourceVersion.create).not.toHaveBeenCalled();
  });

  it("fails closed before freezing a source when any allocated project is inactive or absent", async () => {
    const { service, tx } = setup();
    tx.project.findMany.mockResolvedValue([]);

    await expect(service.createApprovedSource("actor-1", approvedSource)).rejects.toThrow("分摊项目不存在或已停用");
    expect(tx.wageApprovedSourceVersion.create).not.toHaveBeenCalled();
  });

  it("requires every external service basis to prove the same natural wage month", async () => {
    const { service, tx } = setup();
    await expect(service.createApprovedSource("actor-1", {
      ...approvedSource,
      approvedPersonLines: [{
        ...approvedSource.approvedPersonLines[0],
        projectAllocations: [{ ...approvedSource.approvedPersonLines[0].projectAllocations[0], serviceMonth: "2026-07" }]
      }]
    })).rejects.toThrow("服务依据月份必须与工资月份一致");
    await expect(service.createApprovedSource("actor-1", {
      ...approvedSource,
      approvedPersonLines: [{
        ...approvedSource.approvedPersonLines[0],
        projectAllocations: [{ ...approvedSource.approvedPersonLines[0].projectAllocations[0], serviceEvidenceSha256: "not-a-hash" }]
      }]
    })).rejects.toThrow("服务依据校验值必须为 SHA-256");
    expect(tx.wageApprovedSourceVersion.create).not.toHaveBeenCalled();
  });

  it("binds every frozen service basis to the approved-source evidence hash", async () => {
    const { service, tx } = setup();
    await expect(service.createApprovedSource("actor-1", {
      ...approvedSource,
      approvedPersonLines: [{
        ...approvedSource.approvedPersonLines[0],
        projectAllocations: [{ ...approvedSource.approvedPersonLines[0].projectAllocations[0], serviceEvidenceSha256: "c".repeat(64) }]
      }]
    })).rejects.toThrow("服务依据必须由同一外部批准工资资料校验值证明");
    expect(tx.wageApprovedSourceVersion.create).not.toHaveBeenCalled();
  });

  it("persists a server-controlled service-basis binding rather than carrying a naked caller service ID into a wage allocation", async () => {
    const { service, tx } = setup();
    await service.createApprovedSource("actor-1", approvedSource);

    expect(tx.wageServiceBasisBinding.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ sourceVersionId: "source-1", projectId: "project-1", serviceSnapshotId: "service-1", evidenceSha256: "a".repeat(64), authorityFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/) })
    }));
  });

  it("creates one same-company monthly draft atomically with immutable source-backed facts", async () => {
    const { service, tx, prisma } = setup();
    tx.wageApprovedSourceVersion.findUnique.mockResolvedValue({
      id: "source-1",
      employmentCompanyId: "company-1",
      wageMonth: "2026-08",
      periodStart: new Date("2026-08-01T00:00:00.000Z"),
      periodEnd: new Date("2026-08-31T00:00:00.000Z"),
      evidenceFileId: "file-1",
      evidenceSha256: "a".repeat(64),
      sourceSnapshot: {
        approvedPersonLines: approvedSource.approvedPersonLines
      }
    });

    await expect(service.createDraft("actor-1", draft)).resolves.toEqual({ statementId: "statement-1", versionId: "version-1", revision: 1 });

    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({ isolationLevel: "Serializable" }));
    expect(tx.wageStatement.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ employmentCompanyId: "company-1", wageMonth: "2026-08", currentRevision: 1 })
    }));
    expect(tx.wageStatementVersion.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ statementId: "statement-1", revision: 1, sourceVersionId: "source-1", status: "draft" })
    }));
    expect(tx.wageCostComponent.create).toHaveBeenCalled();
    expect(tx.wageCreditorBreakdown.create).toHaveBeenCalled();
    expect(tx.wageProjectAllocation.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ serviceBasisBindingId: "basis-1" }) }));
  });

  it("creates an auditable later supplemental revision only from a confirmed predecessor and a complete new source/matrix payload", async () => {
    const { service, tx, prisma } = setup();
    tx.$queryRaw.mockResolvedValue([{ id: "statement-1" }]);
    tx.wageApprovedSourceVersion.findUnique.mockResolvedValue({
      id: "source-1", employmentCompanyId: "company-1", wageMonth: "2026-08",
      periodStart: new Date("2026-08-01T00:00:00.000Z"), periodEnd: new Date("2026-08-31T00:00:00.000Z"),
      evidenceFileId: "file-1", evidenceSha256: "a".repeat(64), sourceSnapshot: { approvedPersonLines: approvedSource.approvedPersonLines }
    });
    tx.wageStatement.findUnique.mockResolvedValue({ id: "statement-1", employmentCompanyId: "company-1", currentRevision: 1 });
    tx.wageStatementVersion.findUnique.mockResolvedValue({ id: "version-1", statementId: "statement-1", revision: 1, status: "confirmed" });

    await expect(service.createRevision("actor-1", "statement-1", {
      ...draft, sourceVersionId: "source-1", expectedRevision: 1,
      idempotencyKey: "abababab-abab-4bab-8bab-abababababab", disposition: "supplemental"
    })).resolves.toEqual({ statementId: "statement-1", versionId: "version-1", revision: 2, status: "draft", disposition: "supplemental" });

    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({ isolationLevel: "Serializable" }));
    expect(tx.wageStatementVersion.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ statementId: "statement-1", revision: 2, kind: "supplemental", sourceVersionId: "source-1", status: "draft" })
    }));
    expect(tx.wageStatement.update).toHaveBeenCalledWith({ where: { id: "statement-1" }, data: { currentRevision: 2 } });
  });

  it("refuses a later revision unless the predecessor is confirmed", async () => {
    const { service, tx } = setup();
    tx.$queryRaw.mockResolvedValue([{ id: "statement-1" }]);
    tx.wageStatement.findUnique.mockResolvedValue({ id: "statement-1", employmentCompanyId: "company-1", currentRevision: 1 });
    tx.wageStatementVersion.findUnique.mockResolvedValue({ id: "version-1", statementId: "statement-1", revision: 1, status: "submitted" });
    await expect(service.createRevision("actor-1", "statement-1", {
      ...draft, sourceVersionId: "source-2", expectedRevision: 1,
      idempotencyKey: "bcbcbcbc-bcbc-4bcb-8bcb-bcbcbcbcbcbc", disposition: "correction"
    })).rejects.toThrow("只有已确认工资承担单可以创建后续修订");
    expect(tx.wageApprovedSourceVersion.findUnique).not.toHaveBeenCalled();
  });

  it("carries frozen User and BusinessPartyVersion creditors plus both explicit matrices from source into the draft", async () => {
    const { service, tx } = setup();
    const line = {
      ...approvedSource.approvedPersonLines[0],
      costComponents: [{ componentCode: "gross_wage", amountCents: "70000" }, { componentCode: "employer_social_insurance", amountCents: "30000" }],
      creditorBreakdowns: [
        { creditorSubjectType: "employee_user" as const, creditorUserId: "employee-1", creditorCategory: "employee_net_pay", amountCents: "70000" },
        { creditorSubjectType: "business_party" as const, creditorBusinessPartyVersionId: "party-v1", creditorCategory: "employer_social_insurance", amountCents: "30000" }
      ],
      projectCostComponentAllocations: [
        { projectId: "project-1", serviceSnapshotId: "service-1", componentCode: "gross_wage", amountCents: "70000" },
        { projectId: "project-1", serviceSnapshotId: "service-1", componentCode: "employer_social_insurance", amountCents: "30000" }
      ],
      projectCreditorAllocations: [
        { projectId: "project-1", serviceSnapshotId: "service-1", creditorSubjectType: "employee_user" as const, creditorUserId: "employee-1", creditorCategory: "employee_net_pay", amountCents: "70000" },
        { projectId: "project-1", serviceSnapshotId: "service-1", creditorSubjectType: "business_party" as const, creditorBusinessPartyVersionId: "party-v1", creditorCategory: "employer_social_insurance", amountCents: "30000" }
      ]
    };
    const sourceInput = { ...approvedSource, idempotencyKey: "77777777-7777-4777-8777-777777777777", approvedPersonLines: [line] };
    const draftInput = { ...draft, idempotencyKey: "88888888-8888-4888-8888-888888888888", personLines: [line] };
    const frozenPartyVersion = {
      id: "party-v1",
      businessPartyId: "party-1",
      versionNo: 3,
      snapshot: { name: "社保机构", unifiedSocialCreditCode: "91310000SOCIAL0001" }
    };
    tx.businessPartyVersion.findMany.mockResolvedValue([frozenPartyVersion]);
    tx.wageCostComponent.create
      .mockResolvedValueOnce({ id: "cost-gross", componentCode: "gross_wage" })
      .mockResolvedValueOnce({ id: "cost-social", componentCode: "employer_social_insurance" });
    tx.wageCreditorBreakdown.create
      .mockResolvedValueOnce({ id: "creditor-employee", creditorCategory: "employee_net_pay", creditorSubjectType: "employee_user", creditorUserId: "employee-1", creditorBusinessPartyVersionId: null })
      .mockResolvedValueOnce({ id: "creditor-party", creditorCategory: "employer_social_insurance", creditorSubjectType: "business_party", creditorUserId: null, creditorBusinessPartyVersionId: "party-v1" });
    await service.createApprovedSource("actor-1", sourceInput);
    tx.wageApprovedSourceVersion.findUnique.mockResolvedValue({ id: "source-1", employmentCompanyId: "company-1", wageMonth: "2026-08", periodStart: new Date("2026-08-01T00:00:00.000Z"), periodEnd: new Date("2026-08-31T00:00:00.000Z"), evidenceFileId: "file-1", evidenceSha256: "a".repeat(64), sourceSnapshot: { approvedPersonLines: [line] } });
    await service.createDraft("actor-1", draftInput);

    const persistedCreditors = tx.wageCreditorBreakdown.create.mock.calls.map(([call]) => call.data);
    const persistedParty = persistedCreditors.find((creditor) => creditor.creditorSubjectType === "business_party");
    const persistedEmployee = persistedCreditors.find((creditor) => creditor.creditorSubjectType === "employee_user");
    expect(persistedParty).toEqual(expect.objectContaining({
      creditorSubjectType: "business_party", creditorBusinessPartyVersionId: "party-v1",
      creditorNameSnapshot: "社保机构", creditorUnifiedIdentitySnapshot: "91310000SOCIAL0001",
      creditorVersionFingerprint: fingerprint({
        subjectType: "business_party", businessPartyVersionId: "party-v1", businessPartyId: "party-1", versionNo: 3,
        snapshot: frozenPartyVersion.snapshot
      })
    }));
    expect(persistedEmployee).toEqual(expect.objectContaining({
      // User has no version table: identity is the immutable user id plus the
      // name frozen at draft creation, never a later current-profile read.
      creditorVersionFingerprint: fingerprint({ subjectType: "employee_user", userId: "employee-1", nameSnapshot: "张三" })
    }));
    frozenPartyVersion.snapshot.name = "已变更的当前主数据名称";
    expect(persistedParty.creditorVersionFingerprint).toBe(fingerprint({
      subjectType: "business_party", businessPartyVersionId: "party-v1", businessPartyId: "party-1", versionNo: 3,
      snapshot: { name: "社保机构", unifiedSocialCreditCode: "91310000SOCIAL0001" }
    }));
    expect((tx as Record<string, unknown>).businessParty).toBeUndefined();
    expect(tx.wageProjectCostComponentAllocation.createMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.arrayContaining([expect.objectContaining({ amountCents: 70000n }), expect.objectContaining({ amountCents: 30000n })]) }));
    expect(tx.wageProjectCreditorAllocation.createMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.arrayContaining([expect.objectContaining({ amountCents: 70000n }), expect.objectContaining({ amountCents: 30000n })]) }));
  });

  it("rejects a stored confirmation graph that omits a zero-valued Cartesian cell", () => {
    const { service } = setup();
    const person = {
      costComponents: [{ id: "cost-a" }, { id: "cost-b" }],
      creditorBreakdowns: [{ id: "creditor-a" }, { id: "creditor-b" }],
      projectAllocations: [
        {
          id: "allocation-a", amountCents: 100n,
          componentAllocations: [{ costComponentId: "cost-a", amountCents: 100n }, { costComponentId: "cost-b", amountCents: 0n }],
          creditorAllocations: [{ creditorBreakdownId: "creditor-a", amountCents: 100n }, { creditorBreakdownId: "creditor-b", amountCents: 0n }]
        },
        {
          id: "allocation-b", amountCents: 100n,
          componentAllocations: [{ costComponentId: "cost-a", amountCents: 0n }, { costComponentId: "cost-b", amountCents: 100n }],
          creditorAllocations: [{ creditorBreakdownId: "creditor-a", amountCents: 0n }, { creditorBreakdownId: "creditor-b", amountCents: 100n }]
        },
      ]
    };
    const validateStoredMatrices = (candidate: typeof person) => (
      service as unknown as { assertCompleteStoredMatrices(value: typeof person): void }
    ).assertCompleteStoredMatrices(candidate);
    expect(() => validateStoredMatrices(person)).not.toThrow();
    person.projectAllocations[1].creditorAllocations.pop();
    expect(() => validateStoredMatrices(person)).toThrow(ConflictException);
    expect(() => validateStoredMatrices(person)).toThrow("工资版本缺少完整交叉矩阵");
  });

  it("fails closed when the frozen evidence object is deleted or its content hash has drifted", async () => {
    const { service, tx } = setup();
    tx.wageApprovedSourceVersion.findUnique.mockResolvedValue({
      id: "source-1", employmentCompanyId: "company-1", wageMonth: "2026-08",
      periodStart: new Date("2026-08-01T00:00:00.000Z"), periodEnd: new Date("2026-08-31T00:00:00.000Z"),
      evidenceFileId: "file-1", evidenceSha256: "a".repeat(64), sourceSnapshot: { approvedPersonLines: approvedSource.approvedPersonLines }
    });
    tx.fileObject.findUnique.mockResolvedValue({ id: "file-1", storageStatus: "active", contentSha256: "b".repeat(64) });

    await expect(service.createDraft("actor-1", draft)).rejects.toThrow("外部批准工资资料证据已失效或校验值漂移");
    expect(tx.wageStatement.create).not.toHaveBeenCalled();
  });

  it("rejects a source creation caller without wage-statement preparation authority before any write", async () => {
    const { service, tx, roles } = setup();
    roles.resolveActiveRoleScopes.mockResolvedValue(["project_manager"]);

    await expect(service.createApprovedSource("actor-1", approvedSource)).rejects.toBeInstanceOf(ForbiddenException);
    expect(tx.wageApprovedSourceVersion.create).not.toHaveBeenCalled();
  });

  it("issues only canonical role-derived action booleans through the capability read seam", async () => {
    const { service, roles } = setup();
    roles.resolveActiveRoleScopes.mockResolvedValue(["finance_director"]);

    await expect(service.capabilities("actor-1")).resolves.toEqual({
      canPrepare: true,
      canSubmit: true,
      canReturn: true,
      canConfirm: true
    });
  });

  it("keeps the optional ratio algorithm out of the public application service surface", () => {
    const { service } = setup();
    expect(service).not.toHaveProperty("previewRatio");
  });

  it("rejects a draft that changes an externally approved person amount", async () => {
    const { service, tx } = setup();
    tx.wageApprovedSourceVersion.findUnique.mockResolvedValue({
      id: "source-1",
      employmentCompanyId: "company-1",
      wageMonth: "2026-08",
      periodStart: new Date("2026-08-01T00:00:00.000Z"),
      periodEnd: new Date("2026-08-31T00:00:00.000Z"),
      sourceSnapshot: { approvedPersonLines: [{ ...approvedSource.approvedPersonLines[0], approvedAmountCents: "99999" }] }
    });

    await expect(service.createDraft("actor-1", draft)).rejects.toThrow("外部批准工资来源快照不完整");
    expect(tx.wageStatement.create).not.toHaveBeenCalled();
  });

  it("freezes the complete external authority payload and refuses a draft that changes any approved component, creditor, allocation, or employment fact", async () => {
    const { service, tx } = setup();
    tx.wageApprovedSourceVersion.findUnique.mockResolvedValue({
      id: "source-1",
      employmentCompanyId: "company-1",
      wageMonth: "2026-08",
      periodStart: new Date("2026-08-01T00:00:00.000Z"),
      periodEnd: new Date("2026-08-31T00:00:00.000Z"),
      sourceSnapshot: { approvedPersonLines: approvedSource.approvedPersonLines }
    });

    await expect(service.createApprovedSource("actor-1", approvedSource)).resolves.toEqual({ id: "source-1" });
    const persisted = tx.wageApprovedSourceVersion.create.mock.calls[0][0].data.sourceSnapshot;
    expect(persisted.approvedPersonLines[0]).toEqual(expect.objectContaining({
      employmentCompanyId: "company-1",
      employmentPeriodStart: "2026-08-01",
      employmentPeriodEnd: "2026-08-31",
      positionCategory: "project_manager",
      costComponents: approvedSource.approvedPersonLines[0].costComponents,
      creditorBreakdowns: approvedSource.approvedPersonLines[0].creditorBreakdowns,
      projectAllocations: approvedSource.approvedPersonLines[0].projectAllocations,
      projectCostComponentAllocations: approvedSource.approvedPersonLines[0].projectCostComponentAllocations,
      projectCreditorAllocations: approvedSource.approvedPersonLines[0].projectCreditorAllocations
    }));
    await expect(service.createDraft("actor-1", {
      ...draft,
      personLines: [{
        ...draft.personLines[0],
        costComponents: [{ componentCode: "project_bonus", amountCents: "100000" }],
        projectCostComponentAllocations: [{ projectId: "project-1", serviceSnapshotId: "service-1", componentCode: "project_bonus", amountCents: "100000" }]
      }]
    })).rejects.toThrow("工资承担单人员事实必须与外部批准来源一致");
    expect(tx.wageStatement.create).not.toHaveBeenCalled();
  });

  it("rejects a source whose employee net-pay creditor is not the same employee or whose employment facts contradict its company or month", async () => {
    const { service, tx } = setup();
    await expect(service.createApprovedSource("actor-1", {
      ...approvedSource,
      approvedPersonLines: [{ ...approvedSource.approvedPersonLines[0], creditorBreakdowns: [{ creditorSubjectType: "employee_user" as const, creditorUserId: "other-user", creditorCategory: "employee_net_pay", amountCents: "100000" }] }]
    })).rejects.toThrow("员工净付债权人必须绑定该员工");
    await expect(service.createApprovedSource("actor-1", {
      ...approvedSource,
      approvedPersonLines: [{ ...approvedSource.approvedPersonLines[0], employmentCompanyId: "company-2" }]
    })).rejects.toThrow("劳动关系公司必须与工资承担公司一致");
    expect(tx.wageApprovedSourceVersion.create).not.toHaveBeenCalled();
  });

  it("replays an approved source only for the same UUIDv4 payload and rejects a changed payload under that key", async () => {
    const { service, tx } = setup();
    await expect(service.createApprovedSource("actor-1", approvedSource)).resolves.toEqual({ id: "source-1" });
    const firstFingerprint = tx.wageApprovedSourceCommandReceipt.create.mock.calls[0][0].data.fingerprint;
    tx.wageApprovedSourceCommandReceipt.findUnique.mockResolvedValue({ fingerprint: firstFingerprint, resultSnapshot: { id: "source-1" } });
    await expect(service.createApprovedSource("actor-1", approvedSource)).resolves.toEqual({ id: "source-1" });
    expect(tx.wageApprovedSourceVersion.create).toHaveBeenCalledTimes(1);
    await expect(service.createApprovedSource("actor-1", { ...approvedSource, externalReference: "PAYROLL-CHANGED" })).rejects.toThrow("同一幂等键不能用于不同外部工资来源命令");
    await expect(service.createApprovedSource("actor-1", { ...approvedSource, idempotencyKey: "not-a-uuid" })).rejects.toThrow("幂等键必须是 UUIDv4");
    await expect(service.createApprovedSource("actor-1", { ...approvedSource, expectedRevision: 1 })).rejects.toThrow("新建外部工资来源的 expectedRevision 必须为 0");
  });

  it("rejects a draft without a UUIDv4 idempotency key or revision zero before any write", async () => {
    const { service, tx } = setup();

    await expect(service.createDraft("actor-1", { ...draft, idempotencyKey: "not-a-uuid" })).rejects.toThrow("幂等键必须是 UUIDv4");
    await expect(service.createDraft("actor-1", { ...draft, expectedRevision: 1 })).rejects.toThrow("新建工资承担单的 expectedRevision 必须为 0");
    expect(tx.wageStatement.create).not.toHaveBeenCalled();
  });

  it("submits exactly the current draft revision and records a replayable command receipt", async () => {
    const { service, tx, prisma } = setup();
    tx.$queryRaw = jest.fn().mockResolvedValue([{ id: "statement-1" }]);
    tx.wageStatement.findUnique = jest.fn().mockResolvedValue({ id: "statement-1", currentRevision: 1 });
    tx.wageStatementVersion.findUnique = jest.fn().mockResolvedValue({ id: "version-1", statementId: "statement-1", revision: 1, status: "draft" });
    tx.wageStatementVersion.update = jest.fn().mockResolvedValue({ id: "version-1", revision: 1, status: "submitted" });

    await expect(service.submit("actor-1", "statement-1", { idempotencyKey: "22222222-2222-4222-8222-222222222222", expectedRevision: 1 }))
      .resolves.toEqual({ statementId: "statement-1", versionId: "version-1", revision: 1, status: "submitted" });

    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({ isolationLevel: "Serializable" }));
    expect(tx.wageStatementVersion.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "submitted", submittedByUserId: "actor-1" }) }));
    expect(tx.wageCommandReceipt.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: "wage_statement.submit", aggregateId: "statement-1", expectedRevision: 1 }) });
  });

  it("returns a submitted version by superseding it and creating the only allowed next draft revision", async () => {
    const { service, tx, roles } = setup();
    roles.resolveActiveRoleScopes.mockResolvedValue(["finance_director"]);
    tx.$queryRaw = jest.fn().mockResolvedValue([{ id: "statement-1" }]);
    tx.wageStatement.findUnique = jest.fn().mockResolvedValue({ id: "statement-1", currentRevision: 1 });
    const submitted = {
      id: "version-1", statementId: "statement-1", revision: 1, kind: "base", status: "submitted", sourceVersionId: "source-1", sourceSnapshot: { source: true },
      personLines: [{ employeeId: "employee-1", employmentSnapshotId: "employment-1", employeeSnapshot: {}, employmentSnapshot: {}, periodSnapshot: {}, positionCategorySnapshot: {}, approvedAmountCents: 100000n,
        costComponents: [{ id: "cost-1", componentCode: "gross_wage", amountCents: 100000n, sourceSnapshot: {} }],
        creditorBreakdowns: [{ id: "creditor-1", creditorSubjectId: null, creditorSubjectType: "employee_user", creditorUserId: "employee-1", creditorBusinessPartyVersionId: null, creditorSubjectIdentityKey: "employee_user:employee-1", creditorNameSnapshot: "张三", creditorUnifiedIdentitySnapshot: null, creditorVersionFingerprint: "f".repeat(64), creditorCategory: "employee_net_pay", amountCents: 100000n, sourceSnapshot: {} }],
        projectAllocations: [{ id: "allocation-1", projectId: "project-1", serviceSnapshotId: "service-1", serviceBasisBindingId: "basis-1", serviceSnapshot: {}, amountCents: 100000n, componentAllocations: [{ costComponentId: "cost-1", amountCents: 100000n }], creditorAllocations: [{ creditorBreakdownId: "creditor-1", amountCents: 100000n }] }]
      }]
    };
    tx.wageStatementVersion.findUnique = jest.fn().mockResolvedValue(submitted);
    tx.wageStatementVersion.update = jest.fn().mockResolvedValue({ id: "version-1" });
    tx.wageStatementVersion.create = jest.fn().mockResolvedValue({ id: "version-2" });
    tx.wageStatement.update = jest.fn().mockResolvedValue({ id: "statement-1", currentRevision: 2 });

    await expect(service.returnForReview("director-1", "statement-1", { idempotencyKey: "33333333-3333-4333-8333-333333333333", expectedRevision: 1, reason: "请补充说明" }))
      .resolves.toEqual({ statementId: "statement-1", versionId: "version-2", revision: 2, status: "draft" });

    expect(tx.wageStatementVersion.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "superseded", reviewDisposition: "review_returned", reviewReturnReason: "请补充说明" }) }));
    expect(tx.wageStatementVersion.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ statementId: "statement-1", revision: 2, kind: "base", status: "draft" }) }));
  });

  it("refuses confirmation by a creator, editor, or submitter and permits only an independent finance director", async () => {
    const { service, tx, roles } = setup();
    roles.resolveActiveRoleScopes.mockResolvedValue(["finance_director"]);
    tx.$queryRaw = jest.fn().mockResolvedValue([{ id: "statement-1" }]);
    tx.wageStatement.findUnique = jest.fn().mockResolvedValue({ id: "statement-1", currentRevision: 1 });
    tx.wageStatementVersion.findUnique = jest.fn().mockResolvedValue({ id: "version-1", statementId: "statement-1", revision: 1, status: "submitted", createdByUserId: "author-1", lastEditedByUserId: "editor-1", submittedByUserId: "submitter-1" });
    tx.wageStatementVersion.update = jest.fn().mockResolvedValue({ id: "version-1" });

    await expect(service.confirm("submitter-1", "statement-1", { idempotencyKey: "44444444-4444-4444-8444-444444444444", expectedRevision: 1 })).rejects.toThrow("职责分离冲突");
    await expect(service.confirm("director-1", "statement-1", { idempotencyKey: "55555555-5555-4555-8555-555555555555", expectedRevision: 1 }))
      .resolves.toEqual({ statementId: "statement-1", versionId: "version-1", revision: 1, status: "confirmed" });
  });

  it("accepts a controlled correction version through the existing confirmation seam without exposing a public adjustment command", async () => {
    const { service, tx, roles } = setup();
    roles.resolveActiveRoleScopes.mockResolvedValue(["finance_director"]);
    tx.$queryRaw.mockResolvedValue([{ id: "statement-1" }]);
    tx.wageStatement.findUnique.mockResolvedValue({ id: "statement-1", currentRevision: 1 });
    tx.wageStatementVersion.findUnique.mockResolvedValue({
      id: "version-1", statementId: "statement-1", revision: 1, kind: "correction", status: "submitted",
      createdByUserId: "author-1", lastEditedByUserId: "editor-1", submittedByUserId: "submitter-1"
    });
    await expect(service.confirm("director-1", "statement-1", { idempotencyKey: "99999999-9999-4999-8999-999999999999", expectedRevision: 1 }))
      .resolves.toEqual({ statementId: "statement-1", versionId: "version-1", revision: 1, status: "confirmed" });
    expect((service as unknown as Record<string, unknown>).createCorrection).toBeUndefined();
    expect((service as unknown as Record<string, unknown>).reverse).toBeUndefined();
    expect((service as unknown as Record<string, unknown>).settlePayable).toBeUndefined();
  });

  it("confirms a later revision with an identical frozen matrix but publishes no zero-delta payable ref or operating impact", async () => {
    const { service, tx, roles, operatingLedger } = setup();
    jest.restoreAllMocks();
    roles.resolveActiveRoleScopes.mockResolvedValue(["finance_director"]);
    tx.$queryRaw.mockResolvedValue([{ id: "statement-1" }]);
    tx.wageStatement.findUnique.mockResolvedValue({ id: "statement-1", currentRevision: 2, employmentCompanyId: "company-1" });
    const creditor = {
      id: "creditor-2", creditorSubjectId: null, creditorSubjectType: "employee_user", creditorUserId: "employee-1",
      creditorBusinessPartyVersionId: null, creditorSubjectIdentityKey: "employee_user:employee-1",
      creditorNameSnapshot: "张三", creditorUnifiedIdentitySnapshot: null, creditorVersionFingerprint: "f".repeat(64),
      creditorCategory: "employee_net_pay", amountCents: 1_000n, sourceSnapshot: {}
    };
    const subsequent = {
      id: "version-2", statementId: "statement-1", revision: 2, kind: "supplemental", status: "submitted",
      createdByUserId: "author-1", lastEditedByUserId: "editor-1", submittedByUserId: "submitter-1",
      sourceVersion: { periodEnd: new Date("2026-08-31T00:00:00.000Z") },
      personLines: [{
        id: "person-2", employeeId: "employee-1", employmentSnapshotId: "employment-1", employeeSnapshot: {}, employmentSnapshot: {}, periodSnapshot: {}, positionCategorySnapshot: {}, approvedAmountCents: 1_000n,
        costComponents: [{ id: "cost-2", componentCode: "gross_wage", amountCents: 1_000n, sourceSnapshot: {}, projectAllocations: [] }],
        creditorBreakdowns: [{ ...creditor, projectAllocations: [] }],
        projectAllocations: [{
          id: "allocation-2", projectId: "project-1", serviceSnapshotId: "service-1", serviceBasisBindingId: "basis-1", serviceSnapshot: {}, amountCents: 1_000n,
          componentAllocations: [{ id: "cost-cell-2", projectAllocationId: "allocation-2", costComponentId: "cost-2", amountCents: 1_000n, costComponent: { componentCode: "gross_wage" } }],
          creditorAllocations: [{ id: "creditor-cell-2", projectAllocationId: "allocation-2", creditorBreakdownId: "creditor-2", amountCents: 1_000n, creditorBreakdown: creditor }]
        }]
      }]
    };
    const prior = structuredClone(subsequent);
    prior.id = "version-1";
    prior.revision = 1;
    prior.kind = "base";
    tx.wageStatementVersion.findUnique
      .mockResolvedValueOnce({ id: "version-2", statementId: "statement-1", revision: 2, kind: "supplemental", status: "submitted", createdByUserId: "author-1", lastEditedByUserId: "editor-1", submittedByUserId: "submitter-1" })
      .mockResolvedValueOnce(subsequent);
    tx.wageStatementVersion.findFirst = jest.fn().mockResolvedValue(prior);
    tx.wagePayableRef.findMany.mockResolvedValue([]);

    await expect(service.confirm("director-1", "statement-1", { idempotencyKey: "12121212-1212-4212-8212-121212121212", expectedRevision: 2 }))
      .resolves.toEqual({ statementId: "statement-1", versionId: "version-2", revision: 2, status: "confirmed" });

    expect(tx.wagePayableRef.create).not.toHaveBeenCalled();
    expect(operatingLedger.appendConfirmedSourceInTransaction).not.toHaveBeenCalled();
    expect(tx.wageStatementVersion.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "version-2" }, data: expect.objectContaining({ status: "confirmed", confirmedByUserId: "director-1" })
    }));
    expect(tx.wageCommandReceipt.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: "wage_statement.confirm", aggregateId: "statement-1", expectedRevision: 2 })
    }));
    expect(tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: "wage_statement.confirm", businessId: "version-2" })
    }));
  });

  it("confirms a controlled correction with one direct-base decrease ref and matching negative operating impacts", async () => {
    const { service, tx, roles, operatingLedger } = setup();
    jest.restoreAllMocks();
    roles.resolveActiveRoleScopes.mockResolvedValue(["finance_director"]);
    tx.$queryRaw.mockResolvedValue([{ id: "statement-1" }]);
    tx.wageStatement.findUnique.mockResolvedValue({ id: "statement-1", currentRevision: 2, employmentCompanyId: "company-1" });
    const creditor = {
      id: "creditor-2", creditorSubjectId: null, creditorSubjectType: "employee_user", creditorUserId: "employee-1",
      creditorBusinessPartyVersionId: null, creditorSubjectIdentityKey: "employee_user:employee-1",
      creditorNameSnapshot: "张三", creditorUnifiedIdentitySnapshot: null, creditorVersionFingerprint: "f".repeat(64),
      creditorCategory: "employee_net_pay", amountCents: 1_000n, sourceSnapshot: {}
    };
    const correction = {
      id: "version-2", statementId: "statement-1", revision: 2, kind: "correction", status: "submitted",
      createdByUserId: "author-1", lastEditedByUserId: "editor-1", submittedByUserId: "submitter-1",
      sourceVersion: { periodEnd: new Date("2026-08-31T00:00:00.000Z") },
      personLines: [{
        id: "person-2", employeeId: "employee-1", employmentSnapshotId: "employment-1", employeeSnapshot: {}, employmentSnapshot: {}, periodSnapshot: {}, positionCategorySnapshot: {}, approvedAmountCents: 1_000n,
        costComponents: [{ id: "cost-2", componentCode: "gross_wage", amountCents: 1_000n, sourceSnapshot: {}, projectAllocations: [] }],
        creditorBreakdowns: [{ ...creditor, projectAllocations: [] }],
        projectAllocations: [{
          id: "allocation-2", projectId: "project-1", serviceSnapshotId: "service-1", serviceBasisBindingId: "basis-1", serviceSnapshot: {}, amountCents: 1_000n,
          componentAllocations: [{ id: "cost-cell-2", projectAllocationId: "allocation-2", costComponentId: "cost-2", amountCents: 1_000n, costComponent: { componentCode: "gross_wage" } }],
          creditorAllocations: [{ id: "creditor-cell-2", projectAllocationId: "allocation-2", creditorBreakdownId: "creditor-2", amountCents: 1_000n, creditorBreakdown: creditor }]
        }]
      }]
    };
    const prior = structuredClone(correction);
    prior.id = "version-1";
    prior.revision = 1;
    prior.kind = "base";
    prior.personLines[0].approvedAmountCents = 2_000n;
    prior.personLines[0].costComponents[0].amountCents = 2_000n;
    prior.personLines[0].creditorBreakdowns[0].amountCents = 2_000n;
    prior.personLines[0].projectAllocations[0].amountCents = 2_000n;
    prior.personLines[0].projectAllocations[0].componentAllocations[0].amountCents = 2_000n;
    prior.personLines[0].projectAllocations[0].creditorAllocations[0].amountCents = 2_000n;
    tx.wageStatementVersion.findUnique
      .mockResolvedValueOnce({ id: "version-2", statementId: "statement-1", revision: 2, kind: "correction", status: "submitted", createdByUserId: "author-1", lastEditedByUserId: "editor-1", submittedByUserId: "submitter-1" })
      .mockResolvedValueOnce(correction);
    tx.wageStatementVersion.findFirst = jest.fn().mockResolvedValue(prior);
    tx.wagePayableRef = {
      findMany: jest.fn().mockResolvedValue([{
        id: "payable-base-1", amountCents: 2_000n, debtorCompanyId: "company-1", costBearingCompanyId: "company-1", projectId: "project-1",
        personLine: { employeeId: "employee-1", employmentSnapshotId: "employment-1" },
        creditorBreakdown: {
          creditorSubjectType: "employee_user", creditorSubjectIdentityKey: "employee_user:employee-1", creditorCategory: "employee_net_pay",
          creditorNameSnapshot: "张三", creditorUnifiedIdentitySnapshot: null, creditorVersionFingerprint: "f".repeat(64)
        },
        adjustments: []
      }]),
      create: jest.fn().mockResolvedValue({ id: "payable-adjustment-1" })
    };
    tx.project.findUnique = jest.fn().mockResolvedValue({ operatingLedgerEffectiveDate: new Date("2026-08-01T00:00:00.000Z") });
    tx.projectParticipatingCompany = { findFirst: jest.fn().mockResolvedValue({ companyEntityId: "company-1", companyEntityVersionId: "company-version-1" }) };
    tx.projectAffiliateAssignment = { findFirst: jest.fn().mockResolvedValue({ id: "affiliate-assignment-1", businessPartyVersionId: "affiliate-version-1", affiliateNameSnapshot: "施工企业甲", affiliateCreditCodeSnapshot: null }) };

    await expect(service.confirm("director-1", "statement-1", { idempotencyKey: "77777777-7777-4777-8777-777777777777", expectedRevision: 2 }))
      .resolves.toEqual({ statementId: "statement-1", versionId: "version-2", revision: 2, status: "confirmed" });

    expect(tx.wagePayableRef.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ direction: "decrease", adjustsPayableRefId: "payable-base-1", settlementRecheckRequired: true })
    }));
    expect(operatingLedger.appendConfirmedSourceInTransaction).toHaveBeenCalledWith(tx, expect.objectContaining({
      impacts: expect.arrayContaining([
        expect.objectContaining({ sourceImpactKey: "cost:cost-cell-2:decrease", impactKind: "confirmed_cost", direction: "decrease" }),
        expect.objectContaining({ sourceImpactKey: expect.stringMatching(/^payable:creditor-cell-2:/u), impactKind: "payable_decrease", direction: "decrease" })
      ])
    }), "director-1");
  });

  it("keeps a positive correction tied to its original ref without asserting a #220 settlement recheck", async () => {
    const { service, tx } = setup();
    const cell = {
      allocation: { id: "allocation-1", projectId: "project-1", serviceSnapshotId: "service-1" },
      person: { id: "person-1", employeeId: "employee-1", employmentSnapshotId: "employment-1" },
      creditor: {
        id: "creditor-1", creditorSubjectType: "employee_user", creditorUserId: "employee-1",
        creditorBusinessPartyVersionId: null, creditorSubjectIdentityKey: "employee_user:employee-1",
        creditorNameSnapshot: "张三", creditorUnifiedIdentitySnapshot: null,
        creditorVersionFingerprint: "f".repeat(64), creditorCategory: "employee_net_pay"
      }
    };

    await (service as unknown as { createWagePayableRef: (...args: unknown[]) => Promise<unknown> }).createWagePayableRef(
      tx, "version-2", "company-1", cell, 500n, "increase", "payable-base-1"
    );

    expect(tx.wagePayableRef.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        direction: "increase", adjustsPayableRefId: "payable-base-1", settlementRecheckRequired: false
      })
    }));
  });

  it("recovers an approved-source receipt collision by replaying only the winning same-payload result", async () => {
    const { service, tx, prisma } = setup();
    await service.createApprovedSource("actor-1", approvedSource);
    const first = tx.wageApprovedSourceCommandReceipt.create.mock.calls[0][0].data;
    tx.wageApprovedSourceCommandReceipt.create.mockRejectedValueOnce({ code: "P2002" });
    prisma.wageApprovedSourceCommandReceipt.findUnique.mockResolvedValue({ fingerprint: first.fingerprint, resultSnapshot: first.resultSnapshot });

    await expect(service.createApprovedSource("actor-1", approvedSource)).resolves.toEqual({ id: "source-1" });
    expect(prisma.wageApprovedSourceCommandReceipt.findUnique).toHaveBeenCalledWith({ where: { idempotencyKey: approvedSource.idempotencyKey } });

    prisma.wageApprovedSourceCommandReceipt.findUnique.mockResolvedValue({ fingerprint: "changed", resultSnapshot: first.resultSnapshot });
    tx.wageApprovedSourceCommandReceipt.create.mockRejectedValueOnce({ code: "P2002" });
    await expect(service.createApprovedSource("actor-1", approvedSource)).rejects.toThrow("同一幂等键不能用于不同外部工资来源命令");
  });

  it("replays draft, submit, return, and confirm receipt races without treating their P2002 as business conflicts", async () => {
    const { service, tx, prisma, roles } = setup();
    const replayStatementReceipt = async (invoke: () => Promise<unknown>) => {
      await invoke();
      const first = tx.wageCommandReceipt.create.mock.calls.at(-1)[0].data;
      tx.wageCommandReceipt.create.mockRejectedValueOnce({ code: "P2002" });
      prisma.wageCommandReceipt.findUnique.mockResolvedValue({ fingerprint: first.fingerprint, resultSnapshot: first.resultSnapshot });
      await expect(invoke()).resolves.toEqual(first.resultSnapshot);
    };

    tx.wageApprovedSourceVersion.findUnique.mockResolvedValue({
      id: "source-1", employmentCompanyId: "company-1", wageMonth: "2026-08",
      periodStart: new Date("2026-08-01T00:00:00.000Z"), periodEnd: new Date("2026-08-31T00:00:00.000Z"),
      evidenceFileId: "file-1", evidenceSha256: "a".repeat(64), sourceSnapshot: { approvedPersonLines: approvedSource.approvedPersonLines }
    });
    await replayStatementReceipt(() => service.createDraft("actor-1", draft));

    tx.$queryRaw.mockResolvedValue([{ id: "statement-1" }]);
    tx.wageStatement.findUnique.mockResolvedValue({ id: "statement-1", currentRevision: 1 });
    tx.wageStatementVersion.findUnique.mockResolvedValue({ id: "version-1", statementId: "statement-1", revision: 1, status: "draft" });
    await replayStatementReceipt(() => service.submit("actor-1", "statement-1", { idempotencyKey: "22222222-2222-4222-8222-222222222222", expectedRevision: 1 }));

    roles.resolveActiveRoleScopes.mockResolvedValue(["finance_director"]);
    const submitted = {
      id: "version-1", statementId: "statement-1", revision: 1, kind: "base", status: "submitted", sourceVersionId: "source-1", sourceSnapshot: {},
      personLines: [{ employeeId: "employee-1", employmentSnapshotId: "employment-1", employeeSnapshot: {}, employmentSnapshot: {}, periodSnapshot: {}, positionCategorySnapshot: {}, approvedAmountCents: 100000n,
        costComponents: [], creditorBreakdowns: [], projectAllocations: [] }]
    };
    tx.wageStatementVersion.findUnique.mockResolvedValue(submitted);
    tx.wageStatementVersion.create.mockResolvedValue({ id: "version-2" });
    await replayStatementReceipt(() => service.returnForReview("director-1", "statement-1", { idempotencyKey: "33333333-3333-4333-8333-333333333333", expectedRevision: 1, reason: "请补充" }));

    tx.wageStatementVersion.findUnique.mockResolvedValue({ id: "version-1", statementId: "statement-1", revision: 1, status: "submitted", createdByUserId: "author-1", lastEditedByUserId: "editor-1", submittedByUserId: "submitter-1" });
    await replayStatementReceipt(() => service.confirm("director-1", "statement-1", { idempotencyKey: "55555555-5555-4555-8555-555555555555", expectedRevision: 1 }));
  });

  it("retries only bounded serializable P2034 conflicts and preserves a real business failure", async () => {
    const { service, tx, prisma } = setup();
    tx.$queryRaw.mockResolvedValue([{ id: "statement-1" }]);
    tx.wageStatement.findUnique.mockResolvedValue({ id: "statement-1", currentRevision: 1 });
    tx.wageStatementVersion.findUnique.mockResolvedValue({ id: "version-1", statementId: "statement-1", revision: 1, status: "draft" });
    prisma.$transaction.mockImplementationOnce(() => Promise.reject({ code: "P2034" }));

    await expect(service.submit("actor-1", "statement-1", { idempotencyKey: "22222222-2222-4222-8222-222222222222", expectedRevision: 1 }))
      .resolves.toEqual({ statementId: "statement-1", versionId: "version-1", revision: 1, status: "submitted" });
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);

    tx.wageStatementVersion.findUnique.mockResolvedValue({ id: "version-1", statementId: "statement-1", revision: 1, status: "submitted" });
    await expect(service.submit("actor-1", "statement-1", { idempotencyKey: "66666666-6666-4666-8666-666666666666", expectedRevision: 1 }))
      .rejects.toThrow("只有草稿工资承担单可以提交");
  });
});

function fingerprint(value: unknown) {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
