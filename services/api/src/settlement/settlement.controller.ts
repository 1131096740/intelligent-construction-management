import { Controller, Get, Param } from "@nestjs/common";
import { SettlementReadService } from "./settlement-read.service";

@Controller("settlements")
export class SettlementController {
  constructor(private readonly settlementRead: SettlementReadService) {}

  @Get(":settlementId")
  detail(@Param("settlementId") settlementId: string) {
    return this.settlementRead.getDetail(settlementId);
  }
}
