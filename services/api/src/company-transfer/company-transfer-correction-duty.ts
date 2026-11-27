import type { CompanyTransfer, Prisma } from "@prisma/client";
import { companyTransferDutyTarget } from "../approval/approval-duty-sms-intent";
import { transferTotals } from "./company-transfer.domain";
import { originalSourceKey, type LegacyOriginalRef } from "./company-transfer-legacy";

type CorrectionTransfer = Pick<CompanyTransfer,"requiresParallelRepaymentApproval"|"sourceProjectId"> & LegacyOriginalRef;
type CorrectionEvent = {id:string;kind:string;outgoingEventId:string|null;returnedIncomingEventId?:string|null;amountCents:bigint};

export const companyTransferCorrectionDutyLabel = "复核归还原债更正";
export const companyTransferCorrectionTarget = (transferId: string, eventId: string) =>
  `${companyTransferDutyTarget(transferId)}&correctionEventId=${encodeURIComponent(eventId)}`;

export async function currentCompanyTransferCorrectionDuties(
  tx: Prisma.TransactionClient, transfer: CorrectionTransfer, events: readonly CorrectionEvent[],
) {
  if (!transfer.requiresParallelRepaymentApproval || !transfer.sourceProjectId || !originalSourceKey(transfer)) return [];
  const settled = events.filter(event => event.kind === "outgoing").flatMap(event => {
    const totals = transferTotals(events.filter(item => item.outgoingEventId === event.id));
    return totals.received === event.amountCents && totals.netReceived > 0n
      ? [{ ...event, amountCents: totals.netReceived }]
      : [];
  });
  if (!settled.length) return [];
  const requests = await tx.companyTransferOriginalDebtCorrection.findMany({
    where: {outgoingEventId: {in: settled.map(event => event.id)},status: {in: ["pending","confirmed"]}},
    orderBy: [{requestedAt:"asc"},{id:"asc"}],
    select: {outgoingEventId:true,status:true,requestedAt:true,requestedByUserId:true},
  });
  return settled.flatMap(event => {
    const own = requests.filter(row => row.outgoingEventId === event.id);
    if (own.some(row => row.status === "confirmed")) return [];
    const request = own.find(row => row.status === "pending");
    return request ? [{event,requestedAt:request.requestedAt,requestedByUserId:request.requestedByUserId}] : [];
  });
}
