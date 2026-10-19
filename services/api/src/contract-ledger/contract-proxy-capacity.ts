import type { Prisma } from "@prisma/client";
export function allocatedProxyAmount(row:{sourceRef:string;amountCents:bigint;frozenSource:unknown},sourceRef:string){
 const source=row.frozenSource as {allocations?:Array<{sourceRef:string;amountCents:string}>};
 return source?.allocations?source.allocations.filter(a=>a.sourceRef===sourceRef).reduce((s,a)=>s+BigInt(a.amountCents),0n):row.sourceRef===sourceRef?row.amountCents:0n;
}
export async function contractProxyPaid(tx:Prisma.TransactionClient,sourceRef:string,includePending=false,unlinkedOnly=false){
 const rows=await tx.contractProxyExecution.findMany({where:{AND:[{OR:[{sourceRef},{frozenSource:{path:["sourceRefs"],array_contains:[sourceRef]}}]},{OR:[{entryKind:"payment",status:{in:includePending?["pending_confirm","confirmed"]:["confirmed"]}},{entryKind:"refund",status:"confirmed"}]}],...(unlinkedOnly?{paymentRequestId:null}:{})},select:{entryKind:true,amountCents:true,sourceRef:true,frozenSource:true}});
 return rows.reduce((sum,r)=>sum+(r.entryKind==="refund"?-1n:1n)*allocatedProxyAmount(r,sourceRef),0n);
}
export async function contractProxyPaidForContract(tx:Prisma.TransactionClient,contractId:string){
 const settlements=await tx.settlement.findMany({where:{contractId},select:{id:true}});
 let total=0n;
 for(const s of settlements)total+=await contractProxyPaid(tx,`settlement:${s.id}`,false,true);
 return total;
}

export async function proxyRepaymentCompanyCash(tx:Prisma.TransactionClient,projectId:string){
 const rows=await tx.contractProxyExecution.findMany({where:{projectId,status:"confirmed",entryKind:"repayment"},select:{amountCents:true,frozenSource:true}});
 return rows.reduce((sum,row)=>{const source=row.frozenSource as unknown as import("./contract-proxy-source").ProxySource;return sum+(source.debtor.kind==="construction_enterprise"&&source.actualPayer.kind==="participating_company"?row.amountCents:0n);},0n);
}
