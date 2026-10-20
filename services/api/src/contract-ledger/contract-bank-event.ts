import {BadRequestException,ConflictException} from "@nestjs/common";
import type {Prisma} from "@prisma/client";
import {assertContractBankProject} from "./contract-bank-project";
import {businessDay} from "./contract-proxy-bank";
/** One real company-bank event, shared by ordinary payments, remittances and proxy handling. */
export async function requireContractBankEvent(tx:Prisma.TransactionClient,input:{projectId:string;reference?:string;companyId:string;amountCents:bigint;occurredAt:Date;direction:"inflow"|"outflow"}){
 if(!input.reference?.trim())throw new BadRequestException("请选择已核验银行流水；实际收付须先核验银行交易再登记");
 const observation=await tx.verifiedBankTransactionObservation.findUnique({where:{reference:input.reference.trim()}});
 if(!observation)throw new BadRequestException("已核验银行流水不存在，请刷新候选");
 await tx.$queryRaw`SELECT "id" FROM "VerifiedBankTransactionObservation" WHERE "id"=${observation.id} FOR UPDATE`;
 if(observation.holderCompanyEntityId!==input.companyId||observation.amountCents!==input.amountCents||observation.direction!==input.direction||businessDay(observation.occurredAt)!==businessDay(input.occurredAt))throw new BadRequestException("银行流水主体、方向、金额或日期与本次收付不符");
 await assertContractBankProject(tx,observation,input.projectId);
 if(await tx.companyTransferBankClaim.count({where:{observationId:observation.id}})||await tx.bankTransactionClaim.count({where:{observationId:observation.id}})||await tx.contractProxyBankClaim.count({where:{observationId:observation.id}})||await tx.contractBankEventClaim.count({where:{observationId:observation.id}}))throw new ConflictException("该银行流水已认领，不能重复登记收付款");
 return observation;
}
export async function claimContractBankEvent(tx:Prisma.TransactionClient,observationId:string,sourceType:"payment_execution"|"project_upstream_fund_fact",sourceId:string,actor:string){
 await tx.contractBankEventClaim.create({data:{observationId,sourceType,sourceId,createdByUserId:actor}});
}
