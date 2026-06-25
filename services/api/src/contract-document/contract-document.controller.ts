import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import type { AuthenticatedUser } from "../auth/auth.types";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import {
  ContractDocumentService,
  type QueueContractDocumentInput
} from "./contract-document.service";

@Controller()
export class ContractDocumentController {
  constructor(private readonly documents: ContractDocumentService) {}

  @Post("contract-workbench/:contractVersionId/documents")
  queue(
    @Param("contractVersionId") contractVersionId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: QueueContractDocumentInput
  ) {
    return this.documents.queue(contractVersionId, user.id, body);
  }

  @Get("contract-workbench/:contractVersionId/documents")
  list(
    @Param("contractVersionId") contractVersionId: string,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.documents.list(contractVersionId, user.id);
  }

  @Post("contract-documents/:documentId/retry")
  retry(
    @Param("documentId") documentId: string,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.documents.retry(documentId, user.id);
  }
}
