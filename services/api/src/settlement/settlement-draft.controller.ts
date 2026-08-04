import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Optional,
  Param,
  Patch,
  Post,
  UploadedFile,
  UseInterceptors
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { RequireProjectRole } from "../auth/decorators/require-project-role.decorator";
import type { AuthenticatedUser } from "../auth/auth.types";
import { FileService } from "../file/file.service";
import {
  type MemoryUploadedFile,
  normalizeUploadedOriginalName
} from "../file/uploaded-file";
import {
  SaveSettlementDraftDto,
  SubmitSettlementDraftDto
} from "./dto/settlement-draft.dto";
import { SettlementDraftService } from "./settlement-draft.service";
import { SettlementSubmissionService } from "./settlement-submission.service";
import { LinkSettlementCounterpartySignedDocumentDto } from "./dto/settlement-signed-document.dto";
import { SettlementCounterpartyDocumentService } from "./settlement-counterparty-document.service";
import { GenerateSettlementFrozenDocumentDto } from "./dto/settlement-signed-document-action.dto";
import { SettlementFrozenDocumentService } from "./settlement-frozen-document.service";
import { AbandonSettlementDraftDto } from "./dto/abandon-settlement-draft.dto";
import { CopySettlementDraftDto } from "./dto/copy-settlement-draft.dto";
import {
  CreateSettlementLineAttachmentDto,
  InvalidateSettlementLineAttachmentDto
} from "./dto/settlement-line-attachment.dto";
import { SettlementLineAttachmentService } from "./settlement-line-attachment.service";

const SETTLEMENT_PROJECT_ACTIONS = [
  "save_draft",
  "copy_abandoned_draft",
  "submit_draft",
  "preview_lines",
  "preview_import",
  "apply_import",
  "generate_frozen_document",
  "link_counterparty_signed_document",
  "attach_line_file",
  "invalidate_line_attachment",
  "upload_settlement_file"
] as const;

@Controller("projects/:projectId/settlement-drafts")
export class SettlementDraftController {
  constructor(
    private readonly drafts: SettlementDraftService,
    private readonly submissions: SettlementSubmissionService,
    private readonly counterpartyDocuments: SettlementCounterpartyDocumentService,
    private readonly frozenDocuments: SettlementFrozenDocumentService,
    private readonly lineAttachments: SettlementLineAttachmentService,
    @Optional() private readonly files?: FileService
  ) {}

  @Get("capability")
  @RequireProjectRole("settlement.create")
  capability(@Param("projectId") projectId: string) {
    return {
      projectId,
      availableActions: [...SETTLEMENT_PROJECT_ACTIONS]
    };
  }

  @Post("files")
  @RequireProjectRole("settlement.create")
  @UseInterceptors(
    FileInterceptor("file", {
      limits: {
        fileSize: Number(process.env.FILE_UPLOAD_MAX_BYTES ?? 104_857_600)
      }
    })
  )
  uploadPrivateFile(
    @UploadedFile() file: MemoryUploadedFile | undefined,
    @CurrentUser() user: AuthenticatedUser,
    @Body("idempotencyKey") idempotencyKey?: string
  ) {
    if (!file) throw new BadRequestException("请选择要上传的结算资料文件");
    if (!this.files) {
      throw new BadRequestException("结算文件服务暂不可用，请稍后重试");
    }
    return this.files.uploadPrivateFile({
      originalName: normalizeUploadedOriginalName(file.originalname),
      mimeType: file.mimetype,
      sizeBytes: file.size,
      uploadedByUserId: user.id,
      buffer: file.buffer,
      ...(idempotencyKey === undefined ? {} : { idempotencyKey })
    });
  }

  @Post()
  @RequireProjectRole("settlement.create")
  create(
    @Param("projectId") projectId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: SaveSettlementDraftDto
  ) {
    return this.drafts.create(projectId, user.id, body);
  }

  @Post(":draftId/copies")
  @RequireProjectRole("settlement.create")
  copyAbandoned(
    @Param("projectId") projectId: string,
    @Param("draftId") draftId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: CopySettlementDraftDto
  ) {
    return this.drafts.copyAbandoned(projectId, draftId, user.id, body);
  }

  @Get()
  @RequireProjectRole("settlement.create")
  list(
    @Param("projectId") projectId: string,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.drafts.list(projectId, user.id);
  }

  @Get(":draftId")
  @RequireProjectRole("settlement.create")
  detail(
    @Param("projectId") projectId: string,
    @Param("draftId") draftId: string,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.drafts.get(projectId, draftId, user.id);
  }

  @Get(":draftId/final-preparation")
  @RequireProjectRole("settlement.create")
  finalPreparation(
    @Param("projectId") projectId: string,
    @Param("draftId") draftId: string,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.drafts.finalPreparation(projectId, draftId, user.id);
  }

  @Get(":draftId/line-attachments")
  @RequireProjectRole("settlement.create")
  listLineAttachments(
    @Param("projectId") projectId: string,
    @Param("draftId") draftId: string,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.lineAttachments.listDraftAttachments(projectId, draftId, user.id);
  }

  @Post(":draftId/lines/:lineKey/attachments")
  @RequireProjectRole("settlement.create")
  attachLineFile(
    @Param("projectId") projectId: string,
    @Param("draftId") draftId: string,
    @Param("lineKey") lineKey: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: CreateSettlementLineAttachmentDto
  ) {
    return this.lineAttachments.attachToDraftLine(projectId, draftId, lineKey, user.id, body);
  }

  @Post(":draftId/line-attachments/:attachmentId/invalidation")
  @RequireProjectRole("settlement.create")
  invalidateLineAttachment(
    @Param("projectId") projectId: string,
    @Param("draftId") draftId: string,
    @Param("attachmentId") attachmentId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: InvalidateSettlementLineAttachmentDto
  ) {
    return this.lineAttachments.invalidateDraftAttachment(projectId, draftId, attachmentId, user.id, body);
  }

  @Patch(":draftId")
  @RequireProjectRole("settlement.create")
  update(
    @Param("projectId") projectId: string,
    @Param("draftId") draftId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: SaveSettlementDraftDto
  ) {
    return this.drafts.update(projectId, draftId, user.id, body);
  }

  @Post(":draftId/abandonment")
  @RequireProjectRole("settlement.create")
  abandon(
    @Param("projectId") projectId: string,
    @Param("draftId") draftId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: AbandonSettlementDraftDto
  ) {
    return this.drafts.abandon(projectId, draftId, user.id, body);
  }

  @Post(":draftId/approval-submission")
  @RequireProjectRole("settlement.create")
  submit(
    @Param("projectId") projectId: string,
    @Param("draftId") draftId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: SubmitSettlementDraftDto
  ) {
    return this.submissions.submitDraft(
      projectId,
      draftId,
      user.id,
      body.expectedRevision
    );
  }

  @Post(":draftId/counterparty-signed-documents")
  @RequireProjectRole("settlement.create")
  linkCounterpartySignedDocument(
    @Param("projectId") projectId: string,
    @Param("draftId") draftId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: LinkSettlementCounterpartySignedDocumentDto
  ) {
    return this.counterpartyDocuments.link(projectId, draftId, user.id, body);
  }

  @Post(":draftId/frozen-document")
  @RequireProjectRole("settlement.create")
  generateFrozenDocument(
    @Param("projectId") projectId: string,
    @Param("draftId") draftId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: GenerateSettlementFrozenDocumentDto
  ) {
    return this.frozenDocuments.generate(
      projectId,
      draftId,
      user.id,
      body.expectedRevision
    );
  }
}
