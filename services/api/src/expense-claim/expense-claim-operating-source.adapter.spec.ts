import {
  EmployeeProjectLoanEntryOperatingSourceAdapter,
  ExpenseClaimApprovalOperatingSourceAdapter,
  ExpenseClaimPaymentExecutionOperatingSourceAdapter
} from "./expense-claim-operating-source.adapter";
import type { OperatingSourceSnapshot } from "../operating-ledger/operating-source-adapter";

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
});

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
