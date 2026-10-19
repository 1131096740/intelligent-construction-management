import {BadRequestException} from "@nestjs/common";
import type {Prisma} from "@prisma/client";
export async function contractBankProject(tx:Prisma.TransactionClient,observation:{transactionSourceType:string;transactionSourceId:string}):Promise<string|null>{
 if(observation.transactionSourceType!=="contract_bank_verification")return null;
 const request=await tx.contractBankVerificationRequest.findUnique({where:{id:observation.transactionSourceId},select:{projectId:true,status:true}});
 if(!request||request.status!=="confirmed")throw new BadRequestException("银行流水缺少已确认的项目核验依据");
 return request.projectId??"company_own_funds";
}
export async function assertContractBankProject(tx:Prisma.TransactionClient,observation:{transactionSourceType:string;transactionSourceId:string},projectId:string){const sourceProject=await contractBankProject(tx,observation);if(sourceProject&&sourceProject!==projectId)throw new BadRequestException("银行流水不属于本项目，不能跨项目认领");}
export async function contractBankProjectWhere(tx:Prisma.TransactionClient,projectId:string):Promise<Prisma.VerifiedBankTransactionObservationWhereInput>{
 const requests=await tx.contractBankVerificationRequest.findMany({where:{projectId,status:"confirmed"},select:{id:true}});
 return {OR:[{transactionSourceType:{not:"contract_bank_verification"}},{transactionSourceType:"contract_bank_verification",transactionSourceId:{in:requests.map(r=>r.id)}}]};
}
