import { Body, Controller, Delete, Get, Param, Post } from "@nestjs/common";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { AuthenticatedUser } from "../auth/auth.types";
import { ApprovalDelegationService } from "./approval-delegation.service";
import { CreateApprovalDelegationDto } from "./dto/create-approval-delegation.dto";

// 委托台账：任何登录用户都可管理自己的委托关系，无需业务审批岗位，故不挂 @RequireProjectRole。
@Controller("approval-delegations")
export class ApprovalDelegationController {
  constructor(private readonly delegations: ApprovalDelegationService) {}

  @Post()
  create(@Body() body: CreateApprovalDelegationDto, @CurrentUser() user: AuthenticatedUser) {
    return this.delegations.create(user.id, body);
  }

  @Get("user-options")
  userOptions(@CurrentUser() user: AuthenticatedUser) {
    return this.delegations.listActiveUserOptions(user.id);
  }

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.delegations.listForUser(user.id);
  }

  @Delete(":delegationId")
  revoke(@Param("delegationId") delegationId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.delegations.revoke(delegationId, user.id);
  }
}
