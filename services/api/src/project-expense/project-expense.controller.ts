import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { RequirePositions } from "../auth/decorators/require-positions.decorator";
import { RequireProjectRole } from "../auth/decorators/require-project-role.decorator";
import type { AuthenticatedUser } from "../auth/auth.types";
import { ConfirmProjectExpenseReceiptDto } from "./dto/confirm-project-expense-receipt.dto";
import { CreateProjectExpenseDownloadTicketDto } from "./dto/create-project-expense-download-ticket.dto";
import { CreateProjectExpenseRequestDto } from "./dto/create-project-expense-request.dto";
import { RecordProjectExpenseExecutionDto } from "./dto/record-project-expense-execution.dto";
import { RecordProjectExpenseFinanceRecordDto } from "./dto/record-project-expense-finance-record.dto";
import { RecordProjectExpensePurchaseExecutionDto } from "./dto/record-project-expense-purchase-execution.dto";
import { ReviewProjectExpenseApprovalDto } from "./dto/review-project-expense-approval.dto";
import { VoidProjectExpenseRequestDto } from "./dto/void-project-expense-request.dto";
import { WithdrawProjectExpenseApprovalDto } from "./dto/withdraw-project-expense-approval.dto";
import { ProjectExpenseService } from "./project-expense.service";

const FUNDS_OVERVIEW_POSITIONS = [
  "chairman",
  "general_manager",
  "project_manager",
  "finance_director",
  "finance_staff",
  "material_director",
  "material_staff"
] as const;

@Controller("projects/:projectId/expense-requests")
export class ProjectExpenseController {
  constructor(private readonly expenses: ProjectExpenseService) {}

  @Get()
  @RequirePositions(...FUNDS_OVERVIEW_POSITIONS)
  list(
    @Param("projectId") projectId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query("view") view?: "formal_ledger" | "my_drafts" | "returned_for_revision" | "ended",
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string
  ) {
    return view !== undefined || page !== undefined || pageSize !== undefined
      ? this.expenses.list(projectId, user.id, { view, page, pageSize })
      : this.expenses.list(projectId, user.id);
  }

  @Get(":expenseRequestId/approval-detail")
  getApprovalDetail(
    @Param("projectId") projectId: string,
    @Param("expenseRequestId") expenseRequestId: string,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.expenses.getApprovalDetail(projectId, expenseRequestId, user.id);
  }

  @Post()
  @RequireProjectRole("project_expense.create")
  create(
    @Param("projectId") projectId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: CreateProjectExpenseRequestDto
  ) {
    return this.expenses.create(projectId, user.id, body);
  }

  @Post(":expenseRequestId/approval")
  @RequireProjectRole("project_expense.approve")
  reviewApproval(
    @Param("projectId") projectId: string,
    @Param("expenseRequestId") expenseRequestId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: ReviewProjectExpenseApprovalDto
  ) {
    return this.expenses.reviewApproval(projectId, expenseRequestId, user.id, body);
  }

  @Post(":expenseRequestId/approval-withdrawal")
  withdrawApproval(
    @Param("projectId") projectId: string,
    @Param("expenseRequestId") expenseRequestId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: WithdrawProjectExpenseApprovalDto
  ) {
    return this.expenses.withdrawApproval(
      projectId,
      expenseRequestId,
      user.id,
      body
    );
  }

  @Post(":expenseRequestId/attachment-download-ticket")
  createAttachmentDownloadTicket(
    @Param("projectId") projectId: string,
    @Param("expenseRequestId") expenseRequestId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: CreateProjectExpenseDownloadTicketDto
  ) {
    return this.expenses.createAttachmentDownloadTicket(
      projectId,
      expenseRequestId,
      user.id,
      body.confirmationPassword,
      body.downloadReason
    );
  }

  @Post(":expenseRequestId/approval-pdf-download-ticket")
  createApprovalPdfDownloadTicket(
    @Param("projectId") projectId: string,
    @Param("expenseRequestId") expenseRequestId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: CreateProjectExpenseDownloadTicketDto
  ) {
    return this.expenses.createApprovalPdfDownloadTicket(
      projectId,
      expenseRequestId,
      user.id,
      body.confirmationPassword,
      body.downloadReason
    );
  }

  @Post(":expenseRequestId/voiding")
  @RequireProjectRole("project_expense.void")
  voidRequest(
    @Param("projectId") projectId: string,
    @Param("expenseRequestId") expenseRequestId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: VoidProjectExpenseRequestDto
  ) {
    return this.expenses.voidRequest(projectId, expenseRequestId, user.id, body.reason);
  }

  @Post(":expenseRequestId/executions")
  @RequireProjectRole("project_expense.execution")
  recordExecution(
    @Param("projectId") projectId: string,
    @Param("expenseRequestId") expenseRequestId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: RecordProjectExpenseExecutionDto
  ) {
    return this.expenses.recordExecution(projectId, expenseRequestId, user.id, body);
  }

  @Post(":expenseRequestId/purchase-execution")
  @RequireProjectRole("project_expense.purchase_execute")
  recordPurchaseExecution(
    @Param("projectId") projectId: string,
    @Param("expenseRequestId") expenseRequestId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: RecordProjectExpensePurchaseExecutionDto
  ) {
    return this.expenses.recordPurchaseExecution(projectId, expenseRequestId, user.id, body);
  }

  @Post(":expenseRequestId/finance-records")
  @RequireProjectRole("project_expense.finance_record")
  recordFinance(
    @Param("projectId") projectId: string,
    @Param("expenseRequestId") expenseRequestId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: RecordProjectExpenseFinanceRecordDto
  ) {
    return this.expenses.recordFinance(projectId, expenseRequestId, user.id, body);
  }

  @Post(":expenseRequestId/receipt-confirmation")
  @RequireProjectRole("project_expense.receipt_confirm")
  confirmPurchaseReceipt(
    @Param("projectId") projectId: string,
    @Param("expenseRequestId") expenseRequestId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: ConfirmProjectExpenseReceiptDto
  ) {
    return this.expenses.confirmPurchaseReceipt(projectId, expenseRequestId, user.id, body);
  }
}
