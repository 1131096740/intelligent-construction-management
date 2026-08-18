import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import {
  BUSINESS_ENTRY_OPERATIONS,
  type BusinessEntrySubmissionTarget,
  type BusinessEntryOperation
} from "@jiangkong/shared-domain";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { AuthenticatedUser } from "../auth/auth.types";
import type { MemoryUploadedFile } from "../file/uploaded-file";
import {
  BUSINESS_ENTRY_XLSX_MIME,
  BusinessEntryExcelService
} from "./business-entry-excel.service";
import { BusinessEntryDefinitionService } from "./business-entry-definition.service";
import { BusinessEntryDraftRequestDto } from "./dto/business-entry-draft-request.dto";
import { BusinessEntryExcelPreviewDto } from "./dto/business-entry-excel-preview.dto";
import { BusinessEntryCreateTargetDto } from "./dto/business-entry-create-target.dto";

function normalizeTarget(
  target: BusinessEntryDraftRequestDto["target"]
): BusinessEntrySubmissionTarget | undefined {
  if (!target) return undefined;
  return {
    entityType: target.entityType,
    ...(target.entityId !== undefined ? { entityId: target.entityId } : {}),
    ...(target.createTarget !== undefined ? { createTarget: target.createTarget } : {})
  } as BusinessEntrySubmissionTarget;
}

@Controller("business-entry-definitions")
export class BusinessEntryDefinitionController {
  constructor(
    private readonly definitions: BusinessEntryDefinitionService,
    private readonly excel: BusinessEntryExcelService
  ) {}

  @Get(":sceneKey/excel-template")
  async downloadExcelTemplate(
    @Param("sceneKey") sceneKey: string,
    @Query("projectId") projectId: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) response: { set: (headers: Record<string, string>) => void }
  ) {
    const result = await this.excel.exportTemplate(sceneKey, projectId, user.id);
    response.set({
      "Content-Type": BUSINESS_ENTRY_XLSX_MIME,
      "Content-Length": String(result.buffer.length),
      "Content-Disposition": [
        "attachment",
        `filename="${result.fileName.replace(/[^\x20-\x7E]+/g, "_").replace(/"/g, "'")}"`,
        `filename*=UTF-8''${encodeURIComponent(result.fileName)}`
      ].join("; ")
    });
    return new StreamableFile(result.buffer);
  }

  @Post(":sceneKey/excel-preview")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 10 * 1024 * 1024 } }))
  previewExcel(
    @Param("sceneKey") sceneKey: string,
    @Query("projectId") projectId: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: BusinessEntryExcelPreviewDto,
    @UploadedFile() file: MemoryUploadedFile | undefined
  ) {
    if (!file) throw new BadRequestException("请选择业务 Excel 文件");
    return this.excel.preview(
      sceneKey,
      projectId,
      user.id,
      {
        definitionVersion: body.definitionVersion,
        target: body.targetCreateTarget
          ? { entityType: body.targetEntityType, createTarget: body.targetCreateTarget }
          : { entityType: body.targetEntityType, entityId: body.targetEntityId ?? "" }
      },
      file
    );
  }

  @Get(":sceneKey")
  getSceneDefinition(
    @Param("sceneKey") sceneKey: string,
    @Query("projectId") projectId: string | undefined,
    @Query("operation") operation: string | undefined,
    @CurrentUser() user: AuthenticatedUser
  ) {
    if (operation && !BUSINESS_ENTRY_OPERATIONS.includes(operation as BusinessEntryOperation)) {
      throw new BadRequestException("业务字段用途不受支持");
    }
    return this.definitions.getSceneDefinitionForOperation(
      sceneKey,
      projectId,
      user.id,
      (operation as BusinessEntryOperation | undefined) ?? "view"
    );
  }

  @Post(":sceneKey/validate")
  validateDraft(
    @Param("sceneKey") sceneKey: string,
    @Query("projectId") projectId: string | undefined,
    @Body() body: BusinessEntryDraftRequestDto,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.definitions.validateDraft(sceneKey, projectId, user.id, {
      ...body,
      target: normalizeTarget(body.target)
    });
  }

  @Post(":sceneKey/freeze")
  freezeSubmissionSnapshot(
    @Param("sceneKey") sceneKey: string,
    @Query("projectId") projectId: string | undefined,
    @Body() body: BusinessEntryDraftRequestDto,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.definitions.freezeSubmissionSnapshot(sceneKey, projectId, user.id, {
      ...body,
      target: normalizeTarget(body.target)
    });
  }

  @Post(":sceneKey/create-target")
  issueCreateTarget(
    @Param("sceneKey") sceneKey: string,
    @Query("projectId") projectId: string | undefined,
    @Body() body: BusinessEntryCreateTargetDto,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.definitions.issueCreateTarget(sceneKey, projectId, user.id, body.entityType);
  }
}
