import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { SpotProcurementAccessService } from "./spot-procurement-access.service";

@Module({
  imports: [DatabaseModule],
  providers: [SpotProcurementAccessService],
  exports: [SpotProcurementAccessService]
})
export class SpotProcurementAccessModule {}
