export type SettlementLineSourceType = "contract_bill_row" | "manual_adjustment";

export interface CreateSettlementLineDto {
  sourceType: SettlementLineSourceType;
  contractBillRowId?: string;
  name?: string;
  unit?: string;
  quantity?: number | string;
  unitPriceCents?: string;
  amountCents: string;
  reason?: string;
  remark?: string;
  sortOrder?: number;
}

export interface CreateSettlementDto {
  contractVersionId: string;
  code: string;
  periodLabel: string;
  amountCents: string;
  isFinal?: boolean;
  settlementLines?: CreateSettlementLineDto[];
}
