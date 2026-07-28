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
import {
  ContractBillExcelService,
  type ContractDraftBillExcelImportPreviewDto
} from "./contract-bill-excel.service";

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

@Controller()
export class ContractDraftBillExcelController {
  constructor(private readonly excel: ContractBillExcelService) {}

  @Get("contract-drafts/:contractVersionId/bills/:billKey/template")
  async downloadTemplate(
    @Param("contractVersionId") contractVersionId: string,
    @Param("billKey") billKey: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) response: {
      set: (headers: Record<string, string>) => void;
    }
  ) {
    const result = await this.excel.exportDraftTemplate(
      contractVersionId,
      billKey,
      user.id
    );
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

  @Post("contract-drafts/:contractVersionId/bills/:billKey/import-preview")
  previewImport(
    @Param("contractVersionId") contractVersionId: string,
    @Param("billKey") billKey: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: ContractDraftBillExcelImportPreviewDto
  ) {
    return this.excel.previewDraftImport(
      contractVersionId,
      billKey,
      user.id,
      body
    );
  }

  private asciiFallback(fileName: string): string {
    const ascii = fileName.replace(/[^\x20-\x7E]+/g, "_").replace(/"/g, "'");
    return ascii.trim() || "contract-bill-template.xlsx";
  }
}
