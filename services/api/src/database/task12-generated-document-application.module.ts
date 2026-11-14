import { Module } from "@nestjs/common";
import { APP_FILTER, APP_INTERCEPTOR } from "@nestjs/core";
import { ContractDocumentWorkerModule } from "../contract-document/contract-document-worker.module";
import { ContractTemplateModule } from "../contract-template/contract-template.module";
import { ContractModule } from "../contract/contract.module";
import { Task12AuthErrorFilter, Task12AuthStageInterceptor } from "./task12-auth-error-diagnostic";
import { DatabaseModule } from "./database.module";

@Module({
  imports: [DatabaseModule, ContractModule, ContractTemplateModule, ContractDocumentWorkerModule],
  providers: [Task12AuthErrorFilter, Task12AuthStageInterceptor, { provide: APP_FILTER, useExisting: Task12AuthErrorFilter },
    { provide: APP_INTERCEPTOR, useExisting: Task12AuthStageInterceptor }]
})
export class Task12GeneratedDocumentApplicationModule {}
