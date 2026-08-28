import { PayableRegistryService } from "./payable-registry.service";

describe("PayableRegistryService", () => {
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
        statusLabel: "可核销",
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

  it("returns only bounded eligible payment candidates as opaque projections without execution UUIDs or GET writes", async () => {
    const payable = {
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
      creditorSnapshot: { subjectType: "business_party", identityKey: "business_party:party-version-1", name: "工资代发机构" },
      confirmedVersion: { status: "confirmed", revision: 3 },
      creditorBreakdown: {
        creditorSubjectType: "business_party",
        creditorSubjectIdentityKey: "business_party:party-version-1",
        creditorNameSnapshot: "工资代发机构"
      },
      adjustments: []
    };
    const executions = [
      {
        id: "execution-secret-1", paymentRequestId: "request-1", amountCents: 10_000n,
        paymentSubjectType: "our_company",
        companyEntityIdSnapshot: "company-1", companyEntityNameSnapshot: "甲公司",
        paidAt: new Date("2026-08-27T09:00:00.000Z"), createdAt: new Date("2026-08-27T09:01:00.000Z")
      },
      {
        id: "execution-wrong-project", paymentRequestId: "request-2", amountCents: 8_000n,
        paymentSubjectType: "our_company",
        companyEntityIdSnapshot: "company-1", companyEntityNameSnapshot: "甲公司",
        paidAt: new Date("2026-08-27T10:00:00.000Z"), createdAt: new Date("2026-08-27T10:01:00.000Z")
      }
    ];
    const tx = {
      wagePayableRef: { findUnique: jest.fn().mockResolvedValue(payable) },
      paymentExecution: { findMany: jest.fn().mockResolvedValue(executions) },
      paymentRequest: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "request-1", contractId: "contract-1", projectId: "project-1", contractVersionId: "contract-version-1",
            status: "paid", paymentSubjectType: "our_company", updatedAt: new Date("2026-08-27T08:59:00.000Z")
          },
          {
            id: "request-2", contractId: "contract-2", projectId: "project-2", contractVersionId: "contract-version-2",
            status: "paid", paymentSubjectType: "our_company", updatedAt: new Date("2026-08-27T09:59:00.000Z")
          }
        ])
      },
      contract: {
        findMany: jest.fn().mockResolvedValue([
          { id: "contract-1", projectId: "project-1", contractTypeKey: "labor_subcontract" },
          { id: "contract-2", projectId: "project-2", contractTypeKey: "labor_subcontract" }
        ])
      },
      contractVersion: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "contract-version-1", contractId: "contract-1", status: "effective", signingSubjectType: "our_company",
            companyEntityIdSnapshot: "company-1", companyEntityVersionId: "company-version-1",
            affiliateBusinessPartyVersionId: null, updatedAt: new Date("2026-08-27T08:58:00.000Z")
          },
          {
            id: "contract-version-2", contractId: "contract-2", status: "effective", signingSubjectType: "our_company",
            companyEntityIdSnapshot: "company-1", companyEntityVersionId: "company-version-1",
            affiliateBusinessPartyVersionId: null, updatedAt: new Date("2026-08-27T09:58:00.000Z")
          }
        ])
      },
      contractPartySnapshot: {
        findMany: jest.fn().mockResolvedValue([{
          id: "party-snapshot-1", contractVersionId: "contract-version-1",
          businessPartyVersionId: "party-version-1"
        }])
      },
      paymentExecutionWagePayableBinding: {
        findMany: jest.fn().mockImplementation(({ where }: { where?: { wagePayableRefId?: string } }) =>
          where?.wagePayableRefId
            ? Promise.resolve([{
                paymentExecutionId: "execution-secret-1",
                wagePayableRefId: "payable-1",
                debtorCompanyId: "company-1",
                projectId: "project-1",
                creditorSubjectType: "business_party",
                creditorUserId: null,
                creditorBusinessPartyVersionId: "party-version-1",
                creditorSubjectIdentityKey: "business_party:party-version-1",
                creditorNameSnapshot: "工资代发机构",
                creditorUnifiedIdentitySnapshot: null,
                creditorVersionFingerprint: null,
                amountCents: 10_000n
              }])
            : Promise.resolve([])
        )
      },
      paymentExecutionAllocation: { findMany: jest.fn().mockResolvedValue([]) },
      payableSettlementAllocation: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { amountCents: 2_000n } }),
        groupBy: jest.fn().mockResolvedValue([{ paymentExecutionId: "execution-secret-1", _sum: { amountCents: 2_000n } }])
      },
      payableSettlementCase: {
        findMany: jest.fn().mockResolvedValue([{ revision: 3 }])
      }
    };
    const prisma = { ...tx };
    const roles = { resolveActiveRoleScopes: jest.fn().mockResolvedValue(["finance_staff"]) };
    const audit = { record: jest.fn() };
    const service = new PayableRegistryService(prisma as never, roles as never, audit as never);

    const result = await service.listPaymentExecutionCandidates("finance-user", "payable-1");

    expect(result).toMatchObject({ caseRevision: 3, candidates: [expect.objectContaining({
      displayLabel: expect.stringContaining("候选01"),
      payerLabel: "甲公司",
      statusLabel: "已执行，可核销",
      availableAmountCents: "8000",
      selectionRef: expect.stringMatching(/^pes1\./u),
      expiresAt: expect.any(String)
    })] });
    expect(JSON.stringify(result)).not.toContain("execution-secret-1");
    expect(JSON.stringify(result)).not.toContain("paymentExecutionId");
    expect(tx.paymentExecution.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 100 }));
    expect(audit.record).not.toHaveBeenCalled();
    expect(prisma).not.toHaveProperty("paymentExecutionSelectionGrant");

    tx.contract.findMany.mockResolvedValue([
      { id: "contract-1", projectId: "project-1", contractTypeKey: "material_purchase" },
      { id: "contract-2", projectId: "project-2", contractTypeKey: "labor_subcontract" }
    ]);
    await expect(
      service.listPaymentExecutionCandidates("finance-user", "payable-1")
    ).resolves.toMatchObject({ candidates: [] });

    payable.creditorSnapshot = {
      subjectType: "employee_user",
      identityKey: "employee_user:user-1",
      name: "不得进入付款候选的员工"
    };
    payable.creditorBreakdown = {
      creditorSubjectType: "employee_user",
      creditorSubjectIdentityKey: "employee_user:user-1",
      creditorNameSnapshot: "不得进入付款候选的员工"
    };

    await expect(
      service.listPaymentExecutionCandidates("finance-user", "payable-1")
    ).resolves.toMatchObject({ candidates: [] });
    expect(tx.paymentExecution.findMany).toHaveBeenCalledTimes(3);
  });

  it("allocates exactly one freshly authorized opaque selection in one serializable transaction without exposing the execution id", async () => {
    const payable = {
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
    const execution = {
      id: "execution-secret-1",
      paymentRequestId: "request-1",
      amountCents: 10_000n,
      paymentSubjectType: "our_company",
      companyEntityIdSnapshot: "company-1",
      companyEntityNameSnapshot: "甲公司",
      paidAt: new Date("2026-08-27T09:00:00.000Z"),
      createdAt: new Date("2026-08-27T09:01:00.000Z")
    };
    const request = {
      id: "request-1",
      contractId: "contract-1",
      projectId: "project-1",
      contractVersionId: "contract-version-1",
      status: "paid",
      paymentSubjectType: "our_company",
      updatedAt: new Date("2026-08-27T08:59:00.000Z")
    };
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      user: { findUnique: jest.fn().mockResolvedValue({ isActive: true }) },
      userPosition: { findMany: jest.fn().mockResolvedValue([{ positionId: "position-finance" }]) },
      position: { findMany: jest.fn().mockResolvedValue([{ id: "position-finance", key: "finance_staff" }]) },
      wagePayableRef: { findUnique: jest.fn().mockResolvedValue(payable) },
      paymentExecution: {
        findMany: jest.fn().mockResolvedValue([execution]),
        findUnique: jest.fn().mockResolvedValue(execution)
      },
      paymentRequest: { findMany: jest.fn().mockResolvedValue([request]) },
      contract: {
        findMany: jest.fn().mockResolvedValue([{ id: "contract-1", projectId: "project-1", contractTypeKey: "labor_subcontract" }])
      },
      contractVersion: {
        findMany: jest.fn().mockResolvedValue([{
          id: "contract-version-1", contractId: "contract-1", status: "effective", signingSubjectType: "our_company",
          companyEntityIdSnapshot: "company-1", companyEntityVersionId: "company-version-1",
          affiliateBusinessPartyVersionId: null, updatedAt: new Date("2026-08-27T08:58:00.000Z")
        }])
      },
      contractPartySnapshot: {
        findMany: jest.fn().mockResolvedValue([{
          id: "party-snapshot-1", contractVersionId: "contract-version-1",
          businessPartyVersionId: "party-version-1"
        }])
      },
      paymentExecutionWagePayableBinding: {
        findMany: jest.fn().mockImplementation(({ where }: { where?: { paymentExecutionId?: string; wagePayableRefId?: string; wagePayableRef?: { in?: string[] } } }) =>
          where?.wagePayableRefId || where?.wagePayableRef?.in
            ? Promise.resolve([{
                paymentExecutionId: "execution-secret-1",
                wagePayableRefId: "payable-1",
                debtorCompanyId: "company-1",
                projectId: "project-1",
                creditorSubjectType: "business_party",
                creditorUserId: null,
                creditorBusinessPartyVersionId: "party-version-1",
                creditorSubjectIdentityKey: "business_party:party-version-1",
                creditorNameSnapshot: "工资代发机构",
                creditorUnifiedIdentitySnapshot: null,
                creditorVersionFingerprint: null,
                amountCents: 10_000n
              }])
            : Promise.resolve([])
        )
      },
      paymentExecutionAllocation: { findMany: jest.fn().mockResolvedValue([]) },
      payableSettlementAllocation: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { amountCents: null } }),
        groupBy: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: "allocation-1" })
      },
      payableSettlementCase: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({
          id: "settlement-case-1",
          paymentExecutionId: "execution-secret-1",
          status: "draft",
          revision: 1
        }),
        update: jest.fn().mockResolvedValue({
          id: "settlement-case-1",
          paymentExecutionId: "execution-secret-1",
          status: "draft",
          revision: 2
        })
      },
      payableSettlementCommandReceipt: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({})
      }
    };
    const prisma = {
      ...tx,
      $transaction: jest.fn((operation: (client: typeof tx) => unknown) => operation(tx))
    };
    const roles = { resolveActiveRoleScopes: jest.fn().mockResolvedValue(["finance_staff"]) };
    const audit = { record: jest.fn().mockResolvedValue(undefined) };
    const service = new PayableRegistryService(prisma as never, roles as never, audit as never);
    const candidates = await service.listPaymentExecutionCandidates("finance-user", "payable-1");
    const selected = candidates.candidates[0];

    const result = await service.allocatePaymentExecution("finance-user", {
      payableRef: "payable-1",
      selectionRef: selected.selectionRef,
      selectionExpiresAt: selected.expiresAt,
      amountCents: 4_000n,
      expectedCaseRevision: 0,
      idempotencyKey: "00000000-0000-4000-8000-000000000021"
    });

    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "Serializable"
    });
    expect(tx.payableSettlementAllocation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        payableRef: "payable-1",
        paymentExecutionId: "execution-secret-1",
        amountCents: 4_000n
      })
    });
    expect(tx.payableSettlementCommandReceipt.create).toHaveBeenCalledTimes(1);
    expect(audit.record).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toContain("execution-secret-1");
    expect(JSON.stringify(audit.record.mock.calls)).not.toContain("execution-secret-1");
    expect(JSON.stringify(audit.record.mock.calls)).not.toContain("allocation-1");
    expect(JSON.stringify(audit.record.mock.calls)).not.toContain("payable-1");
    expect(JSON.stringify(audit.record.mock.calls)).not.toContain("4000");
    expect(JSON.stringify(audit.record.mock.calls)).not.toContain("00000000-0000-4000-8000-000000000021");
    expect(audit.record).toHaveBeenCalledWith(tx, expect.objectContaining({
      metadata: expect.objectContaining({
        scope: "global",
        roleKeys: ["finance_staff"],
        idempotencyKeyFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/u),
        payloadFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/u),
        allocationFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/u),
        payableRefFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/u),
        amountCentsFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/u),
        paymentExecutionFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/u)
      })
    }));
  });

  it("subtracts existing generic PaymentExecution allocations before exposing a wage candidate", async () => {
    const harness = createAllocationHarness();
    harness.tx.paymentExecutionAllocation.findMany.mockResolvedValue([{
      paymentExecutionId: "execution-secret-1",
      amountCents: 3_000n
    }]);

    await expect(
      harness.service.listPaymentExecutionCandidates("finance-user", "payable-1")
    ).resolves.toMatchObject({
      candidates: [expect.objectContaining({ availableAmountCents: "7000" })]
    });
  });

  it("fails closed when approved and actual payer facts diverge or change after selection", async () => {
    const mismatchHarness = createAllocationHarness();
    mismatchHarness.tx.contractVersion.findMany.mockResolvedValue([{
      id: "contract-version-1", contractId: "contract-1", status: "effective", signingSubjectType: "our_company",
      companyEntityIdSnapshot: "company-2", companyEntityVersionId: "company-version-2",
      affiliateBusinessPartyVersionId: null, updatedAt: new Date("2026-08-27T08:58:00.000Z")
    }]);
    await expect(
      mismatchHarness.service.listPaymentExecutionCandidates("finance-user", "payable-1")
    ).resolves.toMatchObject({ candidates: [] });

    const changedHarness = createAllocationHarness();
    const listed = await changedHarness.service.listPaymentExecutionCandidates("finance-user", "payable-1");
    const selected = listed.candidates[0];
    changedHarness.tx.contractVersion.findMany.mockResolvedValue([{
      id: "contract-version-1", contractId: "contract-1", status: "effective", signingSubjectType: "our_company",
      companyEntityIdSnapshot: "company-2", companyEntityVersionId: "company-version-2",
      affiliateBusinessPartyVersionId: null, updatedAt: new Date("2026-08-27T09:58:00.000Z")
    }]);
    await expect(changedHarness.service.allocatePaymentExecution("finance-user", {
      payableRef: "payable-1",
      selectionRef: selected.selectionRef,
      selectionExpiresAt: selected.expiresAt,
      amountCents: 1_000n,
      expectedCaseRevision: 0,
      idempotencyKey: "00000000-0000-4000-8000-000000000027"
    })).rejects.toThrow("付款候选已失效，请刷新后重新选择");
  });

  it("fails closed when the immutable wage creditor bridge is missing or diverges", async () => {
    const missingHarness = createAllocationHarness();
    missingHarness.tx.paymentExecutionWagePayableBinding.findMany.mockResolvedValue([]);
    await expect(
      missingHarness.service.listPaymentExecutionCandidates("finance-user", "payable-1")
    ).resolves.toMatchObject({ candidates: [] });

    const divergedHarness = createAllocationHarness();
    divergedHarness.tx.paymentExecutionWagePayableBinding.findMany.mockResolvedValue([{
      paymentExecutionId: "execution-secret-1",
      wagePayableRefId: "payable-1",
      debtorCompanyId: "company-1",
      projectId: "project-1",
      creditorSubjectType: "business_party",
      creditorUserId: null,
      creditorBusinessPartyVersionId: "different-party-version",
      creditorSubjectIdentityKey: "business_party:different-party-version",
      creditorNameSnapshot: "工资代发机构",
      creditorUnifiedIdentitySnapshot: null,
      creditorVersionFingerprint: null,
      amountCents: 10_000n
    }]);
    await expect(
      divergedHarness.service.listPaymentExecutionCandidates("finance-user", "payable-1")
    ).resolves.toMatchObject({ candidates: [] });
  });

  it("fails closed when an opaque selection is replayed by another actor or after balances change", async () => {
    const actorHarness = createAllocationHarness();
    const actorCandidates = await actorHarness.service.listPaymentExecutionCandidates(
      "finance-user",
      "payable-1"
    );
    const actorSelected = actorCandidates.candidates[0];

    await expect(actorHarness.service.allocatePaymentExecution("other-finance-user", {
      payableRef: "payable-1",
      selectionRef: actorSelected.selectionRef,
      selectionExpiresAt: actorSelected.expiresAt,
      amountCents: 4_000n,
      expectedCaseRevision: 0,
      idempotencyKey: "00000000-0000-4000-8000-000000000022"
    })).rejects.toThrow("付款候选已失效，请刷新后重新选择");
    expect(actorHarness.tx.payableSettlementAllocation.create).not.toHaveBeenCalled();

    const balanceHarness = createAllocationHarness();
    const balanceCandidates = await balanceHarness.service.listPaymentExecutionCandidates(
      "finance-user",
      "payable-1"
    );
    const balanceSelected = balanceCandidates.candidates[0];
    balanceHarness.tx.paymentExecutionAllocation.findMany.mockResolvedValue([{
      paymentExecutionId: "execution-secret-1",
      amountCents: 1n
    }]);

    await expect(balanceHarness.service.allocatePaymentExecution("finance-user", {
      payableRef: "payable-1",
      selectionRef: balanceSelected.selectionRef,
      selectionExpiresAt: balanceSelected.expiresAt,
      amountCents: 4_000n,
      expectedCaseRevision: 0,
      idempotencyKey: "00000000-0000-4000-8000-000000000023"
    })).rejects.toThrow("付款候选已失效，请刷新后重新选择");
    expect(balanceHarness.tx.payableSettlementAllocation.create).not.toHaveBeenCalled();
  });

  it("fails closed when a selection matches zero or multiple bounded candidates", async () => {
    const zeroHarness = createAllocationHarness();
    await expect(zeroHarness.service.allocatePaymentExecution("finance-user", {
      payableRef: "payable-1",
      selectionRef: "pes1.invalid",
      selectionExpiresAt: new Date(Date.now() + 60_000).toISOString(),
      amountCents: 1_000n,
      expectedCaseRevision: 0,
      idempotencyKey: "00000000-0000-4000-8000-000000000024"
    })).rejects.toThrow("付款候选已失效，请刷新后重新选择");

    const multipleHarness = createAllocationHarness();
    multipleHarness.tx.paymentExecution.findMany.mockResolvedValue([
      multipleHarness.execution,
      multipleHarness.execution
    ]);
    const candidates = await multipleHarness.service.listPaymentExecutionCandidates(
      "finance-user",
      "payable-1"
    );
    expect(candidates.candidates).toHaveLength(2);
    await expect(multipleHarness.service.allocatePaymentExecution("finance-user", {
      payableRef: "payable-1",
      selectionRef: candidates.candidates[0].selectionRef,
      selectionExpiresAt: candidates.candidates[0].expiresAt,
      amountCents: 1_000n,
      expectedCaseRevision: 0,
      idempotencyKey: "00000000-0000-4000-8000-000000000025"
    })).rejects.toThrow("付款候选已失效，请刷新后重新选择");
    expect(multipleHarness.tx.payableSettlementAllocation.create).not.toHaveBeenCalled();
  });

  it("replays the same allocation receipt, conflicts on a changed payload, and retries serializable conflicts", async () => {
    const harness = createAllocationHarness();
    const candidates = await harness.service.listPaymentExecutionCandidates("finance-user", "payable-1");
    const selected = candidates.candidates[0];
    const input = {
      payableRef: "payable-1",
      selectionRef: selected.selectionRef,
      selectionExpiresAt: selected.expiresAt,
      amountCents: 4_000n,
      expectedCaseRevision: 0,
      idempotencyKey: "00000000-0000-4000-8000-000000000026"
    } as const;
    harness.prisma.$transaction.mockImplementationOnce(() => Promise.reject({ code: "P2034" }));

    const first = await harness.service.allocatePaymentExecution("finance-user", input);
    expect(harness.prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(harness.tx.user.findUnique.mock.invocationCallOrder[0]).toBeLessThan(
      harness.tx.payableSettlementCommandReceipt.findUnique.mock.invocationCallOrder[0]
    );
    expect(harness.tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      harness.tx.payableSettlementCommandReceipt.findUnique.mock.invocationCallOrder[0]
    );
    const receipt = harness.tx.payableSettlementCommandReceipt.create.mock.calls[0][0].data;
    harness.tx.payableSettlementCommandReceipt.findUnique.mockResolvedValue({
      payloadFingerprint: receipt.payloadFingerprint,
      responseSnapshot: first
    });

    await expect(harness.service.allocatePaymentExecution("finance-user", input)).resolves.toEqual(first);
    expect(harness.tx.payableSettlementAllocation.create).toHaveBeenCalledTimes(1);
    const lockedTables = harness.tx.$queryRaw.mock.calls.map(([query]) =>
      ((query as { strings?: readonly string[] }).strings ?? []).join(" ")
    );
    expect(lockedTables.findIndex((sql) => sql.includes('FROM "PaymentRequest"')))
      .toBeLessThan(lockedTables.findIndex((sql) => sql.includes('FROM "ContractVersion"')));
    expect(lockedTables.findIndex((sql) => sql.includes('FROM "ContractVersion"')))
      .toBeLessThan(lockedTables.findIndex((sql) => sql.includes('FROM "PaymentExecution"')));
    expect(lockedTables.findIndex((sql) => sql.includes('FROM "PaymentExecution"')))
      .toBeLessThan(lockedTables.findIndex((sql) => sql.includes('FROM "WagePayableRef"')));
    await expect(
      harness.service.allocatePaymentExecution("other-finance-user", input)
    ).rejects.toThrow("幂等键已用于不同核销载荷");
    await expect(harness.service.allocatePaymentExecution("finance-user", {
      ...input,
      amountCents: 4_001n
    })).rejects.toThrow("幂等键已用于不同核销载荷");
    expect(harness.tx.payableSettlementAllocation.create).toHaveBeenCalledTimes(1);
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

  it("submits an exactly covered draft and prevents its creator from confirming it", async () => {
    const tx = createTransitionHarness({
      paymentExecutorUserId: "executor",
      payableAmountCents: 10_000n
    });
    tx.payableSettlementCase.findUnique
      .mockResolvedValueOnce({
        id: "case-1",
        status: "draft",
        revision: 2,
        paymentExecutionId: "execution-1",
        createdByUserId: "maker",
        submittedByUserId: null
      })
      .mockResolvedValueOnce({
        id: "case-1",
        status: "draft",
        revision: 2,
        paymentExecutionId: "execution-1",
        createdByUserId: "maker",
        submittedByUserId: null
      })
      .mockResolvedValueOnce({
        id: "case-1",
        status: "submitted",
        revision: 3,
        paymentExecutionId: "execution-1",
        createdByUserId: "maker",
        submittedByUserId: "maker"
      })
      .mockResolvedValueOnce({
        id: "case-1",
        status: "submitted",
        revision: 3,
        paymentExecutionId: "execution-1",
        createdByUserId: "maker",
        submittedByUserId: "maker"
      });
    tx.payableSettlementCase.update.mockResolvedValue({
      id: "case-1",
      status: "submitted",
      revision: 3
    });
    const prisma = { $transaction: jest.fn((operation: (client: typeof tx) => unknown) => operation(tx)) };
    const roles = { resolveActiveRoleScopes: jest.fn().mockResolvedValue(["finance_director"]) };
    const audit = { record: jest.fn().mockResolvedValue(undefined) };
    const service = new PayableRegistryService(prisma as never, roles as never, audit as never);
    const input = { settlementCaseId: "case-1", expectedRevision: 2, idempotencyKey: "00000000-0000-4000-8000-000000000003" };

    await expect(service.submit("maker", input)).resolves.toEqual(expect.objectContaining({ status: "submitted", revision: 3 }));
    const transitionLocks = tx.$queryRaw.mock.calls.map(([query]) =>
      ((query as { strings?: readonly string[] }).strings ?? []).join(" ")
    );
    expect(transitionLocks.findIndex((sql) => sql.includes('FROM "PaymentRequest"')))
      .toBeLessThan(transitionLocks.findIndex((sql) => sql.includes('FROM "ContractVersion"')));
    expect(transitionLocks.findIndex((sql) => sql.includes('FROM "ContractVersion"')))
      .toBeLessThan(transitionLocks.findIndex((sql) => sql.includes('FROM "PaymentExecution"')));
    expect(JSON.stringify(audit.record.mock.calls)).not.toContain("allocation-1");
    expect(JSON.stringify(audit.record.mock.calls)).not.toContain("payable-1");
    expect(JSON.stringify(audit.record.mock.calls)).not.toContain("10000");
    expect(JSON.stringify(audit.record.mock.calls)).not.toContain("00000000-0000-4000-8000-000000000003");
    expect(audit.record).toHaveBeenCalledWith(tx, expect.objectContaining({
      metadata: expect.objectContaining({
        scope: "global",
        roleKeys: ["finance_director"],
        allocationTrace: [{
          allocationFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/u),
          payableRefFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/u),
          amountCentsFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/u)
        }],
        idempotencyKeyFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/u),
        payloadFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/u),
        settlementCaseFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/u),
        paymentExecutionFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/u),
        allocationCount: 1,
        amountCentsFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/u)
      })
    }));
    await expect(service.confirm("maker", { ...input, expectedRevision: 3, idempotencyKey: "00000000-0000-4000-8000-000000000004" }))
      .rejects.toThrow("确认人必须职责分离");
  });

  it("freshly resolves approved and actual payer facts and rejects proxy-payment mismatch", async () => {
    const tx = createTransitionHarness({
      paymentExecutorUserId: "executor",
      payableAmountCents: 10_000n
    });
    tx.contractVersion.findUnique.mockResolvedValue({
      id: "contract-version-1",
      status: "effective",
      signingSubjectType: "our_company",
      companyEntityIdSnapshot: "company-2",
      companyEntityVersionId: "company-version-2",
      affiliateBusinessPartyVersionId: null
    });
    const prisma = {
      $transaction: jest.fn((operation: (client: typeof tx) => unknown) => operation(tx))
    };
    const service = new PayableRegistryService(
      prisma as never,
      { resolveActiveRoleScopes: jest.fn().mockResolvedValue(["finance_director"]) } as never,
      { record: jest.fn() } as never
    );

    await expect(service.confirm("director", {
      settlementCaseId: "case-1",
      expectedRevision: 3,
      idempotencyKey: "00000000-0000-4000-8000-000000000028"
    })).rejects.toThrow("原债务主体与批准付款主体不一致，本票不处理代付");
    expect(tx.payableSettlementCase.update).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: "付款申请状态变化",
      arrange: (tx: ReturnType<typeof createTransitionHarness>) => {
        tx.paymentRequest.findUnique.mockResolvedValue({
          id: "request-1",
          contractVersionId: "contract-version-1",
          paymentSubjectType: "our_company",
          projectId: "project-1",
          status: "cancelled",
          approvedAmountCents: 10_000n
        });
      },
      error: "付款申请状态已变化"
    },
    {
      name: "付款申请项目变化",
      arrange: (tx: ReturnType<typeof createTransitionHarness>) => {
        tx.paymentRequest.findUnique.mockResolvedValue({
          id: "request-1",
          contractVersionId: "contract-version-1",
          paymentSubjectType: "our_company",
          projectId: "project-2",
          status: "paid",
          approvedAmountCents: 10_000n
        });
      },
      error: "付款申请项目与核销明细不一致"
    },
    {
      name: "批准额度变化",
      arrange: (tx: ReturnType<typeof createTransitionHarness>) => {
        tx.paymentRequest.findUnique.mockResolvedValue({
          id: "request-1",
          contractVersionId: "contract-version-1",
          paymentSubjectType: "our_company",
          projectId: "project-1",
          status: "paid",
          approvedAmountCents: 9_999n
        });
      },
      error: "实际付款超过当前批准额度"
    },
    {
      name: "唯一收款方变化",
      arrange: (tx: ReturnType<typeof createTransitionHarness>) => {
        tx.contractPartySnapshot.findMany.mockResolvedValue([]);
      },
      error: "合同当前未冻结唯一收款方"
    }
  ])("fails confirmation after $name", async ({ arrange, error }) => {
    const tx = createTransitionHarness({
      paymentExecutorUserId: "executor",
      payableAmountCents: 10_000n
    });
    arrange(tx);
    const service = new PayableRegistryService(
      { $transaction: jest.fn((operation: (client: typeof tx) => unknown) => operation(tx)) } as never,
      { resolveActiveRoleScopes: jest.fn().mockResolvedValue(["finance_director"]) } as never,
      { record: jest.fn() } as never
    );

    await expect(service.confirm("director", {
      settlementCaseId: "case-1",
      expectedRevision: 3,
      idempotencyKey: "00000000-0000-4000-8000-000000000029"
    })).rejects.toThrow(error);
    expect(tx.payableSettlementCase.update).not.toHaveBeenCalled();
  });

  it("rejects a creator from confirming even when a different user submitted the case", async () => {
    const tx = createTransitionHarness({
      paymentExecutorUserId: "executor",
      payableAmountCents: 10_000n
    });
    tx.payableSettlementCase.findUnique.mockResolvedValue({
      id: "case-1",
      status: "submitted",
      revision: 3,
      paymentExecutionId: "execution-1",
      createdByUserId: "creator",
      submittedByUserId: "submitter"
    });
    const prisma = { $transaction: jest.fn((operation: (client: typeof tx) => unknown) => operation(tx)) };
    const service = new PayableRegistryService(prisma as never, { resolveActiveRoleScopes: jest.fn().mockResolvedValue(["finance_director"]) } as never, { record: jest.fn() } as never);
    await expect(service.confirm("creator", { settlementCaseId: "case-1", expectedRevision: 3, idempotencyKey: "00000000-0000-4000-8000-000000000014" })).rejects.toThrow("创建人与确认人必须职责分离");
  });

  it("rechecks the finance-director role inside the confirmation transaction", async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      user: { findUnique: jest.fn().mockResolvedValue({ isActive: false }) },
      userPosition: { findMany: jest.fn() },
      position: { findMany: jest.fn() },
      payableSettlementCommandReceipt: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn()
      },
      payableSettlementCase: {
        findUnique: jest.fn().mockResolvedValue({
          id: "case-1",
          status: "submitted",
          revision: 3,
          paymentExecutionId: "execution-1",
          createdByUserId: "creator",
          submittedByUserId: "submitter"
        }),
        update: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn((operation: (client: typeof tx) => unknown) => operation(tx))
    };
    const service = new PayableRegistryService(
      prisma as never,
      { resolveActiveRoleScopes: jest.fn().mockResolvedValue(["finance_director"]) } as never,
      { record: jest.fn() } as never
    );

    await expect(service.confirm("director", {
      settlementCaseId: "case-1",
      expectedRevision: 3,
      idempotencyKey: "00000000-0000-4000-8000-000000000015"
    })).rejects.toThrow("当前用户不具备全系统财务负责人权限");
    expect(tx.payableSettlementCommandReceipt.findUnique).not.toHaveBeenCalled();
    expect(tx.payableSettlementCase.update).not.toHaveBeenCalled();
  });

  it("prevents the payment executor from confirming the same settlement case", async () => {
    const tx = createTransitionHarness({
      paymentExecutorUserId: "director",
      payableAmountCents: 10_000n
    });
    const prisma = {
      $transaction: jest.fn((operation: (client: typeof tx) => unknown) => operation(tx))
    };
    const service = new PayableRegistryService(
      prisma as never,
      { resolveActiveRoleScopes: jest.fn().mockResolvedValue(["finance_director"]) } as never,
      { record: jest.fn().mockResolvedValue(undefined) } as never
    );

    await expect(service.confirm("director", {
      settlementCaseId: "case-1",
      expectedRevision: 3,
      idempotencyKey: "00000000-0000-4000-8000-000000000016"
    })).rejects.toThrow("付款执行人与确认人必须职责分离");
    expect(tx.payableSettlementCase.update).not.toHaveBeenCalled();
  });

  it("prevents an allocation editor from confirming the same settlement case", async () => {
    const tx = createTransitionHarness({
      paymentExecutorUserId: "executor",
      payableAmountCents: 10_000n
    });
    const prisma = {
      $transaction: jest.fn((operation: (client: typeof tx) => unknown) => operation(tx))
    };
    const service = new PayableRegistryService(
      prisma as never,
      { resolveActiveRoleScopes: jest.fn().mockResolvedValue(["finance_director"]) } as never,
      { record: jest.fn().mockResolvedValue(undefined) } as never
    );

    await expect(service.confirm("allocation-editor", {
      settlementCaseId: "case-1",
      expectedRevision: 3,
      idempotencyKey: "00000000-0000-4000-8000-000000000018"
    })).rejects.toThrow("核销编辑人与确认人必须职责分离");
    expect(tx.payableSettlementCase.update).not.toHaveBeenCalled();
  });

  it("fails confirmation when an upstream correction makes the payable over-settled", async () => {
    const tx = createTransitionHarness({
      paymentExecutorUserId: "executor",
      payableAmountCents: 9_000n
    });
    const prisma = {
      $transaction: jest.fn((operation: (client: typeof tx) => unknown) => operation(tx))
    };
    const service = new PayableRegistryService(
      prisma as never,
      { resolveActiveRoleScopes: jest.fn().mockResolvedValue(["finance_director"]) } as never,
      { record: jest.fn().mockResolvedValue(undefined) } as never
    );

    await expect(service.confirm("director", {
      settlementCaseId: "case-1",
      expectedRevision: 3,
      idempotencyKey: "00000000-0000-4000-8000-000000000017"
    })).rejects.toThrow("工资应付余额已变化");
    expect(tx.payableSettlementCase.update).not.toHaveBeenCalled();
  });
});

