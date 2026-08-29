import { ConflictException, ForbiddenException } from "@nestjs/common";

import { FundMovementService, type CreateFundMovementInput } from "./fund-movement.service";

const CREATE_KEY = "11111111-1111-4111-8111-111111111111";
const SUBMIT_KEY = "22222222-2222-4222-8222-222222222222";
const CONFIRM_KEY = "33333333-3333-4333-8333-333333333333";

function crossProjectInput(overrides: Partial<CreateFundMovementInput> = {}): CreateFundMovementInput {
  return {
    kind: "cross_project_payment",
    paymentExecutionId: "execution-1",
    sourceProjectId: "project-source",
    beneficiaryProjectId: "project-beneficiary",
    sourceCompanyEntityId: "company-source",
    beneficiaryCompanyEntityId: "company-beneficiary",
    paymentAmountCents: 100n,
    projectFundUsedCents: 100n,
    companyAdvanceCents: 0n,
    legs: [
      {
        role: "source",
        projectId: "project-source",
        companyEntityId: "company-source",
        direction: "decrease",
        amountCents: 100n,
        sourceType: "payable",
        sourceAggregateId: "payable-1",
        sourceAllocationCount: 1,
        sourceAllocationAmountCents: 100n,
        contractId: "contract-1",
        contractVersionId: "contract-version-1",
        sourceSnapshot: { source: "test" }
      },
      {
        role: "beneficiary",
        projectId: "project-beneficiary",
        companyEntityId: "company-beneficiary",
        direction: "increase",
        amountCents: 100n,
        sourceType: "payable",
        sourceAggregateId: "payable-1",
        sourceAllocationCount: 1,
        sourceAllocationAmountCents: 100n,
        contractId: "contract-1",
        contractVersionId: "contract-version-1",
        sourceSnapshot: { source: "test" }
      }
    ],
    idempotencyKey: CREATE_KEY,
    ...overrides
  };
}

