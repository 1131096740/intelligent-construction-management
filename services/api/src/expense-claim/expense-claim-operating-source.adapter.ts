import { BadRequestException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { PrimaryCostCategoryCode } from "@jiangkong/shared-domain";

import {
  frozenAffiliateFromJson,
  occurredBeforeEffectiveDate,
  readAffiliateSnapshot,
  readOperatingLedgerEffectiveDate,
  requiredJsonDate,
  requiredJsonMoney,
  requiredJsonRecord,
  requiredJsonText,
  sourceJson,
  stableNamedSubjectId
} from "../operating-ledger/formal-operating-source.helpers";
import type {
  AppendOperatingFactInput,
  OperatingSubjectReference
} from "../operating-ledger/operating-ledger.service";
import type {
  OperatingSourceAdapter,
  OperatingSourceFactInput,
  OperatingSourceLocator,
  OperatingSourceSnapshot
} from "../operating-ledger/operating-source-adapter";

export const EXPENSE_CLAIM_APPROVAL_SOURCE_TYPE = "expense_claim_approval";
export const EXPENSE_CLAIM_PAYMENT_EXECUTION_SOURCE_TYPE =
  "expense_claim_payment_execution";
export const EMPLOYEE_PROJECT_LOAN_ENTRY_SOURCE_TYPE =
  "employee_project_loan_entry";

const APPROVED_EXPENSE_CLAIM_STATUSES = [
  "approved_pending_payment",
  "partially_paid",
  "paid",
  "offset_completed"
] as const;

const LOAN_ENTRY_TYPES = [
  "disbursement",
  "offset",
  "repayment",
  "reversal"
] as const;

type ExpenseClaimApprovalRow = {
  id: string;
  code: string;
  claimType: string;
  incidentalExpenseCategory: string | null;
  projectId: string | null;
  companyEntityId: string;
  applicantUserId: string | null;
  applicantNameSnapshot: string;
  applicantPhoneSnapshot: string | null;
  payeeNameSnapshot: string | null;
  requestedAmountCents: bigint;
  companyPayableAmountCents: bigint;
  approvedAt: Date | null;
};

type ExpenseClaimPaymentExecutionRow = {
  id: string;
  expenseClaimId: string;
  amountCents: bigint;
  paidAt: Date;
  paymentMethod: string;
  voucherFileId: string;
  recordedByUserId: string;
  note: string | null;
  createdAt: Date;
};

type EmployeeProjectLoanEntryRow = {
  id: string;
  loanAccountId: string;
  entryType: string;
  amountCents: bigint;
  balanceDeltaCents: bigint;
  sourceExpenseClaimId: string | null;
  sourceRepaymentId: string | null;
  reversalOfEntryId: string | null;
  voucherFileId: string | null;
  paymentMethod: string | null;
  occurredAt: Date;
  createdByUserId: string;
  note: string | null;
  createdAt: Date;
};

type EmployeeProjectLoanAccountRow = {
  id: string;
  projectId: string | null;
  userId: string;
  companyEntityId: string;
};

export class ExpenseClaimApprovalOperatingSourceAdapter
  implements OperatingSourceAdapter
{
  readonly sourceType = EXPENSE_CLAIM_APPROVAL_SOURCE_TYPE;

  async readProjectSnapshots(
    tx: Parameters<OperatingSourceAdapter["readProjectSnapshots"]>[0],
    projectId: string
  ): Promise<readonly OperatingSourceSnapshot[]> {
    const rows = await tx.expenseClaim.findMany({
      where: {
        projectId,
        claimType: { in: ["reimbursement", "incidental_expense"] },
        status: { in: [...APPROVED_EXPENSE_CLAIM_STATUSES] },
        approvedAt: { not: null }
      },
      select: expenseClaimApprovalSelect(),
      orderBy: [{ approvedAt: "asc" }, { id: "asc" }]
    });
    return Promise.all(
      rows.map((row) => this.snapshot(tx, row as ExpenseClaimApprovalRow))
    );
  }

  async readSourceSnapshot(
    tx: Parameters<OperatingSourceAdapter["readSourceSnapshot"]>[0],
    locator: OperatingSourceLocator
  ): Promise<OperatingSourceSnapshot | null> {
    const row = await tx.expenseClaim.findUnique({
      where: { id: locator.sourceBusinessId },
      select: expenseClaimApprovalSelect()
    });
    if (
      !row ||
      row.projectId !== locator.projectId ||
      !["reimbursement", "incidental_expense"].includes(row.claimType) ||
      !APPROVED_EXPENSE_CLAIM_STATUSES.includes(
        row.status as (typeof APPROVED_EXPENSE_CLAIM_STATUSES)[number]
      ) ||
      !row.approvedAt
    ) {
      return null;
    }
    return this.snapshot(tx, row as ExpenseClaimApprovalRow);
  }

  toOperatingFactInput(
    snapshot: OperatingSourceSnapshot
  ): OperatingSourceFactInput {
    const source = requiredJsonRecord(snapshot.sourceSnapshot, "费用确认正式来源");
    const affiliate = frozenAffiliateFromJson(source, "费用确认");
    const occurredAt = requiredJsonDate(source, "approvedAt", "费用确认");
    const confirmedAt = requiredJsonDate(source, "confirmedAt", "费用确认");
    const effectiveDate = requiredJsonDate(
      source,
      "operatingLedgerEffectiveDate",
      "费用确认"
    );
    const amountCents = requiredJsonMoney(source, "requestedAmountCents", "费用确认");
    const payableCents = requiredJsonMoney(
      source,
      "companyPayableAmountCents",
      "费用确认"
    );
    if (amountCents <= 0n || payableCents < 0n || payableCents > amountCents) {
      throw new BadRequestException("费用确认金额或待付金额不正确");
    }
    const company: OperatingSubjectReference = {
      kind: "participating_company",
      id: requiredJsonText(source, "companyEntityId", "费用确认")
    };
    const claimType = requiredJsonText(source, "claimType", "费用确认");
    const payee = claimPayee(source, claimType, "费用确认");
    const impacts =
      claimType === "reimbursement"
        ? reimbursementCostImpacts(snapshot, source, company, amountCents)
        : incidentalCostImpacts(snapshot, source, company, amountCents);
    if (payableCents > 0n) {
      impacts.push({
        idempotencyKey: `${snapshot.sourceType}:${snapshot.sourceBusinessId}:payable`,
        sourceImpactKey: "payable_increase",
        impactKind: "payable_increase",
        amountCents: payableCents,
        direction: "increase",
        subjectRole: "payee",
        subject: payee,
        description:
          claimType === "reimbursement"
            ? "费用确认形成员工待补付"
            : "零星费用确认形成下游应付"
      });
    }
    return {
      entryKind: "original",
      input: formalInput({
        snapshot,
        source,
        affiliate,
        occurredAt,
        confirmedAt,
        effectiveDate,
        amountCents,
        confirmedByUserId: requiredJsonText(source, "confirmedByUserId", "费用确认"),
        factKind: "expense",
        direction: "outflow",
        subjects: { costBearingCompany: company },
        impacts,
        basisSnapshot: sourceJson({
          authority: "approved_expense_claim",
          claimType
        })
      })
    };
  }

  private async snapshot(
    tx: Parameters<OperatingSourceAdapter["readSourceSnapshot"]>[0],
    row: ExpenseClaimApprovalRow
  ): Promise<OperatingSourceSnapshot> {
    if (!row.projectId || !row.approvedAt) {
      throw new BadRequestException("费用确认缺少项目或批准时间");
    }
    const [lines, instance, effectiveDate] = await Promise.all([
      tx.expenseClaimLine.findMany({
        where: { expenseClaimId: row.id },
        select: {
          id: true,
          sortOrder: true,
          expenseCategory: true,
          occurredOn: true,
          purpose: true,
          amountCents: true
        },
        orderBy: { sortOrder: "asc" }
      }),
      tx.approvalInstance.findFirst({
        where: {
          businessType: "expense_claim",
          businessId: row.id,
          status: "approved"
        },
        select: { id: true }
      }),
      readOperatingLedgerEffectiveDate(tx, row.projectId)
    ]);
    if (!instance) throw new BadRequestException("费用确认缺少已完成审批实例");
    const [confirmation, affiliate] = await Promise.all([
      tx.approvalActionLog.findFirst({
        where: { approvalInstanceId: instance.id, action: "approve" },
        select: { actorUserId: true, createdAt: true },
        orderBy: { createdAt: "desc" }
      }),
      readAffiliateSnapshot(tx, {
        projectId: row.projectId,
        occurredAt: row.approvedAt
      })
    ]);
    if (!confirmation) throw new BadRequestException("费用确认缺少冻结终审记录");
    if (row.claimType === "reimbursement" && !lines.length) {
      throw new BadRequestException("报销确认缺少费用明细");
    }
    if (
      row.claimType === "incidental_expense" &&
      (!row.incidentalExpenseCategory || !row.payeeNameSnapshot?.trim())
    ) {
      throw new BadRequestException("零星费用确认缺少受控分类或收款对象");
    }
    return {
      projectId: row.projectId,
      sourceType: this.sourceType,
      sourceBusinessId: row.id,
      sourceBusinessCode: row.code,
      sourceVersion: 1,
      status: "confirmed",
      sourceSnapshot: sourceJson({
        formalStatus: "confirmed",
        claimType: row.claimType,
        incidentalExpenseCategory: row.incidentalExpenseCategory,
        companyEntityId: row.companyEntityId,
        applicantUserId: row.applicantUserId,
        applicantNameSnapshot: row.applicantNameSnapshot,
        applicantPhoneSnapshot: row.applicantPhoneSnapshot,
        payeeNameSnapshot: row.payeeNameSnapshot,
        requestedAmountCents: row.requestedAmountCents.toString(),
        companyPayableAmountCents: row.companyPayableAmountCents.toString(),
        approvedAt: row.approvedAt.toISOString(),
        confirmedByUserId: confirmation.actorUserId,
        confirmedAt: confirmation.createdAt.toISOString(),
        reimbursementLines: lines.map((line) => ({
          id: line.id,
          sortOrder: String(line.sortOrder),
          expenseCategory: line.expenseCategory,
          occurredOn: line.occurredOn.toISOString(),
          purpose: line.purpose,
          amountCents: line.amountCents.toString()
        })),
        operatingLedgerEffectiveDate: effectiveDate.toISOString(),
        affiliate
      })
    };
  }
}

export class ExpenseClaimPaymentExecutionOperatingSourceAdapter
  implements OperatingSourceAdapter
{
  readonly sourceType = EXPENSE_CLAIM_PAYMENT_EXECUTION_SOURCE_TYPE;

  async readProjectSnapshots(
    tx: Parameters<OperatingSourceAdapter["readProjectSnapshots"]>[0],
    projectId: string
  ): Promise<readonly OperatingSourceSnapshot[]> {
    const claims = await tx.expenseClaim.findMany({
      where: {
        projectId,
        claimType: { in: ["reimbursement", "incidental_expense"] }
      },
      select: { id: true }
    });
    if (!claims.length) return [];
    const rows = await tx.expenseClaimPaymentExecution.findMany({
      where: { expenseClaimId: { in: claims.map((claim) => claim.id) } },
      orderBy: [{ paidAt: "asc" }, { id: "asc" }]
    });
    return Promise.all(
      rows.map((row) => this.snapshot(tx, row as ExpenseClaimPaymentExecutionRow))
    );
  }

  async readSourceSnapshot(
    tx: Parameters<OperatingSourceAdapter["readSourceSnapshot"]>[0],
    locator: OperatingSourceLocator
  ): Promise<OperatingSourceSnapshot | null> {
    const row = await tx.expenseClaimPaymentExecution.findUnique({
      where: { id: locator.sourceBusinessId }
    });
    if (!row) return null;
    const claim = await tx.expenseClaim.findUnique({
      where: { id: row.expenseClaimId },
      select: expenseClaimPaymentSelect()
    });
    if (
      !claim ||
      claim.projectId !== locator.projectId ||
      !["reimbursement", "incidental_expense"].includes(claim.claimType)
    ) {
      return null;
    }
    return this.snapshot(
      tx,
      row as ExpenseClaimPaymentExecutionRow,
      claim as ExpenseClaimPaymentRow
    );
  }

  toOperatingFactInput(
    snapshot: OperatingSourceSnapshot
  ): OperatingSourceFactInput {
    const source = requiredJsonRecord(snapshot.sourceSnapshot, "费用实际付款正式来源");
    const affiliate = frozenAffiliateFromJson(source, "费用实际付款");
    const occurredAt = requiredJsonDate(source, "paidAt", "费用实际付款");
    const confirmedAt = requiredJsonDate(source, "confirmedAt", "费用实际付款");
    const effectiveDate = requiredJsonDate(
      source,
      "operatingLedgerEffectiveDate",
      "费用实际付款"
    );
    const amountCents = requiredJsonMoney(source, "amountCents", "费用实际付款");
    if (amountCents <= 0n) throw new BadRequestException("费用实际付款金额必须大于 0");
    const payer: OperatingSubjectReference = {
      kind: "participating_company",
      id: requiredJsonText(source, "paymentSubjectCompanyEntityId", "费用实际付款")
    };
    const claimType = requiredJsonText(source, "claimType", "费用实际付款");
    const payee = claimPayee(source, claimType, "费用实际付款");
    return {
      entryKind: "original",
      input: formalInput({
        snapshot,
        source,
        affiliate,
        occurredAt,
        confirmedAt,
        effectiveDate,
        amountCents,
        confirmedByUserId: requiredJsonText(source, "recordedByUserId", "费用实际付款"),
        factKind: "downstream_payment",
        direction: "outflow",
        subjects: { actualPayer: payer, payee },
        impacts: [
          {
            idempotencyKey: `${snapshot.sourceType}:${snapshot.sourceBusinessId}:payable`,
            sourceImpactKey: `payable:${requiredJsonText(source, "expenseClaimId", "费用实际付款")}`,
            impactKind: "payable_decrease",
            amountCents,
            direction: "decrease",
            subjectRole: "payee",
            subject: payee,
            description:
              claimType === "reimbursement"
                ? "实际报销付款清偿员工待补付"
                : "零星费用实际付款清偿下游应付"
          },
          {
            idempotencyKey: `${snapshot.sourceType}:${snapshot.sourceBusinessId}:funds`,
            sourceImpactKey: "company_project_funds_decrease",
            impactKind: "company_project_funds_decrease",
            amountCents,
            direction: "decrease",
            subjectRole: "actual_payer",
            subject: payer,
            description: "费用实际付款减少我方公司项目资金"
          }
        ],
        basisSnapshot: sourceJson({
          authority: "expense_claim_payment_execution",
          voucherFileId: requiredJsonText(source, "voucherFileId", "费用实际付款")
        })
      })
    };
  }

  private async snapshot(
    tx: Parameters<OperatingSourceAdapter["readSourceSnapshot"]>[0],
    row: ExpenseClaimPaymentExecutionRow,
    loadedClaim?: ExpenseClaimPaymentRow
  ): Promise<OperatingSourceSnapshot> {
    const claim =
      loadedClaim ??
      ((await tx.expenseClaim.findUnique({
        where: { id: row.expenseClaimId },
        select: expenseClaimPaymentSelect()
      })) as ExpenseClaimPaymentRow | null);
    if (
      !claim?.projectId ||
      !["reimbursement", "incidental_expense"].includes(claim.claimType)
    ) {
      throw new BadRequestException("费用实际付款缺少可投影的项目费用申请");
    }
    if (!claim.paymentSubjectCompanyEntityId) {
      throw new BadRequestException("费用实际付款缺少冻结付款主体");
    }
    const [effectiveDate, affiliate] = await Promise.all([
      readOperatingLedgerEffectiveDate(tx, claim.projectId),
      readAffiliateSnapshot(tx, {
        projectId: claim.projectId,
        occurredAt: row.paidAt
      })
    ]);
    return {
      projectId: claim.projectId,
      sourceType: this.sourceType,
      sourceBusinessId: row.id,
      sourceBusinessCode: `${claim.code}/实付/${row.id}`,
      sourceVersion: 1,
      status: "confirmed",
      sourceSnapshot: sourceJson({
        formalStatus: "confirmed",
        expenseClaimId: claim.id,
        claimType: claim.claimType,
        paymentSubjectCompanyEntityId: claim.paymentSubjectCompanyEntityId,
        applicantUserId: claim.applicantUserId,
        applicantNameSnapshot: claim.applicantNameSnapshot,
        applicantPhoneSnapshot: claim.applicantPhoneSnapshot,
        payeeNameSnapshot: claim.payeeNameSnapshot,
        amountCents: row.amountCents.toString(),
        paidAt: row.paidAt.toISOString(),
        confirmedAt: row.createdAt.toISOString(),
        paymentMethod: row.paymentMethod,
        voucherFileId: row.voucherFileId,
        recordedByUserId: row.recordedByUserId,
        note: row.note,
        operatingLedgerEffectiveDate: effectiveDate.toISOString(),
        affiliate
      })
    };
  }
}

export class EmployeeProjectLoanEntryOperatingSourceAdapter
  implements OperatingSourceAdapter
{
  readonly sourceType = EMPLOYEE_PROJECT_LOAN_ENTRY_SOURCE_TYPE;

  async readProjectSnapshots(
    tx: Parameters<OperatingSourceAdapter["readProjectSnapshots"]>[0],
    projectId: string
  ): Promise<readonly OperatingSourceSnapshot[]> {
    const accounts = await tx.employeeProjectLoanAccount.findMany({
      where: { projectId },
      select: { id: true, projectId: true, userId: true, companyEntityId: true }
    });
    if (!accounts.length) return [];
    const accountById = new Map(
      accounts.map((account) => [account.id, account as EmployeeProjectLoanAccountRow])
    );
    const rows = await tx.employeeProjectLoanEntry.findMany({
      where: {
        loanAccountId: { in: accounts.map((account) => account.id) },
        entryType: { in: [...LOAN_ENTRY_TYPES] }
      },
      orderBy: [{ occurredAt: "asc" }, { id: "asc" }]
    });
    return Promise.all(
      rows.map((row) => {
        const account = accountById.get(row.loanAccountId);
        if (!account) throw new BadRequestException("员工借款分录缺少借款账户");
        return this.snapshot(tx, row as EmployeeProjectLoanEntryRow, account);
      })
    );
  }

  async readSourceSnapshot(
    tx: Parameters<OperatingSourceAdapter["readSourceSnapshot"]>[0],
    locator: OperatingSourceLocator
  ): Promise<OperatingSourceSnapshot | null> {
    const row = await tx.employeeProjectLoanEntry.findUnique({
      where: { id: locator.sourceBusinessId }
    });
    if (!row || !LOAN_ENTRY_TYPES.includes(row.entryType as (typeof LOAN_ENTRY_TYPES)[number])) {
      return null;
    }
    const account = await tx.employeeProjectLoanAccount.findUnique({
      where: { id: row.loanAccountId },
      select: { id: true, projectId: true, userId: true, companyEntityId: true }
    });
    if (!account || account.projectId !== locator.projectId) return null;
    return this.snapshot(
      tx,
      row as EmployeeProjectLoanEntryRow,
      account as EmployeeProjectLoanAccountRow
    );
  }

  toOperatingFactInput(
    snapshot: OperatingSourceSnapshot
  ): OperatingSourceFactInput {
    const source = requiredJsonRecord(snapshot.sourceSnapshot, "员工借款分录正式来源");
    const affiliate = frozenAffiliateFromJson(source, "员工借款分录");
    const occurredAt = requiredJsonDate(source, "occurredAt", "员工借款分录");
    const confirmedAt = requiredJsonDate(source, "confirmedAt", "员工借款分录");
    const effectiveDate = requiredJsonDate(
      source,
      "operatingLedgerEffectiveDate",
      "员工借款分录"
    );
    const amountCents = requiredJsonMoney(source, "amountCents", "员工借款分录");
    if (amountCents <= 0n) throw new BadRequestException("员工借款分录金额必须大于 0");
    const employee: OperatingSubjectReference = {
      kind: "employee",
      id: requiredJsonText(source, "employeeUserId", "员工借款分录")
    };
    const company: OperatingSubjectReference = {
      kind: "participating_company",
      id: requiredJsonText(source, "companyEntityId", "员工借款分录")
    };
    const entryType = requiredJsonText(source, "entryType", "员工借款分录");
    const base = {
      snapshot,
      source,
      affiliate,
      occurredAt,
      confirmedAt,
      effectiveDate,
      amountCents,
      confirmedByUserId: requiredJsonText(source, "confirmedByUserId", "员工借款分录"),
      factKind: "employee_loan" as const,
      subjects: { debtor: employee, creditor: company },
      basisSnapshot: sourceJson({ authority: "employee_project_loan_entry", entryType })
    };
    if (entryType === "disbursement") {
      assertLoanDelta(source, amountCents, "借款发放");
      return {
        entryKind: "original",
        input: formalInput({
          ...base,
          direction: "outflow",
          subjects: { ...base.subjects, actualPayer: company, payee: employee },
          impacts: [
            receivableImpact(snapshot, company, amountCents, "increase"),
            companyFundsImpact(snapshot, company, amountCents, "decrease")
          ]
        })
      };
    }
    if (entryType === "offset") {
      assertLoanDelta(source, -amountCents, "借款冲账");
      return {
        entryKind: "original",
        input: formalInput({
          ...base,
          direction: "neutral",
          impacts: [receivableImpact(snapshot, company, amountCents, "decrease")]
        })
      };
    }
    if (entryType === "repayment") {
      assertLoanDelta(source, -amountCents, "借款还款");
      return {
        entryKind: "original",
        input: formalInput({
          ...base,
          direction: "inflow",
          subjects: { ...base.subjects, actualPayer: employee, payee: company },
          impacts: [
            receivableImpact(snapshot, company, amountCents, "decrease"),
            companyFundsImpact(snapshot, company, amountCents, "increase")
          ]
        })
      };
    }
    if (entryType === "reversal") {
      assertLoanDelta(source, amountCents, "借款还款冲销");
      return {
        entryKind: "reversal",
        input: formalInput({
          ...base,
          direction: "outflow",
          subjects: { ...base.subjects, actualPayer: employee, payee: company },
          impacts: [
            {
              ...receivableImpact(snapshot, company, amountCents, "increase"),
              impactKind: "receivable_decrease",
              description: "员工借款还款冲销恢复公司对员工应收"
            },
            {
              ...companyFundsImpact(snapshot, company, amountCents, "decrease"),
              impactKind: "company_project_funds_increase",
              subjectRole: "payee",
              description: "员工借款还款冲销冲减我方公司项目资金回收"
            }
          ],
          adjustsFactId: requiredJsonText(source, "adjustsFactId", "借款还款冲销")
        })
      };
    }
    throw new BadRequestException("员工借款分录类型不支持经营账投影");
  }

  private async snapshot(
    tx: Parameters<OperatingSourceAdapter["readSourceSnapshot"]>[0],
    row: EmployeeProjectLoanEntryRow,
    account: EmployeeProjectLoanAccountRow
  ): Promise<OperatingSourceSnapshot> {
    if (!account.projectId) throw new BadRequestException("员工借款账户未关联项目");
    const [
      claim,
      repayment,
      effectiveDate,
      affiliate,
      adjustment,
      reversedRepaymentEntry
    ] = await Promise.all([
      row.sourceExpenseClaimId
        ? tx.expenseClaim.findUnique({
            where: { id: row.sourceExpenseClaimId },
            select: { id: true, code: true, projectId: true, applicantUserId: true }
          })
        : Promise.resolve(null),
      row.sourceRepaymentId
        ? tx.employeeLoanRepayment.findUnique({
            where: { id: row.sourceRepaymentId },
            select: {
              id: true,
              loanAccountId: true,
              confirmedByUserId: true,
              confirmedAt: true
            }
          })
        : Promise.resolve(null),
      readOperatingLedgerEffectiveDate(tx, account.projectId),
      readAffiliateSnapshot(tx, {
        projectId: account.projectId,
        occurredAt: row.occurredAt
      }),
      row.reversalOfEntryId
        ? tx.operatingFact.findUnique({
            where: {
              sourceType_sourceBusinessId: {
                sourceType: this.sourceType,
                sourceBusinessId: row.reversalOfEntryId
              }
            },
            select: { id: true }
          })
        : Promise.resolve(null)
      ,
      row.reversalOfEntryId
        ? tx.employeeProjectLoanEntry.findUnique({
            where: { id: row.reversalOfEntryId },
            select: {
              id: true,
              loanAccountId: true,
              entryType: true,
              sourceRepaymentId: true,
              amountCents: true,
              balanceDeltaCents: true
            }
          })
        : Promise.resolve(null)
    ]);
    if (
      claim &&
      (claim.projectId !== account.projectId || claim.applicantUserId !== account.userId)
    ) {
      throw new BadRequestException("员工借款分录与费用申请的项目或员工不一致");
    }
    if (repayment && repayment.loanAccountId !== account.id) {
      throw new BadRequestException("员工借款还款分录与借款账户不一致");
    }
    if (row.entryType === "repayment" && (!repayment?.confirmedByUserId || !repayment.confirmedAt)) {
      throw new BadRequestException("员工借款还款缺少冻结确认信息");
    }
    if (
      row.entryType === "reversal" &&
      (!adjustment ||
        !reversedRepaymentEntry ||
        reversedRepaymentEntry.loanAccountId !== account.id ||
        reversedRepaymentEntry.entryType !== "repayment" ||
        !reversedRepaymentEntry.sourceRepaymentId ||
        reversedRepaymentEntry.amountCents !== row.amountCents ||
        reversedRepaymentEntry.balanceDeltaCents !== -row.amountCents)
    ) {
      throw new BadRequestException("员工借款还款冲销缺少完整的原还款经营事实");
    }
    const confirmedByUserId =
      row.entryType === "repayment"
        ? repayment!.confirmedByUserId!
        : row.createdByUserId;
    const confirmedAt =
      row.entryType === "repayment" ? repayment!.confirmedAt! : row.createdAt;
    return {
      projectId: account.projectId,
      sourceType: this.sourceType,
      sourceBusinessId: row.id,
      sourceBusinessCode: claim?.code
        ? `${claim.code}/借款分录/${row.id}`
        : `员工借款账户/${account.id}/${row.id}`,
      sourceVersion: 1,
      status: "confirmed",
      sourceSnapshot: sourceJson({
        formalStatus: "confirmed",
        loanAccountId: account.id,
        employeeUserId: account.userId,
        companyEntityId: account.companyEntityId,
        entryType: row.entryType,
        amountCents: row.amountCents.toString(),
        balanceDeltaCents: row.balanceDeltaCents.toString(),
        sourceExpenseClaimId: row.sourceExpenseClaimId,
        sourceExpenseClaimCode: claim?.code ?? null,
        sourceRepaymentId:
          row.sourceRepaymentId ?? reversedRepaymentEntry?.sourceRepaymentId ?? null,
        reversalOfEntryId: row.reversalOfEntryId,
        ...(adjustment ? { adjustsFactId: adjustment.id } : {}),
        voucherFileId: row.voucherFileId,
        paymentMethod: row.paymentMethod,
        note: row.note,
        occurredAt: row.occurredAt.toISOString(),
        confirmedByUserId,
        confirmedAt: confirmedAt.toISOString(),
        operatingLedgerEffectiveDate: effectiveDate.toISOString(),
        affiliate
      })
    };
  }
}

type ExpenseClaimPaymentRow = {
  id: string;
  code: string;
  claimType: string;
  projectId: string | null;
  applicantUserId: string | null;
  applicantNameSnapshot: string;
  applicantPhoneSnapshot: string | null;
  payeeNameSnapshot: string | null;
  paymentSubjectCompanyEntityId: string | null;
};

function expenseClaimApprovalSelect() {
  return {
    id: true,
    code: true,
    claimType: true,
    incidentalExpenseCategory: true,
    projectId: true,
    companyEntityId: true,
    applicantUserId: true,
    applicantNameSnapshot: true,
    applicantPhoneSnapshot: true,
    payeeNameSnapshot: true,
    requestedAmountCents: true,
    companyPayableAmountCents: true,
    approvedAt: true,
    status: true
  } as const;
}

function expenseClaimPaymentSelect() {
  return {
    id: true,
    code: true,
    claimType: true,
    projectId: true,
    applicantUserId: true,
    applicantNameSnapshot: true,
    applicantPhoneSnapshot: true,
    payeeNameSnapshot: true,
    paymentSubjectCompanyEntityId: true
  } as const;
}

function formalInput(input: {
  snapshot: OperatingSourceSnapshot;
  source: Record<string, Prisma.InputJsonValue>;
  affiliate: ReturnType<typeof frozenAffiliateFromJson>;
  occurredAt: Date;
  confirmedAt: Date;
  effectiveDate: Date;
  amountCents: bigint;
  confirmedByUserId: string;
  factKind: AppendOperatingFactInput["factKind"];
  direction: AppendOperatingFactInput["direction"];
  subjects: AppendOperatingFactInput["subjects"];
  impacts: AppendOperatingFactInput["impacts"];
  basisSnapshot: Prisma.InputJsonObject;
  adjustsFactId?: string;
}): AppendOperatingFactInput {
  return {
    projectId: input.snapshot.projectId,
    sourceType: input.snapshot.sourceType,
    sourceBusinessId: input.snapshot.sourceBusinessId,
    sourceBusinessCode: input.snapshot.sourceBusinessCode,
    sourceVersion: input.snapshot.sourceVersion,
    idempotencyKey: `${input.snapshot.sourceType}:${input.snapshot.sourceBusinessId}`,
    occurredAt: input.occurredAt,
    confirmedAt: input.confirmedAt,
    confirmedByUserId: input.confirmedByUserId,
    factKind: input.factKind,
    operatingLevel: "project",
    evidenceLevel: "A",
    amountCents: input.amountCents,
    currencyCode: "CNY",
    direction: input.direction,
    isBeforeOperatingLedgerEffectiveDate: occurredBeforeEffectiveDate(
      input.occurredAt,
      input.effectiveDate
    ),
    affiliateAssignmentId: input.affiliate.assignmentId,
    affiliateBusinessPartyVersionId: input.affiliate.businessPartyVersionId,
    affiliateNameSnapshot: input.affiliate.name,
    ...(input.affiliate.creditCode
      ? { affiliateCreditCodeSnapshot: input.affiliate.creditCode }
      : {}),
    sourceSnapshot: input.snapshot.sourceSnapshot,
    basisSnapshot: input.basisSnapshot,
    subjects: input.subjects,
    impacts: input.impacts,
    ...(input.adjustsFactId ? { adjustsFactId: input.adjustsFactId } : {})
  };
}

function claimPayee(
  source: Record<string, Prisma.InputJsonValue>,
  claimType: string,
  label: string
): OperatingSubjectReference {
  if (claimType === "reimbursement") {
    const userId = source.applicantUserId;
    if (typeof userId === "string" && userId.trim()) {
      return { kind: "employee", id: userId };
    }
    const name = requiredJsonText(source, "applicantNameSnapshot", label);
    const phone =
      typeof source.applicantPhoneSnapshot === "string"
        ? source.applicantPhoneSnapshot
        : "";
    return {
      kind: "employee",
      id: stableNamedSubjectId("employee", `${name}/${phone}`)
    };
  }
  if (claimType === "incidental_expense") {
    return {
      kind: "downstream_counterparty",
      id: stableNamedSubjectId(
        "downstream_counterparty",
        requiredJsonText(source, "payeeNameSnapshot", label)
      )
    };
  }
  throw new BadRequestException("费用申请类型不支持经营账投影");
}

function reimbursementCostImpacts(
  snapshot: OperatingSourceSnapshot,
  source: Record<string, Prisma.InputJsonValue>,
  company: OperatingSubjectReference,
  requestedAmountCents: bigint
): AppendOperatingFactInput["impacts"] {
  const lines = source.reimbursementLines;
  if (!Array.isArray(lines) || !lines.length) {
    throw new BadRequestException("报销确认快照缺少费用明细");
  }
  const impacts = lines.map((entry) => {
    const line = requiredJsonRecord(entry, "报销费用明细");
    const amountCents = requiredJsonMoney(line, "amountCents", "报销费用明细");
    if (amountCents <= 0n) throw new BadRequestException("报销费用明细金额必须大于 0");
    const sortOrder = requiredJsonText(line, "sortOrder", "报销费用明细");
    return {
      idempotencyKey: `${snapshot.sourceType}:${snapshot.sourceBusinessId}:confirmed_cost:${sortOrder}`,
      sourceImpactKey: `confirmed_cost:${sortOrder}`,
      impactKind: "confirmed_cost" as const,
      amountCents,
      direction: "increase" as const,
      subjectRole: "cost_bearing_company" as const,
      subject: company,
      costCategoryCode: "project_daily_expense" as const,
      description: `报销费用确认：${requiredJsonText(line, "expenseCategory", "报销费用明细")}`,
      impactSnapshot: sourceJson({
        lineId: requiredJsonText(line, "id", "报销费用明细"),
        occurredOn: requiredJsonText(line, "occurredOn", "报销费用明细"),
        purpose: requiredJsonText(line, "purpose", "报销费用明细")
      })
    };
  });
  const total = impacts.reduce((sum, impact) => sum + impact.amountCents, 0n);
  if (total !== requestedAmountCents) {
    throw new BadRequestException("报销费用明细合计与确认金额不一致");
  }
  return impacts;
}

function incidentalCostImpacts(
  snapshot: OperatingSourceSnapshot,
  source: Record<string, Prisma.InputJsonValue>,
  company: OperatingSubjectReference,
  amountCents: bigint
): AppendOperatingFactInput["impacts"] {
  const category = requiredJsonText(source, "incidentalExpenseCategory", "零星费用确认");
  const costCategories: Readonly<Record<string, PrimaryCostCategoryCode>> = {
    temporary_service: "site_construction_and_measures",
    temporary_machinery_shift: "machinery_and_rental",
    sporadic_labor: "crew_and_labor",
    other_incidental: "other_project_cost"
  };
  const costCategoryCode = costCategories[category];
  if (!costCategoryCode) throw new BadRequestException("零星费用分类不支持经营账投影");
  return [
    {
      idempotencyKey: `${snapshot.sourceType}:${snapshot.sourceBusinessId}:confirmed_cost`,
      sourceImpactKey: "confirmed_cost",
      impactKind: "confirmed_cost",
      amountCents,
      direction: "increase",
      subjectRole: "cost_bearing_company",
      subject: company,
      costCategoryCode,
      description: "零星费用确认项目成本"
    }
  ];
}

function receivableImpact(
  snapshot: OperatingSourceSnapshot,
  company: OperatingSubjectReference,
  amountCents: bigint,
  direction: "increase" | "decrease"
): AppendOperatingFactInput["impacts"][number] {
  return {
    idempotencyKey: `${snapshot.sourceType}:${snapshot.sourceBusinessId}:receivable`,
    sourceImpactKey: "receivable",
    impactKind: direction === "increase" ? "receivable_increase" : "receivable_decrease",
    amountCents,
    direction,
    subjectRole: "creditor",
    subject: company,
    description: direction === "increase" ? "员工借款增加公司对员工应收" : "员工借款清偿减少公司对员工应收"
  };
}

function companyFundsImpact(
  snapshot: OperatingSourceSnapshot,
  company: OperatingSubjectReference,
  amountCents: bigint,
  direction: "increase" | "decrease"
): AppendOperatingFactInput["impacts"][number] {
  return {
    idempotencyKey: `${snapshot.sourceType}:${snapshot.sourceBusinessId}:funds`,
    sourceImpactKey: "funds",
    impactKind:
      direction === "increase"
        ? "company_project_funds_increase"
        : "company_project_funds_decrease",
    amountCents,
    direction,
    subjectRole: direction === "increase" ? "payee" : "actual_payer",
    subject: company,
    description: direction === "increase" ? "员工还款增加我方公司项目资金" : "员工借款或冲销减少我方公司项目资金"
  };
}

function assertLoanDelta(
  source: Record<string, Prisma.InputJsonValue>,
  expected: bigint,
  label: string
) {
  if (requiredJsonMoney(source, "balanceDeltaCents", label) !== expected) {
    throw new BadRequestException(`${label}余额变动与金额不一致`);
  }
}
