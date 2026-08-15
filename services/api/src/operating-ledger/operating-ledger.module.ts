import { Module } from "@nestjs/common";

import {
  PaymentExecutionOperatingSourceAdapter,
  PAYMENT_EXECUTION_SOURCE_TYPE
} from "../payment/payment-operating-source.adapter";
import {
  ProjectProxyPaymentOperatingSourceAdapter,
  PROJECT_PROXY_PAYMENT_SOURCE_TYPE,
  ProjectUpstreamSettlementOperatingSourceAdapter,
  PROJECT_UPSTREAM_SETTLEMENT_SOURCE_TYPE
} from "../project/project-operating-source.adapter";
import { SettlementOperatingSourceAdapter } from "../settlement/settlement-operating-source.adapter";
import { OperatingLedgerService } from "./operating-ledger.service";
import { OperatingSourceAdapterRegistry } from "./operating-source-adapter";
import { OperatingSourceReplayService } from "./operating-source-replay.service";

export const POL05_OPERATING_SOURCE_TYPES = Object.freeze([
  PROJECT_UPSTREAM_SETTLEMENT_SOURCE_TYPE,
  "settlement",
  PAYMENT_EXECUTION_SOURCE_TYPE,
  PROJECT_PROXY_PAYMENT_SOURCE_TYPE
] as const);

export function createPol05OperatingSourceRegistry(): OperatingSourceAdapterRegistry {
  return new OperatingSourceAdapterRegistry(
    [
      new ProjectUpstreamSettlementOperatingSourceAdapter(),
      new SettlementOperatingSourceAdapter(),
      new PaymentExecutionOperatingSourceAdapter(),
      new ProjectProxyPaymentOperatingSourceAdapter()
    ],
    POL05_OPERATING_SOURCE_TYPES
  );
}

@Module({
  providers: [
    OperatingLedgerService,
    {
      provide: OperatingSourceAdapterRegistry,
      useFactory: createPol05OperatingSourceRegistry
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
