import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { AuthModule } from "../auth/auth.module";
import { DatabaseModule } from "../database/database.module";
import { FileModule } from "../file/file.module";
import { ContractDocumentProcessor } from "./contract-document.processor";

@Module({
  imports: [AuditModule, AuthModule, DatabaseModule, FileModule],
  providers: [ContractDocumentProcessor]
})
export class ContractDocumentWorkerModule {}
