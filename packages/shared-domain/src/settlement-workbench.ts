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
  quantity: string;
  unitPrice: string;
  taxRatePercent: string;
  amountRole: "included" | "reference" | "non_priced" | "provisional";
  pricingMode: "tax_inclusive" | "tax_exclusive";
  calculationMode: Exclude<SettlementCalculationMode, "manual_adjustment">;
  contractAmountCents: string;
  settledQuantity: string | null;
  previousSettledQuantity: string | null;
  remainingQuantity: string | null;
  settledAmountCents: string;
  remainingAmountCents: string;
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
    contractAmountCents: string;
    settledAmountCents: string;
    remainingAmountCents: string;
  };
  rows: SettlementSourceLineReadModel[];
}
