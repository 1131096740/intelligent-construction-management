import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { AuditModule } from "../audit/audit.module";
import { FileController } from "./file.controller";
import { FileService, PrivateFileStorage } from "./file.service";

@Module({
  imports: [AuditModule, AuthModule],
  controllers: [FileController],
  providers: [FileService, PrivateFileStorage],
  exports: [FileService]
})
export class FileModule {}
