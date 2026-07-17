import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { SpotProcurementClosureService } from "./spot-procurement-closure.service";

@Module({
  imports: [AuditModule],
  providers: [SpotProcurementClosureService],
  exports: [SpotProcurementClosureService]
})
export class SpotProcurementClosureModule {}