function createTransitionHarness(input: Readonly<{
  paymentExecutorUserId: string;
  payableAmountCents: bigint;
}>) {
  const allocation = {
    id: "allocation-1",
    payableRef: "payable-1",
    amountCents: 10_000n,
    debtorCompanyId: "company-1",
    payeeSubjectType: "business_party",
    payeeSubjectId: "business_party:party-version-1",
    currencyCode: "CNY",
    sourceType: "wage_payable_ref",
    sourceAggregateId: "version-1",
    sourceLineId: "payable-1",
    confirmedVersionId: "version-1",
    beneficiaryProjectId: "project-1",
    confirmedAmountCents: 10_000n,
    createdByUserId: "allocation-editor"
  };
  return {
    $queryRaw: jest.fn().mockResolvedValue([]),
    user: { findUnique: jest.fn().mockResolvedValue({ isActive: true }) },
    userPosition: {
      findMany: jest.fn().mockResolvedValue([{ positionId: "position-director" }])
    },
    position: {
      findMany: jest.fn().mockResolvedValue([
        { id: "position-director", key: "finance_director" }
      ])
    },
    payableSettlementCommandReceipt: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({})
    },
    payableSettlementCase: {
      findUnique: jest.fn().mockResolvedValue({
        id: "case-1",
        status: "submitted",
        revision: 3,
        paymentExecutionId: "execution-1",
        createdByUserId: "creator",
        submittedByUserId: "submitter"
      }),
      update: jest.fn().mockResolvedValue({
        id: "case-1",
        status: "confirmed",
        revision: 4
      })
    },
    paymentExecution: {
      findUnique: jest.fn().mockResolvedValue({
        id: "execution-1",
        paymentRequestId: "request-1",
        paymentSubjectType: "our_company",
        amountCents: 10_000n,
        companyEntityIdSnapshot: "company-1",
        executedByUserId: input.paymentExecutorUserId
      })
    },
    paymentRequest: {
      findUnique: jest.fn().mockResolvedValue({
        id: "request-1",
        contractVersionId: "contract-version-1",
        paymentSubjectType: "our_company",
        projectId: "project-1",
        status: "paid",
        approvedAmountCents: 10_000n
      })
    },
    contractVersion: {
      findUnique: jest.fn().mockResolvedValue({
        id: "contract-version-1",
        status: "effective",
        signingSubjectType: "our_company",
        companyEntityIdSnapshot: "company-1",
        companyEntityVersionId: "company-version-1",
        affiliateBusinessPartyVersionId: null
      })
    },
    contractPartySnapshot: {
      findMany: jest.fn().mockResolvedValue([{
        id: "party-snapshot-1",
        contractVersionId: "contract-version-1",
        businessPartyVersionId: "party-version-1"
      }])
    },
    payableSettlementAllocation: {
      findMany: jest.fn().mockResolvedValue([allocation]),
      aggregate: jest.fn().mockResolvedValue({ _sum: { amountCents: null } })
    },
    paymentExecutionAllocation: {
      findMany: jest.fn().mockResolvedValue([])
    },
    wagePayableRef: {
      findUnique: jest.fn().mockResolvedValue({
        id: "payable-1",
        confirmedVersionId: "version-1",
        projectAllocationId: "project-allocation-1",
        creditorBreakdownId: "creditor-1",
        debtorCompanyId: "company-1",
        projectId: "project-1",
        amountCents: 10_000n,
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
        adjustments: input.payableAmountCents === 10_000n
          ? []
          : [{ direction: "decrease", amountCents: 10_000n - input.payableAmountCents }]
      })
    }
  };
}

