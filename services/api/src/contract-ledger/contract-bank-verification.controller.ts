import { RetryDutyNotificationDto } from "../approval/retry-duty-notification.dto";
import { ContractBankVerificationNotificationService } from "./contract-bank-verification-notification.service";
import {BadRequestException,Body,Controller,Get,Optional,Param,Post,Query} from "@nestjs/common";
import {CurrentUser} from "../auth/decorators/current-user.decorator";
import type {AuthenticatedUser} from "../auth/auth.types";
import {ContractBankVerificationService,type PrepareBankVerification} from "./contract-bank-verification.service";
@Controller("contract-bank-verifications")
export class ContractBankVerificationController{
 constructor(private readonly service:ContractBankVerificationService,
  @Optional() private readonly notifications?:ContractBankVerificationNotificationService){}
 @Get() list(@CurrentUser() u:AuthenticatedUser,@Query("projectId") p:string,@Query("page") page?:string,@Query("status") status?:string){return this.service.list(u.id,p||null,page===undefined?1:Number(page),status);}
 @Post() prepare(@CurrentUser() u:AuthenticatedUser,@Body() b:PrepareBankVerification){return this.service.prepare(u.id,b);}
 @Get(":id/duty-sms")
 async dutySmsStatus(@CurrentUser() actor:AuthenticatedUser,@Param("id") id:string) {
  return {notice:await this.notifications?.notificationStatus(id,actor.id)??null};
 }
 @Post(":id/duty-sms/retry")
 retryDutySms(@CurrentUser() actor:AuthenticatedUser,@Param("id") id:string,@Body() input:RetryDutyNotificationDto) {
  if(!this.notifications)throw new BadRequestException("短信通知暂不可用");
  return this.notifications.retry(id,actor.id,input.attemptId);
 }
 @Post(":id/decision") decide(@CurrentUser() u:AuthenticatedUser,@Param("id") id:string,@Body() b:{decision:"confirm"|"return";holderEvidenceFileId?:string;accountNumber?:string;confirmationPassword:string}){return this.service.decide(u.id,id,b);}
}
