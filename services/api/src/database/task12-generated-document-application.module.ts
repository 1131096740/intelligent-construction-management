import { Module } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import { ContractDocumentWorkerModule } from "../contract-document/contract-document-worker.module";
import { ContractTemplateModule } from "../contract-template/contract-template.module";
import { ContractModule } from "../contract/contract.module";
import { ProjectOperatingConstraintFilter } from "../project/project-operating-constraint.filter";
import { DatabaseModule } from "./database.module";

@Module({
  imports: [DatabaseModule, ContractModule, ContractTemplateModule, ContractDocumentWorkerModule],
  providers: [{ provide: APP_FILTER, useClass: ProjectOperatingConstraintFilter }]
})
export class Task12GeneratedDocumentApplicationModule {}
