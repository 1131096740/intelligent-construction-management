import { Module } from "@nestjs/common";

import { OperatingLedgerService } from "./operating-ledger.service";

@Module({
  providers: [OperatingLedgerService],
  exports: [OperatingLedgerService]
})
export class OperatingLedgerModule {}
