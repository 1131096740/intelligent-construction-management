import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { FileController } from "./file.controller";
import { FileService, PrivateFileStorage } from "./file.service";

@Module({
  imports: [AuditModule],
  controllers: [FileController],
  providers: [FileService, PrivateFileStorage],
  exports: [FileService]
})
export class FileModule {}
