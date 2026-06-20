import { Module } from "@nestjs/common";
import { ApprovalFreezeService } from "./approval-freeze.service";

@Module({
  providers: [ApprovalFreezeService],
  exports: [ApprovalFreezeService]
})
export class ApprovalModule {}
