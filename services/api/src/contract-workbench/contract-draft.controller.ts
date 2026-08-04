import {
  Body,
  Controller,
  Delete,
  forwardRef,
  Get,
  Headers,
  Inject,
  Param,
  Post,
  Put,
  UploadedFile,
  UseInterceptors
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { AuthenticatedUser } from "../auth/auth.types";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { RequireProjectRole } from "../auth/decorators/require-project-role.decorator";
import { ContractService } from "../contract/contract.service";
import { ContractDocumentService } from "../contract-document/contract-document.service";
import { ContractCutoverSurface } from "../contract-cutover/contract-cutover.decorators";
import {
  type MemoryUploadedFile,
  normalizeUploadedOriginalName
} from "../file/uploaded-file";
import { UploadPrivateFileDto } from "../file/dto/upload-private-file.dto";
import { ContractDraftAggregateService } from "./contract-draft-aggregate.service";
import { ContractDraftEditLeaseService } from "./contract-draft-edit-lease.service";
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
    private readonly documents: ContractDocumentService
  ) {}

  @Get(":contractVersionId/workbench")
  @RequireProjectRole("contract.create")
  workbench(
    @Param("contractVersionId") contractVersionId: string,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.aggregate.getWorkbench(contractVersionId, user.id);
  }

  @Put(":contractVersionId")
  @RequireProjectRole("contract.create")
  saveDraft(
    @Param("contractVersionId") contractVersionId: string,
    @Headers("x-contract-draft-lease") leaseToken: string,
    @Body() body: SaveContractDraftAggregateDto,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.aggregate.saveAggregate(
      contractVersionId,
      user.id,
      leaseToken,
      body
    );
  }

  @Delete(":contractVersionId")
  @RequireProjectRole("contract.create")
  deleteDraft(
    @Param("contractVersionId") contractVersionId: string,
    @Body() body: DeleteContractDraftDto,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.contracts.abandonDraft(contractVersionId, user.id, {
      ...body,
      action: "delete_pristine_draft"
    });
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
    return this.contracts.submitApproval(
      contractVersionId,
      user.id,
      body,
      leaseToken
    );
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
