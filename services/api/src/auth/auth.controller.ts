import { Body, Controller, Post, Req, UnauthorizedException } from "@nestjs/common";
import { Public } from "./decorators/public.decorator";
import type { AuthenticatedRequest } from "./auth.types";
import { AuthService } from "./auth.service";
import type { ChangePasswordDto } from "./dto/change-password.dto";
import type { LoginDto } from "./dto/login.dto";
import type { LogoutDto } from "./dto/logout.dto";
import type { RefreshTokenDto } from "./dto/refresh-token.dto";
import type { WxLoginDto } from "./dto/wx-login.dto";

@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post("login")
  login(@Body() body: LoginDto) {
    return this.auth.login(body);
  }

  @Public()
  @Post("refresh")
  refresh(@Body() body: RefreshTokenDto) {
    return this.auth.refresh(body);
  }

  @Public()
  @Post("logout")
  logout(@Body() body: LogoutDto) {
    return this.auth.logout(body);
  }

  @Post("change-password")
  changePassword(@Req() request: AuthenticatedRequest, @Body() body: ChangePasswordDto) {
    if (!request.user) {
      throw new UnauthorizedException("Authenticated user is required");
    }

    return this.auth.changePassword(request.user, body);
  }

  @Public()
  @Post("wx-login")
  wxLogin(@Body() body: WxLoginDto) {
    return this.auth.wxLogin(body);
  }
}
