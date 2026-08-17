import { BadRequestException } from "@nestjs/common";

import { PaymentExecutionOperatingSourceAdapter } from "./payment-operating-source.adapter";

describe("PaymentExecutionOperatingSourceAdapter", () => {
  it("maps a partial multi-settlement payment to payable and company funds decreases without cost", async () => {
    const adapter = new PaymentExecutionOperatingSourceAdapter();
    const tx = paymentTx();
    const snapshot = await adapter.readSourceSnapshot(tx as never, {
      projectId: "project-1",
      sourceType: adapter.sourceType,
      sourceBusinessId: "execution-1"
    });

    const { entryKind, input } = adapter.toOperatingFactInput(snapshot!);
    expect(entryKind).toBe("original");
    expect(input).toEqual(
      expect.objectContaining({
        sourceType: "payment_execution",
        sourceBusinessId: "execution-1",
        factKind: "downstream_payment",
        amountCents: 600_00n,
        subjects: {
          debtor: { kind: "participating_company", id: "company-entity-1" },
          approvedPayer: {
            kind: "participating_company",
            id: "company-entity-1"
          },
          actualPayer: {
            kind: "participating_company",
            id: "company-entity-1"
          },
          payee: {
            kind: "downstream_counterparty",
            id: "counterparty-version-1"
          }
        }
      })
    );
    expect(input.impacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceImpactKey: "payable:settlement-1",
          impactKind: "payable_decrease",
          amountCents: 250_00n
        }),
        expect.objectContaining({
          sourceImpactKey: "payable:settlement-2",
          impactKind: "payable_decrease",
          amountCents: 350_00n
        }),
        expect.objectContaining({
          sourceImpactKey: "company_project_funds_decrease",
          impactKind: "company_project_funds_decrease",
          amountCents: 600_00n
        })
      ])
    );
    expect(input.impacts.some((impact) => impact.impactKind === "confirmed_cost"))
      .toBe(false);
    expect(
      input.impacts.some((impact) => impact.sourceImpactKey.includes("advance"))
    ).toBe(false);
    expect(
      input.impacts.some(
        (impact) => impact.sourceImpactKey === "inter_subject_proxy_payment"
      )
    ).toBe(false);
    expect(input.operatingLevel).toBe("project");
  });

  it("preserves different approved and actual payers and forms one inter-subject balance", async () => {
    const adapter = new PaymentExecutionOperatingSourceAdapter();
    const tx = paymentTx({ companyEntityIdSnapshot: "proxy-company-entity" });
    const snapshot = await adapter.readSourceSnapshot(tx as never, {
      projectId: "project-1",
      sourceType: adapter.sourceType,
      sourceBusinessId: "execution-1"
    });
    const { entryKind, input } = adapter.toOperatingFactInput(snapshot!);
    expect(entryKind).toBe("original");

    expect(input.subjects.approvedPayer?.id).toBe("company-entity-1");
    expect(input.subjects.actualPayer?.id).toBe("proxy-company-entity");
    expect(input.impacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceImpactKey: "inter_subject_proxy_payment",
          impactKind: "inter_subject_balance_increase",
          amountCents: 600_00n
        })
      ])
    );
  });

  it("fails closed when formal executions exceed the approved amount", async () => {
    const adapter = new PaymentExecutionOperatingSourceAdapter();
    const tx = paymentTx();
    (tx.paymentExecution.aggregate as jest.Mock).mockResolvedValue({
      _sum: { amountCents: 1_000_01n }
    });

    await expect(
      adapter.readSourceSnapshot(tx as never, {
        projectId: "project-1",
        sourceType: adapter.sourceType,
        sourceBusinessId: "execution-1"
      })
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

function paymentTx(executionOverrides: Record<string, unknown> = {}) {
  const execution = {
    id: "execution-1",
    idempotencyKey: "e92b167a-d07b-4c10-9878-c9602ee7ccab",
    paymentRequestId: "payment-request-1",
    settlementId: null,
    paymentSubjectType: "our_company",
    companyEntityIdSnapshot: "company-entity-1",
    companyEntityNameSnapshot: "我方公司甲",
    companyEntityCreditCodeSnapshot: "91310000000000001X",
    amountCents: 600_00n,
    paidAt: new Date("2026-08-14T00:00:00.000Z"),
    executedByUserId: "finance-user-1",
    voucherFileId: "voucher-1",
    createdAt: new Date("2026-08-14T01:00:00.000Z"),
    ...executionOverrides
  };
  return {
    project: {
      findUnique: jest.fn().mockResolvedValue({
        operatingLedgerEffectiveDate: new Date("2026-08-01T00:00:00.000Z")
      })
    },
    projectAffiliateAssignment: {
      findFirst: jest.fn().mockResolvedValue({
        id: "affiliate-assignment-1",
        businessPartyVersionId: "affiliate-version-1",
        affiliateNameSnapshot: "施工企业甲",
        affiliateCreditCodeSnapshot: "91310000000000000X"
      })
    },
    paymentExecution: {
      findUnique: jest.fn().mockResolvedValue(execution),
      findMany: jest.fn().mockResolvedValue([execution]),
      aggregate: jest.fn().mockResolvedValue({ _sum: { amountCents: 600_00n } })
    },
    paymentRequest: {
      findUnique: jest.fn().mockResolvedValue({
        id: "payment-request-1",
        projectId: "project-1",
        contractId: "contract-1",
        contractVersionId: "contract-version-1",
        code: "PAY-202608-001",
        sourceType: "contract_due",
        settlementId: null,
        paymentSubjectType: "our_company",
        requestedAmountCents: 1_000_00n,
        approvedAmountCents: 1_000_00n
      }),
      findMany: jest.fn().mockResolvedValue([{ id: "payment-request-1" }])
    },
    contractVersion: {
      findUnique: jest.fn().mockResolvedValue({
        signingSubjectType: "our_company",
        companyEntityIdSnapshot: "company-entity-1",
        companyEntityVersionId: "company-version-1",
        affiliateAssignmentId: "affiliate-assignment-1",
        affiliateBusinessPartyVersionId: "affiliate-version-1"
      })
    },
    contractPartySnapshot: {
      findFirst: jest.fn().mockResolvedValue({
        businessPartyVersionId: "counterparty-version-1",
        snapshot: { name: "供应商乙" }
      })
    },
    paymentExecutionAllocation: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: "allocation-1",
          allocationType: "contract_due_payment",
          sourceRowId: "settlement-1",
          settlementId: "settlement-1",
          amountCents: 250_00n,
          allocationOrder: 1
        },
        {
          id: "allocation-2",
          allocationType: "advance_deduction",
          sourceRowId: "advance-1",
          settlementId: null,
          amountCents: 100_00n,
          allocationOrder: 1
        },
        {
          id: "allocation-3",
          allocationType: "contract_due_payment",
          sourceRowId: "settlement-2",
          settlementId: "settlement-2",
          amountCents: 350_00n,
          allocationOrder: 2
        }
      ])
    }
  };
}
