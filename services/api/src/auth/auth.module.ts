import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { AuditModule } from "../audit/audit.module";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { JwtAuthGuard } from "./guards/jwt-auth.guard";
import { PermissionGuard } from "./guards/permission.guard";
import { JwtTokenService } from "./jwt-token.service";

@Module({
  imports: [AuditModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtTokenService,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionGuard }
  ],
  exports: [AuthService, JwtTokenService]
})
export class AuthModule {}
