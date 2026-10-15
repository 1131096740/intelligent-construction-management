import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { AuditModule } from "../audit/audit.module";
import { SpotProcurementAccessModule } from "../spot-procurement/spot-procurement-access.module";
import { ContractCutoverGuard } from "../contract-cutover/contract-cutover.guard";
import { OperationalWriteFreezeGuard } from "../operational-write-freeze/operational-write-freeze.guard";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { JwtAuthGuard } from "./guards/jwt-auth.guard";
import { PermissionGuard } from "./guards/permission.guard";
import { JwtTokenService } from "./jwt-token.service";
import { ProjectVisibilityService } from "./project-visibility.service";
import { CompanyRoleResolverService } from "./company-role-resolver.service";
import { OperationalWriteFreezeService } from "../operational-write-freeze/operational-write-freeze.service";
import { RetiredWriteEntryGuard } from "../retired-write-entry/retired-write-entry.guard";
import { AccountSecurityController } from "./account-security.controller";
import { AccountSecurityService } from "./account-security.service";
import { SmsVerificationService } from "./sms-verification.service";
import { TencentSmsGateway } from "./tencent-sms.gateway";
import { AuthRateLimitService } from "./auth-rate-limit.service";
import { AccountRateLimitGuard } from "./guards/account-rate-limit.guard";

@Module({
  imports: [AuditModule, SpotProcurementAccessModule],
  controllers: [AuthController, AccountSecurityController],
  providers: [
    AuthService,
    AccountSecurityService,
    SmsVerificationService,
    TencentSmsGateway,
    AuthRateLimitService,
    JwtTokenService,
    CompanyRoleResolverService,
    OperationalWriteFreezeService,
    ProjectVisibilityService,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RetiredWriteEntryGuard },
    { provide: APP_GUARD, useClass: OperationalWriteFreezeGuard },
    { provide: APP_GUARD, useClass: AccountRateLimitGuard },
    { provide: APP_GUARD, useClass: PermissionGuard },
    { provide: APP_GUARD, useClass: ContractCutoverGuard }
  ],
  exports: [
    AuthService,
    SmsVerificationService,
    JwtTokenService,
    ProjectVisibilityService,
    CompanyRoleResolverService,
    OperationalWriteFreezeService
  ]
})
export class AuthModule {}
