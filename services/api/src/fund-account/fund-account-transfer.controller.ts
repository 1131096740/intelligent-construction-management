import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import type { AuthenticatedUser } from "../auth/auth.types";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { RequirePositions } from "../auth/decorators/require-positions.decorator";
import { ActOnFundAccountTransferDto, RegisterFundAccountTransferDto } from "./fund-account-transfer.dto";
import { FundAccountTransferService } from "./fund-account-transfer.service";

@Controller("fund-account-transfers")
@RequirePositions("finance_staff", "finance_director", "comprehensive_director")
export class FundAccountTransferController {
  constructor(private readonly transfers: FundAccountTransferService) {}

  @Get()
  list(@CurrentUser() actor: AuthenticatedUser) { return this.transfers.list(actor.id); }

  @Post()
  register(@CurrentUser() actor: AuthenticatedUser, @Body() input: RegisterFundAccountTransferDto) {
    return this.transfers.register(actor.id, input);
  }

  @Post(":id/actions")
  act(@CurrentUser() actor: AuthenticatedUser, @Param("id") id: string, @Body() input: ActOnFundAccountTransferDto) {
    return this.transfers.act(actor.id, id, input);
  }
}
