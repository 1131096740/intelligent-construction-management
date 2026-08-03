import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import type { AuthenticatedUser } from "../auth/auth.types";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { RequireProjectRole } from "../auth/decorators/require-project-role.decorator";
import { ContractCutoverSurface } from "../contract-cutover/contract-cutover.decorators";
import {
  ContractDocumentService,
  type QueueContractDocumentInput
} from "./contract-document.service";
import {
  ContractNegotiationService,
  type CreateOfflineRevisionPreviewTicketInput,
  type DisposeContractDifferenceInput,
  type OpenNegotiationRoundInput,
  type UploadNegotiationRevisionInput
} from "./contract-negotiation.service";

@Controller()
export class ContractDocumentController {
  constructor(
    private readonly documents: ContractDocumentService,
    private readonly negotiations: ContractNegotiationService
  ) {}

  @Post("contract-workbench/:contractVersionId/documents")
  @ContractCutoverSurface()
  @RequireProjectRole("contract.create")
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

  @Post("contract-workbench/:contractVersionId/offline-revisions")
  @ContractCutoverSurface()
  @RequireProjectRole("contract.create")
  uploadOfflineRevision(
    @Param("contractVersionId") contractVersionId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: UploadNegotiationRevisionInput
  ) {
    return this.negotiations.uploadRevision(contractVersionId, user.id, body);
  }

  @Get("contract-workbench/:contractVersionId/offline-revisions")
  listOfflineRevisions(
    @Param("contractVersionId") contractVersionId: string,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.negotiations.listOfflineRevisionHistory(contractVersionId, user.id);
  }

  @Post("contract-workbench/:contractVersionId/negotiation-rounds")
  @ContractCutoverSurface()
  @RequireProjectRole("contract.create")
  openNegotiationRound(
    @Param("contractVersionId") contractVersionId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: OpenNegotiationRoundInput
  ) {
    return this.negotiations.openRound(contractVersionId, user.id, body);
  }

  @Get("contract-workbench/:contractVersionId/negotiation-rounds")
  listNegotiationRounds(
    @Param("contractVersionId") contractVersionId: string,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.negotiations.listRounds(contractVersionId, user.id);
  }

  @Post("contract-negotiation-rounds/:roundId/close")
  @ContractCutoverSurface()
  @RequireProjectRole("contract.create")
  closeNegotiationRound(
    @Param("roundId") roundId: string,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.negotiations.closeRound(roundId, user.id);
  }

  @Post("contract-document-differences/:differenceId/disposition")
  @ContractCutoverSurface()
  @RequireProjectRole("contract.create")
  disposeDifference(
    @Param("differenceId") differenceId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: DisposeContractDifferenceInput
  ) {
    return this.negotiations.disposeDifference(differenceId, user.id, body);
  }

  @Post("contract-offline-revisions/:revisionId/retry")
  @ContractCutoverSurface()
  @RequireProjectRole("contract.create")
  retryOfflineRevision(
    @Param("revisionId") revisionId: string,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.negotiations.retryRevision(revisionId, user.id);
  }

  @Post("contract-offline-revisions/:revisionId/preview-download-ticket")
  @RequireProjectRole("contract.create")
  createOfflineRevisionPreviewDownloadTicket(
    @Param("revisionId") revisionId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: CreateOfflineRevisionPreviewTicketInput
  ) {
    return this.negotiations.createPreviewDownloadTicket(revisionId, user.id, body);
  }

  @Post("contract-documents/:documentId/retry")
  @ContractCutoverSurface()
  @RequireProjectRole("contract.create")
  retry(
    @Param("documentId") documentId: string,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.documents.retry(documentId, user.id);
  }
}
