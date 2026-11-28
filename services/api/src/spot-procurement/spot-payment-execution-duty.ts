import type { Prisma, SpotProcurementPayment } from "@prisma/client";
import { loadProjectApprovalAssignments } from "../approval/project-approval-assignments";
import type { SpotProcurementPilotService } from "./spot-procurement-pilot.service";

export const spotPaymentDutySelect = {
  id:true,projectId:true,procurementId:true,procurementVersionId:true,code:true,status:true,
  companyPaymentAmountCents:true,canceledCompanyPaymentAmountCents:true,paidAmountCents:true,updatedAt:true,
  handlerUserId:true,payeeNameSnapshot:true,payerCompanyNameSnapshot:true
} as const;
type Payment = Pick<SpotProcurementPayment,keyof typeof spotPaymentDutySelect>;

export function effectiveSpotCompanyPaymentAmount(payment:Pick<Payment,"companyPaymentAmountCents"|"canceledCompanyPaymentAmountCents">) {
  const amount=payment.companyPaymentAmountCents-payment.canceledCompanyPaymentAmountCents;
  return amount>0n?amount:0n;
}

export function spotPaymentDutyAssignments(tx:Prisma.TransactionClient,projectId:string,actorId?:string) {
  return loadProjectApprovalAssignments(tx,projectId,["finance_staff"],actorId,false);
}

export async function currentSpotPaymentDuty(tx:Prisma.TransactionClient,pilot:SpotProcurementPilotService,payment:Payment) {
  const remaining=effectiveSpotCompanyPaymentAmount(payment)-payment.paidAmountCents;
  if (!["approved_pending_payment","partially_paid"].includes(payment.status) || remaining<=0n || !pilot.isEnabled(payment.projectId)) return null;
  const [root,version,discrepancy]=await Promise.all([
    tx.spotProcurement.findUnique({where:{id:payment.procurementId},select:{projectId:true,currentVersionId:true,status:true}}),
    tx.spotProcurementVersion.findUnique({where:{id:payment.procurementVersionId},select:{id:true,procurementId:true,status:true}}),
    tx.spotProcurementDiscrepancy.findFirst({where:{procurementId:payment.procurementId,status:"pending_resolution",invalidatedAt:null},select:{id:true}})
  ]);
  if (discrepancy || root?.projectId!==payment.projectId || root.currentVersionId!==version?.id ||
    root.status!=="approved_in_progress" || version?.status!=="approved" || version.procurementId!==payment.procurementId) return null;
  return remaining;
}
