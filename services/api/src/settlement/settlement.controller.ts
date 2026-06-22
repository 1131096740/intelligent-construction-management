import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { ConfirmSettlementArchiveDto } from "./dto/confirm-settlement-archive.dto";
import { CreateSettlementDto } from "./dto/create-settlement.dto";
import { UploadSettlementArchiveFileDto } from "./dto/upload-settlement-archive-file.dto";
import { SettlementReadService } from "./settlement-read.service";
import { SettlementService } from "./settlement.service";

@Controller("settlements")
export class SettlementController {
  constructor(
    private readonly settlementRead: SettlementReadService,
    private readonly settlements: SettlementService
  ) {}

  @Post()
  create(@Body() body: CreateSettlementDto) {
    return this.settlements.create(body);
  }

  @Get(":settlementId")
  detail(@Param("settlementId") settlementId: string) {
    return this.settlementRead.getDetail(settlementId);
  }

  @Post(":settlementId/archive-files")
  uploadArchiveFile(
    @Param("settlementId") settlementId: string,
    @Body() body: UploadSettlementArchiveFileDto
  ) {
    return this.settlements.uploadArchiveFile(settlementId, body);
  }

  @Post(":settlementId/archive-confirmation")
  confirmArchiveFile(
    @Param("settlementId") settlementId: string,
    @Body() body: ConfirmSettlementArchiveDto
  ) {
    return this.settlements.confirmArchiveFile(settlementId, body);
  }
}
