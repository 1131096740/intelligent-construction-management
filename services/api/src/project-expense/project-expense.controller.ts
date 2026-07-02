import { Body, Controller, Param, Post } from "@nestjs/common";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { RequireProjectRole } from "../auth/decorators/require-project-role.decorator";
import type { AuthenticatedUser } from "../auth/auth.types";
import { CreateProjectExpenseRequestDto } from "./dto/create-project-expense-request.dto";
import { RecordProjectExpenseExecutionDto } from "./dto/record-project-expense-execution.dto";
import { RecordProjectExpenseFinanceRecordDto } from "./dto/record-project-expense-finance-record.dto";
import { ReviewProjectExpenseApprovalDto } from "./dto/review-project-expense-approval.dto";
import { ProjectExpenseService } from "./project-expense.service";

@Controller("projects/:projectId/expense-requests")
export class ProjectExpenseController {
  constructor(private readonly expenses: ProjectExpenseService) {}

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
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.expenses.withdrawApproval(projectId, expenseRequestId, user.id);
  }

  @Post(":expenseRequestId/voiding")
  @RequireProjectRole("project_expense.void")
  voidRequest(
    @Param("projectId") projectId: string,
    @Param("expenseRequestId") expenseRequestId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { reason: string }
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
}
