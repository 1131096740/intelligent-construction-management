import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Optional,
  Param,
  Post,
  Query,
  Res,
  StreamableFile
} from "@nestjs/common";
import {
  CONTRACT_SETTLEMENT_LEDGER_EXPORT_ROLE_KEYS,
  DRAFT_LEDGER_VIEWS,
  SETTLEMENT_WORKBENCH_VIEWS,
  type DraftLedgerView,
  type SettlementWorkbenchView
} from "@jiangkong/shared-domain";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { ProjectVisibilityService } from "../auth/project-visibility.service";
import {
  RequirePositions,
  UseAnyProjectPositionScope
} from "../auth/decorators/require-positions.decorator";
import { RequireProjectRole } from "../auth/decorators/require-project-role.decorator";
import type { AuthenticatedUser } from "../auth/auth.types";
import { LEDGER_READ_POSITION_KEYS } from "../auth/ledger-read-positions";
import { XLSX_MIME } from "../core-flow/ledger-excel";
import { AssignSettlementApprovalDto } from "./dto/assign-settlement-approval.dto";
import { ConfirmSettlementArchiveDto } from "./dto/confirm-settlement-archive.dto";
import { CreateSettlementDto } from "./dto/create-settlement.dto";
import { DownloadSettlementApprovalPdfDto } from "./dto/download-settlement-approval-pdf.dto";
import { GenerateSettlementPdfArchiveDto } from "./dto/generate-settlement-pdf-archive.dto";
import { ReviewSettlementApprovalDto } from "./dto/review-settlement-approval.dto";
import { UploadSettlementArchiveFileDto } from "./dto/upload-settlement-archive-file.dto";
import { WithdrawSettlementApprovalDto } from "./dto/withdraw-settlement-approval.dto";
import { SettlementReadService } from "./settlement-read.service";
import {
  SETTLEMENT_ATTACHMENT_TEMPLATE_MIME,
  SettlementAttachmentTemplateService
} from "./settlement-attachment-template.service";
import { SettlementService } from "./settlement.service";
import { SettlementSubmissionService } from "./settlement-submission.service";
import { SettlementSignedDocumentService } from "./settlement-signed-document.service";
import { RegenerateSettlementSignedDocumentDto } from "./dto/settlement-signed-document-action.dto";
import { RecordSettlementRecoveryDto, ReverseSettlementRecoveryDto } from "./dto/record-settlement-recovery.dto";
import { SettlementRecoveryService } from "./settlement-recovery.service";

@Controller("settlements")
export class SettlementController {
  constructor(
    private readonly settlementRead: SettlementReadService,
    private readonly attachmentTemplates: SettlementAttachmentTemplateService,
    private readonly settlements: SettlementService,
    private readonly projectVisibility: ProjectVisibilityService,
    private readonly submissions: SettlementSubmissionService,
    @Optional() private readonly signedDocuments?: SettlementSignedDocumentService,
    @Optional() private readonly recoveries?: SettlementRecoveryService
  ) {}

  @Post()
  @RequireProjectRole("settlement.create")
  create(@Body() body: CreateSettlementDto, @CurrentUser() user: AuthenticatedUser) {
    return this.submissions.submit(body, user.id);
  }

  @Get()
  @RequirePositions(...LEDGER_READ_POSITION_KEYS)
  async list(@CurrentUser() user: AuthenticatedUser, @Query("limit") limit?: string) {
    return this.settlementRead.listRecent(limit, await this.projectVisibility.visibleProjectIds(user.id));
  }

  @Get("lifecycle-ledger")
  @RequirePositions(...LEDGER_READ_POSITION_KEYS)
  async lifecycleLedger(
    @CurrentUser() user: AuthenticatedUser,
    @Query("view") rawView?: string,
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string
  ) {
    const view = DRAFT_LEDGER_VIEWS.includes(rawView as DraftLedgerView)
      ? rawView as DraftLedgerView
      : "formal_ledger";
    return this.settlementRead.lifecycleLedger(
      view,
      page,
      pageSize,
      await this.projectVisibility.visibleProjectIds(user.id),
      user.id
    );
  }

