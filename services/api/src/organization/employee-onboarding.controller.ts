import { Body, Controller, Get, Headers, Param, Post } from "@nestjs/common";
import { Public } from "../auth/decorators/public.decorator";
import { ApplicationLoginDto, EmployeeRegistrationDto, ReviewEmployeeRegistrationDto, ResubmitEmployeeRegistrationDto } from "./dto/employee-registration.dto";
import { EmployeeOnboardingService } from "./employee-onboarding.service";
import { RequirePositions } from "../auth/decorators/require-positions.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { AuthenticatedUser } from "../auth/auth.types";
import { ApplicationPasswordDto } from "../auth/dto/account-security.dto";

@Controller("employee-onboarding")
export class EmployeeOnboardingController {
  constructor(private readonly onboarding: EmployeeOnboardingService) {}

  @Public()
  @Post("register")
  register(@Body() body: EmployeeRegistrationDto) { return this.onboarding.register(body); }

  @Public()
  @Post("login")
  login(@Body() body: ApplicationLoginDto) { return this.onboarding.login(body); }

  @Public()
  @Get("mine")
  mine(@Headers("authorization") authorization?: string) { return this.onboarding.mine(authorization); }

  @Public()
  @Post("mine")
  resubmit(@Body() body: ResubmitEmployeeRegistrationDto, @Headers("authorization") authorization?: string) {
    return this.onboarding.resubmit(body, authorization);
  }
  @Public()
  @Post("mine/password")
  changePassword(@Body() body: ApplicationPasswordDto, @Headers("authorization") authorization?: string) {
    return this.onboarding.changeApplicationPassword(body.newPassword, authorization);
  }

  @Get("applications")
  @RequirePositions("chairman", "comprehensive_director")
  applications(@CurrentUser() actor: AuthenticatedUser) { return this.onboarding.list(actor.id); }

  @Post("applications/:id/review")
  @RequirePositions("chairman", "comprehensive_director")
  review(@Param("id") id: string, @CurrentUser() actor: AuthenticatedUser, @Body() body: ReviewEmployeeRegistrationDto) {
    return this.onboarding.review(id, actor.id, body);
  }
}
