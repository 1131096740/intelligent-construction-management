import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { DatabaseModule } from "../database/database.module";
import { FileModule } from "../file/file.module";
import { ContractDocumentProcessor } from "./contract-document.processor";

@Module({
  imports: [AuditModule, DatabaseModule, FileModule],
  providers: [ContractDocumentProcessor]
})
export class ContractDocumentWorkerModule {}
