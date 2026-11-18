import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import type { AuthenticatedUser } from "../auth/auth.types";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { RequirePositions } from "../auth/decorators/require-positions.decorator";
import { ClaimInitialPublicCashCustodyDto, ConfirmPublicCashHandoverDto, StartPublicCashHandoverDto } from "./public-cash-handover.dto";
import { PublicCashHandoverService } from "./public-cash-handover.service";

@Controller("public-cash-handovers")
@RequirePositions("comprehensive_director", "finance_staff", "finance_director")
export class PublicCashHandoverController {
  constructor(private readonly handovers: PublicCashHandoverService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.handovers.list(user.id);
  }

  @Post("initial-custodian")
  claimInitial(@CurrentUser() user: AuthenticatedUser, @Body() input: ClaimInitialPublicCashCustodyDto) {
    return this.handovers.claimInitial(user.id, input);
  }

  @Post()
  start(@CurrentUser() user: AuthenticatedUser, @Body() input: StartPublicCashHandoverDto) {
    return this.handovers.start(user.id, input);
  }

  @Post(":id/confirmation")
  confirm(@CurrentUser() user: AuthenticatedUser, @Param("id", new ParseUUIDPipe({ version: "4" })) id: string, @Body() input: ConfirmPublicCashHandoverDto) {
    return this.handovers.confirm(user.id, id, input);
  }
}
