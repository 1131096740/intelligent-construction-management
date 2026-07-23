import { Module } from "@nestjs/common";
import { BusinessNumberingService } from "./business-numbering.service";

@Module({
  providers: [BusinessNumberingService],
  exports: [BusinessNumberingService]
})
export class BusinessNumberModule {}
