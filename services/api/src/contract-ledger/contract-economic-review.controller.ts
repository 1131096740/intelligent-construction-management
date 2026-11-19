import { RetryDutyNotificationDto } from "../approval/retry-duty-notification.dto";
import { EconomicFinanceNotificationService } from "./economic-finance-notification.service";
import { Body, Controller, Get, Optional, ServiceUnavailableException, Param, Post, Query } from "@nestjs/common";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { AuthenticatedUser } from "../auth/auth.types";
import { ContractEconomicReviewService, type PrepareEconomicReview } from "./contract-economic-review.service";
@Controller("contract-economic-reviews")
export class ContractEconomicReviewController {
 constructor(private readonly reviews:ContractEconomicReviewService, @Optional() private readonly notifications?: EconomicFinanceNotificationService){}
 @Get("counterparties") counterparties(@CurrentUser() user:AuthenticatedUser,@Query("projectId") projectId:string){return this.reviews.counterparties(user.id,projectId);}
 @Get() list(@CurrentUser() user:AuthenticatedUser,@Query("projectId") projectId:string){return this.reviews.list(user.id,projectId);}
 @Post() prepare(@CurrentUser() user:AuthenticatedUser,@Body() input:PrepareEconomicReview){return this.reviews.prepare(user.id,input);}
 @Post("settlement-coverage") prepareSettlement(@CurrentUser() user:AuthenticatedUser,@Body() input:{projectId:string;sourceRef:string;allocations:unknown;confirmationPassword:string}){return this.reviews.prepareSettlement(user.id,input);}
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
 @Post(":id/decision") decide(@CurrentUser() user:AuthenticatedUser,@Param("id") id:string,@Body() input:{revision:number;decision:"confirm"|"return";reason?:string;confirmationPassword:string}){return this.reviews.decide(user.id,id,input);}
}