function createHarness(roleKeys: string[] = ["finance_staff"]) {
  const receipts = new Map<string, { payloadFingerprint: string; responseSnapshot: unknown }>();
  let legIndex = 0;
  const positionRows = roleKeys.map((key, index) => ({
    id: `position-${index + 1}`,
    key,
    positionId: `position-${index + 1}`
  }));
  const tx = {
    $executeRaw: jest.fn().mockResolvedValue(0),
    $queryRaw: jest.fn().mockResolvedValue([{ id: "movement-1" }]),
    fundMovementCommandReceipt: {
      findUnique: jest.fn().mockImplementation(({ where }: { where: { idempotencyKey: string } }) =>
        Promise.resolve(receipts.get(where.idempotencyKey) ?? null)),
      create: jest.fn().mockImplementation(({ data }: { data: { idempotencyKey: string; payloadFingerprint: string; responseSnapshot: unknown } }) => {
        receipts.set(data.idempotencyKey, {
          payloadFingerprint: data.payloadFingerprint,
          responseSnapshot: data.responseSnapshot
        });
        return Promise.resolve(data);
      })
    },
    paymentExecution: {
      findUnique: jest.fn().mockResolvedValue({ id: "execution-1", amountCents: 100n })
    },
    paymentRequest: {
      findUnique: jest.fn().mockResolvedValue({
        id: "payment-request-1",
        projectId: "project-beneficiary",
        contractId: "contract-1",
        contractVersionId: "contract-version-1",
        paymentTermsVersionId: "terms-version-1",
        sourceType: "settlement",
        status: "paid",
        paymentSubjectType: "our_company",
        requestedAmountCents: 100n,
        approvedAmountCents: 100n,
        paidAmountCents: 100n,
        abandonedAt: null,
        settlementId: "settlement-1"
      })
    },
    fundMovement: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: "movement-1", revision: 1, status: "draft" }),
      findUnique: jest.fn().mockResolvedValue({
        id: "movement-1",
        kind: "cross_project_payment",
        status: "submitted",
        revision: 2,
        paymentExecutionId: "execution-1",
        sourceProjectId: "project-source",
        beneficiaryProjectId: "project-beneficiary",
        sourceCompanyEntityId: "company-source",
        beneficiaryCompanyEntityId: "company-beneficiary",
        paymentAmountCents: 100n,
        projectFundUsedCents: 100n,
        companyAdvanceCents: 0n,
        createdByUserId: "creator-1",
        submittedByUserId: "submitter-1"
      }),
      findUniqueOrThrow: jest.fn().mockResolvedValue({
        id: "movement-1",
        kind: "cross_project_payment",
        status: "submitted",
        revision: 2,
        sourceProjectId: "project-source",
        beneficiaryProjectId: "project-beneficiary",
        sourceCompanyEntityId: "company-source",
        beneficiaryCompanyEntityId: "company-beneficiary",
        paymentAmountCents: 100n,
        projectFundUsedCents: 100n,
        companyAdvanceCents: 0n,
        paymentExecutionId: "execution-1",
        createdByUserId: "creator-1",
        submittedByUserId: "submitter-1",
        confirmedByUserId: null,
        createdAt: new Date("2026-08-29T00:00:00.000Z"),
        submittedAt: new Date("2026-08-29T00:01:00.000Z"),
        confirmedAt: null,
        legs: [],
        relationshipEntries: []
      }),
      update: jest.fn().mockResolvedValue({ id: "movement-1", status: "submitted", revision: 2 }),
      findMany: jest.fn().mockResolvedValue([])
    },
    fundMovementLeg: {
      create: jest.fn().mockImplementation(({ data }: { data: { role: string; projectId: string; companyEntityId: string } }) => {
        legIndex += 1;
        return Promise.resolve({ id: `leg-${legIndex}`, role: data.role, projectId: data.projectId, companyEntityId: data.companyEntityId });
      }),
      update: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue([])
    },
    fundMovementRelationshipEntry: {
      create: jest.fn().mockResolvedValue({ id: "relationship-1" }),
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
      aggregate: jest.fn().mockResolvedValue({ _sum: { amountCents: 0n } }),
      update: jest.fn().mockResolvedValue({})
    },
    project: {
      findUnique: jest.fn().mockResolvedValue({
        isActive: true,
        operatingLedgerEffectiveDate: new Date("2026-01-01T00:00:00.000Z")
      })
    },
    projectAffiliateAssignment: {
      findFirst: jest.fn().mockResolvedValue({
        id: "affiliate-1",
        businessPartyVersionId: "affiliate-version-1",
        affiliateNameSnapshot: "施工企业",
        affiliateCreditCodeSnapshot: "credit-code"
      })
    },
    projectParticipatingCompany: {
      findFirst: jest.fn().mockResolvedValue({ companyEntityId: "company-a" })
    },
    projectFinancingQuota: {
      findMany: jest.fn().mockResolvedValue([])
    },
    user: {
      findUnique: jest.fn().mockResolvedValue({ isActive: true }),
      findMany: jest.fn().mockImplementation(({ where }: { where?: { id?: { in?: string[] } } }) =>
        Promise.resolve((where?.id?.in ?? []).map((id) => ({ id, isActive: true }))))
    },
    userPosition: {
      findMany: jest.fn().mockResolvedValue(positionRows.map(({ positionId }) => ({ positionId })))
    },
    position: {
      findMany: jest.fn().mockResolvedValue(positionRows.map(({ id, key }) => ({ id, key })))
    },
    contract: {
      findUnique: jest.fn().mockResolvedValue({ id: "contract-1", projectId: "project-source", voidedAt: null })
    },
    contractVersion: {
      findUnique: jest.fn().mockResolvedValue({
        id: "contract-version-1",
        contractId: "contract-1",
        status: "effective",
        effectiveAt: new Date("2025-01-01T00:00:00.000Z"),
        endedAt: null,
        signingSubjectType: "our_company",
        companyEntityIdSnapshot: "company-source",
        companyEntityVersionId: "company-source-version-1"
      })
    },
    settlement: {
      findUnique: jest.fn().mockResolvedValue({
        id: "settlement-1",
        projectId: "project-source",
        contractId: "contract-1",
        contractVersionId: "contract-version-1",
        status: "effective",
        payableAmountCents: 100n
      })
    },
    paymentTermsStage: {
      findUnique: jest.fn().mockResolvedValue({ id: "stage-1", paymentTermsVersionId: "terms-version-1" })
    },
    paymentExecutionAllocation: {
      findMany: jest.fn().mockResolvedValue([])
    },
    approvalInstance: {
      findMany: jest.fn().mockResolvedValue([{
        id: "approval-1",
        status: "approved",
        currentNodeIndex: 1,
        frozenNodes: [{ name: "财务", roleKeys: ["finance_director"], approvedRoleKeys: ["finance_director"] }],
        updatedAt: new Date("2026-08-29T00:01:00.000Z")
      }])
    },
    approvalActionLog: {
      findFirst: jest.fn().mockResolvedValue({ actorUserId: "approver-1", approvedRoleKey: "finance_director", representedUserId: null })
    },
    approvalDelegation: {
      findMany: jest.fn().mockResolvedValue([])
    },
    payableSettlementCase: {
      findMany: jest.fn().mockResolvedValue([{
        id: "settlement-case-1",
        paymentExecutionId: "execution-1",
        status: "confirmed",
        revision: 1,
        confirmedByUserId: "case-confirmer",
        confirmedAt: new Date("2026-08-29T00:03:00.000Z")
      }])
    },
    payableSettlementAllocation: {
      findMany: jest.fn().mockResolvedValue([{
        id: "settlement-allocation-1",
        settlementCaseId: "settlement-case-1",
        paymentExecutionId: "execution-1",
        payableRef: "wage-ref-1",
        sourceType: "wage_payable_ref",
        sourceAggregateId: "wage-version-1",
        sourceLineId: "wage-ref-1",
        confirmedVersionId: "wage-version-1",
        debtorCompanyId: "company-beneficiary",
        payeeSubjectType: "employee_user",
        payeeSubjectId: "employee_user:employee-1",
        currencyCode: "CNY",
        beneficiaryProjectId: "project-beneficiary",
        sourceSnapshot: { payableRef: "wage-ref-1" },
        confirmedAmountCents: 100n,
        amountCents: 100n
      }]),
      aggregate: jest.fn().mockResolvedValue({ _sum: { amountCents: 0n } })
    },
    wagePayableRef: {
      findMany: jest.fn().mockResolvedValue([{
        id: "wage-ref-1",
        confirmedVersionId: "wage-version-1",
        projectAllocationId: "wage-project-allocation-1",
        creditorBreakdownId: "wage-creditor-1",
        projectId: "project-beneficiary",
        debtorCompanyId: "company-beneficiary",
        debtorCompanySnapshot: { companyId: "company-beneficiary" },
        projectSnapshot: { projectId: "project-beneficiary" },
        creditorSnapshot: {
          subjectType: "employee_user",
          identityKey: "employee_user:employee-1",
          name: "测试员工"
        },
        amountCents: 100n,
        direction: "increase",
        adjustsPayableRefId: null,
        confirmedVersion: { status: "confirmed" },
        creditorBreakdown: {
          creditorSubjectType: "employee_user",
          creditorUserId: "employee-1",
          creditorBusinessPartyVersionId: null,
          creditorSubjectIdentityKey: "employee_user:employee-1",
          creditorNameSnapshot: "测试员工",
          creditorUnifiedIdentitySnapshot: null,
          creditorVersionFingerprint: "c".repeat(64)
        },
        adjustments: []
      }])
    },
    paymentExecutionWagePayableBinding: {
      findMany: jest.fn().mockResolvedValue([{
        id: "wage-binding-1",
        wagePayableRefId: "wage-ref-1",
        debtorCompanyId: "company-beneficiary",
        debtorCompanySnapshot: { companyId: "company-beneficiary" },
        projectId: "project-beneficiary",
        projectSnapshot: { projectId: "project-beneficiary" },
        creditorSubjectType: "employee_user",
        creditorUserId: "employee-1",
        creditorBusinessPartyVersionId: null,
        creditorSubjectIdentityKey: "employee_user:employee-1",
        creditorNameSnapshot: "测试员工",
        creditorUnifiedIdentitySnapshot: null,
        creditorVersionFingerprint: "c".repeat(64),
        creditorSnapshot: {
          subjectType: "employee_user",
          identityKey: "employee_user:employee-1",
          name: "测试员工"
        },
        currencyCode: "CNY",
        amountCents: 100n
      }])
    },
    interEntityRelationshipEntry: {
      findMany: jest.fn().mockResolvedValue([{
        id: "proxy-relationship-1",
        originalDebtorCompanyId: "company-beneficiary",
        creditorCompanyId: "company-source",
        approvedPayerCompanyId: "company-source",
        amountCents: 100n,
        currencyCode: "CNY",
        projectId: "project-beneficiary",
        contractId: "contract-1",
        contractVersionId: "contract-version-1",
        sourceType: "wage_payable_ref",
        sourceAggregateId: "wage-ref-1",
        sourceAllocationCount: 1,
        sourceAllocationAmountCents: 100n
      }])
    },
    paymentExecutionPayerAttestation: {
      findUnique: jest.fn().mockResolvedValue(null)
    }
  };
  const prisma = {
    $transaction: jest.fn((work: (client: typeof tx) => Promise<unknown>) => work(tx)),
    fundMovement: tx.fundMovement
  };
  const roles = { resolveActiveRoleScopes: jest.fn().mockResolvedValue(roleKeys) };
  const audit = { record: jest.fn().mockResolvedValue({}) };
  const ledger = {
    appendConfirmedSourceInTransaction: jest.fn().mockResolvedValue({ id: "fact-1" })
  };
  const funding = {
    lockFundingContext: jest.fn().mockResolvedValue(undefined),
    assertPersistedProjectFundingLedgerCoverage: jest.fn().mockResolvedValue({
      projectCashSourceAmountCents: 100n,
      allocationSummary: { netUsedBySource: new Map() }
    }),
    allocateExecution: jest.fn().mockResolvedValue(undefined),
    reverseExecution: jest.fn().mockResolvedValue(undefined)
  };
  const service = new FundMovementService(
    prisma as never,
    roles as never,
    audit as never,
    ledger as never,
    funding as never
  );
  return { service, tx, prisma, roles, audit, ledger, funding, receipts };
}

