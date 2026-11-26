import { ExpenseClaimFundingNotificationService } from "./expense-claim-funding-notification.service";
import { RetryDutyNotificationDto } from "../approval/retry-duty-notification.dto";
import { DeleteExpenseClaimDraftDto } from "./dto/delete-expense-claim-draft.dto";
import { BadRequestException, Body, Controller, Get, GoneException, Optional, Param, ParseIntPipe, Patch, Post, Query, Res, StreamableFile, UploadedFile, UseInterceptors } from "@nestjs/common";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { RequireProjectRole } from "../auth/decorators/require-project-role.decorator";
import { RequirePositions } from "../auth/decorators/require-positions.decorator";
import type { AuthenticatedUser } from "../auth/auth.types";
import { FileService } from "../file/file.service";
import { FileInterceptor, type MemoryUploadedFile, normalizeUploadedOriginalName } from "../file/uploaded-file";
import { CreateExpenseClaimDto } from "./dto/create-expense-claim.dto";
import { ReviewExpenseClaimDto } from "./dto/review-expense-claim.dto";
import { EditReturnedExpenseClaimDto, WithdrawExpenseClaimDto } from "./dto/returned-expense-claim.dto";
import { AttachExpenseClaimAttachmentDto, RemoveExpenseClaimAttachmentDto } from "./dto/manage-expense-claim-attachment.dto";
import { AdjustExpenseClaimPaymentSubjectDto } from "./dto/adjust-expense-claim-payment-subject.dto";
import { RecordExpenseClaimPaymentDto } from "./dto/record-expense-claim-payment.dto";
import { ledgerExportHeaders } from "../core-flow/business-ledger-export";
import { ExpenseClaimService } from "./expense-claim.service";

const RETIRED_LOAN_CASH = "员工借款资金办理已停止";
const approvalDutyIndexPipe = new ParseIntPipe({
  optional: true,
  exceptionFactory: () => new BadRequestException("审批职责编号无效，请刷新")
});

@Controller("expense-claims")
export class ExpenseClaimController {
  constructor(
    private readonly claims: ExpenseClaimService,
    @Optional() private readonly files?: FileService,
    @Optional() private readonly dutyNotifications?: ExpenseClaimFundingNotificationService
  ) {}

