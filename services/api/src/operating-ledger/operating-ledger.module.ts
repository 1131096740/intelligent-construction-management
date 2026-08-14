import { Module } from "@nestjs/common";

import { OperatingLedgerService } from "./operating-ledger.service";
import { OperatingSourceAdapterRegistry } from "./operating-source-adapter";
import { OperatingSourceReplayService } from "./operating-source-replay.service";

@Module({
  providers: [
    OperatingLedgerService,
    {
      provide: OperatingSourceAdapterRegistry,
      useFactory: () => new OperatingSourceAdapterRegistry([])
    },
    OperatingSourceReplayService
  ],
  exports: [
    OperatingLedgerService,
    OperatingSourceAdapterRegistry,
    OperatingSourceReplayService
  ]
})
export class OperatingLedgerModule {}
