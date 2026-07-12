import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { AuthModule } from "../auth/auth.module";
import { FileModule } from "../file/file.module";
import { ContractDocumentController } from "./contract-document.controller";
import { ContractDocumentProcessor } from "./contract-document.processor";
import { ContractDocumentService } from "./contract-document.service";
import { ContractNegotiationService } from "./contract-negotiation.service";

@Module({
  imports: [AuditModule, AuthModule, FileModule],
  controllers: [ContractDocumentController],
  providers: [ContractDocumentService, ContractNegotiationService, ContractDocumentProcessor],
  exports: [ContractDocumentService]
})
export class ContractDocumentModule {}
