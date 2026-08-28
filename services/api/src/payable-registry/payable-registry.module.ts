import { Module } from "@nestjs/common";

import { AuditModule } from "../audit/audit.module";
import { AuthModule } from "../auth/auth.module";
import { DatabaseModule } from "../database/database.module";
import { FileModule } from "../file/file.module";
import { PayableRegistryController } from "./payable-registry.controller";
import { PayableRegistryService } from "./payable-registry.service";

@Module({
  imports: [DatabaseModule, AuthModule, AuditModule, FileModule],
  controllers: [PayableRegistryController],
  providers: [PayableRegistryService],
  exports: [PayableRegistryService]
})
export class PayableRegistryModule {}
