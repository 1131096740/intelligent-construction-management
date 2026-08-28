import { Module } from "@nestjs/common";

import { AuditModule } from "../audit/audit.module";
import { AuthModule } from "../auth/auth.module";
import { DatabaseModule } from "../database/database.module";
import { PayableRegistryController } from "./payable-registry.controller";
import { PayableRegistryService } from "./payable-registry.service";

@Module({
  imports: [DatabaseModule, AuthModule, AuditModule],
  controllers: [PayableRegistryController],
  providers: [PayableRegistryService],
  exports: [PayableRegistryService]
})
export class PayableRegistryModule {}
