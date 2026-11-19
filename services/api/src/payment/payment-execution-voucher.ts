import type { Prisma } from "@prisma/client";

/** The original payment stays immutable; supplementary evidence is not a payment. */
export async function paymentExecutionVoucherFileId(client: Pick<Prisma.TransactionClient,"registeredPaymentVoucher">, execution: {id:string;voucherFileId:string|null}) {
  return execution.voucherFileId ?? (await client.registeredPaymentVoucher.findUnique({where:{executionId:execution.id}}))?.fileId ?? null;
}
