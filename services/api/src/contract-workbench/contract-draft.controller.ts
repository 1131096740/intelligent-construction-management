import {
  Body,
  Controller,
  Delete,
  forwardRef,
  Get,
  Headers,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Put,
  UploadedFile,
  UseInterceptors
} from "@nestjs/common";
import type { AuthenticatedUser } from "../auth/auth.types";
import { createHash } from "node:crypto";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { RequireProjectRole } from "../auth/decorators/require-project-role.decorator";
import { ContractV2SubmissionService } from "../contract/contract-v2-submission.service";
import { ContractService } from "../contract/contract.service";
import { ContractDocumentService } from "../contract-document/contract-document.service";
import { ContractCutoverSurface } from "../contract-cutover/contract-cutover.decorators";
import {
  FileInterceptor,
  type MemoryUploadedFile,
  normalizeUploadedOriginalName
} from "../file/uploaded-file";
import { UploadPrivateFileDto } from "../file/dto/upload-private-file.dto";
import { ContractDraftAggregateService } from "./contract-draft-aggregate.service";
import { ContractDraftEditLeaseService } from "./contract-draft-edit-lease.service";
import { PristineDraftDeletionService } from "./pristine-draft-deletion.service";
import {
  DeleteContractDraftDto,
  GenerateContractDraftPreviewDto,
  SaveContractDraftAggregateDto,
  SubmitContractDraftDto
} from "./dto/contract-workbench.dto";

@ContractCutoverSurface()
@Controller("contract-drafts")
export class ContractDraftController {
  constructor(
    private readonly aggregate: ContractDraftAggregateService,
    private readonly editLease: ContractDraftEditLeaseService,
    @Inject(forwardRef(() => ContractService))
    private readonly contracts: ContractService,
    private readonly deletion: PristineDraftDeletionService,
    private readonly documents: ContractDocumentService,
    private readonly v2Submission: ContractV2SubmissionService
  ) {}

  @Get(":contractVersionId/save-requests/:idempotencyKey")
  @RequireProjectRole("contract.create")
  saveResult(
    @Param("contractVersionId") contractVersionId: string,
    @Param("idempotencyKey", new ParseUUIDPipe({ version: "4" })) idempotencyKey: string,
    @CurrentUser() user: AuthenticatedUser,
    @Headers("x-contract-numeric-protocol") numericProtocol?: string
  ) {
    return this.aggregate.getSaveResult(contractVersionId, user.id, idempotencyKey, numericProtocol);
  }

  @Get(":contractVersionId/submission-requests/:idempotencyKey")
  @RequireProjectRole("contract.create")
  submissionResult(
    @Param("contractVersionId") contractVersionId: string,
    @Param("idempotencyKey", new ParseUUIDPipe({ version: "4" })) idempotencyKey: string,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.v2Submission.getSubmissionResult(contractVersionId, user.id, idempotencyKey);
  }

  @Get(":contractVersionId/workbench")
  @RequireProjectRole("contract.create")
  workbench(
    @Param("contractVersionId") contractVersionId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Headers("x-contract-numeric-protocol") numericProtocol?: string
  ) {
    return numericProtocol === undefined
      ? this.aggregate.getWorkbench(contractVersionId, user.id)
      : this.aggregate.getWorkbench(contractVersionId, user.id, numericProtocol);
  }

  @Get(":contractVersionId/document-body")
  @RequireProjectRole("contract.create")
  documentBody(
    @Param("contractVersionId") contractVersionId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Headers("x-contract-numeric-protocol") numericProtocol?: string
  ) {
    return this.documents.getDraftBody(contractVersionId, user.id, numericProtocol);
  }

  @Put(":contractVersionId")
  @RequireProjectRole("contract.create")
  saveDraft(
    @Param("contractVersionId") contractVersionId: string,
    @Headers("x-contract-draft-lease") leaseToken: string,
    @Body() body: SaveContractDraftAggregateDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request?: { body: unknown }
  ) {
    if (!request) return this.aggregate.saveAggregate(contractVersionId, user.id, leaseToken, body);
    return this.aggregate.saveAggregate(
      contractVersionId,
      user.id,
      leaseToken,
      body,
      createHash("sha256").update(JSON.stringify(request.body)).digest("hex")
    );
  }

  @Delete(":contractVersionId")
  @RequireProjectRole("contract.draft.delete")
  deleteDraft(
    @Param("contractVersionId") contractVersionId: string,
    @Body() body: DeleteContractDraftDto,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.deletion.deletePristineDraft(contractVersionId, user.id, body);
  }

  @Post(":contractVersionId/files")
  @RequireProjectRole("contract.create")
  @UseInterceptors(
    FileInterceptor("file", {
      limits: {
        fileSize: Number(process.env.FILE_UPLOAD_MAX_BYTES ?? 104_857_600)
      }
    })
  )
  uploadPrivateFile(
    @Param("contractVersionId") contractVersionId: string,
    @UploadedFile() file: MemoryUploadedFile | undefined,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: UploadPrivateFileDto = new UploadPrivateFileDto()
  ) {
    if (!file) {
      throw new Error("请选择要上传的资料文件");
    }

    return this.aggregate.uploadPrivateFile(contractVersionId, user.id, {
      originalName: normalizeUploadedOriginalName(file.originalname),
      mimeType: file.mimetype,
      sizeBytes: file.size,
      buffer: file.buffer,
      ...(body.idempotencyKey === undefined ? {} : { idempotencyKey: body.idempotencyKey })
    });
  }

  @Post(":contractVersionId/preview-generation")
  @RequireProjectRole("contract.create")
  generatePreview(
    @Param("contractVersionId") contractVersionId: string,
    @Body() body: GenerateContractDraftPreviewDto,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.documents.queueDraftPreview(contractVersionId, user.id, body);
  }

  @Post(":contractVersionId/submission")
  @RequireProjectRole("contract.submit")
  submitDraft(
    @Param("contractVersionId") contractVersionId: string,
    @Headers("x-contract-draft-lease") leaseToken: string,
    @Body() body: SubmitContractDraftDto,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return body.submissionProtocolVersion === 2
      ? this.v2Submission.submit(contractVersionId, user.id, body, leaseToken)
      : this.contracts.submitApproval(contractVersionId, user.id, body, leaseToken);
  }

  @Post(":contractVersionId/edit-lease")
  @RequireProjectRole("contract.create")
  acquireEditLease(
    @Param("contractVersionId") contractVersionId: string,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.editLease.acquire(contractVersionId, user.id);
  }

  @Post(":contractVersionId/edit-lease/heartbeat")
  @RequireProjectRole("contract.create")
  heartbeatEditLease(
    @Param("contractVersionId") contractVersionId: string,
    @Headers("x-contract-draft-lease") leaseToken: string
  ) {
    return this.editLease.heartbeat(contractVersionId, leaseToken);
  }

  @Post(":contractVersionId/edit-lease/takeover")
  @RequireProjectRole("contract.create")
  takeOverEditLease(
    @Param("contractVersionId") contractVersionId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { currentPassword: string }
  ) {
    return this.editLease.takeOver(contractVersionId, user.id, body);
  }

  @Delete(":contractVersionId/edit-lease")
  @RequireProjectRole("contract.create")
  releaseEditLease(
    @Param("contractVersionId") contractVersionId: string,
    @Headers("x-contract-draft-lease") leaseToken: string
  ) {
    return this.editLease.release(contractVersionId, leaseToken);
  }
}