  // All active accounts may apply for themselves. JwtAuthGuard checks account state;
  // the expense domain checks project membership, proxy authority and draft ownership.
  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() body: CreateExpenseClaimDto) {
    return this.claims.create(user.id, body);
  }

  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Query("view") view?: string) {
    return this.claims.listMine(user.id, view);
  }

  /**
   * 费用与报销台账：财务/综合/公司领导/项目经理按项目可见范围跨项目查账，
   * 普通员工仍只见本人、经办及参与审批的记录。列表与导出同读模型。
   */
  @Get("ledger")
  ledger(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: Record<string, string | string[] | undefined> = {}
  ) {
    return this.claims.listLedger(user.id, query);
  }

  @Get("ledger-export")
  async exportLedger(
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true })
    response: { set: (headers: Record<string, string>) => void },
    @Query() query: Record<string, string | string[] | undefined> = {}
  ) {
    const result = await this.claims.exportLedger(user.id, query);
    response.set(ledgerExportHeaders(result));
    return new StreamableFile(result.buffer);
  }

  @Get("create-options")
  createOptions(@CurrentUser() user: AuthenticatedUser) {
    return this.claims.createOptions(user.id);
  }

  @Get("expense-categories")
  expenseCategories(@CurrentUser() user: AuthenticatedUser, @Query("companyEntityId") companyEntityId?: string) {
    return this.claims.expenseCategories(user.id, companyEntityId);
  }

  @Get("selectable-purchase-batches")
  selectablePurchaseBatches(
    @CurrentUser() user: AuthenticatedUser,
    @Query("companyEntityId") companyEntityId?: string,
    @Query("projectId") projectId?: string
  ) {
    return this.claims.selectableAdvanceBatches(user.id, { companyEntityId, projectId });
  }

  @Get(":claimId")
  detail(@Param("claimId") claimId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.claims.getMine(claimId, user.id);
  }

  @Post(":claimId/draft-deletion")
  deleteDraft(@Param("claimId") claimId: string, @CurrentUser() user: AuthenticatedUser, @Body() body: DeleteExpenseClaimDraftDto) {
    return this.claims.deleteUnsubmittedDraft(claimId, user.id, body.expectedUpdatedAt);
  }

  @Get(":claimId/capability")
  actionCapability(
    @Param("claimId") claimId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query("scopeKey") scopeKey?: string
  ) {
    return scopeKey === "public_cash"
      ? this.claims.getActionCapability(claimId, user.id, "public_cash")
      : this.claims.getActionCapability(claimId, user.id);
  }

  @Get(":claimId/repayments/:repaymentId/capability")
  repaymentActionCapability(
    @Param("claimId") claimId: string,
    @Param("repaymentId") repaymentId: string,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.claims.getRepaymentActionCapability(
      claimId,
      repaymentId,
      user.id
    );
  }

  @Post(":claimId/draft-attachment-file-uploads")
  @UseInterceptors(
    FileInterceptor("file", {
      limits: { fileSize: Number(process.env.FILE_UPLOAD_MAX_BYTES ?? 104_857_600) }
    })
  )
  uploadDraftAttachmentFile(
    @Param("claimId") claimId: string,
    @UploadedFile() file: MemoryUploadedFile | undefined,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { idempotencyKey?: string } = {}
  ) {
    return this.uploadPrivateFile(
      claimId,
      user.id,
      "attach_expense_claim_attachment",
      file,
      body.idempotencyKey,
      "费用草稿附件"
    );
  }

  @Post(":claimId/append-attachment-file-uploads")
  @RequireProjectRole("expense_claim.attachment.append")
  @UseInterceptors(
    FileInterceptor("file", {
      limits: { fileSize: Number(process.env.FILE_UPLOAD_MAX_BYTES ?? 104_857_600) }
    })
  )
  uploadAppendAttachmentFile(
    @Param("claimId") claimId: string,
    @UploadedFile() file: MemoryUploadedFile | undefined,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { idempotencyKey?: string } = {}
  ) {
    return this.uploadPrivateFile(
      claimId,
      user.id,
      "append_expense_claim_attachment",
      file,
      body.idempotencyKey,
      "费用追加资料"
    );
  }

  @Post(":claimId/payment-voucher-file-uploads")
  @RequireProjectRole("expense_claim.payment.execute")
  @UseInterceptors(
    FileInterceptor("file", {
      limits: { fileSize: Number(process.env.FILE_UPLOAD_MAX_BYTES ?? 104_857_600) }
    })
  )
  uploadPaymentVoucherFile(
    @Param("claimId") claimId: string,
    @UploadedFile() file: MemoryUploadedFile | undefined,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { idempotencyKey?: string } = {},
    @Query("scopeKey") scopeKey?: string
  ) {
    return this.uploadPrivateFile(
      claimId,
      user.id,
      scopeKey === "public_cash" ? "record_expense_claim_public_cash_payment" : "record_expense_claim_payment",
      file,
      body.idempotencyKey,
      "费用付款凭证"
    );
  }

  @Post(":claimId/disbursement-voucher-file-uploads")
  @RequireProjectRole("expense_claim.disburse")
  uploadDisbursementVoucherFile() {
    throw new GoneException(RETIRED_LOAN_CASH);
  }

  @Post(":claimId/repayment-voucher-file-uploads")
  @RequireProjectRole("expense_claim.repayment.record")
  uploadRepaymentVoucherFile() {
    throw new GoneException(RETIRED_LOAN_CASH);
  }

  @Post(":claimId/payment-subject")
  @RequirePositions("finance_staff", "finance_director", "comprehensive_director")
  adjustPaymentSubject(
    @Param("claimId") claimId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: AdjustExpenseClaimPaymentSubjectDto
  ) {
    return this.claims.adjustPaymentSubject(claimId, user.id, body);
  }

  @Post(":claimId/submission")
  submit(@Param("claimId") claimId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.claims.submit(claimId, user.id);
  }

  @Post(":claimId/withdrawal")
  withdraw(
    @Param("claimId") claimId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: WithdrawExpenseClaimDto
  ) {
    return this.claims.withdrawApproval(claimId, user.id, body.approvalInstanceId);
  }

  @Patch(":claimId/draft")
  editReturnedDraft(
    @Param("claimId") claimId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: EditReturnedExpenseClaimDto
  ) {
    return this.claims.editReturnedDraft(claimId, user.id, body);
  }

  @Post(":claimId/approval")
  @RequireProjectRole("expense_claim.approve")
  review(
    @Param("claimId") claimId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: ReviewExpenseClaimDto
  ) {
    return this.claims.review(claimId, user.id, body);
  }

  @Post(":claimId/attachments")
  attach(
    @Param("claimId") claimId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: AttachExpenseClaimAttachmentDto
  ) {
    return this.claims.attachAttachment(claimId, user.id, body);
  }

  @Post(":claimId/attachments/append")
  @RequireProjectRole("expense_claim.attachment.append")
  appendAttachment(
    @Param("claimId") claimId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: AttachExpenseClaimAttachmentDto
  ) {
    return this.claims.appendAttachment(claimId, user.id, body);
  }

  @Post(":claimId/attachments/:attachmentId/removal")
  removeAttachment(
    @Param("claimId") claimId: string,
    @Param("attachmentId") attachmentId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: RemoveExpenseClaimAttachmentDto
  ) {
    return this.claims.removeAttachment(claimId, attachmentId, user.id, body);
  }

  @Get(":claimId/duty-sms")
  @RequireProjectRole("expense_claim.payment.execute")
  async dutySmsStatus(@Param("claimId") id: string, @CurrentUser() user: AuthenticatedUser) {
    return { notice: await this.dutyNotifications?.notificationStatus(id, user.id) ?? null };
  }

  @Post(":claimId/duty-sms/retry")
  @RequireProjectRole("expense_claim.payment.execute")
  retryDutySms(@Param("claimId") id: string, @CurrentUser() user: AuthenticatedUser, @Body() body: RetryDutyNotificationDto) {
    if (!this.dutyNotifications) throw new BadRequestException("短信通知暂不可用");
    return this.dutyNotifications.retry(id, user.id, body.attemptId);
  }

  @Get(":claimId/approval-duty-sms")
  async approvalDutySmsStatus(
    @Param("claimId") id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query("approvalDutyIndex", approvalDutyIndexPipe) approvalDutyIndex?: number,
    @Query("approvalInstanceId") approvalInstanceId?: string
  ) {
    this.assertApprovalSmsCoordinates(approvalDutyIndex, approvalInstanceId);
    return { notice: await this.dutyNotifications?.approvalStatus(id, user.id, approvalDutyIndex, approvalInstanceId) ?? null };
  }

  @Post(":claimId/approval-duty-sms/retry")
  retryApprovalDutySms(
    @Param("claimId") id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: RetryDutyNotificationDto,
    @Query("approvalDutyIndex", approvalDutyIndexPipe) approvalDutyIndex?: number,
    @Query("approvalInstanceId") approvalInstanceId?: string
  ) {
    if (!this.dutyNotifications) throw new BadRequestException("短信通知暂不可用");
    this.assertApprovalSmsCoordinates(approvalDutyIndex, approvalInstanceId);
    return this.dutyNotifications.retryApproval(id, user.id, body.attemptId, approvalDutyIndex, approvalInstanceId);
  }

  private assertApprovalSmsCoordinates(index?: number, instanceId?: string) {
    if (index !== undefined && (!Number.isSafeInteger(index) || index < 0)) {
      throw new BadRequestException("审批职责编号无效，请刷新");
    }
    if (instanceId !== undefined && (typeof instanceId !== "string" || !instanceId.trim())) {
      throw new BadRequestException("审批轮次无效，请刷新");
    }
  }

  @Post(":claimId/disbursements")
  @RequireProjectRole("expense_claim.disburse")
  recordLoanDisbursement() {
    throw new GoneException(RETIRED_LOAN_CASH);
  }

  @Post(":claimId/payments")
  @RequireProjectRole("expense_claim.payment.execute")
  recordReimbursementPayment(
    @Param("claimId") claimId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: RecordExpenseClaimPaymentDto
  ) {
    return this.claims.recordPayment(claimId, user.id, body);
  }

  @Post(":claimId/final-payment-pdf")
  @RequireProjectRole("expense_claim.payment.execute")
  generateFinalPaymentPdf(@Param("claimId") claimId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.claims.generateReimbursementFinalPaymentPdf(claimId, user.id);
  }

  @Post(":claimId/final-disbursement-pdf")
  @RequireProjectRole("expense_claim.disburse")
  generateLoanFinalDisbursementPdf() {
    throw new GoneException(RETIRED_LOAN_CASH);
  }

  @Post(":claimId/repayments")
  @RequireProjectRole("expense_claim.repayment.record")
  recordRepayment() {
    throw new GoneException(RETIRED_LOAN_CASH);
  }

  @Post(":claimId/repayments/:repaymentId/confirmation")
  @RequireProjectRole("expense_claim.repayment.confirm")
  confirmRepayment() {
    throw new GoneException(RETIRED_LOAN_CASH);
  }

  @Post(":claimId/repayments/:repaymentId/reversal")
  @RequireProjectRole("expense_claim.repayment.reverse")
  reverseRepayment() {
    throw new GoneException(RETIRED_LOAN_CASH);
  }

  private async uploadPrivateFile(
    claimId: string,
    actorUserId: string,
    action: string,
    file: MemoryUploadedFile | undefined,
    idempotencyKey: string | undefined,
    label: string
  ) {
    await this.claims.assertActionAvailable(claimId, actorUserId, action);
    if (!file) throw new BadRequestException(`请选择要上传的${label}`);
    if (!this.files) {
      throw new BadRequestException("费用申请文件服务暂不可用，请稍后重试");
    }
    return this.files.uploadPrivateFile({
      originalName: normalizeUploadedOriginalName(file.originalname),
      mimeType: file.mimetype,
      sizeBytes: file.size,
      uploadedByUserId: actorUserId,
      buffer: file.buffer,
      ...(idempotencyKey === undefined ? {} : { idempotencyKey })
    });
  }
}
