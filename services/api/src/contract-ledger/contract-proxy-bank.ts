import {assertContractBankProject} from "./contract-bank-project";
import {BadRequestException,ConflictException} from "@nestjs/common";
import type {Prisma} from "@prisma/client";
import type {ProxySource} from "./contract-proxy-source";
export async function validateProxyBank(tx:Prisma.TransactionClient,source:ProxySource,entryKind:string,amount:bigint,date:Date,observationId?:string|null,projectId?:string){
 const holder=entryKind==="repayment"&&source.debtor.kind==="participating_company"?source.debtor:source.actualPayer;
 if(holder.kind!=="participating_company") {if(observationId)throw new BadRequestException("施工企业账户不能套用我方账户流水");return null;}
 if(!observationId)throw new BadRequestException("涉及我方公司账户的真实收付必须选择已核验银行流水");
 await tx.$queryRaw`SELECT "id" FROM "VerifiedBankTransactionObservation" WHERE "id"=${observationId} FOR UPDATE`;
 const observation=await tx.verifiedBankTransactionObservation.findUnique({where:{id:observationId}});
 const direction=entryKind==="payment"||(entryKind==="repayment"&&source.debtor.kind==="participating_company")?"outflow":"inflow";
 const day=(d:Date)=>d.toLocaleDateString("en-CA",{timeZone:"Asia/Shanghai"});
 if(!observation||observation.holderCompanyEntityId!==holder.id||observation.amountCents!==amount||observation.direction!==direction||day(observation.occurredAt)!==day(date))throw new BadRequestException("银行流水持有人、方向、金额或实际日期与本次收付不符");
 await assertContractBankProject(tx,observation,projectId??"");
 if(await tx.companyTransferBankClaim.count({where:{observationId}})||await tx.contractBankEventClaim.count({where:{observationId}})||await tx.bankTransactionClaim.count({where:{observationId}})||await tx.contractProxyBankClaim.count({where:{observationId}}))throw new ConflictException("该银行流水已在付款或资金执行中认领，不能重复登记");
 return observation;
}

export async function validateProxyReceivingBank(tx:Prisma.TransactionClient,source:ProxySource,entryKind:string,amount:bigint,date:Date,id?:string|null,projectId?:string){
 if(entryKind!=="repayment"||source.debtor.kind!=="participating_company"||source.actualPayer.kind!=="participating_company"){
  if(id)throw new BadRequestException("仅我方公司之间归还需要收款侧流水");return null;
 }
 return validateProxyBank(tx,{...source,debtor:source.actualPayer},"refund",amount,date,id,projectId);
}
export const businessDay=(date:Date)=>date.toLocaleDateString("en-CA",{timeZone:"Asia/Shanghai"});
