import { Module } from "@nestjs/common";

import {
  EmployeeProjectLoanEntryOperatingSourceAdapter,
  EMPLOYEE_PROJECT_LOAN_ENTRY_SOURCE_TYPE,
  ExpenseClaimApprovalOperatingSourceAdapter,
  EXPENSE_CLAIM_APPROVAL_SOURCE_TYPE,
  ExpenseClaimPaymentExecutionOperatingSourceAdapter,
  EXPENSE_CLAIM_PAYMENT_EXECUTION_SOURCE_TYPE
} from "../expense-claim/expense-claim-operating-source.adapter";
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
import {
  SPOT_PROCUREMENT_INVOICE_RECORD_SOURCE_TYPE,
  SPOT_PROCUREMENT_PAYMENT_EXECUTION_SOURCE_TYPE,
  SPOT_PROCUREMENT_RECEIPT_REVIEW_SOURCE_TYPE,
  SPOT_PROCUREMENT_REFUND_SOURCE_TYPE,
  SpotProcurementInvoiceOperatingSourceAdapter,
  SpotProcurementPaymentExecutionOperatingSourceAdapter,
  SpotProcurementReceiptOperatingSourceAdapter,
  SpotProcurementRefundOperatingSourceAdapter
} from "../spot-procurement/spot-procurement-operating-source.adapter";
import {
  CONTRACT_TAKEOVER_HISTORICAL_PAYMENT_SOURCE_TYPE,
  ContractTakeoverHistoricalPaymentOperatingSourceAdapter
} from "../contract-takeover/contract-takeover-operating-source.adapter";
import { SettlementOperatingSourceAdapter } from "../settlement/settlement-operating-source.adapter";
import { OperatingLedgerService } from "./operating-ledger.service";
import { OperatingSourceAdapterRegistry } from "./operating-source-adapter";
import { OperatingSourceReplayService } from "./operating-source-replay.service";

export const OPERATING_SOURCE_TYPES = Object.freeze([
  PROJECT_UPSTREAM_SETTLEMENT_SOURCE_TYPE,
  "settlement",
  PAYMENT_EXECUTION_SOURCE_TYPE,
  PROJECT_PROXY_PAYMENT_SOURCE_TYPE,
  EXPENSE_CLAIM_APPROVAL_SOURCE_TYPE,
  EXPENSE_CLAIM_PAYMENT_EXECUTION_SOURCE_TYPE,
  EMPLOYEE_PROJECT_LOAN_ENTRY_SOURCE_TYPE,
  SPOT_PROCUREMENT_RECEIPT_REVIEW_SOURCE_TYPE,
  SPOT_PROCUREMENT_PAYMENT_EXECUTION_SOURCE_TYPE,
  SPOT_PROCUREMENT_REFUND_SOURCE_TYPE,
  SPOT_PROCUREMENT_INVOICE_RECORD_SOURCE_TYPE,
  CONTRACT_TAKEOVER_HISTORICAL_PAYMENT_SOURCE_TYPE
] as const);

export function createOperatingSourceRegistry(): OperatingSourceAdapterRegistry {
  return new OperatingSourceAdapterRegistry(
    [
      new ProjectUpstreamSettlementOperatingSourceAdapter(),
      new SettlementOperatingSourceAdapter(),
      new PaymentExecutionOperatingSourceAdapter(),
      new ProjectProxyPaymentOperatingSourceAdapter(),
      new ExpenseClaimApprovalOperatingSourceAdapter(),
      new ExpenseClaimPaymentExecutionOperatingSourceAdapter(),
      new EmployeeProjectLoanEntryOperatingSourceAdapter(),
      new SpotProcurementReceiptOperatingSourceAdapter(),
      new SpotProcurementPaymentExecutionOperatingSourceAdapter(),
      new SpotProcurementRefundOperatingSourceAdapter(),
      new SpotProcurementInvoiceOperatingSourceAdapter(),
      new ContractTakeoverHistoricalPaymentOperatingSourceAdapter()
    ],
    OPERATING_SOURCE_TYPES
  );
}

@Module({
  providers: [
    OperatingLedgerService,
    {
      provide: OperatingSourceAdapterRegistry,
      useFactory: createOperatingSourceRegistry
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
