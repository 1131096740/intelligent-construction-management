export type SettlementSourceLineExceptionCode =
  | "negative_remaining_amount"
  | "negative_remaining_quantity"
  | "unknown_previous_quantity";

export type SettlementCalculationMode =
  | "normal_auto"
  | "manual_amount"
  | "manual_adjustment";

export interface SettlementSourceLineException {
  code: SettlementSourceLineExceptionCode;
  message: string;
}

export type SettlementSubmissionBlockerCode =
  | "missing_invoice_type"
  | "missing_tax_rate"
  | "missing_unit_price";

export interface SettlementSubmissionBlocker {
  code: SettlementSubmissionBlockerCode;
  message: string;
  remedyPath: string;
}

export interface SettlementSourceLineReadModel {
  id: string;
  billId: string;
  billKey: string;
  billName: string;
  rowKey: string;
  sortOrder: number;
  itemCode: string | null;
  itemName: string;
  specification: string | null;
  unit: string;
  quantity: string | null;
  unitPrice: string | null;
  taxRatePercent: string | null;
  taxExclusiveUnitPrice: string | null;
  pricingFactStatus: "confirmed" | "unconfirmed";
  calculationAvailable: boolean;
  submissionBlocker: SettlementSubmissionBlocker | null;
  amountRole: "included" | "reference" | "non_priced" | "provisional";
  pricingMode: "tax_inclusive" | "tax_exclusive";
  calculationMode: Exclude<SettlementCalculationMode, "manual_adjustment">;
  contractAmountCents: string | null;
  settledQuantity: string | null;
  previousSettledQuantity: string | null;
  remainingQuantity: string | null;
  settledAmountCents: string;
  remainingAmountCents: string | null;
  provisional: boolean;
  settlementBasis: string | null;
  exception: SettlementSourceLineException | null;
  exceptions: SettlementSourceLineException[];
}

export interface SettlementSourceLinesReadModel {
  contractVersionId: string;
  contractId: string;
  projectId: string;
  contractAmountCents: string;
  summary: {
    rowCount: number;
    exceptionCount: number;
    contractAmountCents: string | null;
    settledAmountCents: string;
    remainingAmountCents: string | null;
  };
  rows: SettlementSourceLineReadModel[];
}
