import { readCashSettlementPrerequisite, readCashSettlementPrerequisiteInTransaction } from "./registered-payment-public-cash-prerequisite";

describe("public cash settlement prerequisite (synthetic observer, no PG)", () => {
  const identity = { projectId: "project-1", settlementId: "settlement-1" };
  function setup() {
    const settlement = { id: "settlement-1", projectId: "project-1", status: "effective", amountCents: 4000n, payableAmountCents: 4000n, paidAmountCents: 0n };
    const facts = [{ id: "fact-1", projectId: "project-1", sourceType: "settlement", sourceBusinessId: "settlement-1", status: "confirmed" }];
    const impacts = [
      { factId: "fact-1", projectId: "project-1", sourceType: "settlement", sourceBusinessId: "settlement-1", impactKind: "confirmed_cost", direction: "increase", numericProtocolVersion: 1, amountCents: 4000n },
      { factId: "fact-1", projectId: "project-1", sourceType: "settlement", sourceBusinessId: "settlement-1", impactKind: "payable_increase", direction: "increase", numericProtocolVersion: 1, amountCents: 4000n }
    ];
    const tx = { $executeRawUnsafe: jest.fn().mockResolvedValue(0), settlement: { findUnique: jest.fn().mockResolvedValue(settlement) }, operatingFact: { findMany: jest.fn().mockResolvedValue(facts) }, operatingImpactEntry: { findMany: jest.fn().mockResolvedValue(impacts) } };
    const observer = { $transaction: jest.fn(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx)) };
    return { observer, tx, settlement, facts, impacts };
  }
  it("accepts a single effective settlement with matching cost and payable in one read-only repeatable-read snapshot", async () => {
    const f = setup();
    await expect(readCashSettlementPrerequisite(f.observer as never, identity)).resolves.toEqual({ settlementId: identity.settlementId, factId: "fact-1", costCents: "4000", payableCents: "4000" });
    expect(f.observer.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "RepeatableRead" });
    expect(f.tx.$executeRawUnsafe).toHaveBeenCalledWith("SET TRANSACTION READ ONLY");
  });
  it("validates settlement inside the caller's existing observer transaction", async () => {
    const f = setup();
    await expect(readCashSettlementPrerequisiteInTransaction(f.tx as never, identity)).resolves.toEqual({ settlementId: identity.settlementId, factId: "fact-1", costCents: "4000", payableCents: "4000" });
    expect(f.tx.$executeRawUnsafe).not.toHaveBeenCalled();
    expect(f.observer.$transaction).not.toHaveBeenCalled();
  });
  it("checks the entire settlement source scope for orphan impacts when requested", async () => {
    const f = setup();
    await readCashSettlementPrerequisiteInTransaction(f.tx as never, identity, () => undefined, 0n, true);
    expect(f.tx.operatingImpactEntry.findMany).toHaveBeenCalledWith(expect.objectContaining({where:{projectId:identity.projectId,sourceType:"settlement",sourceBusinessId:identity.settlementId}}));
  });
  it.each(["wrong project", "missing cost", "wrong payable", "duplicate fact", "already paid", "wrong fact source", "extra impact", "wrong protocol"])("rejects %s", async failure => {
    const f = setup();
    if (failure === "wrong project") f.settlement.projectId = "other";
    if (failure === "missing cost") f.impacts.shift();
    if (failure === "wrong payable") f.impacts[1]!.amountCents = 3999n;
    if (failure === "duplicate fact") f.facts.push({...f.facts[0]!, id: "fact-2"});
    if (failure === "already paid") f.settlement.paidAmountCents = 1n;
    if (failure === "wrong fact source") f.facts[0]!.sourceBusinessId = "other";
    if (failure === "extra impact") f.impacts.push({...f.impacts[0]!});
    if (failure === "wrong protocol") f.impacts[0]!.numericProtocolVersion = 2;
    await expect(readCashSettlementPrerequisite(f.observer as never, identity)).rejects.toThrow("PUBLIC_CASH_SETTLEMENT_PREREQUISITE");
  });
});
