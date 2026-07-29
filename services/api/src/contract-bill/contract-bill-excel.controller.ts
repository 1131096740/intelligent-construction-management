import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Res,
  StreamableFile
} from "@nestjs/common";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { AuthenticatedUser } from "../auth/auth.types";
import { ContractCutoverSurface } from "../contract-cutover/contract-cutover.decorators";
import {
  ContractBillExcelService,
  type ContractBillExcelImportDto
} from "./contract-bill-excel.service";

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

@ContractCutoverSurface()
@Controller()
export class ContractBillExcelController {
  constructor(private readonly excel: ContractBillExcelService) {}

  @Get("contract-bills/:billId/excel-template")
  async exportTemplate(
    @Param("billId") billId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) response: { set: (headers: Record<string, string>) => void }
  ) {
    const result = await this.excel.exportTemplate(billId, user.id);
    response.set({
      "Content-Type": XLSX_MIME,
      "Content-Length": String(result.buffer.length),
      // ASCII 兜底 filename + UTF-8 filename*，兼容中文文件名。
      "Content-Disposition": [
        "attachment",
        `filename="${this.asciiFallback(result.fileName)}"`,
        `filename*=UTF-8''${encodeURIComponent(result.fileName)}`
      ].join("; ")
    });
    return new StreamableFile(result.buffer);
  }

  @Post("contract-bills/:billId/excel-imports")
  previewImport(
    @Param("billId") billId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: ContractBillExcelImportDto
  ) {
    return this.excel.previewImport(billId, user.id, body);
  }

  @Post("contract-bill-imports/:importId/apply")
  applyImport(
    @Param("importId") importId: string,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.excel.applyImport(importId, user.id);
  }

  private asciiFallback(fileName: string): string {
    const ascii = fileName.replace(/[^\x20-\x7E]+/g, "_").replace(/"/g, "'");
    return ascii.trim() || "contract-bill-template.xlsx";
  }
}
