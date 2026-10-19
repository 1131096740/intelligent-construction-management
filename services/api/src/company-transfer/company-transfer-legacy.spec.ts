import { readLegacyTransferDebt, transferRepaymentUsage } from './company-transfer-legacy';
import { legacyRepaymentSnapshot } from './company-transfer-legacy-operating';
import { CompanyTransferOperatingSourceAdapter } from './company-transfer-operating-source.adapter';

describe('已有往来归还核算', () => {
  it('历史未清只扣截至日到账，当前可申请包含全部审批占用并释放退回', async () => {
    const tx = {
      companyTransfer: { findMany: jest.fn().mockResolvedValue([{ id: 'r', amountCents: 100n }]) },
      companyTransferEvent: { findMany: jest.fn().mockResolvedValue([
        { kind: 'incoming', amountCents: 60n, occurredAt: new Date('2026-09-01') },
        { kind: 'returned', amountCents: 40n, occurredAt: new Date('2026-10-01') }
      ]) }
    };
    expect(await transferRepaymentUsage(tx as never, { originalTransferId: 'loan' }, new Date('2026-08-31'))).toEqual({ received: 0n, reserved: 60n });
    expect(await transferRepaymentUsage(tx as never, { originalTransferId: 'loan' })).toEqual({ received: 60n, reserved: 60n });
  });
  it('原资金往来冻结归还双方及项目并按截止日扣减', async () => {
    const until = new Date('2026-08-31');
    const tx = { fundMovementRelationshipEntry: {
      findUnique: jest.fn().mockResolvedValue({ id: 'root', status: 'confirmed', direction: 'increase', debtorCompanyEntityId: 'b', creditorCompanyEntityId: 'a', beneficiaryProjectId: 'pb', sourceProjectId: 'pa', amountCents: 100n, createdAt: new Date('2026-08-01') }),
      aggregate: jest.fn().mockResolvedValue({ _sum: { amountCents: 20n } })
    } };
    expect(await readLegacyTransferDebt(tx as never, { originalFundMovementRelationshipId: 'root' }, until)).toMatchObject({ sourceCompanyId: 'b', destinationCompanyId: 'a', sourceProjectId: 'pb', destinationProjectId: 'pa', remainingCents: 80n });
    expect(tx.fundMovementRelationshipEntry.aggregate).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ confirmedAt: { lte: until } }) }));
  });
  it('原往来核销仅反向原债务影响，不重复现金、成本或供应商应付', async () => {
    const tx = {
      companyTransferEvent: { findUnique: jest.fn().mockResolvedValue({ id: 'event', transferId: 'repay', kind: 'incoming', amountCents: 25n, occurredAt: new Date('2026-08-10'), createdAt: new Date('2026-08-10'), recordedByUserId: 'finance' }) },
      companyTransfer: { findUniqueOrThrow: jest.fn().mockResolvedValue({ code: 'HZ', originalFundMovementRelationshipId: 'root', sourceProjectId: 'pb', destinationProjectId: 'pa', destinationCompanyId: 'a' }) },
      fundMovementRelationshipEntry: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'root', movementId: 'movement' }) },
      fundMovementLeg: { findUnique: jest.fn().mockResolvedValue({ id: 'leg', movementId: 'movement', projectId: 'pa', operatingFactId: 'fact' }) },
      operatingFact: { findUniqueOrThrow: jest.fn().mockResolvedValue({ subjectSnapshot: { creditor: { kind: 'participating_company', id: 'a' } }, impacts: [{ id: 'impact', factId: 'fact', sourceImpactKey: 'internal_relationship', direction: 'increase', impactKind: 'internal_receivable_increase', subjectRole: 'creditor', subjectKind: 'participating_company', subjectId: 'a' }] }) },
      project: { findUnique: jest.fn().mockResolvedValue({ operatingLedgerEffectiveDate: new Date('2026-01-01') }) },
      projectAffiliateAssignment: { findFirst: jest.fn().mockResolvedValue({ id: 'assignment', businessPartyVersionId: 'av', affiliateNameSnapshot: '总包' }) }
    };
    const snapshot = await legacyRepaymentSnapshot(tx as never, 'event', 'leg', 'pa');
    expect(tx.operatingFact.findUniqueOrThrow).toHaveBeenCalledWith(expect.objectContaining({ include: { impacts: { where: { sourceImpactKey: { in: ['internal_relationship', 'company_advance_payable'] } } } } }));
    const fact = new CompanyTransferOperatingSourceAdapter().toOperatingFactInput(snapshot!).input;
    expect(fact.impacts).toHaveLength(1);
    expect(fact.impacts[0]).toMatchObject({ impactKind: 'internal_receivable_decrease', amountCents: 25n, direction: 'decrease', subject: { kind: 'participating_company', id: 'a' } });
  });
});

describe('旧公司代付与新互转余额同源', () => {
  it('按原项目和双方分列旧债，只有到账归还减少余额，未来到账不倒灌', async () => {
    const { appendLegacyProxyBalances } = await import('./company-transfer-legacy-balances');
    const tx = {
      interEntityRelationshipEntry: { findMany: jest.fn().mockResolvedValue([{ id: 'root', projectId: 'p', originalDebtorCompanyId: 'b', creditorCompanyId: 'a', amountCents: 100n }]), aggregate: jest.fn().mockResolvedValue({ _sum: { amountCents: 10n } }) },
      companyEntity: { findMany: jest.fn().mockResolvedValue([{ id: 'a', name: '甲' }, { id: 'b', name: '乙' }]) },
      companyTransfer: { findMany: jest.fn().mockResolvedValue([{ id: 'repay', amountCents: 40n }]) },
      companyTransferEvent: { findMany: jest.fn().mockResolvedValue([{ kind: 'incoming', amountCents: 40n, occurredAt: new Date('2026-09-01') }]) }
    };
    const earlier = await appendLegacyProxyBalances(tx as never, [], new Date('2026-08-31'), { projectIds: ['p'] });
    expect(earlier.find(b => b.companyId === 'a')).toMatchObject({ cashChangeCents: '0', legacyReceivableCents: '90', legacyPayableCents: '0' });
    expect(earlier.find(b => b.companyId === 'b')).toMatchObject({ legacyReceivableCents: '0', legacyPayableCents: '90' });
    const later = await appendLegacyProxyBalances(tx as never, [], new Date('2026-09-30'), { projectIds: ['p'], companyId: 'a' });
    expect(later).toHaveLength(1); expect(later[0].legacyReceivableCents).toBe('50');
  });
});
