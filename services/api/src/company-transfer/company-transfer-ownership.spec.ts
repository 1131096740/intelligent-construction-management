import { repaymentOwnershipDate } from "./company-transfer-ownership";
import type { Prisma } from "@prisma/client";

const date = new Date("2026-08-20"), repaymentDate = new Date("2026-10-15");
function fixture(kind = "repayment", incoming = false) {
  const transfer = { id: "repay", kind, status: "approved", sourceCompanyId: "borrower", destinationCompanyId: "lender", sourceProjectId: "project", destinationProjectId: "project", originalTransferId: "loan" };
  const tx = {
    companyTransferEvent: { findUnique: jest.fn().mockResolvedValue({ id: "event", transferId: "repay", kind: incoming ? "incoming" : "outgoing", occurredAt: repaymentDate }), findFirst: jest.fn().mockResolvedValue({ occurredAt: date }) },
    companyTransfer: { findUniqueOrThrow: jest.fn().mockImplementation(({ where }) => Promise.resolve(where.id === "repay" ? transfer : { kind: "loan", status: "approved", sourceCompanyId: "lender", destinationCompanyId: "borrower", sourceProjectId: "project", destinationProjectId: "project", id: "loan" })) },
    contractProxyExecution: { findUniqueOrThrow: jest.fn() },
    fundMovementRelationshipEntry: { findUnique: jest.fn(), findUniqueOrThrow: jest.fn(), aggregate: jest.fn().mockResolvedValue({ _sum: { amountCents: 0n } }) },
    interEntityRelationshipEntry: { findUnique: jest.fn(), findUniqueOrThrow: jest.fn(), aggregate: jest.fn().mockResolvedValue({ _sum: { amountCents: 0n } }) },
    fundMovementLeg: { findFirst: jest.fn().mockResolvedValue({ operatingFactId: "originalFact" }) },
    operatingFact: { findUniqueOrThrow: jest.fn().mockResolvedValue({ occurredAt: date }) },
    paymentExecution: { findUniqueOrThrow: jest.fn().mockResolvedValue({ paidAt: date }) },
    fundExecution: { findUniqueOrThrow: jest.fn().mockResolvedValue({ occurredAt: date }) }
  };
  return { transfer: transfer as typeof transfer & { originalProxyId?: string; originalFundMovementRelationshipId?: string; originalInterEntityRelationshipId?: string }, tx, read: (projectId = "project", sourceBusinessId = "event") => repaymentOwnershipDate(tx as unknown as Prisma.TransactionClient, { projectId, sourceBusinessId }) };
}
describe("repayment historical ownership", () => {
  it.each([false, true])("uses original confirmed loan leg for incoming=%s", async incoming => {
    const f = fixture("repayment", incoming); expect(await f.read()).toEqual(date);
    expect(f.tx.companyTransferEvent.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ kind: incoming ? "outgoing" : "incoming" }) }));
  });
  it("keeps new storage/loan on the actual date and refuses another project or invented relationship", async () => {
    expect(await fixture("storage").read()).toBeUndefined(); expect(await fixture("loan").read()).toBeUndefined();
    await expect(fixture().read("other")).rejects.toThrow("项目"); await expect(fixture().read("project", "event:relationship:fake")).rejects.toThrow("来源");
    const f=fixture(); f.transfer.status="submitted"; await expect(f.read()).rejects.toThrow("批准");
  });
  it("uses frozen confirmed proxy debt and rejects a changed debtor", async () => {
    const f=fixture(); f.transfer.originalTransferId=""; f.transfer.originalProxyId="proxy";
    const original={ status:"confirmed",entryKind:"payment",projectId:"project",occurredAt:date,frozenSource:{debtor:{id:"borrower"},actualPayer:{id:"lender"}} };
    f.tx.contractProxyExecution.findUniqueOrThrow.mockResolvedValue(original);expect(await f.read()).toEqual(date);
    original.frozenSource.debtor.id="other";await expect(f.read()).rejects.toThrow("原代付");
  });
  it("uses each original movement project's operating fact without rewriting the cash date", async () => {
    const f=fixture(); f.transfer.originalTransferId="";f.transfer.originalFundMovementRelationshipId="movement";
    const root={id:"movement",status:"confirmed",direction:"increase",adjustsEntryId:null,debtorCompanyEntityId:"borrower",creditorCompanyEntityId:"lender",beneficiaryProjectId:"project",sourceProjectId:"project",amountCents:100n,createdAt:date,confirmedAt:date,movementId:"move"};
    f.tx.fundMovementRelationshipEntry.findUnique.mockResolvedValue(root);f.tx.fundMovementRelationshipEntry.findUniqueOrThrow.mockResolvedValue(root);expect(await f.read()).toEqual(date);
    expect(f.tx.fundMovementLeg.findFirst).toHaveBeenCalledWith(expect.objectContaining({where:expect.objectContaining({projectId:"project",movementId:"move"})}));
  });
  it.each(["payment", "fund"])("uses original %s execution for old inter-entity debt", async kind => {
    const f=fixture();f.transfer.originalTransferId="";f.transfer.originalInterEntityRelationshipId="old";
    const root={id:"old",status:"confirmed",entryKind:"proxy_payment",direction:"increase",adjustsEntryId:null,originalDebtorCompanyId:"borrower",creditorCompanyId:"lender",projectId:"project",amountCents:100n,createdAt:date,confirmedAt:date,paymentExecutionId:kind==="payment"?"payment":null,fundExecutionId:kind==="fund"?"fund":null};
    f.tx.interEntityRelationshipEntry.findUnique.mockResolvedValue(root);f.tx.interEntityRelationshipEntry.findUniqueOrThrow.mockResolvedValue(root);expect(await f.read()).toEqual(date);
    f.tx.paymentExecution.findUniqueOrThrow.mockResolvedValue({paidAt:new Date("2026-12-01")});f.tx.fundExecution.findUniqueOrThrow.mockResolvedValue({occurredAt:new Date("2026-12-01")});await expect(f.read()).rejects.toThrow("原债");
  });
});
