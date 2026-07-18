import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { AuditModule } from "../audit/audit.module";
import { SpotProcurementAccessModule } from "../spot-procurement/spot-procurement-access.module";
import { FileController } from "./file.controller";
import { FileService, PrivateFileStorage } from "./file.service";

@Module({
  imports: [AuditModule, AuthModule, SpotProcurementAccessModule],
  controllers: [FileController],
  providers: [FileService, PrivateFileStorage],
  exports: [FileService]
})
export class FileModule {}
