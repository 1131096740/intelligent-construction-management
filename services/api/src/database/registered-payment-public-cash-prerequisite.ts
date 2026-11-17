import type { Prisma, PrismaClient } from "@prisma/client";

/** Read-only prerequisite for a future isolated cash case. This does not seed,
 * authorize or execute that case; caller owns and verifies the observer session. */
export async function readCashSettlementPrerequisite(
  observer: Pick<PrismaClient, "$transaction">,
  identity: { projectId: string; settlementId: string },
  check: () => void = () => undefined,
  paidCents: 0n | 4000n = 0n
) {
  if (!identity.projectId || !identity.settlementId) throw new Error("PUBLIC_CASH_SETTLEMENT_PREREQUISITE");
  check();const result = await observer.$transaction(async tx => {
    check();await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");check();
    return readCashSettlementPrerequisiteInTransaction(tx, identity, check, paidCents);
  }, { isolationLevel: "RepeatableRead" });
  check();return result;
}

/** Reads the settlement witness in the caller's existing read-only snapshot. */
export async function readCashSettlementPrerequisiteInTransaction(
  tx: Prisma.TransactionClient,
  identity: { projectId: string; settlementId: string },
  check: () => void = () => undefined,
  paidCents: 0n | 4000n = 0n,
  strictSourceScope = false
) {
  const fail = (): never => { throw new Error("PUBLIC_CASH_SETTLEMENT_PREREQUISITE"); };
  if (!identity.projectId || !identity.settlementId) return fail();
  const { projectId, settlementId } = identity;
  const checked = async <T>(operation: () => PromiseLike<T>): Promise<T> => { check(); const value = await operation(); check(); return value; };
    const settlement = await checked(() => tx.settlement.findUnique({ where: { id: settlementId }, select: {
      id: true, projectId: true, status: true, amountCents: true, payableAmountCents: true, paidAmountCents: true
    } }));
    if (!settlement || settlement.id !== settlementId || settlement.projectId !== projectId || settlement.status !== "effective" ||
      settlement.amountCents !== 4000n || settlement.payableAmountCents !== 4000n || settlement.paidAmountCents !== paidCents) return fail();
    const facts = await checked(() => tx.operatingFact.findMany({ where: { projectId, sourceType: "settlement", sourceBusinessId: settlementId }, select: {
      id: true, projectId: true, sourceType: true, sourceBusinessId: true, status: true
    } }));
    if (facts.length !== 1 || facts[0]?.projectId !== projectId || facts[0].sourceType !== "settlement" ||
      facts[0].sourceBusinessId !== settlementId || facts[0].status !== "confirmed") return fail();
    const factId = facts[0].id;
    const impacts = await checked(() => tx.operatingImpactEntry.findMany({ where: strictSourceScope ? { projectId, sourceType: "settlement", sourceBusinessId: settlementId } : { factId }, select: {
      factId: true, projectId: true, sourceType: true, sourceBusinessId: true, impactKind: true, direction: true, numericProtocolVersion: true, amountCents: true
    } }));
    if (impacts.length !== 2 || !["confirmed_cost", "payable_increase"].every(kind => impacts.filter(impact =>
      impact.factId === factId && impact.projectId === projectId && impact.sourceType === "settlement" &&
      impact.sourceBusinessId === settlementId && impact.impactKind === kind && impact.direction === "increase" &&
      impact.numericProtocolVersion === 1 && impact.amountCents === 4000n).length === 1)) return fail();
    return { settlementId, factId, costCents: "4000", payableCents: "4000" };
}
