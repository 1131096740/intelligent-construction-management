import type { Prisma } from "@prisma/client";
export async function matchedUpwardReceipts(tx:Pick<Prisma.TransactionClient,"upwardReceiptMatch">,where:{receiptFactId?:string;settlementLedgerId?:string},pending=false,excludeId?:string){
 const rows=await tx.upwardReceiptMatch.findMany({where:{...where,...(excludeId?{id:{not:excludeId}}:{}),OR:[{status:"confirmed"},...(pending?[{status:"pending_confirm",originalId:null}]:[])]}});
 return rows.reduce((sum,r)=>sum+(r.originalId?-r.amountCents:r.amountCents),0n);
}
