import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { AuditModule } from "../audit/audit.module";
import { SpotProcurementAccessModule } from "../spot-procurement/spot-procurement-access.module";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { JwtAuthGuard } from "./guards/jwt-auth.guard";
import { PermissionGuard } from "./guards/permission.guard";
import { JwtTokenService } from "./jwt-token.service";
import { ProjectVisibilityService } from "./project-visibility.service";

@Module({
  imports: [AuditModule, SpotProcurementAccessModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtTokenService,
    ProjectVisibilityService,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionGuard }
  ],
  exports: [AuthService, JwtTokenService, ProjectVisibilityService]
})
export class AuthModule {}
