import { createHash } from "node:crypto";
import { Test } from "@nestjs/testing";
import { PayableRegistryController } from "./payable-registry.controller";
import { PayableRegistryService } from "./payable-registry.service";

describe("PayableRegistryService", () => {
  it.each([[0n, "1000"], [300n, "700"]])("reads a historical company debt with %s cents repaid", async (received, remaining) => {
    const prisma = {
      interEntityRelationshipEntry: { findMany: jest.fn().mockResolvedValue([{
        id: "historical-relationship", amountCents: 1000n, adjustments: []
      }]) },
      companyTransfer: { findMany: jest.fn().mockResolvedValue([]) },
      companyTransferEvent: { findMany: jest.fn().mockResolvedValue([]) },
      $queryRaw: jest.fn().mockResolvedValue([{ delta: received }])
    };
    const service = new PayableRegistryService(
      prisma as never, { resolveActiveRoleScopes: async () => ["finance_staff"] } as never, { record: jest.fn() } as never
    );

    await expect(service.listInterEntityRelationships("finance-user")).resolves.toEqual([
      expect.objectContaining({ relationshipEntryId: "historical-relationship", remainingAmountCents: remaining, status: "open" })
    ]);
  });

  it("retains an exact historical allocation replay through HTTP and refuses fresh writes", async () => {
    const historicalUuid = "00000000-0000-4000-8000-000000000460";
    const futureUuid = "00000000-0000-4000-8000-000000000461";
    const input = {
      selectionRef: "stored-opaque-reference", selectionExpiresAt: "2026-08-01T00:00:00Z",
      amountCents: "10000", expectedCaseRevision: 3
    };
    const snapshot = { settlementCaseId: "historical-case", status: "draft", revision: 4, allocatedAmountCents: "10000" };
    const payloadFingerprint = createHash("sha256").update(JSON.stringify({
      action: "payable_settlement.allocation.create", actorUserId: "finance-user",
      amountCents: "10000", expectedCaseRevision: "3", payableRef: "payable-history",
      selectionExpiresAt: input.selectionExpiresAt, selectionRef: input.selectionRef
    })).digest("hex");
    const tx = {
      user: { findUnique: jest.fn().mockResolvedValue({ isActive: true }) },
      userPosition: { findMany: jest.fn().mockResolvedValue([{ positionId: "finance-position" }]) },
      position: { findMany: jest.fn().mockResolvedValue([{ id: "finance-position", key: "finance_staff" }]) },
      payableSettlementCommandReceipt: {
        findUnique: jest.fn(async ({ where }: { where: { idempotencyKey: string } }) =>
          where.idempotencyKey === historicalUuid ? { payloadFingerprint, responseSnapshot: snapshot } : null),
        create: jest.fn()
      },
      wagePayableRef: { findUnique: jest.fn().mockResolvedValue(null) },
      payableSettlementAllocation: { create: jest.fn() },
      $queryRaw: jest.fn().mockResolvedValue([])
    };
    const prisma = { $transaction: async (run: (client: typeof tx) => Promise<unknown>) => run(tx) };
    const service = new PayableRegistryService(
      prisma as never, { resolveActiveRoleScopes: async () => ["finance_staff"] } as never, { record: jest.fn() } as never
    );
    const module = await Test.createTestingModule({
      controllers: [PayableRegistryController],
      providers: [{ provide: PayableRegistryService, useValue: service }]
    }).compile();
    const app = module.createNestApplication({ logger: false });
    app.use((request: { user?: { id: string } }, _response: unknown, next: () => void) => {
      request.user = { id: "finance-user" };
      next();
    });
    try {
      await app.listen(0, "127.0.0.1");
      const path = `${await app.getUrl()}/payable-settlements/wage-payable-cases/payable-history/allocations`;
      const post = (idempotencyKey: string, amountCents = input.amountCents) => fetch(path, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...input, idempotencyKey, amountCents })
      });

      const replay = await post(historicalUuid);
      expect(replay.status).toBe(201);
      expect(await replay.json()).toEqual(snapshot);
      expect((await post(historicalUuid, "9999")).status).toBe(409);
      expect((await post(futureUuid)).status).toBe(410);
      expect(tx.wagePayableRef.findUnique).not.toHaveBeenCalled();
      expect(tx.payableSettlementCommandReceipt.create).not.toHaveBeenCalled();
      expect(tx.payableSettlementAllocation.create).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it.each([
    ["submit", "finance_staff", "submitted"],
    ["confirm", "finance_director", "confirmed"],
    ["returnForReview", "finance_director", "review_returned"]
  ] as const)("only replays an existing authorized %s receipt", async (method, role, status) => {
    const historyKey = "00000000-0000-4000-8000-000000000462";
    const freshKey = "00000000-0000-4000-8000-000000000463";
    const input = { settlementCaseId: "historical-case", expectedRevision: 3, idempotencyKey: historyKey };
    const snapshot = { settlementCaseId: input.settlementCaseId, status, revision: 4 };
    const payloadFingerprint = createHash("sha256").update(JSON.stringify({
      action: `payable_settlement.case.${method === "returnForReview" ? "return" : method}`,
      actorUserId: "finance-user", expectedRevision: "3", settlementCaseId: input.settlementCaseId
    })).digest("hex");
    const tx = {
      user: { findUnique: jest.fn().mockResolvedValue({ isActive: true }) },
      userPosition: { findMany: jest.fn().mockResolvedValue([{ positionId: "finance-position" }]) },
      position: { findMany: jest.fn().mockResolvedValue([{ id: "finance-position", key: role }]) },
      payableSettlementCase: { findUnique: jest.fn().mockResolvedValue({ id: input.settlementCaseId }), update: jest.fn(), create: jest.fn() },
      payableSettlementAllocation: { create: jest.fn() },
      payableSettlementCommandReceipt: {
        findUnique: jest.fn(async ({ where }: { where: { idempotencyKey: string } }) =>
          where.idempotencyKey === historyKey ? { payloadFingerprint, responseSnapshot: snapshot } : null),
        create: jest.fn()
      },
      $queryRaw: jest.fn().mockResolvedValue([])
    };
    const prisma = { $transaction: async (run: (client: typeof tx) => Promise<unknown>) => run(tx) };
    const audit = { record: jest.fn() };
    const service = new PayableRegistryService(prisma as never, { resolveActiveRoleScopes: async () => [role] } as never, audit as never);

    await expect(service[method]("finance-user", input)).resolves.toEqual(snapshot);
    expect(tx.payableSettlementCase.findUnique).not.toHaveBeenCalled();
    await expect(service[method]("finance-user", { ...input, expectedRevision: 4 })).rejects.toMatchObject({ status: 409 });
    await expect(service[method]("finance-user", { ...input, idempotencyKey: freshKey })).rejects.toMatchObject({ status: 410 });
    expect(tx.payableSettlementCase.update).not.toHaveBeenCalled();
    expect(tx.payableSettlementCase.create).not.toHaveBeenCalled();
    expect(tx.payableSettlementAllocation.create).not.toHaveBeenCalled();
    expect(tx.payableSettlementCommandReceipt.create).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();

    tx.user.findUnique.mockResolvedValue({ isActive: false });
    await expect(service[method]("finance-user", input)).rejects.toMatchObject({ status: 403 });
  });

  it.each([["finance_staff", false], ["finance_director", true]] as const)(
    "keeps historical reads and existing relationship returns separate from wage writes for %s",
    async (role, returnRelationship) => {
      const service = new PayableRegistryService({} as never, { resolveActiveRoleScopes: async () => [role] } as never, {} as never);
      await expect(service.getCapabilities("finance-user")).resolves.toEqual({
        read: true, allocate: false, submit: false, confirm: false, return: false, returnRelationship
      });
    }
  );

  it("lists bounded confirmed business-party wage cases as safe workbench options", async () => {
    const businessPayable = {
      id: "payable-1",
      confirmedVersionId: "version-1",
      projectAllocationId: "project-allocation-1",
      creditorBreakdownId: "creditor-1",
      debtorCompanyId: "company-1",
      projectId: "project-1",
      amountCents: 12_000n,
      direction: "increase",
      adjustsPayableRefId: null,
      settlementRecheckRequired: false,
      debtorCompanySnapshot: { companyId: "company-1" },
      projectSnapshot: { projectId: "project-1" },
      creditorSnapshot: {
        subjectType: "business_party",
        identityKey: "business_party:party-version-1",
        name: "工资代发机构"
      },
      confirmedVersion: { status: "confirmed", revision: 3 },
      creditorBreakdown: {
        creditorSubjectType: "business_party",
        creditorSubjectIdentityKey: "business_party:party-version-1",
        creditorNameSnapshot: "工资代发机构"
      },
      adjustments: []
    };
    const employeePayable = {
      ...businessPayable,
      id: "payable-person",
      creditorSnapshot: {
        subjectType: "employee_user",
        identityKey: "employee_user:user-1",
        name: "不应暴露的人员"
      },
      creditorBreakdown: {
        creditorSubjectType: "employee_user",
        creditorSubjectIdentityKey: "employee_user:user-1",
        creditorNameSnapshot: "不应暴露的人员"
      }
    };
    const prisma = {
      $queryRaw: jest.fn().mockResolvedValue([
        {
          payableRef: "payable-1",
          confirmedAmountCents: 2_000n,
          activeAmountCents: 2_000n
        },
        {
          payableRef: "payable-person",
          confirmedAmountCents: 2_000n,
          activeAmountCents: 2_000n
        }
      ]),
      wagePayableRef: { findMany: jest.fn().mockResolvedValue([businessPayable, employeePayable]) },
      payableSettlementAllocation: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { amountCents: 2_000n } })
      },
      payableSettlementCase: {
        findMany: jest.fn().mockResolvedValue([{ revision: 3 }])
      },
      companyEntity: { findUnique: jest.fn().mockResolvedValue({ name: "甲公司" }) },
      project: { findUnique: jest.fn().mockResolvedValue({ code: "XM-01", name: "一号项目" }) }
    };
    const service = new PayableRegistryService(
      prisma as never,
      { resolveActiveRoleScopes: jest.fn().mockResolvedValue(["finance_staff"]) } as never,
      { record: jest.fn() } as never
    );

    const result = await service.listWagePayableCases("finance-user");

    expect(result).toEqual([
      expect.objectContaining({
        payableRef: "payable-1",
        caseRevision: 3,
        displayLabel: "XM-01 · 一号项目 · 工资代发机构",
        debtorCompanyLabel: "甲公司",
        creditorLabel: "工资代发机构",
        status: "allocatable",
        statusLabel: "历史余额",
        remainingAmountCents: "10000"
      }),
      expect.objectContaining({
        payableRef: "payable-person",
        caseRevision: 3,
        displayLabel: "XM-01 · 一号项目 · \u5458\u5de5\u51c0\u4ed8",
        creditorLabel: "员工净付",
        status: "allocatable",
        remainingAmountCents: "10000"
      })
    ]);
    expect(JSON.stringify(result)).not.toContain("不应暴露的人员");
    expect(prisma.wagePayableRef.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 100 }));
  });

  it("derives and exposes the actual over-settled reconciliation state instead of trusting the upstream hint", async () => {
    const payable = {
      id: "payable-over-settled",
      confirmedVersionId: "version-1",
      projectAllocationId: "project-allocation-1",
      creditorBreakdownId: "creditor-1",
      debtorCompanyId: "company-1",
      projectId: "project-1",
      amountCents: 10_000n,
      direction: "increase",
      adjustsPayableRefId: null,
      settlementRecheckRequired: true,
      debtorCompanySnapshot: { companyId: "company-1" },
      projectSnapshot: { projectId: "project-1" },
      creditorSnapshot: {
        subjectType: "business_party",
        identityKey: "business_party:party-version-1",
        name: "工资代发机构"
      },
      confirmedVersion: { status: "confirmed", revision: 4 },
      creditorBreakdown: {
        creditorSubjectType: "business_party",
        creditorSubjectIdentityKey: "business_party:party-version-1",
        creditorNameSnapshot: "工资代发机构"
      },
      adjustments: [{ direction: "decrease", amountCents: 2_000n }]
    };
    const aggregate = jest.fn()
      .mockResolvedValueOnce({ _sum: { amountCents: 9_000n } })
      .mockResolvedValueOnce({ _sum: { amountCents: 9_000n } });
    const prisma = {
      $queryRaw: jest.fn().mockResolvedValue([
        {
          payableRef: "payable-over-settled",
          confirmedAmountCents: 9_000n,
          activeAmountCents: 9_000n
        }
      ]),
      wagePayableRef: { findMany: jest.fn().mockResolvedValue([payable]) },
      payableSettlementAllocation: { aggregate },
      companyEntity: { findUnique: jest.fn().mockResolvedValue({ name: "甲公司" }) },
      project: { findUnique: jest.fn().mockResolvedValue({ code: "XM-01", name: "一号项目" }) }
    };
    const service = new PayableRegistryService(
      prisma as never,
      { resolveActiveRoleScopes: jest.fn().mockResolvedValue(["finance_staff"]) } as never,
      { record: jest.fn() } as never
    );

    await expect(service.listWagePayableCases("finance-user")).resolves.toEqual([
      expect.objectContaining({
        payableRef: "payable-over-settled",
        status: "over_settled_reconciliation_required",
        statusLabel: "超额核销待核对",
        remainingAmountCents: "0",
        overSettledAmountCents: "1000"
      })
    ]);
  });

  it("rejects project-only and technical administrator roles before touching the registry", async () => {
    const prisma = { wagePayableRef: { findUnique: jest.fn() } };
    const roles = { resolveActiveRoleScopes: jest.fn().mockResolvedValue(["project_finance_staff", "super_admin"]) };
    const audit = { record: jest.fn() };
    const service = new PayableRegistryService(prisma as never, roles as never, audit as never);

    await expect(
      service.listPaymentExecutionCandidates("technical-admin", "payable-1")
    ).rejects.toThrow("只有全系统财务人员可以办理核销案件");
    expect(prisma.wagePayableRef.findUnique).not.toHaveBeenCalled();
  });

  it("requires leader-approved company transfer for existing inter-entity debt", async () => {
    const root = {
      id: "relationship-1",
      entryKind: "proxy_payment",
      direction: "increase",
      status: "confirmed",
      adjustsEntryId: null,
      paymentExecutionId: "execution-1",
      settlementCaseId: "case-1",
      originalDebtorCompanyId: "company-debtor",
      creditorCompanyId: "company-actual",
      approvedPayerCompanyId: "company-approved",
      debtorSnapshot: { companyEntityId: "company-debtor", name: "原债务公司" },
      creditorSnapshot: { companyEntityId: "company-actual", name: "实际付款公司" },
      approvedPayerSnapshot: { companyEntityId: "company-approved", name: "批准付款公司" },
      amountCents: 10_000n,
      currencyCode: "CNY",
      evidenceFileId: "voucher-1",
      createdByUserId: "original-confirm",
      confirmedByUserId: "original-confirm",
      adjustments: [{ direction: "decrease", amountCents: 2_000n }],
      paymentExecution: { executedByUserId: "executor" }
    };
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      user: { findUnique: jest.fn().mockResolvedValue({ isActive: true }) },
      userPosition: { findMany: jest.fn().mockResolvedValue([{ positionId: "director-position" }]) },
      position: { findMany: jest.fn().mockResolvedValue([{ id: "director-position", key: "finance_director" }]) },
      payableSettlementCommandReceipt: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({})
      },
      interEntityRelationshipEntry: {
        findUnique: jest.fn().mockResolvedValue(root),
        create: jest.fn().mockResolvedValue({ id: "return-1" }),
        update: jest.fn().mockResolvedValue({ id: "return-1", status: "confirmed" })
      },
      interEntityRelationshipEvidenceClaim: {
        findUnique: jest.fn().mockResolvedValue({
          id: "claim-return",
          relationshipEntryId: "relationship-1",
          fileId: "voucher-return",
          uploadedByUserId: "return-director",
          contentSha256: "c".repeat(64),
          status: "pending"
        }),
        update: jest.fn().mockResolvedValue({ id: "claim-return", status: "consumed" })
      },
      fileObject: {
        findUnique: jest.fn().mockResolvedValue({
          id: "voucher-return",
          storageStatus: "active",
          uploadedByUserId: "return-director",
          contentSha256: "c".repeat(64)
        })
      }
    };
    const prisma = {
      $transaction: jest.fn((operation: (client: typeof tx) => unknown) => operation(tx))
    };
    const audit = { record: jest.fn().mockResolvedValue(undefined) };
    const service = new PayableRegistryService(
      prisma as never,
      { resolveActiveRoleScopes: jest.fn().mockResolvedValue(["finance_director"]) } as never,
      audit as never
    );

    await expect(service.returnInterEntityRelationship("return-director", {
      relationshipEntryId: "relationship-1",
      amountCents: 3_000n,
      evidenceFileId: "voucher-return",
      evidenceClaimId: "claim-return",
      reason: "代付公司部分归还",
      idempotencyKey: "00000000-0000-4000-8000-000000000031"
    })).rejects.toThrow("公司间往来归还请从公司互转台账发起");
    expect(tx.interEntityRelationshipEntry.create).not.toHaveBeenCalled();
    expect(tx.interEntityRelationshipEvidenceClaim.update).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("requires a confirmed root relationship before uploading return evidence", async () => {
    const findUnique = jest.fn().mockResolvedValue({
      entryKind: "proxy_payment",
      direction: "increase",
      status: "confirmed",
      adjustsEntryId: null
    });
    const service = new PayableRegistryService(
      { interEntityRelationshipEntry: { findUnique } } as never,
      { resolveActiveRoleScopes: jest.fn().mockResolvedValue(["finance_director"]) } as never,
      { record: jest.fn() } as never
    );

    await expect(
      service.assertInterEntityRelationshipEvidenceUpload(
        "return-director",
        "relationship-1"
      )
    ).resolves.toBeUndefined();
    expect(findUnique).toHaveBeenCalledWith({
      where: { id: "relationship-1" },
      select: {
        entryKind: true,
        direction: true,
        status: true,
        adjustsEntryId: true
      }
    });
  });
});
