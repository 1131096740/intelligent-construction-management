import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  StreamableFile,
  UploadedFile,
  UseInterceptors
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { AuthenticatedUser } from "../auth/auth.types";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { RequirePositions } from "../auth/decorators/require-positions.decorator";
import { RequireProjectRole } from "../auth/decorators/require-project-role.decorator";
import { BUSINESS_ENTRY_XLSX_MIME } from "../file/bounded-xlsx";
import type { MemoryUploadedFile } from "../file/uploaded-file";
import { HistoryExpenseService } from "./history-expense.service";
import {
  ActivateHistoryExpenseDto,
  ConfirmHistoryExpenseDto,
  CorrectHistoryExpenseRowDto,
  CreateHistoryExpenseBatchDto,
  PrecheckHistoryExpenseDto,
  VerifyHistoryExpenseRowDto
} from "./dto/history-expense.dto";

/**
 * 历史无合同费用批量分行核实入账（#417 / HIS-10、HIS-11、HIS-12）。
 *
 * 入口刻意保持简单：先选项目，再按网格登记多条用途/类别/金额/付款情况/依据；
 * 不要求也不创建合同。财务逐行核实，主管复核后只把已核实行入账，待核对行保留。
 */
@Controller("projects/:projectId/history-expenses")
export class HistoryExpenseController {
  constructor(private readonly historyExpenses: HistoryExpenseService) {}

  @Get("capability")
  @RequirePositions("comprehensive_director", "finance_staff", "finance_director")
  capability(@Param("projectId") projectId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.historyExpenses.capability(projectId, user.id);
  }

  @Get("excel-template")
  @RequireProjectRole("history_expense.manage")
  async excelTemplate(@Param("projectId") projectId: string, @CurrentUser() user: AuthenticatedUser) {
    const { buffer, fileName } = await this.historyExpenses.excelTemplate(projectId, user.id);
    return new StreamableFile(buffer, {
      type: BUSINESS_ENTRY_XLSX_MIME,
      disposition: `attachment; filename="history-expense.xlsx"; filename*=UTF-8''${encodeURIComponent(fileName)}`
    });
  }

  @Post("excel-precheck")
  @RequireProjectRole("history_expense.manage")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 10 * 1024 * 1024 } }))
  precheckExcel(
    @Param("projectId") projectId: string,
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file: MemoryUploadedFile | undefined
  ) {
    if (!file) throw new BadRequestException("请选择历史费用 Excel 文件");
    return this.historyExpenses.precheckExcel(projectId, user.id, file);
  }

  @Post("precheck")
  @RequireProjectRole("history_expense.manage")
  precheck(
    @Param("projectId") projectId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: PrecheckHistoryExpenseDto
  ) {
    return this.historyExpenses.precheck(projectId, user.id, body);
  }

  @Post("batches")
  @RequireProjectRole("history_expense.manage")
  create(
    @Param("projectId") projectId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: CreateHistoryExpenseBatchDto
  ) {
    return this.historyExpenses.createBatch(projectId, user.id, body);
  }

  @Get("batches")
  @RequirePositions("comprehensive_director", "finance_staff", "finance_director")
  list(@Param("projectId") projectId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.historyExpenses.list(projectId, user.id);
  }

  @Get("batches/:batchId")
  @RequirePositions("comprehensive_director", "finance_staff", "finance_director")
  detail(
    @Param("projectId") projectId: string,
    @Param("batchId") batchId: string,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.historyExpenses.detail(projectId, batchId, user.id);
  }

  @Patch("batches/:batchId/rows/:rowId")
  @RequireProjectRole("history_expense.verify")
  verifyRow(
    @Param("projectId") projectId: string,
    @Param("batchId") batchId: string,
    @Param("rowId") rowId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: VerifyHistoryExpenseRowDto
  ) {
    return this.historyExpenses.verifyRow(projectId, batchId, rowId, user.id, body);
  }

  @Post("batches/:batchId/rows/:rowId/corrections")
  @RequireProjectRole("history_expense.correct")
  correctRow(
    @Param("projectId") projectId: string,
    @Param("batchId") batchId: string,
    @Param("rowId") rowId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: CorrectHistoryExpenseRowDto
  ) {
    return this.historyExpenses.correctRow(projectId, batchId, rowId, user.id, body);
  }

  @Post("batches/:batchId/confirmations")
  @RequireProjectRole("history_expense.confirm")
  confirm(
    @Param("projectId") projectId: string,
    @Param("batchId") batchId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: ConfirmHistoryExpenseDto
  ) {
    return this.historyExpenses.confirm(projectId, batchId, user.id, body);
  }

  @Post("batches/:batchId/activation")
  @RequireProjectRole("history_expense.activate")
  activate(
    @Param("projectId") projectId: string,
    @Param("batchId") batchId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: ActivateHistoryExpenseDto
  ) {
    return this.historyExpenses.activate(projectId, batchId, user.id, body);
  }
}