  @Get("workbench")
  @RequirePositions(...LEDGER_READ_POSITION_KEYS)
  async workbenchLedger(
    @CurrentUser() user: AuthenticatedUser,
    @Query("view") rawView?: string,
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string
  ) {
    const view = SETTLEMENT_WORKBENCH_VIEWS.includes(rawView as SettlementWorkbenchView)
      ? rawView as SettlementWorkbenchView
      : "all";
    return this.settlementRead.workbenchLedger(
      view,
      page,
      pageSize,
      await this.projectVisibility.visibleProjectIds(user.id),
      user.id
    );
  }

  @Get("ledger-export")
  @RequirePositions(...CONTRACT_SETTLEMENT_LEDGER_EXPORT_ROLE_KEYS)
  async exportLedger(
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true })
    response: { set: (headers: Record<string, string>) => void }
  ) {
    const result = await this.settlementRead.exportLedger(
      await this.projectVisibility.visibleProjectIds(user.id),
      user.id
    );
    response.set({
      "Content-Type": XLSX_MIME,
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(result.fileName)}`,
      "Content-Length": String(result.buffer.length)
    });
    return new StreamableFile(result.buffer);
  }

  @Get(":settlementId/attachment-templates/:templateKey/download")
  @RequireProjectRole("settlement.archive.upload")
  async downloadAttachmentTemplate(
    @Param("settlementId") settlementId: string,
    @Param("templateKey") templateKey: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) response: { set: (headers: Record<string, string>) => void }
  ) {
    const result = await this.attachmentTemplates.exportTemplate(settlementId, templateKey, user.id);
    response.set({
      "Content-Type": SETTLEMENT_ATTACHMENT_TEMPLATE_MIME,
      "Content-Length": String(result.buffer.length),
      "Content-Disposition": [
        "attachment",
        `filename="${this.asciiFallback(result.fileName)}"`,
        `filename*=UTF-8''${encodeURIComponent(result.fileName)}`
      ].join("; ")
    });
    return new StreamableFile(result.buffer);
  }

  @Get(":settlementId/recovery")
  @RequirePositions(...LEDGER_READ_POSITION_KEYS)
  async recovery(@Param("settlementId") settlementId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.requireRecoveries().listForSettlement(
      settlementId,
      await this.projectVisibility.visibleProjectIds(user.id)
    );
  }

  @Post(":settlementId/recovery-entries")
  @RequirePositions("finance_staff")
  recordRecovery(
    @Param("settlementId") settlementId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: RecordSettlementRecoveryDto
  ) {
    return this.requireRecoveries().record(settlementId, user.id, body);
  }

  @Post(":settlementId/recovery-entries/:entryId/reversal")
  @RequirePositions("finance_staff")
  reverseRecovery(
    @Param("settlementId") settlementId: string,
    @Param("entryId") entryId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: ReverseSettlementRecoveryDto
  ) {
    return this.requireRecoveries().reverse(settlementId, entryId, user.id, body);
  }

  private requireRecoveries() {
    if (!this.recoveries) throw new BadRequestException("结算回收台账服务暂不可用，请稍后重试");
    return this.recoveries;
  }

  @Get(":settlementId")
  @RequirePositions(...LEDGER_READ_POSITION_KEYS)
  async detail(@Param("settlementId") settlementId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.settlementRead.getDetail(
      settlementId,
      await this.projectVisibility.visibleProjectIds(user.id),
      user.id
    );
  }

  @Post(":settlementId/approval")
  @RequireProjectRole("settlement.approve")
  reviewApproval(
    @Param("settlementId") settlementId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: ReviewSettlementApprovalDto
  ) {
    return this.settlements.reviewApproval(settlementId, user.id, body);
  }

  @Post(":settlementId/approval-withdrawal")
  @RequirePositions(...LEDGER_READ_POSITION_KEYS)
  @UseAnyProjectPositionScope()
  withdrawApproval(
    @Param("settlementId") settlementId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: WithdrawSettlementApprovalDto
  ) {
    return this.settlements.withdrawApproval(settlementId, user.id, body);
  }

  // 超时催办：由申请人发起，督促当前节点审批人；是否超时/重复节流在 service 内判定。
  @Post(":settlementId/approval-reminder")
  remindApproval(@Param("settlementId") settlementId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.settlements.remindApproval(settlementId, user.id);
  }

  @Post(":settlementId/approval-transfer")
  @RequireProjectRole("settlement.approve")
  transferApproval(
    @Param("settlementId") settlementId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: AssignSettlementApprovalDto
  ) {
    return this.settlements.transferApproval(settlementId, user.id, body);
  }

  @Post(":settlementId/approval-delegation")
  @RequireProjectRole("settlement.approve")
  delegateApproval(
    @Param("settlementId") settlementId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: AssignSettlementApprovalDto
  ) {
    return this.settlements.delegateApproval(settlementId, user.id, body);
  }

  @Post(":settlementId/archive-files")
  @RequireProjectRole("settlement.archive.upload")
  uploadArchiveFile(
    @Param("settlementId") settlementId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: UploadSettlementArchiveFileDto
  ) {
    return this.settlements.uploadArchiveFile(settlementId, user.id, body);
  }

  @Post(":settlementId/archive-confirmation")
  @RequireProjectRole("settlement.archive.confirm")
  confirmArchiveFile(
    @Param("settlementId") settlementId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: ConfirmSettlementArchiveDto
  ) {
    return this.settlements.confirmArchiveFile(settlementId, user.id, body);
  }

  @Post(":settlementId/signed-document-regeneration")
  @RequireProjectRole("settlement.archive.confirm")
  regenerateSignedDocument(
    @Param("settlementId") settlementId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: RegenerateSettlementSignedDocumentDto
  ) {
    if (!body.confirmPureRenderingIssue || !body.reason.trim() || !body.confirmationPassword?.trim()) {
      throw new BadRequestException("请确认仅修复渲染问题并填写重新生成原因");
    }
    if (!this.signedDocuments) {
      throw new BadRequestException("结算签名合成服务暂不可用，请稍后重试");
    }
    return this.signedDocuments.generateFinal(
      settlementId, user.id, true, body.reason.trim(), undefined, body.confirmationPassword
    );
  }

  @Post(":settlementId/signed-document-generation-retry")
  @RequireProjectRole("settlement.archive.confirm")
  retrySignedDocumentGeneration(
    @Param("settlementId") settlementId: string,
    @CurrentUser() user: AuthenticatedUser
  ) {
    if (!this.signedDocuments) {
      throw new BadRequestException("结算签名合成服务暂不可用，请稍后重试");
    }
    return this.signedDocuments.generateFinal(settlementId, user.id, false);
  }

  @Post(":settlementId/pdf-generation")
  @RequireProjectRole("settlement.archive.upload")
  generatePdfArchive(
    @Param("settlementId") settlementId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: GenerateSettlementPdfArchiveDto
  ) {
    return this.settlements.generatePdfArchive(settlementId, user.id, body);
  }

  @Get(":settlementId/draft-excel")
  @RequireProjectRole("settlement.archive.upload")
  async downloadDraftExcel(
    @Param("settlementId") settlementId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) response: { set: (headers: Record<string, string>) => void }
  ) {
    const result = await this.settlements.exportDraftExcel(settlementId, user.id);
    response.set({
      "Content-Type": XLSX_MIME,
      "Content-Length": String(result.buffer.length),
      "Content-Disposition": [
        "attachment",
        `filename="${this.asciiFallback(result.fileName)}"`,
        `filename*=UTF-8''${encodeURIComponent(result.fileName)}`
      ].join("; ")
    });

    return new StreamableFile(result.buffer);
  }

  @Post(":settlementId/approval-pdf/latest")
  async downloadLatestApprovalPdf(
    @Param("settlementId") settlementId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: DownloadSettlementApprovalPdfDto,
    @Res({ passthrough: true }) response: { set: (headers: Record<string, string>) => void }
  ) {
    const result = await this.settlements.downloadLatestApprovalPdf(
      settlementId,
      user.id,
      body.confirmationPassword,
      body.downloadReason
    );
    response.set({
      "Content-Type": "application/pdf",
      "Content-Length": String(result.buffer.length),
      "Content-Disposition": [
        "attachment",
        `filename="${this.asciiFallback(result.fileName)}"`,
        `filename*=UTF-8''${encodeURIComponent(result.fileName)}`
      ].join("; ")
    });

    return new StreamableFile(result.buffer);
  }

  private asciiFallback(fileName: string): string {
    const ascii = fileName.replace(/[^\x20-\x7E]+/g, "_").replace(/"/g, "'");
    return ascii.trim() || "settlement-draft.xlsx";
  }
}
