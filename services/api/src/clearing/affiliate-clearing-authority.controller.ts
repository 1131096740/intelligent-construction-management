import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";

import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { RequireProjectRole } from "../auth/decorators/require-project-role.decorator";
import type { AuthenticatedUser } from "../auth/auth.types";
import type { AuthorityLifecycleDto, CreateAffiliateClearingAuthorityDto } from "./affiliate-clearing-authority.dto";
import { AffiliateClearingAuthorityService } from "./affiliate-clearing-authority.service";

@Controller("affiliate-clearing-authorities")
export class AffiliateClearingAuthorityController {
  constructor(private readonly authorities: AffiliateClearingAuthorityService) {}

  @Get("options")
  options(@CurrentUser() user: AuthenticatedUser, @Query("projectId") projectId?: string) {
    return this.authorities.options(user.id, projectId);
  }

  @Get("allocation-options/:caseId")
  allocationOptions(@CurrentUser() user: AuthenticatedUser, @Param("caseId") caseId: string) {
    return this.authorities.allocationOptions(user.id, caseId);
  }

  @Post()
  @RequireProjectRole("clearing.prepare")
  create(@CurrentUser() user: AuthenticatedUser, @Body() input: CreateAffiliateClearingAuthorityDto) {
    return this.authorities.createAuthority(user.id, input);
  }

  @Post(":authorityId/submit")
  @RequireProjectRole("clearing.submit")
  submit(@CurrentUser() user: AuthenticatedUser, @Param("authorityId") authorityId: string, @Body() input: AuthorityLifecycleDto) {
    return this.authorities.submitAuthority(user.id, authorityId, input);
  }

  @Post(":authorityId/confirm")
  @RequireProjectRole("clearing.confirm")
  confirm(@CurrentUser() user: AuthenticatedUser, @Param("authorityId") authorityId: string, @Body() input: AuthorityLifecycleDto) {
    return this.authorities.confirmAuthority(user.id, authorityId, input);
  }

  @Post(":authorityId/return")
  @RequireProjectRole("clearing.return")
  return(@CurrentUser() user: AuthenticatedUser, @Param("authorityId") authorityId: string, @Body() input: AuthorityLifecycleDto) {
    return this.authorities.returnAuthority(user.id, authorityId, input);
  }

}
