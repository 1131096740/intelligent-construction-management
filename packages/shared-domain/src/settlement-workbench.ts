export type SettlementSourceLineExceptionCode = "negative_remaining_amount";

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
  contractAmountCents: string;
  settledQuantity: string | null;
  settledAmountCents: string;
  remainingAmountCents: string;
  provisional: boolean;
  settlementBasis: string | null;
  exception: SettlementSourceLineException | null;
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
