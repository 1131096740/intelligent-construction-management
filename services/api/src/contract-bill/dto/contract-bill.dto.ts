export interface SaveBillRowDto {
  expectedBillRevision: number;
  itemCode?: string;
  itemName: string;
  specification?: string;
  unit: string;
  quantity?: string;
  unitPrice: string;
  taxRatePercent?: string;
  taxRateSource?: "version_default" | "row_override";
  isProvisional?: boolean;
  settlementBasis?: string;
  customData: Record<string, unknown>;
}

export interface ReorderBillRowsDto {
  expectedBillRevision: number;
  rowKeys: string[];
}

export interface ReplaceBillRowDto {
  clientRowKey: string;
  rowKey?: string;
  sortOrder: number;
  itemCode?: string;
  itemName: string;
  specification?: string;
  unit: string;
  quantity?: string;
  unitPrice: string;
  taxRatePercent?: string;
  taxRateSource?: "version_default" | "row_override";
  isProvisional?: boolean;
  settlementBasis?: string;
  customData: Record<string, unknown>;
}

export interface ReplaceBillRowsDto {
  expectedBillRevision: number;
  idempotencyKey: string;
  rows: ReplaceBillRowDto[];
}
