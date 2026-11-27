import {
  EmployeeProjectLoanEntryOperatingSourceAdapter,
  ExpenseClaimApprovalOperatingSourceAdapter,
  ExpenseClaimPaymentExecutionOperatingSourceAdapter
} from "./expense-claim-operating-source.adapter";
import type { OperatingSourceSnapshot } from "../operating-ledger/operating-source-adapter";

jest.mock("../fund-account/registered-operational-payment", () => ({
  observeRegisteredOperationalPaymentSource: jest.fn().mockResolvedValue(null)
}));

describe("POL-06 expense operating source adapters", () => {
  it("creates cost and employee payable only when reimbursement approval is confirmed", () => {
    const mapped = new ExpenseClaimApprovalOperatingSourceAdapter().toOperatingFactInput(
      snapshot("expense_claim_approval", "claim-1", {
        claimType: "reimbursement",
        companyEntityId: "company-1",
        applicantUserId: "employee-1",
        applicantNameSnapshot: "张三",
        applicantPhoneSnapshot: "13800000001",
        requestedAmountCents: "3000",
        companyPayableAmountCents: "3000",
        approvedAt: "2026-08-15T01:00:00.000Z",
        confirmedAt: "2026-08-15T02:00:00.000Z",
        confirmedByUserId: "general-manager-1",
        reimbursementLines: [
          {
            id: "line-1",
            sortOrder: "1",
            expenseCategory: "现场交通",
            occurredOn: "2026-08-14T00:00:00.000Z",
            purpose: "项目现场交通",
            amountCents: "3000"
          }
        ]
      })
    );

    expect(mapped.entryKind).toBe("original");
    expect(mapped.input.impacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          impactKind: "confirmed_cost",
          amountCents: 3000n,
          costCategoryCode: "project_daily_expense"
        }),
        expect.objectContaining({
          impactKind: "payable_increase",
          amountCents: 3000n,
          subject: { kind: "employee", id: "employee-1" }
        })
      ])
    );
    expect(mapped.input.impacts).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ impactKind: "company_project_funds_decrease" })
      ])
    );
  });

  it("preserves both reimbursement costs while booking the payable amount in whole cents", () => {
    const approved = snapshot("expense_claim_approval", "claim-precision", {
      claimType: "reimbursement",
      companyEntityId: "company-1",
      applicantUserId: "employee-1",
      applicantNameSnapshot: "合成报销人",
      requestedAmountCents: "1",
      requestedAmountYuan: "0.0100",
      companyPayableAmountCents: "1",
      approvedAt: "2026-08-15T01:00:00.000Z",
      confirmedAt: "2026-08-15T02:00:00.000Z",
      confirmedByUserId: "approver",
      reimbursementLines: ["1", "2"].map((sortOrder, index) => ({
        id: "line-" + sortOrder, sortOrder, expenseCategory: "办公费",
        occurredOn: "2026-08-14T00:00:00.000Z", purpose: "验收",
        amountYuan: "0.0050", amountCents: index === 0 ? "1" : "0"
      }))
    });
    const { input } = new ExpenseClaimApprovalOperatingSourceAdapter().toOperatingFactInput(approved);
    expect(input).toMatchObject({ numericProtocolVersion: 2, amountCents: null, amountYuan: "0.0100" });
    expect(input.impacts).toMatchObject([
      { impactKind: "confirmed_cost", amountYuan: "0.0050", amountCents: null },
      { impactKind: "confirmed_cost", amountYuan: "0.0050", amountCents: null },
      { impactKind: "payable_increase", amountYuan: "0.0100", amountCents: null }
    ]);
  });

  it.each([undefined, null, "bearing-company"])("confirms the cost once with the bearing decision %s", companyId => {
    const mapped = new ExpenseClaimApprovalOperatingSourceAdapter().toOperatingFactInput(
      snapshot("expense_claim_approval", "claim-bearing", {
        companyEntityId: "original-company",
        ...(companyId !== undefined ? { costBearingCompanyEntityId: companyId } : {}),
        claimType: "incidental_expense",
        incidentalExpenseCategory: "temporary_service",
        payeeNameSnapshot: "服务方",
        requestedAmountCents: "800",
        companyPayableAmountCents: "800",
        approvedAt: "2026-08-15T03:00:00.000Z",
        confirmedAt: "2026-08-15T03:00:00.000Z",
        confirmedByUserId: "approver"
      })
    );
    const impacts = mapped.input.impacts.filter(impact => impact.impactKind === "confirmed_cost");
    expect(impacts).toHaveLength(1);
    expect(impacts[0].amountCents).toBe(800n);
    const resolved = companyId === undefined ? "original-company" : companyId;
    const expected = resolved === null ? undefined : { kind: "participating_company", id: resolved };
    expect(mapped.input.subjects.costBearingCompany).toEqual(expected);
    expect(impacts[0].subject).toEqual(expected);
    expect(mapped.input.subjects.actualPayer).toBeUndefined();
  });

  it("uses actual expense payment only to clear payable and project funds", () => {
    const mapped = new ExpenseClaimPaymentExecutionOperatingSourceAdapter().toOperatingFactInput(
      snapshot("expense_claim_payment_execution", "payment-1", {
        expenseClaimId: "claim-1",
        claimType: "reimbursement",
        paymentSubjectCompanyEntityId: "company-1",
        applicantUserId: "employee-1",
        applicantNameSnapshot: "张三",
        applicantPhoneSnapshot: "13800000001",
        amountCents: "3000",
        paidAt: "2026-08-15T03:00:00.000Z",
        confirmedAt: "2026-08-15T03:00:00.000Z",
        recordedByUserId: "finance-1",
        voucherFileId: "voucher-1"
      })
    );

    expect(mapped.input.impacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          impactKind: "payable_decrease",
          amountCents: 3000n,
          subject: { kind: "employee", id: "employee-1" }
        }),
        expect.objectContaining({
          impactKind: "company_project_funds_decrease",
          amountCents: 3000n,
          subject: { kind: "participating_company", id: "company-1" }
        })
      ])
    );
    expect(mapped.input.impacts).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ impactKind: "confirmed_cost" })])
    );
  });

  it("clears the payable and public cash once without adding an expense cost", () => {
    const mapped = new ExpenseClaimPaymentExecutionOperatingSourceAdapter().toOperatingFactInput(
      snapshot("expense_claim_payment_execution", "cash-execution", {
        expenseClaimId: "claim-1",
        claimType: "reimbursement",
        registeredFunding: { actualPayerCompanyId: null, actualPayerName: "公共现金" },
        applicantUserId: "employee-1",
        applicantNameSnapshot: "张三",
        applicantPhoneSnapshot: "13800000001",
        amountCents: "3000",
        paidAt: "2026-08-15T03:00:00.000Z",
        confirmedAt: "2026-08-15T03:00:00.000Z",
        recordedByUserId: "cash-keeper",
        voucherFileId: "voucher-1"
      })
    );
    expect(mapped.input.impacts).toMatchObject([
      { impactKind: "payable_decrease", amountCents: 3000n },
      { impactKind: "public_cash_funds_decrease", amountCents: 3000n, subject: { kind: "public_cash", id: "public_cash" } }
    ]);
  });

  it("uses each frozen registered payer without creating a second cost impact", () => {
    const adapter = new ExpenseClaimPaymentExecutionOperatingSourceAdapter();
    for (const [executionId, companyId] of [["payment-1", "company-2"], ["payment-2", "company-3"]]) {
      const mapped = adapter.toOperatingFactInput(snapshot("expense_claim_payment_execution", executionId, {
        expenseClaimId: "claim-1",
        claimType: "reimbursement",
        paymentSubjectCompanyEntityId: "later-claim-payer",
        registeredFunding: { actualPayerCompanyId: companyId },
        applicantUserId: "employee-1",
        applicantNameSnapshot: "张三",
        applicantPhoneSnapshot: "13800000001",
        amountCents: "3000",
        paidAt: "2026-08-15T03:00:00.000Z",
        confirmedAt: "2026-08-15T03:00:00.000Z",
        recordedByUserId: "finance-1",
        voucherFileId: "voucher-1"
      }));
      expect(mapped.input.impacts).toMatchObject([
        { impactKind: "payable_decrease", idempotencyKey: `expense_claim_payment_execution:${executionId}:payable` },
        {
          impactKind: "company_project_funds_decrease",
          idempotencyKey: `expense_claim_payment_execution:${executionId}:funds`,
          subject: { kind: "participating_company", id: companyId }
        }
      ]);
    }
  });

  it("maps only a linked employee repayment reversal as a reversal against its original fact", () => {
    const mapped = new EmployeeProjectLoanEntryOperatingSourceAdapter().toOperatingFactInput(
      snapshot("employee_project_loan_entry", "loan-entry-reversal-1", {
        employeeUserId: "employee-1",
        companyEntityId: "company-1",
        entryType: "reversal",
        amountCents: "3000",
        balanceDeltaCents: "3000",
        sourceRepaymentId: "repayment-1",
        reversalOfEntryId: "loan-entry-repayment-1",
        adjustsFactId: "operating-fact-repayment-1",
        occurredAt: "2026-08-15T04:00:00.000Z",
        confirmedAt: "2026-08-15T04:00:00.000Z",
        confirmedByUserId: "finance-director-1"
      })
    );

    expect(mapped.entryKind).toBe("reversal");
    expect(mapped.input.adjustsFactId).toBe("operating-fact-repayment-1");
    expect(mapped.input.impacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ impactKind: "receivable_decrease", direction: "increase" }),
        expect.objectContaining({
          impactKind: "company_project_funds_increase",
          direction: "decrease",
          subjectRole: "payee"
        })
      ])
    );
  });

  it("reads a repayment reversal only when its original repayment fact is already formal", async () => {
    const adapter = new EmployeeProjectLoanEntryOperatingSourceAdapter();
    const tx = {
      employeeProjectLoanEntry: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce({
            id: "loan-entry-reversal-1",
            loanAccountId: "loan-account-1",
            entryType: "reversal",
            amountCents: 3000n,
            balanceDeltaCents: 3000n,
            sourceExpenseClaimId: null,
            sourceRepaymentId: null,
            reversalOfEntryId: "loan-entry-repayment-1",
            voucherFileId: null,
            paymentMethod: null,
            occurredAt: new Date("2026-08-15T04:00:00.000Z"),
            createdByUserId: "finance-director-1",
            note: "录入更正",
            createdAt: new Date("2026-08-15T04:00:00.000Z")
          })
          .mockResolvedValueOnce({
            id: "loan-entry-repayment-1",
            loanAccountId: "loan-account-1",
            entryType: "repayment",
            sourceRepaymentId: "repayment-1",
            amountCents: 3000n,
            balanceDeltaCents: -3000n
          })
      },
      employeeProjectLoanAccount: {
        findUnique: jest.fn().mockResolvedValue({
          id: "loan-account-1",
          projectId: "project-1",
          userId: "employee-1",
          companyEntityId: "company-1"
        })
      },
      project: {
        findUnique: jest.fn().mockResolvedValue({
          operatingLedgerEffectiveDate: new Date("2026-08-01T00:00:00.000Z")
        })
      },
      projectAffiliateAssignment: {
        findFirst: jest.fn().mockResolvedValue({
          id: "affiliate-assignment-1",
          businessPartyVersionId: "affiliate-version-1",
          affiliateNameSnapshot: "施工企业",
          affiliateCreditCodeSnapshot: null
        })
      },
      operatingFact: { findUnique: jest.fn().mockResolvedValue({ id: "fact-1" }) }
    };

    await expect(
      adapter.readSourceSnapshot(tx as never, {
        projectId: "project-1",
        sourceType: "employee_project_loan_entry",
        sourceBusinessId: "loan-entry-reversal-1"
      })
    ).resolves.toMatchObject({
      sourceSnapshot: expect.objectContaining({
        sourceRepaymentId: "repayment-1",
        adjustsFactId: "fact-1"
      })
    });
  });

  it("does not record a second cost when the expense claim belongs to an actual purchase batch", () => {
    const mapped = new ExpenseClaimApprovalOperatingSourceAdapter().toOperatingFactInput(
      snapshot("expense_claim_approval", "claim-batch-1", {
        claimType: "incidental_expense",
        incidentalExpenseCategory: "procurement_office_supplies",
        actualPurchaseBatchId: "batch-1",
        companyEntityId: "company-1",
        applicantUserId: "buyer-1",
        applicantNameSnapshot: "采购经办",
        applicantPhoneSnapshot: "13800000002",
        payeeNameSnapshot: "合成供应商",
        requestedAmountCents: "300000",
        companyPayableAmountCents: "300000",
        approvedAt: "2026-11-20T01:00:00.000Z",
        confirmedAt: "2026-11-20T02:00:00.000Z",
        confirmedByUserId: "finance-director-1"
      })
    );

    expect(mapped.input.impacts).toEqual([
      expect.objectContaining({
        impactKind: "payable_increase",
        amountCents: 300000n,
        subject: { kind: "downstream_counterparty", id: "downstream_counterparty:合成供应商" }
      })
    ]);
    expect(mapped.input.impacts).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ impactKind: "confirmed_cost" })])
    );
  });
})

function snapshot(
  sourceType: string,
  sourceBusinessId: string,
  sourceSnapshot: Record<string, unknown>
): OperatingSourceSnapshot {
  return {
    projectId: "project-1",
    sourceType,
    sourceBusinessId,
    sourceBusinessCode: sourceBusinessId,
    sourceVersion: 1,
    status: "confirmed",
    sourceSnapshot: {
      formalStatus: "confirmed",
      operatingLedgerEffectiveDate: "2026-08-01T00:00:00.000Z",
      affiliate: {
        assignmentId: "affiliate-assignment-1",
        businessPartyVersionId: "affiliate-version-1",
        name: "施工企业",
        creditCode: null
      },
      ...sourceSnapshot
    } as never
  };
}
