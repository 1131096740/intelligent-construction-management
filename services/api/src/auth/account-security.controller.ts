import { Body, Controller, Get, Param, Post, Req } from "@nestjs/common";
import { CurrentUser } from "./decorators/current-user.decorator";
import { RequirePositions } from "./decorators/require-positions.decorator";
import { Public } from "./decorators/public.decorator";
import type { AuthenticatedUser } from "./auth.types";
import { AccountSecurityService } from "./account-security.service";
import { AdminResetPasswordDto, ConfirmAccountPasswordDto, RecoveryCodeResetDto, SendSmsDto, SmsPasswordResetDto, SmsPhoneDto } from "./dto/account-security.dto";
import { accountClientAddress, type AccountHttpRequest } from "./auth-rate-limit.service";

@Controller("account-security")
export class AccountSecurityController {
  constructor(private readonly security: AccountSecurityService) {}
  @Public()
  @Get("options")
  options() { return this.security.options(); }
  @Public()
  @Post("sms")
  sendSms(@Body() input: SendSmsDto, @Req() request: AccountHttpRequest) { return this.security.sendSms(input, accountClientAddress(request)); }
  @Post("phone-change-sms")
  phoneChangeSms(@Body() input: SmsPhoneDto, @CurrentUser() actor: AuthenticatedUser, @Req() request: AccountHttpRequest) {
    return this.security.sendPhoneChange(input.phone, actor.id, accountClientAddress(request));
  }
  @Public()
  @Post("reset-with-sms")
  resetWithSms(@Body() input: SmsPasswordResetDto) { return this.security.resetWithSms(input); }
  @Post("users/:id/reset-password")
  @RequirePositions("chairman", "comprehensive_director")
  resetUser(@Param("id") id: string, @CurrentUser() actor: AuthenticatedUser, @Body() input: AdminResetPasswordDto) {
    return this.security.resetUser(id, actor.id, input);
  }
  @Post("applications/:id/reset-password")
  @RequirePositions("chairman", "comprehensive_director")
  resetApplication(@Param("id") id: string, @CurrentUser() actor: AuthenticatedUser, @Body() input: AdminResetPasswordDto) {
    return this.security.resetApplication(id, actor.id, input);
  }
  @Post("recovery-code")
  @RequirePositions("chairman")
  createRecoveryCode(@CurrentUser() actor: AuthenticatedUser, @Body() input: ConfirmAccountPasswordDto) {
    return this.security.createRecoveryCode(actor.id, input.confirmationPassword);
  }
  @Public()
  @Post("recover")
  recover(@Body() input: RecoveryCodeResetDto) { return this.security.recover(input); }
}
