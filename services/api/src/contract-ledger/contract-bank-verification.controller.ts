import {Body,Controller,Get,Param,Post,Query} from "@nestjs/common";
import {CurrentUser} from "../auth/decorators/current-user.decorator";
import type {AuthenticatedUser} from "../auth/auth.types";
import {ContractBankVerificationService,type PrepareBankVerification} from "./contract-bank-verification.service";
@Controller("contract-bank-verifications")
export class ContractBankVerificationController{
 constructor(private readonly service:ContractBankVerificationService){}
 @Get() list(@CurrentUser() u:AuthenticatedUser,@Query("projectId") p:string,@Query("page") page?:string,@Query("status") status?:string){return this.service.list(u.id,p||null,page===undefined?1:Number(page),status);}
 @Post() prepare(@CurrentUser() u:AuthenticatedUser,@Body() b:PrepareBankVerification){return this.service.prepare(u.id,b);}
 @Post(":id/decision") decide(@CurrentUser() u:AuthenticatedUser,@Param("id") id:string,@Body() b:{decision:"confirm"|"return";holderEvidenceFileId?:string;accountNumber?:string;confirmationPassword:string}){return this.service.decide(u.id,id,b);}
}
