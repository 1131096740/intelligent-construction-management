import { ExpenseClaimService } from './expense-claim.service';

function fixture() {
  const claim = { id: 'loan-a', code: 'JK-A', claimType: 'loan', status: 'disbursed', projectId: 'project', applicantUserId: 'owner', handledByUserId: 'owner', requestedAmountCents: 100n, loanOffsetAmountCents: 0n, companyPayableAmountCents: 100n, fundedAmountCents: 100n };
  const db = {
    expenseClaim: { findFirst: jest.fn(async () => claim) },
    userPosition: { findMany: jest.fn(async () => []) }, projectMember: { findMany: jest.fn(async () => []) },
    position: { findMany: jest.fn(async () => []) },
    project: { findUnique: jest.fn(async () => ({ id: 'project', name: '项目' })) },
    expenseClaimLine: { findMany: jest.fn(async () => []) }, expenseClaimAttachment: { findMany: jest.fn(async () => []) },
    expenseClaimEntrySnapshot: { findMany: jest.fn(async () => []) },
    pdfDocument: { findFirst: jest.fn(async () => null) },
    employeeProjectLoanAccount: { findUnique: jest.fn(async () => ({ id: 'account', fundedAmountCents: 900n, offsetAmountCents: 0n, repaidAmountCents: 20n, reservedOffsetAmountCents: 0n, balanceAmountCents: 880n })) },
    employeeProjectLoanEntry: { findMany: jest.fn(async () => [{ id: 'disbursement-a', amountCents: 100n }]) },
    employeeLoanRepayment: { findMany: jest.fn(async () => [{ id: 'repayment-unrelated-b', amountCents: 20n }]) }
  };
  const progress = { canViewBusiness: jest.fn(async () => true) };
  return { db, claim, progress, service: new ExpenseClaimService(db as never, undefined as never, undefined as never, undefined, undefined, undefined, undefined, undefined, undefined, progress as never) };
}

describe('流程参与资格不扩大员工借款账户权限', () => {
  it('历史审批人只看本单放款，不读取同员工其他借款账户余额和还款', async () => {
    const { service, db } = fixture();
    const result = await service.getMine('loan-a', 'past-reviewer');
    expect(result.loanAccount).toBeNull();
    expect(result.loanRepayments).toEqual([]);
    expect(db.employeeProjectLoanAccount.findUnique).not.toHaveBeenCalled();
    expect(db.employeeLoanRepayment.findMany).not.toHaveBeenCalled();
    expect(result.loanDisbursements).toEqual([{ id: 'disbursement-a', amountCents: '100' }]);
    expect(db.employeeProjectLoanEntry.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { sourceExpenseClaimId: 'loan-a', entryType: 'disbursement' } }));
  });
  it('原有申请人账户读取继续可用', async () => {
    const { service } = fixture();
    const result = await service.getMine('loan-a', 'owner');
    expect(result.loanAccount?.balanceAmountCents).toBe('880');
    expect(result.loanRepayments).toEqual([{ id: 'repayment-unrelated-b', amountCents: '20' }]);
  });
  it('流程历史资格不能读取重新编辑的草稿', async () => {
    const { service, claim, progress } = fixture();
    claim.status = 'draft';
    await expect(service.getMine('loan-a', 'past-reviewer')).rejects.toThrow('无权读取');
    expect(progress.canViewBusiness).not.toHaveBeenCalled();
  });
});
