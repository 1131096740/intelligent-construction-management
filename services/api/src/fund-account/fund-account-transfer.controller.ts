import { RetryDutyNotificationDto } from "../approval/retry-duty-notification.dto";
import { FundAccountTransferNotificationService } from "./fund-account-transfer-notification.service";
import { BadRequestException, Body, Controller, Get, Optional, Param, Post } from "@nestjs/common";
import type { AuthenticatedUser } from "../auth/auth.types";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { RequirePositions } from "../auth/decorators/require-positions.decorator";
import { ActOnFundAccountTransferDto, RegisterFundAccountTransferDto } from "./fund-account-transfer.dto";
import { FundAccountTransferService } from "./fund-account-transfer.service";

@Controller("fund-account-transfers")
@RequirePositions("finance_staff", "finance_director", "comprehensive_director")
export class FundAccountTransferController {
  constructor(private readonly transfers: FundAccountTransferService,
    @Optional() private readonly notifications?: FundAccountTransferNotificationService) {}

  @Get()
  list(@CurrentUser() actor: AuthenticatedUser) { return this.transfers.list(actor.id); }

  @Post()
  register(@CurrentUser() actor: AuthenticatedUser, @Body() input: RegisterFundAccountTransferDto) {
    return this.transfers.register(actor.id, input);
  }

  @Get(":id/duty-sms")
  async dutySmsStatus(@CurrentUser() actor: AuthenticatedUser, @Param("id") id: string) {
    return { notice: await this.notifications?.notificationStatus(id, actor.id) ?? null };
  }

  @Post(":id/duty-sms/retry")
  retryDutySms(@CurrentUser() actor: AuthenticatedUser, @Param("id") id: string, @Body() input: RetryDutyNotificationDto) {
    if (!this.notifications) throw new BadRequestException("短信通知暂不可用");
    return this.notifications.retry(id, actor.id, input.attemptId);
  }

  @Post(":id/actions")
  act(@CurrentUser() actor: AuthenticatedUser, @Param("id") id: string, @Body() input: ActOnFundAccountTransferDto) {
    return this.transfers.act(actor.id, id, input);
  }
}
