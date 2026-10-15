import { type CanActivate, type ExecutionContext, Injectable } from "@nestjs/common";
import { accountClientAddress, AuthRateLimitService, type AccountHttpRequest } from "../auth-rate-limit.service";

@Injectable()
export class AccountRateLimitGuard implements CanActivate {
  constructor(private readonly limits: AuthRateLimitService) {}
  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<AccountHttpRequest>();
    if (req.method !== "POST") return true;
    const path: string = req.route?.path ?? req.path ?? "";
    if (!["/auth/login", "/employee-onboarding/login", "/employee-onboarding/register", "/account-security/recover", "/account-security/reset-with-sms"].includes(path)) return true;
    const registration = path.endsWith("/register");
    const phone = typeof req.body?.phone === "string" ? req.body.phone.slice(0, 20) : "invalid";
    await this.limits.take([
      { scope: "account-ip", value: accountClientAddress(req), seconds: 900, max: 300 },
      { scope: registration ? "registration-phone" : "login-phone", value: phone, seconds: 900, max: registration ? 5 : 30 }
    ]);
    return true;
  }
}