function prepareCrossProjectConfirmation(
  harness: ReturnType<typeof createHarness>,
  options: Readonly<{
    adjustments?: readonly { direction: string; amountCents: bigint }[];
    confirmedSettledAmountCents?: bigint;
    sourcePayerParticipatesInBeneficiaryProject?: boolean;
  }> = {}
) {
  const { tx } = harness;
  const movement = {
    id: "movement-1",
    kind: "cross_project_payment",
    status: "submitted",
    revision: 2,
    paymentExecutionId: "execution-1",
    sourceProjectId: "project-source",
    beneficiaryProjectId: "project-beneficiary",
    sourceCompanyEntityId: "company-source",
    beneficiaryCompanyEntityId: "company-beneficiary",
    paymentAmountCents: 100n,
    projectFundUsedCents: 100n,
    companyAdvanceCents: 0n,
    createdByUserId: "creator-1",
    submittedByUserId: "submitter-1"
  };
  const legs = [
    {
      id: "leg-source",
      movementId: "movement-1",
      legNo: 1,
      role: "source",
      projectId: "project-source",
      companyEntityId: "company-source",
      counterpartyProjectId: "project-beneficiary",
      counterpartyCompanyEntityId: "company-beneficiary",
      direction: "decrease",
      amountCents: 100n,
      projectFundUsedCents: 100n,
      companyAdvanceCents: 0n,
      paymentExecutionId: "execution-1",
      relationshipEntryId: "relationship-1",
      sourceType: "settlement",
      sourceAggregateId: "settlement-1",
      sourceAllocationCount: 1,
      sourceAllocationAmountCents: 100n,
      contractId: "contract-1",
      contractVersionId: "contract-version-1",
      operatingFactId: null,
      sourceSnapshot: {},
      idempotencyKey: "leg-key-source",
      createdByUserId: "creator-1",
      createdAt: new Date("2026-08-29T00:00:00.000Z")
    },
    {
      id: "leg-beneficiary",
      movementId: "movement-1",
      legNo: 2,
      role: "beneficiary",
      projectId: "project-beneficiary",
      companyEntityId: "company-beneficiary",
      counterpartyProjectId: "project-source",
      counterpartyCompanyEntityId: "company-source",
      direction: "increase",
      amountCents: 100n,
      projectFundUsedCents: 0n,
      companyAdvanceCents: 0n,
      paymentExecutionId: "execution-1",
      relationshipEntryId: null,
      sourceType: "settlement",
      sourceAggregateId: "settlement-1",
      sourceAllocationCount: 1,
      sourceAllocationAmountCents: 100n,
      contractId: "contract-1",
      contractVersionId: "contract-version-1",
      operatingFactId: null,
      sourceSnapshot: {},
      idempotencyKey: "leg-key-beneficiary",
      createdByUserId: "creator-1",
      createdAt: new Date("2026-08-29T00:00:00.000Z")
    }
  ];
  const relationship = {
    id: "relationship-1",
    movementId: "movement-1",
    legId: "leg-source",
    entryKind: "project_internal_receivable",
    direction: "increase",
    status: "draft",
    adjustsEntryId: null,
    sourceProjectId: "project-source",
    beneficiaryProjectId: "project-beneficiary",
    debtorCompanyEntityId: "company-beneficiary",
    creditorCompanyEntityId: "company-source",
    amountCents: 100n,
    sourceType: "settlement",
    sourceAggregateId: "settlement-1",
    sourceAllocationCount: 1,
    sourceAllocationAmountCents: 100n,
    contractId: "contract-1",
    contractVersionId: "contract-version-1",
    sourceSnapshot: {},
    idempotencyKey: "relationship-key",
    payloadFingerprint: "a".repeat(64),
    createdByUserId: "creator-1",
    createdAt: new Date("2026-08-29T00:00:00.000Z"),
    confirmedByUserId: null,
    confirmedAt: null
  };

  tx.fundMovement.findUnique.mockReset();
  tx.fundMovement.findUnique.mockResolvedValue(movement);
  tx.fundMovement.findUniqueOrThrow.mockReset();
  tx.fundMovement.findUniqueOrThrow.mockResolvedValue({ ...movement, legs, relationshipEntries: [relationship] });
  tx.fundMovementLeg.findMany.mockReset();
  tx.fundMovementLeg.findMany.mockResolvedValue(legs);
  tx.fundMovementRelationshipEntry.findMany.mockReset();
  tx.fundMovementRelationshipEntry.findMany.mockResolvedValue([relationship]);

  tx.paymentExecution.findUnique.mockReset();
  tx.paymentExecution.findUnique
    .mockResolvedValueOnce({ id: "execution-1", paymentRequestId: "payment-request-1" })
    .mockResolvedValueOnce({
      id: "execution-1",
      amountCents: 100n,
      paymentRequestId: "payment-request-1",
      settlementId: "settlement-1",
      paymentSubjectType: "our_company",
      companyEntityIdSnapshot: "company-source",
      executedByUserId: "bank-operator",
      paidAt: new Date("2026-08-29T00:02:00.000Z"),
      payerAttestationFingerprint: null
    });
  tx.paymentRequest.findUnique.mockReset();
  tx.paymentRequest.findUnique.mockResolvedValue({
    id: "payment-request-1",
    projectId: "project-beneficiary",
    contractId: "contract-1",
    contractVersionId: "contract-version-1",
    paymentTermsVersionId: "terms-version-1",
    sourceType: "settlement",
    status: "paid",
    paymentSubjectType: "our_company",
    approvedAmountCents: 100n,
    paidAmountCents: 100n,
    abandonedAt: null,
    settlementId: "settlement-1"
  });
  tx.contract.findUnique.mockReset();
  tx.contract.findUnique.mockResolvedValue({ id: "contract-1", projectId: "project-beneficiary", voidedAt: null });
  tx.contractVersion.findUnique.mockReset();
  tx.contractVersion.findUnique.mockResolvedValue({
    id: "contract-version-1",
    contractId: "contract-1",
    status: "effective",
    effectiveAt: new Date("2025-01-01T00:00:00.000Z"),
    endedAt: null,
    signingSubjectType: "our_company",
    companyEntityIdSnapshot: "company-source",
    companyEntityVersionId: "company-source-version-1"
  });
  tx.settlement.findUnique.mockReset();
  tx.settlement.findUnique.mockResolvedValue({
    id: "settlement-1",
    projectId: "project-beneficiary",
    contractId: "contract-1",
    contractVersionId: "contract-version-1",
    status: "effective",
    payableAmountCents: 100n
  });
  tx.wagePayableRef.findMany.mockReset();
  tx.wagePayableRef.findMany.mockResolvedValue([{
    id: "wage-ref-1",
    confirmedVersionId: "wage-version-1",
    projectAllocationId: "wage-project-allocation-1",
    creditorBreakdownId: "wage-creditor-1",
    projectId: "project-beneficiary",
    debtorCompanyId: "company-beneficiary",
    debtorCompanySnapshot: { companyId: "company-beneficiary" },
    projectSnapshot: { projectId: "project-beneficiary" },
    creditorSnapshot: { subjectType: "employee_user", identityKey: "employee_user:employee-1", name: "测试员工" },
    amountCents: 100n,
    direction: "increase",
    adjustsPayableRefId: null,
    confirmedVersion: { status: "confirmed" },
    creditorBreakdown: {
      creditorSubjectType: "employee_user",
      creditorUserId: "employee-1",
      creditorBusinessPartyVersionId: null,
      creditorSubjectIdentityKey: "employee_user:employee-1",
      creditorNameSnapshot: "测试员工",
      creditorUnifiedIdentitySnapshot: null,
      creditorVersionFingerprint: "c".repeat(64)
    },
    adjustments: options.adjustments ?? []
  }]);
  tx.payableSettlementAllocation.findMany.mockReset();
  tx.payableSettlementAllocation.findMany.mockResolvedValue([{
    id: "settlement-allocation-1",
    settlementCaseId: "settlement-case-1",
    paymentExecutionId: "execution-1",
    payableRef: "wage-ref-1",
    sourceType: "wage_payable_ref",
    sourceAggregateId: "wage-version-1",
    sourceLineId: "wage-ref-1",
    confirmedVersionId: "wage-version-1",
    debtorCompanyId: "company-beneficiary",
    payeeSubjectType: "employee_user",
    payeeSubjectId: "employee_user:employee-1",
    currencyCode: "CNY",
    beneficiaryProjectId: "project-beneficiary",
    sourceSnapshot: { payableRef: "wage-ref-1" },
    confirmedAmountCents: 100n,
    amountCents: 100n
  }]);
  tx.payableSettlementAllocation.aggregate.mockImplementation(({ where }: { where: { settlementCase?: { status?: string | { in: string[] } } } }) => {
    const status = where.settlementCase?.status;
    if (status === "confirmed") {
      return Promise.resolve({ _sum: { amountCents: options.confirmedSettledAmountCents ?? 0n } });
    }
    return Promise.resolve({ _sum: { amountCents: 0n } });
  });
  tx.paymentExecutionWagePayableBinding.findMany.mockReset();
  tx.paymentExecutionWagePayableBinding.findMany.mockResolvedValue([{
    id: "wage-binding-1",
    wagePayableRefId: "wage-ref-1",
    debtorCompanyId: "company-beneficiary",
    debtorCompanySnapshot: { companyId: "company-beneficiary" },
    projectId: "project-beneficiary",
    projectSnapshot: { projectId: "project-beneficiary" },
    creditorSubjectType: "employee_user",
    creditorUserId: "employee-1",
    creditorBusinessPartyVersionId: null,
    creditorSubjectIdentityKey: "employee_user:employee-1",
    creditorNameSnapshot: "测试员工",
    creditorUnifiedIdentitySnapshot: null,
    creditorVersionFingerprint: "c".repeat(64),
    creditorSnapshot: { subjectType: "employee_user", identityKey: "employee_user:employee-1", name: "测试员工" },
    currencyCode: "CNY",
    amountCents: 100n
  }]);
  tx.interEntityRelationshipEntry.findMany.mockReset();
  tx.interEntityRelationshipEntry.findMany.mockResolvedValue([{
    id: "proxy-relationship-1",
    originalDebtorCompanyId: "company-beneficiary",
    creditorCompanyId: "company-source",
    approvedPayerCompanyId: "company-source",
    amountCents: 100n,
    currencyCode: "CNY",
    projectId: "project-beneficiary",
    contractId: "contract-1",
    contractVersionId: "contract-version-1",
    sourceType: "wage_payable_ref",
    sourceAggregateId: "wage-ref-1",
    sourceAllocationCount: 1,
    sourceAllocationAmountCents: 100n
  }]);
  tx.payableSettlementCase.findMany.mockReset();
  tx.payableSettlementCase.findMany.mockResolvedValue([{
    id: "settlement-case-1",
    paymentExecutionId: "execution-1",
    status: "confirmed",
    revision: 1,
    confirmedByUserId: "case-confirmer",
    confirmedAt: new Date("2026-08-29T00:03:00.000Z")
  }]);
  tx.projectParticipatingCompany.findFirst.mockImplementation(({ where }: { where: { projectId: string; companyEntityId: string } }) => {
    if (where.projectId === "project-source" && where.companyEntityId === "company-source") {
      return Promise.resolve({ companyEntityId: "company-source" });
    }
    if (where.projectId === "project-beneficiary" && where.companyEntityId === "company-beneficiary") {
      return Promise.resolve({ companyEntityId: "company-beneficiary" });
    }
    if (options.sourcePayerParticipatesInBeneficiaryProject &&
      where.projectId === "project-beneficiary" && where.companyEntityId === "company-source") {
      return Promise.resolve({ companyEntityId: "company-source" });
    }
    return Promise.resolve(null);
  });
}

