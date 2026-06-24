import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { BusinessPartyController } from "./business-party.controller";
import { BusinessPartyService } from "./business-party.service";

@Module({
  imports: [AuditModule],
  controllers: [BusinessPartyController],
  providers: [BusinessPartyService],
  exports: [BusinessPartyService]
})
export class BusinessPartyModule {}
