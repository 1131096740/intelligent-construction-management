import { Body, Controller, Get, Param, Post, Res, StreamableFile } from "@nestjs/common";
import type { AuthenticatedUser } from "../auth/auth.types";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { RequireProjectRole } from "../auth/decorators/require-project-role.decorator";
import { PreviewSettlementImportDto } from "./dto/preview-settlement-import.dto";
import {
  SETTLEMENT_IMPORT_XLSX_MIME,
  SettlementImportService
} from "./settlement-import.service";

@Controller("settlement-workbench")
export class SettlementImportController {
  constructor(private readonly imports: SettlementImportService) {}

  @Get("contract-versions/:contractVersionId/import-template")
  @RequireProjectRole("settlement.create")
  async downloadTemplate(
    @Param("contractVersionId") contractVersionId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) response: { set: (headers: Record<string, string>) => void }
  ) {
    const result = await this.imports.exportTemplate(contractVersionId, user.id);
    this.setDownloadHeaders(response, result.buffer, result.fileName);
    return new StreamableFile(result.buffer);
  }

  @Post("contract-versions/:contractVersionId/imports/preview")
  @RequireProjectRole("settlement.create")
  preview(
    @Param("contractVersionId") contractVersionId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() input: PreviewSettlementImportDto
  ) {
    return this.imports.previewImport(contractVersionId, user.id, input);
  }

  @Post("projects/:projectId/imports/:importId/apply")
  @RequireProjectRole("settlement.create")
  apply(
    @Param("projectId") projectId: string,
    @Param("importId") importId: string,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.imports.applyImport(projectId, importId, user.id);
  }

  @Get("projects/:projectId/imports/:importId/errors.xlsx")
  @RequireProjectRole("settlement.create")
  async downloadErrors(
    @Param("projectId") projectId: string,
    @Param("importId") importId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) response: { set: (headers: Record<string, string>) => void }
  ) {
    const result = await this.imports.exportErrors(projectId, importId, user.id);
    this.setDownloadHeaders(response, result.buffer, result.fileName);
    return new StreamableFile(result.buffer);
  }

  @Get("projects/:projectId/imports/:importId/result.xlsx")
  @RequireProjectRole("settlement.create")
  async downloadResult(
    @Param("projectId") projectId: string,
    @Param("importId") importId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) response: { set: (headers: Record<string, string>) => void }
  ) {
    const result = await this.imports.exportResult(projectId, importId, user.id);
    this.setDownloadHeaders(response, result.buffer, result.fileName);
    return new StreamableFile(result.buffer);
  }

  private setDownloadHeaders(
    response: { set: (headers: Record<string, string>) => void },
    buffer: Buffer,
    fileName: string
  ) {
    response.set({
      "Content-Type": SETTLEMENT_IMPORT_XLSX_MIME,
      "Content-Length": String(buffer.length),
      "Content-Disposition": [
        "attachment",
        `filename="${fileName.replace(/[^\x20-\x7E]+/g, "_").replace(/"/g, "'")}"`,
        `filename*=UTF-8''${encodeURIComponent(fileName)}`
      ].join("; ")
    });
  }
}
