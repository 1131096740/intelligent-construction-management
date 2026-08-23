import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { AuthModule } from "../auth/auth.module";
import { BusinessPartyController } from "./business-party.controller";
import { BusinessPartyService } from "./business-party.service";

@Module({
  imports: [AuditModule, AuthModule],
  controllers: [BusinessPartyController],
  providers: [BusinessPartyService],
  exports: [BusinessPartyService]
})
export class BusinessPartyModule {}
