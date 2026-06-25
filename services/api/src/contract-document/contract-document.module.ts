import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { FileModule } from "../file/file.module";
import { ContractDocumentController } from "./contract-document.controller";
import { ContractDocumentProcessor } from "./contract-document.processor";
import { ContractDocumentService } from "./contract-document.service";

@Module({
  imports: [AuditModule, FileModule],
  controllers: [ContractDocumentController],
  providers: [ContractDocumentService, ContractDocumentProcessor],
  exports: [ContractDocumentService]
})
export class ContractDocumentModule {}
