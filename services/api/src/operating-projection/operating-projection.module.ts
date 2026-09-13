import { Module } from "@nestjs/common";

import { AuditModule } from "../audit/audit.module";
import { AuthModule } from "../auth/auth.module";
import { ClearingModule } from "../clearing/clearing.module";
import { DatabaseModule } from "../database/database.module";
import { OperatingProjectionController } from "./operating-projection.controller";
import { OperatingProjectionService } from "./operating-projection.service";

@Module({
  imports: [DatabaseModule, AuditModule, AuthModule, ClearingModule],
  controllers: [OperatingProjectionController],
  providers: [OperatingProjectionService],
  exports: [OperatingProjectionService]
})
export class OperatingProjectionModule {}