describe("FundMovementService", () => {
  const previousWriteSecret = process.env.OPERATING_LEDGER_DB_WRITE_SECRET;

  beforeAll(() => {
    process.env.OPERATING_LEDGER_DB_WRITE_SECRET = "unit-test-fund-movement-secret";
  });

  afterAll(() => {
    if (previousWriteSecret === undefined) {
      delete process.env.OPERATING_LEDGER_DB_WRITE_SECRET;
    } else {
      process.env.OPERATING_LEDGER_DB_WRITE_SECRET = previousWriteSecret;
    }
  });

  it("rejects project-scoped and super-admin roles before any write", async () => {
    for (const roleKeys of [["project_finance"], ["super_admin", "finance_staff"]]) {
      const { service, prisma } = createHarness(roleKeys);
      await expect(service.create("actor-1", crossProjectInput())).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    }
  });

  it("binds payment source authority to the beneficiary project, not the funding project", async () => {
    const { service, tx } = createHarness();
    tx.paymentExecution.findUnique
      .mockResolvedValueOnce({ id: "execution-1", paymentRequestId: "payment-request-1" })
      .mockResolvedValueOnce({
        id: "execution-1",
        amountCents: 100n,
        paymentRequestId: "payment-request-1",
        settlementId: "settlement-1",
        paymentSubjectType: "our_company",
        companyEntityIdSnapshot: "company-source",
        executedByUserId: "bank-operator",
        paidAt: new Date("2026-08-29T00:02:00.000Z"),
        payerAttestationFingerprint: null
      });
    tx.contract.findUnique.mockResolvedValueOnce({
      id: "contract-1",
      projectId: "project-beneficiary",
      voidedAt: null
    });
    tx.settlement.findUnique.mockResolvedValueOnce({
      id: "settlement-1",
      projectId: "project-beneficiary",
      contractId: "contract-1",
      contractVersionId: "contract-version-1",
      status: "effective",
      payableAmountCents: 100n
    });

    const context = await (service as unknown as {
      lockAndValidatePaymentExecution: (transaction: unknown, movement: unknown, actorUserId: string) => Promise<{
        request: { projectId: string };
        source: { sourceSnapshot: { projectId: string } };
      }>;
    }).lockAndValidatePaymentExecution(tx, {
      id: "movement-1",
      kind: "cross_project_payment",
      status: "submitted",
      revision: 2,
      paymentExecutionId: "execution-1",
      sourceProjectId: "project-source",
      beneficiaryProjectId: "project-beneficiary",
      sourceCompanyEntityId: "company-source",
      beneficiaryCompanyEntityId: "company-beneficiary",
      paymentAmountCents: 100n,
      projectFundUsedCents: 100n,
      companyAdvanceCents: 0n,
      createdByUserId: "creator-1",
      submittedByUserId: "submitter-1"
    }, "confirmer-1");

    expect(context.request.projectId).toBe("project-beneficiary");
    expect(context.source.sourceSnapshot.projectId).toBe("project-beneficiary");
  });

  it("keeps profit execution fail-closed while #109 has no server authority", async () => {
    const { service, prisma } = createHarness();
    await expect(service.create("actor-1", {
      ...crossProjectInput(),
      kind: "profit_distribution_execution",
      paymentExecutionId: undefined,
      sourceProjectId: "project-1",
      beneficiaryProjectId: "project-1",
      sourceCompanyEntityId: "company-1",
      beneficiaryCompanyEntityId: "company-1",
      profitAuthorizationId: "client-supplied-109",
      legs: [
        { ...crossProjectInput().legs[0], projectId: "project-1", companyEntityId: "company-1" },
        { ...crossProjectInput().legs[1], projectId: "project-1", companyEntityId: "company-1", direction: "increase" }
      ]
    })).rejects.toThrow("#109");
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("creates one draft movement with two stable legs and one relationship atomically", async () => {
    const { service, tx, audit } = createHarness();
    await expect(service.create("actor-1", crossProjectInput())).resolves.toEqual({
      movementId: "movement-1",
      status: "draft",
      revision: 1
    });
    expect(tx.fundMovement.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "draft", paymentExecutionId: "execution-1" })
    }));
    expect(tx.fundMovementLeg.create).toHaveBeenCalledTimes(2);
    expect(tx.fundMovementRelationshipEntry.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        entryKind: "project_internal_receivable",
        direction: "increase",
        sourceType: "payable",
        sourceAllocationAmountCents: 100n,
        contractVersionId: "contract-version-1"
      })
    }));
    expect(tx.fundMovementLeg.update).toHaveBeenCalledWith({
      where: { id: "leg-1" },
      data: { relationshipEntryId: "relationship-1" }
    });
    expect(audit.record).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: "fund_movement.create" }));
  });

  it("rejects a company advance that is labelled as project-funded", async () => {
    const { service, prisma } = createHarness();
    await expect(service.create("actor-1", {
      ...crossProjectInput(),
      kind: "company_advance",
      paymentExecutionId: undefined,
      sourceProjectId: "project-source",
      beneficiaryProjectId: "project-source",
      sourceCompanyEntityId: "company-source",
      beneficiaryCompanyEntityId: "company-beneficiary",
      projectFundUsedCents: 100n,
      companyAdvanceCents: 0n,
      legs: crossProjectInput().legs.map((leg, index) => ({
        ...leg,
        projectId: "project-source",
        direction: index === 0 ? "decrease" : "increase"
      }))
    })).rejects.toThrow("公司垫资必须全部由公司垫资组成");
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("replays the exact create receipt and conflicts on a changed payload", async () => {
    const { service, tx } = createHarness();
    const input = crossProjectInput();
    await service.create("actor-1", input);
    await expect(service.create("actor-1", input)).resolves.toEqual({
      movementId: "movement-1",
      status: "draft",
      revision: 1
    });
    expect(tx.fundMovement.create).toHaveBeenCalledTimes(1);
    await expect(service.create("actor-1", {
      ...input,
      paymentAmountCents: 200n,
      projectFundUsedCents: 200n,
      companyAdvanceCents: 0n,
      legs: input.legs.map((leg) => ({ ...leg, amountCents: 200n, sourceAllocationAmountCents: 200n }))
    })).rejects.toBeInstanceOf(ConflictException);
  });

  it("enforces submit SoD before changing lifecycle", async () => {
    const { service, tx } = createHarness();
    tx.fundMovement.findUniqueOrThrow.mockResolvedValueOnce({
      id: "movement-1",
      status: "draft",
      revision: 1,
      createdByUserId: "actor-1",
      createdAt: new Date("2026-08-29T00:00:00.000Z")
    });
    await expect(service.submit("actor-1", {
      movementId: "movement-1",
      expectedRevision: 1,
      idempotencyKey: SUBMIT_KEY
    })).rejects.toBeInstanceOf(ForbiddenException);
    expect(tx.fundMovement.update).not.toHaveBeenCalled();
  });

  it("enforces submit SoD across an active delegation edge", async () => {
    const { service, tx } = createHarness();
    tx.fundMovement.findUniqueOrThrow.mockResolvedValueOnce({
      id: "movement-1",
      status: "draft",
      revision: 1,
      createdByUserId: "creator-1",
      createdAt: new Date("2026-08-29T00:00:00.000Z")
    });
    tx.approvalDelegation.findMany.mockResolvedValueOnce([
      { fromUserId: "creator-1", toUserId: "actor-1" }
    ]);
    await expect(service.submit("actor-1", {
      movementId: "movement-1",
      expectedRevision: 1,
      idempotencyKey: "66666666-6666-4666-8666-666666666666"
    })).rejects.toBeInstanceOf(ForbiddenException);
    expect(tx.fundMovement.update).not.toHaveBeenCalled();
  });

  it("does not allow the creator or submitter to confirm", async () => {
    const { service, tx, ledger } = createHarness(["finance_director"]);
    tx.fundMovement.findUniqueOrThrow.mockResolvedValueOnce({
      id: "movement-1",
      kind: "same_project_company_transfer",
      status: "submitted",
      revision: 2,
      sourceProjectId: "project-source",
      beneficiaryProjectId: "project-source",
      sourceCompanyEntityId: "company-source",
      beneficiaryCompanyEntityId: "company-beneficiary",
      paymentAmountCents: 100n,
      projectFundUsedCents: 100n,
      companyAdvanceCents: 0n,
      paymentExecutionId: null,
      createdByUserId: "creator-1",
      submittedByUserId: "actor-1",
      createdAt: new Date("2026-08-29T00:00:00.000Z"),
      submittedAt: new Date("2026-08-29T00:01:00.000Z"),
      confirmedAt: null,
      legs: [],
      relationshipEntries: []
    });
    tx.fundMovement.findUnique.mockResolvedValueOnce({
      id: "movement-1",
      kind: "same_project_company_transfer",
      status: "submitted",
      revision: 2,
      paymentExecutionId: null,
      sourceProjectId: "project-source",
      beneficiaryProjectId: "project-source",
      sourceCompanyEntityId: "company-source",
      beneficiaryCompanyEntityId: "company-beneficiary",
      paymentAmountCents: 100n,
      projectFundUsedCents: 100n,
      companyAdvanceCents: 0n,
      createdByUserId: "creator-1",
      submittedByUserId: "actor-1"
    });
    await expect(service.confirm("actor-1", {
      movementId: "movement-1",
      expectedRevision: 2,
      idempotencyKey: CONFIRM_KEY
    })).rejects.toBeInstanceOf(ForbiddenException);
    expect(ledger.appendConfirmedSourceInTransaction).not.toHaveBeenCalled();
  });

  it("enforces confirmation SoD across an active delegation edge", async () => {
    const { service, tx, ledger } = createHarness(["finance_director"]);
    tx.fundMovement.findUniqueOrThrow.mockResolvedValueOnce({
      id: "movement-1",
      kind: "same_project_company_transfer",
      status: "submitted",
      revision: 2,
      sourceProjectId: "project-source",
      beneficiaryProjectId: "project-source",
      sourceCompanyEntityId: "company-source",
      beneficiaryCompanyEntityId: "company-beneficiary",
      paymentAmountCents: 100n,
      projectFundUsedCents: 100n,
      companyAdvanceCents: 0n,
      paymentExecutionId: null,
      createdByUserId: "creator-1",
      submittedByUserId: "submitter-1",
      createdAt: new Date("2026-08-29T00:00:00.000Z"),
      submittedAt: new Date("2026-08-29T00:01:00.000Z"),
      confirmedAt: null,
      legs: [],
      relationshipEntries: []
    });
    tx.fundMovement.findUnique.mockResolvedValueOnce({
      id: "movement-1",
      kind: "same_project_company_transfer",
      status: "submitted",
      revision: 2,
      paymentExecutionId: null,
      sourceProjectId: "project-source",
      beneficiaryProjectId: "project-source",
      sourceCompanyEntityId: "company-source",
      beneficiaryCompanyEntityId: "company-beneficiary",
      paymentAmountCents: 100n,
      projectFundUsedCents: 100n,
      companyAdvanceCents: 0n,
      createdByUserId: "creator-1",
      submittedByUserId: "submitter-1"
    });
    tx.approvalDelegation.findMany.mockResolvedValueOnce([
      { fromUserId: "creator-1", toUserId: "confirmer-1" }
    ]);
    await expect(service.confirm("confirmer-1", {
      movementId: "movement-1",
      expectedRevision: 2,
      idempotencyKey: "77777777-7777-4777-8777-777777777777"
    })).rejects.toBeInstanceOf(ForbiddenException);
    expect(ledger.appendConfirmedSourceInTransaction).not.toHaveBeenCalled();
  });

  it("enforces confirmation SoD for the represented approval identity", async () => {
    const harness = createHarness(["finance_director"]);
    prepareCrossProjectConfirmation(harness, { sourcePayerParticipatesInBeneficiaryProject: true });
    harness.tx.approvalActionLog.findFirst.mockResolvedValueOnce({
      actorUserId: "approval-agent-1",
      representedUserId: "confirmer-1",
      approvedRoleKey: "finance_director"
    });

    await expect(harness.service.confirm("confirmer-1", {
      movementId: "movement-1",
      expectedRevision: 2,
      idempotencyKey: "88888888-8888-4888-8888-888888888888"
    })).rejects.toBeInstanceOf(ForbiddenException);
    expect(harness.tx.fundMovement.update).not.toHaveBeenCalled();
    expect(harness.ledger.appendConfirmedSourceInTransaction).not.toHaveBeenCalled();
  });

  it("fails closed when the approval represented identity is blank", async () => {
    const harness = createHarness(["finance_director"]);
    prepareCrossProjectConfirmation(harness, { sourcePayerParticipatesInBeneficiaryProject: true });
    harness.tx.approvalActionLog.findFirst.mockResolvedValueOnce({
      actorUserId: "approval-agent-1",
      representedUserId: "   ",
      approvedRoleKey: "finance_director"
    });

    await expect(harness.service.confirm("confirmer-1", {
      movementId: "movement-1",
      expectedRevision: 2,
      idempotencyKey: "99999999-9999-4999-8999-999999999999"
    })).rejects.toBeInstanceOf(ConflictException);
    expect(harness.tx.fundMovement.update).not.toHaveBeenCalled();
    expect(harness.ledger.appendConfirmedSourceInTransaction).not.toHaveBeenCalled();
  });

  it.each([
    ["actorUserId", { actorUserId: "   ", approvedRoleKey: "finance_director" }],
    ["approvedRoleKey", { actorUserId: "approval-agent-1", approvedRoleKey: "   " }]
  ])("fails closed when approval %s is blank", async (_field, action) => {
    const harness = createHarness(["finance_director"]);
    prepareCrossProjectConfirmation(harness, { sourcePayerParticipatesInBeneficiaryProject: true });
    harness.tx.approvalActionLog.findFirst.mockResolvedValueOnce({
      ...action,
      representedUserId: null
    });

    await expect(harness.service.confirm("confirmer-1", {
      movementId: "movement-1",
      expectedRevision: 2,
      idempotencyKey: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
    })).rejects.toBeInstanceOf(ConflictException);
    expect(harness.tx.fundMovement.update).not.toHaveBeenCalled();
    expect(harness.ledger.appendConfirmedSourceInTransaction).not.toHaveBeenCalled();
  });

  it("increments the aggregate revision only after a complete confirmation", async () => {
    const { service, tx, ledger, funding } = createHarness(["finance_director"]);
    tx.fundMovement.findUniqueOrThrow.mockResolvedValueOnce({
      id: "movement-1",
      kind: "same_project_company_transfer",
      status: "submitted",
      revision: 2,
      sourceProjectId: "project-source",
      beneficiaryProjectId: "project-source",
      sourceCompanyEntityId: "company-a",
      beneficiaryCompanyEntityId: "company-b",
      paymentAmountCents: 100n,
      projectFundUsedCents: 100n,
      companyAdvanceCents: 0n,
      paymentExecutionId: null,
      createdByUserId: "creator-1",
      submittedByUserId: "submitter-1",
      confirmedByUserId: null,
      createdAt: new Date("2026-08-29T00:00:00.000Z"),
      submittedAt: new Date("2026-08-29T00:01:00.000Z"),
      confirmedAt: null,
      legs: [],
      relationshipEntries: []
    });
    tx.fundMovement.findUnique.mockResolvedValueOnce({
      id: "movement-1",
      kind: "same_project_company_transfer",
      status: "submitted",
      revision: 2,
      paymentExecutionId: null,
      sourceProjectId: "project-source",
      beneficiaryProjectId: "project-source",
      sourceCompanyEntityId: "company-a",
      beneficiaryCompanyEntityId: "company-b",
      paymentAmountCents: 100n,
      projectFundUsedCents: 100n,
      companyAdvanceCents: 0n,
      createdByUserId: "creator-1",
      submittedByUserId: "submitter-1"
    });
    tx.fundMovementLeg.findMany.mockResolvedValueOnce([
      {
        id: "leg-source",
        movementId: "movement-1",
        legNo: 1,
        role: "source",
        projectId: "project-source",
        companyEntityId: "company-a",
        counterpartyProjectId: "project-source",
        counterpartyCompanyEntityId: "company-b",
        direction: "decrease",
        amountCents: 100n,
        projectFundUsedCents: 100n,
        companyAdvanceCents: 0n,
        paymentExecutionId: null,
        relationshipEntryId: null,
        sourceType: null,
        sourceAggregateId: null,
        sourceAllocationCount: null,
        sourceAllocationAmountCents: null,
        contractId: null,
        contractVersionId: null,
        operatingFactId: null,
        sourceSnapshot: {},
        idempotencyKey: "leg-key-source",
        createdByUserId: "creator-1",
        createdAt: new Date("2026-08-29T00:00:00.000Z")
      },
      {
        id: "leg-beneficiary",
        movementId: "movement-1",
        legNo: 2,
        role: "beneficiary",
        projectId: "project-source",
        companyEntityId: "company-b",
        counterpartyProjectId: "project-source",
        counterpartyCompanyEntityId: "company-a",
        direction: "increase",
        amountCents: 100n,
        projectFundUsedCents: 0n,
        companyAdvanceCents: 0n,
        paymentExecutionId: null,
        relationshipEntryId: null,
        sourceType: null,
        sourceAggregateId: null,
        sourceAllocationCount: null,
        sourceAllocationAmountCents: null,
        contractId: null,
        contractVersionId: null,
        operatingFactId: null,
        sourceSnapshot: {},
        idempotencyKey: "leg-key-beneficiary",
        createdByUserId: "creator-1",
        createdAt: new Date("2026-08-29T00:00:00.000Z")
      }
    ]);
    tx.projectParticipatingCompany.findFirst.mockImplementation(({ where }: { where: { companyEntityId: string } }) =>
      Promise.resolve({ companyEntityId: where.companyEntityId })
    );
    tx.fundMovement.update.mockResolvedValueOnce({ id: "movement-1", status: "confirmed", revision: 3 });

    await expect(service.confirm("confirmer-1", {
      movementId: "movement-1",
      expectedRevision: 2,
      idempotencyKey: CONFIRM_KEY
    })).resolves.toEqual({ movementId: "movement-1", status: "confirmed", revision: 3 });
    expect(funding.lockFundingContext).toHaveBeenCalledWith(tx, "project-source");
    expect(funding.assertPersistedProjectFundingLedgerCoverage).toHaveBeenCalledWith(tx, "project-source");
    expect(ledger.appendConfirmedSourceInTransaction).toHaveBeenCalledTimes(2);
    const factInputs = ledger.appendConfirmedSourceInTransaction.mock.calls.map(([, input]) => input as {
      impacts: Array<{ sourceImpactKey: string; direction: string; amountCents: bigint }>;
    });
    expect(factInputs[0].impacts).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceImpactKey: "project_funds", direction: "decrease", amountCents: 100n })
    ]));
    expect(factInputs[1].impacts).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceImpactKey: "project_funds", direction: "increase", amountCents: 100n })
    ]));
    expect(tx.fundMovement.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ revision: { increment: 1 }, status: "confirmed" })
    }));
  });

  it("fails closed when the canonical payer or payee cannot be represented in a leg project", async () => {
    const harness = createHarness(["finance_director"]);
    prepareCrossProjectConfirmation(harness);

    await expect(harness.service.confirm("confirmer-1", {
      movementId: "movement-1",
      expectedRevision: 2,
      idempotencyKey: "44444444-4444-4444-8444-444444444444"
    })).rejects.toThrow("受益付款主体无法在项目事实范围表达");
    expect(harness.tx.fundMovement.update).not.toHaveBeenCalled();
    expect(harness.ledger.appendConfirmedSourceInTransaction).not.toHaveBeenCalled();
  });

  it("rejects a confirmed wage settlement after an effective payable decrease", async () => {
    const harness = createHarness(["finance_director"]);
    prepareCrossProjectConfirmation(harness, {
      adjustments: [{ direction: "decrease", amountCents: 60n }],
      confirmedSettledAmountCents: 100n,
      sourcePayerParticipatesInBeneficiaryProject: true
    });

    await expect(harness.service.confirm("confirmer-1", {
      movementId: "movement-1",
      expectedRevision: 2,
      idempotencyKey: "55555555-5555-4555-8555-555555555555"
    })).rejects.toThrow("超额核销");
    expect(harness.tx.fundMovement.update).not.toHaveBeenCalled();
    expect(harness.ledger.appendConfirmedSourceInTransaction).not.toHaveBeenCalled();
  });
});
