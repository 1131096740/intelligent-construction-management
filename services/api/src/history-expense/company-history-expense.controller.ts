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
import { BUSINESS_ENTRY_XLSX_MIME } from "../file/bounded-xlsx";
import type { MemoryUploadedFile } from "../file/uploaded-file";
import { CompanyHistoryExpenseService } from "./company-history-expense.service";
import {
  ActivateHistoryExpenseDto,
  ConfirmHistoryExpenseDto,
  CorrectHistoryExpenseRowDto,
  CreateHistoryExpenseBatchDto,
  PrecheckHistoryExpenseDto,
  VerifyHistoryExpenseRowDto
} from "./dto/history-expense.dto";

@Controller("company-entities/:companyEntityId/history-expenses")
export class CompanyHistoryExpenseController {
  constructor(private readonly historyExpenses: CompanyHistoryExpenseService) {}

  @Get("capability")
  @RequirePositions("comprehensive_director", "finance_staff", "finance_director")
  capability(@Param("companyEntityId") companyEntityId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.historyExpenses.capability(companyEntityId, user.id);
  }

  @Get("ledger")
  @RequirePositions("comprehensive_director", "finance_staff", "finance_director")
  ledger(@Param("companyEntityId") companyEntityId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.historyExpenses.ledger(companyEntityId, user.id);
  }

  @Get("excel-template")
  @RequirePositions("comprehensive_director")
  async excelTemplate(@Param("companyEntityId") companyEntityId: string, @CurrentUser() user: AuthenticatedUser) {
    const { buffer, fileName } = await this.historyExpenses.excelTemplate(companyEntityId, user.id);
    return new StreamableFile(buffer, {
      type: BUSINESS_ENTRY_XLSX_MIME,
      disposition: `attachment; filename="history-expense.xlsx"; filename*=UTF-8''${encodeURIComponent(fileName)}`
    });
  }

  @Post("excel-precheck")
  @RequirePositions("comprehensive_director")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 10 * 1024 * 1024 } }))
  precheckExcel(
    @Param("companyEntityId") companyEntityId: string,
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file: MemoryUploadedFile | undefined
  ) {
    if (!file) throw new BadRequestException("请选择历史费用 Excel 文件");
    return this.historyExpenses.precheckExcel(companyEntityId, user.id, file);
  }

  @Post("precheck")
  @RequirePositions("comprehensive_director")
  precheck(
    @Param("companyEntityId") companyEntityId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: PrecheckHistoryExpenseDto
  ) {
    return this.historyExpenses.precheck(companyEntityId, user.id, body);
  }

  @Post("batches")
  @RequirePositions("comprehensive_director")
  create(
    @Param("companyEntityId") companyEntityId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: CreateHistoryExpenseBatchDto
  ) {
    return this.historyExpenses.createBatch(companyEntityId, user.id, body);
  }

  @Get("batches")
  @RequirePositions("comprehensive_director", "finance_staff", "finance_director")
  list(@Param("companyEntityId") companyEntityId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.historyExpenses.list(companyEntityId, user.id);
  }

  @Get("batches/:batchId")
  @RequirePositions("comprehensive_director", "finance_staff", "finance_director")
  detail(
    @Param("companyEntityId") companyEntityId: string,
    @Param("batchId") batchId: string,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.historyExpenses.detail(companyEntityId, batchId, user.id);
  }

  @Patch("batches/:batchId/rows/:rowId")
  @RequirePositions("finance_staff", "finance_director")
  verifyRow(
    @Param("companyEntityId") companyEntityId: string,
    @Param("batchId") batchId: string,
    @Param("rowId") rowId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: VerifyHistoryExpenseRowDto
  ) {
    return this.historyExpenses.verifyRow(companyEntityId, batchId, rowId, user.id, body);
  }

  @Post("batches/:batchId/rows/:rowId/corrections")
  @RequirePositions("finance_director")
  correctRow(
    @Param("companyEntityId") companyEntityId: string,
    @Param("batchId") batchId: string,
    @Param("rowId") rowId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: CorrectHistoryExpenseRowDto
  ) {
    return this.historyExpenses.correctRow(companyEntityId, batchId, rowId, user.id, body);
  }

  @Post("batches/:batchId/confirmations")
  @RequirePositions("finance_director")
  confirm(
    @Param("companyEntityId") companyEntityId: string,
    @Param("batchId") batchId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: ConfirmHistoryExpenseDto
  ) {
    return this.historyExpenses.confirm(companyEntityId, batchId, user.id, body);
  }

  @Post("batches/:batchId/activation")
  @RequirePositions("finance_director")
  activate(
    @Param("companyEntityId") companyEntityId: string,
    @Param("batchId") batchId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: ActivateHistoryExpenseDto
  ) {
    return this.historyExpenses.activate(companyEntityId, batchId, user.id, body);
  }
}