function createAllocationHarness() {
  const payable = {
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
  const execution = {
    id: "execution-secret-1",
    paymentRequestId: "request-1",
    amountCents: 10_000n,
    paymentSubjectType: "our_company",
    companyEntityIdSnapshot: "company-1",
    companyEntityNameSnapshot: "甲公司",
    paidAt: new Date("2026-08-27T09:00:00.000Z"),
    createdAt: new Date("2026-08-27T09:01:00.000Z")
  };
    const request = {
      id: "request-1",
      contractId: "contract-1",
      projectId: "project-1",
    contractVersionId: "contract-version-1",
    status: "paid",
    paymentSubjectType: "our_company",
    updatedAt: new Date("2026-08-27T08:59:00.000Z")
  };
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    user: { findUnique: jest.fn().mockResolvedValue({ isActive: true }) },
    userPosition: { findMany: jest.fn().mockResolvedValue([{ positionId: "position-finance" }]) },
    position: { findMany: jest.fn().mockResolvedValue([{ id: "position-finance", key: "finance_staff" }]) },
    wagePayableRef: { findUnique: jest.fn().mockResolvedValue(payable) },
    paymentExecution: {
      findMany: jest.fn().mockResolvedValue([execution]),
      findUnique: jest.fn().mockResolvedValue(execution)
    },
    paymentRequest: { findMany: jest.fn().mockResolvedValue([request]) },
    contract: {
      findMany: jest.fn().mockResolvedValue([{ id: "contract-1", projectId: "project-1", contractTypeKey: "labor_subcontract" }])
    },
    contractVersion: {
      findMany: jest.fn().mockResolvedValue([{
        id: "contract-version-1", contractId: "contract-1", status: "effective", signingSubjectType: "our_company",
        companyEntityIdSnapshot: "company-1", companyEntityVersionId: "company-version-1",
        affiliateBusinessPartyVersionId: null, updatedAt: new Date("2026-08-27T08:58:00.000Z")
      }])
    },
    contractPartySnapshot: {
      findMany: jest.fn().mockResolvedValue([{
        id: "party-snapshot-1", contractVersionId: "contract-version-1",
        businessPartyVersionId: "party-version-1"
      }])
    },
    paymentExecutionWagePayableBinding: {
      findMany: jest.fn().mockImplementation(({ where }: { where?: { paymentExecutionId?: string; wagePayableRefId?: string; wagePayableRef?: { in?: string[] } } }) => {
        if (where?.wagePayableRefId || where?.wagePayableRef?.in) {
          return Promise.resolve([{
            paymentExecutionId: "execution-secret-1",
            wagePayableRefId: "payable-1",
            debtorCompanyId: "company-1",
            projectId: "project-1",
            creditorSubjectType: "business_party",
            creditorUserId: null,
            creditorBusinessPartyVersionId: "party-version-1",
            creditorSubjectIdentityKey: "business_party:party-version-1",
            creditorNameSnapshot: "工资代发机构",
            creditorUnifiedIdentitySnapshot: null,
            creditorVersionFingerprint: null,
            amountCents: 10_000n
          }]);
        }
        return Promise.resolve([]);
      })
    },
    paymentExecutionAllocation: { findMany: jest.fn().mockResolvedValue([]) },
    payableSettlementAllocation: {
      aggregate: jest.fn().mockResolvedValue({ _sum: { amountCents: null } }),
      groupBy: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: "allocation-1" })
    },
    payableSettlementCase: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({
        id: "settlement-case-1",
        status: "draft",
        revision: 1
      }),
      update: jest.fn().mockResolvedValue({
        id: "settlement-case-1",
        status: "draft",
        revision: 2
      })
    },
    payableSettlementCommandReceipt: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({})
    }
  };
  const prisma = {
    ...tx,
    $transaction: jest.fn((operation: (client: typeof tx) => unknown) => operation(tx))
  };
  const roles = { resolveActiveRoleScopes: jest.fn().mockResolvedValue(["finance_staff"]) };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const service = new PayableRegistryService(prisma as never, roles as never, audit as never);
  return { service, prisma, tx, audit, execution };
}
