import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import { RetryDutyNotificationDto } from "../approval/retry-duty-notification.dto";
import type { AuthenticatedUser } from "../auth/auth.types";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { RequirePositions } from "../auth/decorators/require-positions.decorator";
import { ActPrincipalReturnDto, ApplyPrincipalReturnDto, PayPrincipalReturnDto } from "./fund-principal-return.dto";
import { FundPrincipalReturnNotificationService } from "./fund-principal-return-notification.service";
import { FundPrincipalReturnService } from "./fund-principal-return.service";

@Controller("fund-accounts/principal-returns")
export class FundPrincipalReturnController {
  constructor(private readonly returns: FundPrincipalReturnService, private readonly notices: FundPrincipalReturnNotificationService) {}

  @Get()
  list(@CurrentUser() actor: AuthenticatedUser) { return this.returns.list(actor.id); }

  @RequirePositions("comprehensive_director")
  @Post("applications")
  apply(@CurrentUser() actor: AuthenticatedUser, @Body() input: ApplyPrincipalReturnDto) {
    return this.returns.apply(actor.id,input);
  }

  @Post("applications/:id/actions")
  act(@CurrentUser() actor: AuthenticatedUser, @Param("id",new ParseUUIDPipe({version:"4"})) id: string, @Body() input: ActPrincipalReturnDto) {
    return this.returns.act(actor.id,id,input);
  }

  @RequirePositions("comprehensive_director","finance_staff","finance_director")
  @Post("applications/:id/payments")
  pay(@CurrentUser() actor: AuthenticatedUser, @Param("id",new ParseUUIDPipe({version:"4"})) id: string, @Body() input: PayPrincipalReturnDto) {
    return this.returns.pay(actor.id,id,input);
  }

  @Get("applications/:id/duty-sms/:dutyKey")
  dutySms(@CurrentUser() actor: AuthenticatedUser, @Param("id",new ParseUUIDPipe({version:"4"})) id: string,
    @Param("dutyKey") dutyKey: string) {
    return this.notices.status(id, actor.id, dutyKey);
  }

  @Post("applications/:id/duty-sms/:dutyKey/retry")
  retryDutySms(@CurrentUser() actor: AuthenticatedUser, @Param("id",new ParseUUIDPipe({version:"4"})) id: string,
    @Param("dutyKey") dutyKey: string, @Body() input: RetryDutyNotificationDto) {
    return this.notices.retry(id, actor.id, dutyKey, input.attemptId);
  }

  @Get("results/:key")
  result(@CurrentUser() actor: AuthenticatedUser, @Param("key",new ParseUUIDPipe({version:"4"})) key: string) {
    return this.returns.result(actor.id,key);
  }
}
