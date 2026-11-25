import type { Prisma } from '@prisma/client';
import type { CompanyTransferBalance } from './company-transfer-summary';
import { transferRepaymentUsage } from './company-transfer-legacy';
/** Read direct proxy debt once from its original ledger or operational payment fact. */
export async function appendLegacyProxyBalances(tx: Prisma.TransactionClient, balances: CompanyTransferBalance[], until: Date, scope: { projectIds?: string[]; companyId?: string }) {
  const roots = await tx.interEntityRelationshipEntry.findMany({ where: { status: 'confirmed', entryKind: 'proxy_payment', direction: 'increase', adjustsEntryId: null, projectId: scope.projectIds ? { in: scope.projectIds } : { not: null }, confirmedAt: { lte: until }, ...(scope.companyId ? { OR: [{ originalDebtorCompanyId: scope.companyId }, { creditorCompanyId: scope.companyId }] } : {}) } });
  const operational = await tx.registeredOperationalPayment.findMany({ where: {
    actualPayerCompanyId: { not: null },
    projectId: scope.projectIds ? { in: scope.projectIds } : undefined,
    paidAt: { lte: until },
    ...(scope.companyId ? { OR: [{ originalDebtorCompanyId: scope.companyId }, { actualPayerCompanyId: scope.companyId }] } : {}),
  }, select: { id: true, originalDebtorCompanyId: true, actualPayerCompanyId: true, projectId: true, amountCents: true } });
  const companyIds = [...new Set([
    ...roots.flatMap(row => [row.originalDebtorCompanyId, row.creditorCompanyId]),
    ...operational.flatMap(row => row.actualPayerCompanyId ? [row.originalDebtorCompanyId, row.actualPayerCompanyId] : []),
  ])];
  const companies = companyIds.length ? await tx.companyEntity.findMany({ where: { id: { in: companyIds } }, select: { id: true, name: true } }) : [];
  const result = balances.map(b => ({ ...b, legacyReceivableCents: '0', legacyPayableCents: '0' }));
  const debts = [
    ...roots.map(root => ({ ...root, legacy: true })),
    ...operational.flatMap(root => root.actualPayerCompanyId ? [{ ...root, creditorCompanyId: root.actualPayerCompanyId, legacy: false }] : []),
  ];
  for (const root of debts) {
    if (root.originalDebtorCompanyId === root.creditorCompanyId) continue;
    const adjustments = root.legacy ? await tx.interEntityRelationshipEntry.aggregate({
      where: { adjustsEntryId: root.id, status: 'confirmed', direction: 'decrease', confirmedAt: { lte: until } },
      _sum: { amountCents: true },
    }) : null;
    const usage = await transferRepaymentUsage(tx, root.legacy ? { originalInterEntityRelationshipId: root.id } : { originalOperationalPaymentId: root.id }, until);
    const remaining = root.amountCents - (adjustments?._sum.amountCents ?? 0n) - usage.received;
    for (const [id, field] of [[root.originalDebtorCompanyId, 'legacyPayableCents'], [root.creditorCompanyId, 'legacyReceivableCents']] as const) {
      if (scope.companyId && scope.companyId !== id) continue;
      let row = result.find(b => b.companyId === id && b.projectId === root.projectId);
      if (!row) { row = { companyId: id, companyName: companies.find(c => c.id === id)?.name ?? '原公司', projectId: root.projectId, cashChangeCents: '0', inTransitCents: '0', receivableCents: '0', payableCents: '0', legacyReceivableCents: '0', legacyPayableCents: '0' }; result.push(row); }
      row[field] = String(BigInt(row[field]) + remaining);
    }
  }
  return result.sort((a,b) => `${a.projectId}:${a.companyId}`.localeCompare(`${b.projectId}:${b.companyId}`));
}
