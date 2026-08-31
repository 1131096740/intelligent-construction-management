import { ConflictException } from "@nestjs/common";

import { fundExecutionSelectionRefFingerprint } from "./fund-execution-selection-ref.service";
import {
  PaymentExecutionSharedAllocationService,
  type ClaimedPaymentExecutionInput
} from "./payment-execution-shared-allocation.service";

describe("PaymentExecutionSharedAllocationService", () => {
  const previousWriteSecret = process.env.OPERATING_LEDGER_DB_WRITE_SECRET;
  const occurredAt = new Date("2026-08-30T02:03:04.000Z");
  const payableRef = "00000000-0000-4000-8000-000000000223";
  const observationSelectionRef = "payment-observation-selection-ref";
  const input: ClaimedPaymentExecutionInput = {
    actorUserId: "finance-staff-1",
    auditRequestId: "a1111111-1111-4111-8111-111111111111",
    observationSelectionRef,
    paymentExecutionId: "payment-execution-1",
    paymentRequestId: "payment-request-1",
    projectId: "project-1",
    amountCents: 30_000n,
    occurredAt,
    wagePayableBindings: [{ payableRef, amountCents: 30_000n }]
  };
  const observation = {
    id: "observation-1",
    direction: "outflow",
    amountCents: 30_000n,
    currencyCode: "CNY",
    occurredAt,
    payerVerificationId: "payer-verification-1",
    holderCompanyEntityId: "holder-company-1",
    transactionEvidenceFileId: "transaction-evidence-1",
    transactionEvidenceContentSha256: "a".repeat(64),
    verificationEvidenceFileId: "verification-evidence-1",
    verificationEvidenceContentSha256: "b".repeat(64),
    payloadFingerprint: "c".repeat(64)
  };

  beforeEach(() => {
    process.env.OPERATING_LEDGER_DB_WRITE_SECRET = "payment-shared-allocation-test-secret";
  });

  afterAll(() => {
    if (previousWriteSecret === undefined) {
      delete process.env.OPERATING_LEDGER_DB_WRITE_SECRET;
    } else {
      process.env.OPERATING_LEDGER_DB_WRITE_SECRET = previousWriteSecret;
    }
  });

  function fixture(payableProjectId = "project-1") {
    const options = {
      matchObservationInTransaction: jest.fn().mockResolvedValue({
        observation,
        binding: { observationId: observation.id }
      })
    };
    const projectFunding = {
      allocateExecution: jest.fn().mockResolvedValue({
        kind: "allocated",
        projectCashAmountCents: 30_000n,
        financingQuotaAmountCents: 0n,
        allocations: [
          {
            id: "project-funding-allocation-1",
            sourceType: "project_cash",
            sourceId: null,
            amountCents: 30_000n
          }
        ]
      })
    };
    const operatingLedger = {
      appendConfirmedSourceInTransaction: jest.fn().mockResolvedValue({
        id: "operating-fact-1",
        impactIds: ["operating-impact-1"]
      })
    };
    const tx = {
      $executeRaw: jest.fn().mockResolvedValue(1),
      $queryRaw: jest.fn().mockResolvedValue([{ id: payableRef }]),
      paymentExecution: {
        findUnique: jest.fn().mockResolvedValue({
          id: input.paymentExecutionId,
          paymentRequestId: input.paymentRequestId,
          amountCents: input.amountCents,
          paidAt: input.occurredAt,
          companyEntityIdSnapshot: "debtor-company-1"
        })
      },
      paymentExecutionPayerAttestation: {
        findUnique: jest.fn().mockResolvedValue({
          payerVerificationId: observation.payerVerificationId,
          holderCompanyEntityId: observation.holderCompanyEntityId,
          verificationEvidenceFileId: observation.verificationEvidenceFileId,
          verificationEvidenceContentSha256:
            observation.verificationEvidenceContentSha256,
          proxyAuthorizationReason: "经财务负责人批准代付",
          proxyAuthorizationEvidenceFileId: "authorization-evidence-1",
          proxyAuthorizationEvidenceSha256: "d".repeat(64),
          reauthorizationReference: "approval-action-1",
          reauthorizationApprovalInstanceId: "approval-instance-1",
          reauthorizationApprovalActionLogId: "approval-action-1",
          reauthorizationPaymentRequestId: input.paymentRequestId,
          reauthorizedByUserId: "finance-director-1",
          reauthorizedAt: new Date("2026-08-30T01:00:00.000Z")
        })
      },
      bankTransactionClaim: {
        create: jest.fn().mockResolvedValue({ id: "claim-1" }),
        findUnique: jest.fn()
      },
      payableSettlementCase: {
        create: jest.fn().mockResolvedValue({ id: "settlement-case-1" })
      },
      wagePayableRef: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: payableRef,
            confirmedVersionId: "confirmed-version-1",
            debtorCompanyId: "debtor-company-1",
            projectId: payableProjectId,
            amountCents: 30_000n,
            direction: "increase",
            adjustsPayableRefId: null,
            debtorCompanySnapshot: { companyId: "debtor-company-1" },
            projectSnapshot: { projectId: payableProjectId },
            creditorSnapshot: {
              subjectType: "employee_user",
              identityKey: "employee_user:employee-1",
              name: "测试员工"
            },
            confirmedVersion: { status: "confirmed" },
            creditorBreakdown: {
              creditorSubjectType: "employee_user",
              creditorSubjectIdentityKey: "employee_user:employee-1",
              creditorNameSnapshot: "测试员工"
            },
            adjustments: []
          }
        ])
      },
      projectAffiliateAssignment: {
        findFirst: jest.fn().mockResolvedValue({
          id: "affiliate-assignment-1",
          businessPartyVersionId: "affiliate-version-1",
          affiliateNameSnapshot: "有效施工企业",
          affiliateCreditCodeSnapshot: "91310000AFFILIATE001"
        })
      },
      projectParticipatingCompany: {
        findFirst: jest.fn().mockResolvedValue({ id: "participant-1" })
      },
      companyEntity: {
        findUnique: jest.fn(({ where }: { where: { id: string } }) =>
          Promise.resolve(
            where.id === observation.holderCompanyEntityId
              ? {
                  id: observation.holderCompanyEntityId,
                  name: "实际付款公司",
                  unifiedSocialCreditCode: "91310000HOLDER0001"
                }
              : {
                  id: "debtor-company-1",
                  name: "原债务公司",
                  unifiedSocialCreditCode: "91310000DEBTOR0001"
                }
          )
        )
      },
      project: {
        findUnique: jest.fn().mockResolvedValue({
          operatingLedgerEffectiveDate: new Date("2026-01-01T00:00:00.000Z")
        })
      },
      executionAllocationLine: {
        create: jest.fn().mockResolvedValue({}),
        findMany: jest.fn()
      },
      executionAllocationAxisEffect: {
        create: jest.fn().mockResolvedValue({}),
        findMany: jest.fn()
      },
      payableSettlementAllocation: {
        create: jest.fn().mockResolvedValue({})
      },
      executionAllocationConsequence: {
        create: jest.fn().mockResolvedValue({})
      },
      interEntityRelationshipEntry: {
        create: jest.fn().mockResolvedValue({})
      }
    };
    const service = new PaymentExecutionSharedAllocationService(
      options as never,
      projectFunding as never,
      operatingLedger as never
    );
    return { service, tx, options, projectFunding, operatingLedger };
  }

  it("materializes one claimed PaymentExecution into one shared line and exactly four canonical axes", async () => {
    const { service, tx, projectFunding, operatingLedger } = fixture();

    await expect(service.materializeInTransaction(tx as never, input)).resolves.toEqual({
      allocationLineCount: 1
    });

    expect(tx.$executeRaw).toHaveBeenCalledTimes(4);
    expect(tx.bankTransactionClaim.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        observationId: observation.id,
        selectionRefFingerprint: fundExecutionSelectionRefFingerprint(
          observationSelectionRef
        ),
        targetType: "payment_execution",
        paymentExecutionId: input.paymentExecutionId,
        auditAction: "payment_execution_record",
        auditRequestId: input.auditRequestId
      })
    });
    expect(tx.executionAllocationLine.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        executionType: "payment_execution",
        executionId: input.paymentExecutionId,
        paymentExecutionId: input.paymentExecutionId,
        lineNo: 1,
        direction: "outflow",
        amountCents: 30_000n,
        businessType: "wage_payable_ref",
        businessId: payableRef,
        sourceIdentity: payableRef
      })
    });
    expect(tx.executionAllocationAxisEffect.create).toHaveBeenCalledTimes(4);
    expect(
      tx.executionAllocationAxisEffect.create.mock.calls.map(
        ([call]) => call.data.axis
      )
    ).toEqual(["payable", "project_fund", "relationship", "operating"]);
    expect(
      tx.executionAllocationAxisEffect.create.mock.calls.map(
        ([call]) => [call.data.status, call.data.amountCents]
      )
    ).toEqual([
      ["applied", 30_000n],
      ["applied", 30_000n],
      ["applied", 30_000n],
      ["applied", 30_000n]
    ]);
    expect(tx.payableSettlementAllocation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        paymentExecutionId: input.paymentExecutionId,
        payableRef,
        amountCents: 30_000n,
        direction: "settle"
      })
    });
    expect(projectFunding.allocateExecution).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        executionType: "payment_execution",
        executionId: input.paymentExecutionId,
        businessType: "wage_payable_ref",
        businessId: payableRef,
        amountCents: 30_000n,
        executionAllocationLineId: expect.any(String)
      })
    );
    expect(tx.interEntityRelationshipEntry.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        paymentExecutionId: input.paymentExecutionId,
        originalDebtorCompanyId: "debtor-company-1",
        creditorCompanyId: observation.holderCompanyEntityId,
        amountCents: 30_000n,
        authorizationEvidenceFileId: "authorization-evidence-1",
        authorizationEvidenceContentSha256: "d".repeat(64),
        reauthorizationReference: "approval-action-1",
        reauthorizedByUserId: "finance-director-1"
      })
    });
    expect(operatingLedger.appendConfirmedSourceInTransaction).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        projectId: input.projectId,
        sourceType: "payment_execution",
        paymentExecutionId: input.paymentExecutionId,
        amountCents: 30_000n,
        impacts: [
          expect.objectContaining({
            paymentExecutionId: input.paymentExecutionId,
            amountCents: 30_000n
          })
        ]
      }),
      input.actorUserId
    );
    expect(tx.executionAllocationConsequence.create).toHaveBeenCalledTimes(4);
    expect(tx.wagePayableRef.findMany.mock.invocationCallOrder[0]).toBeLessThan(
      tx.bankTransactionClaim.create.mock.invocationCallOrder[0]
    );
    expect(
      tx.projectParticipatingCompany.findFirst.mock.invocationCallOrder[0]
    ).toBeLessThan(tx.bankTransactionClaim.create.mock.invocationCallOrder[0]);
  });

  it("fails closed before creating a Claim when the formal payable plan is outside the Payment project", async () => {
    const { service, tx } = fixture("another-project");

    await expect(service.materializeInTransaction(tx as never, input)).rejects.toThrow(
      "付款执行关联的应付不属于同一项目或债务主体"
    );

    expect(tx.bankTransactionClaim.create).not.toHaveBeenCalled();
    expect(tx.payableSettlementCase.create).not.toHaveBeenCalled();
    expect(tx.executionAllocationLine.create).not.toHaveBeenCalled();
  });

  it("fails closed before creating a Claim when a cross-company plan lacks frozen reauthorization", async () => {
    const { service, tx } = fixture();
    tx.paymentExecutionPayerAttestation.findUnique.mockResolvedValue({
      payerVerificationId: observation.payerVerificationId,
      holderCompanyEntityId: observation.holderCompanyEntityId,
      verificationEvidenceFileId: observation.verificationEvidenceFileId,
      verificationEvidenceContentSha256:
        observation.verificationEvidenceContentSha256
    });

    await expect(service.materializeInTransaction(tx as never, input)).rejects.toThrow(
      "跨主体付款执行缺少服务端冻结的完整重新授权事实"
    );

    expect(tx.bankTransactionClaim.create).not.toHaveBeenCalled();
    expect(tx.executionAllocationLine.create).not.toHaveBeenCalled();
  });

  it("replays from frozen Claim and four-axis evidence without re-resolving an expired selection", async () => {
    const { service, tx, options } = fixture();
    tx.bankTransactionClaim.findUnique.mockResolvedValue({
      targetType: "payment_execution",
      selectionRefFingerprint: fundExecutionSelectionRefFingerprint(
        observationSelectionRef
      )
    });
    tx.executionAllocationLine.findMany.mockResolvedValue([
      { id: "allocation-line-1", amountCents: 30_000n }
    ]);
    tx.executionAllocationAxisEffect.findMany.mockResolvedValue(
      ["payable", "project_fund", "relationship", "operating"].map((axis) => ({
        axis
      }))
    );

    await expect(service.assertReplayInTransaction(tx as never, input)).resolves.toEqual({
      allocationLineCount: 1
    });
    expect(options.matchObservationInTransaction).not.toHaveBeenCalled();

    await expect(
      service.assertReplayInTransaction(tx as never, {
        ...input,
        observationSelectionRef: "different-selection-ref"
      })
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
