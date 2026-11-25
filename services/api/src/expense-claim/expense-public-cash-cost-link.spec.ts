import { ConflictException } from "@nestjs/common";
import { linkExpensePublicCashCost } from "./expense-public-cash-cost-link";

function fixture(costs: Array<{ id: string; amountCents: bigint }>, prior = 0n) {
  const tx = {
    expenseClaimPaymentExecution: { findUnique: jest.fn().mockResolvedValue({ expenseClaimId: "original-claim" }) },
    operatingImpactEntry: { findMany: jest.fn().mockResolvedValue(costs) },
    expensePublicCashCostLink: {
      groupBy: jest.fn().mockResolvedValue(prior ? [{ costImpactId: "cost-1", _sum: { amountCents: prior } }] : []),
      createMany: jest.fn()
    },
    $executeRaw: jest.fn()
  };
  return { tx, append: (cents: bigint) =>
    linkExpensePublicCashCost(tx as never, "cash-payment", "cash-execution", "project-1", [
      { costImpactId: "cost-1", amountCents: cents }
    ])
  };
}

it("writes only the linked cash amount after checking the exact original expense and prior uses", async () => {
  const { tx, append } = fixture([{ id: "cost-1", amountCents: 800n }], 500n);
  await append(300n);
  expect(tx.operatingImpactEntry.findMany).toHaveBeenCalledWith({
    where: {
      id: { in: ["cost-1"] }, projectId: "project-1", impactKind: "confirmed_cost", direction: "increase",
      numericProtocolVersion: 1,
      fact: {
        sourceType: "expense_claim_approval", sourceBusinessId: "original-claim", projectId: "project-1",
        entryKind: "original", status: "confirmed", evidenceLevel: "A", isBeforeOperatingLedgerEffectiveDate: false,
        adjustments: { none: { status: "confirmed" } }
      }
    },
    select: { id: true, amountCents: true }
  });
  expect(tx.expensePublicCashCostLink.createMany).toHaveBeenCalledWith({
    data: [{ operationalPaymentId: "cash-payment", costImpactId: "cost-1", amountCents: 300n }]
  });
  expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
});

it("refuses a cost line outside the confirmed same-claim query without writing a link", async () => {
  const { tx, append } = fixture([]);
  await expect(append(300n)).rejects.toThrow(ConflictException);
  expect(tx.expensePublicCashCostLink.createMany).not.toHaveBeenCalled();
});

it("refuses any part of a second cash payment that would exceed the original cost", async () => {
  const { tx, append } = fixture([{ id: "cost-1", amountCents: 800n }], 500n);
  await expect(append(301n)).rejects.toThrow(ConflictException);
  expect(tx.expensePublicCashCostLink.createMany).not.toHaveBeenCalled();
});
