import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { CreateSettlementDto } from "./dto/create-settlement.dto";
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
}
