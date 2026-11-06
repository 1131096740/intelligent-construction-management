import type { Prisma } from "@prisma/client";

/** Real source relationships, never caller labels, select the wage domain. */
export async function registeredExecutionIsWageLinked(tx: Prisma.TransactionClient, executionId: string) {
  if (await tx.paymentExecutionWagePayableBinding.findFirst({where:{paymentExecutionId:executionId},select:{id:true}})) return true;
  return Boolean(await tx.historicalWageSummaryPaymentExecutionLink.findFirst({where:{paymentExecutionId:executionId},select:{id:true}}));
}

/** Protocol ownership only: never infer permission, approved workflow or funds.
 * Missing/returned approval therefore cannot restore the legacy bank entry. */
export async function currentRegisteredPaymentDomain(tx: Prisma.TransactionClient, paymentId: string) {
  const payment = await tx.paymentRequest.findUnique({where:{id:paymentId}});
  if (!payment || payment.paymentSubjectType !== "our_company" || !["settlement","contract_due","contract_advance"].includes(payment.sourceType)) return {supportedDomain:false,payment,version:null,executions:[]};
  const version = await tx.contractVersion.findUnique({where:{id:payment.contractVersionId}});
  const executions = await tx.paymentExecution.findMany({where:{paymentRequestId:payment.id},select:{id:true,voucherFileId:true}});
  if (version?.signingSubjectType !== "our_company") return {supportedDomain:false,payment,version,executions};
  for (const execution of executions) if (await registeredExecutionIsWageLinked(tx,execution.id)) return {supportedDomain:false,payment,version,executions};
  return {supportedDomain:true,payment,version,executions};
}
