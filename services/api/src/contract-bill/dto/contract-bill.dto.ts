export interface SaveBillRowDto {
  expectedBillRevision: number;
  itemCode?: string;
  itemName: string;
  specification?: string;
  unit: string;
  quantity: string;
  unitPrice: string;
  taxRatePercent: string;
  isProvisional?: boolean;
  settlementBasis?: string;
  customData: Record<string, unknown>;
}

export interface ReorderBillRowsDto {
  expectedBillRevision: number;
  rowKeys: string[];
}
