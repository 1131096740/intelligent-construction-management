import { RetryDutyNotificationDto } from "../approval/retry-duty-notification.dto";
import { UpwardAmountNotificationService } from "./upward-amount-notification.service";
import { Body,Controller,Get, Optional, ServiceUnavailableException,Param,Post,Query } from "@nestjs/common";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { AuthenticatedUser } from "../auth/auth.types";
import { UpwardContractAmountService,type PrepareUpwardAmount } from "./upward-contract-amount.service";
@Controller("upward-contract-amount-revisions")
export class UpwardContractAmountController {
 constructor(private readonly service:UpwardContractAmountService, @Optional() private readonly notifications?: UpwardAmountNotificationService){}
 @Get() list(@CurrentUser() user:AuthenticatedUser,@Query("projectId") projectId:string){return this.service.list(user.id,projectId);}
 @Post() prepare(@CurrentUser() user:AuthenticatedUser,@Body() input:PrepareUpwardAmount){return this.service.prepare(user.id,input);}
 @Get(":id/duty-sms")
 dutySms(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
   if (!this.notifications) throw new ServiceUnavailableException("待办短信状态暂不可用");
   return this.notifications.status(id, user.id);
 }
 @Post(":id/duty-sms/retry")
 retryDutySms(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() body: RetryDutyNotificationDto) {
   if (!this.notifications) throw new ServiceUnavailableException("待办短信状态暂不可用");
   return this.notifications.retry(id, user.id, body.attemptId);
 }
 @Post(":id/decision") decide(@CurrentUser() user:AuthenticatedUser,@Param("id") id:string,@Body() input:{decision:"confirm"|"return";confirmationPassword:string}){return this.service.decide(user.id,id,input);}
}
