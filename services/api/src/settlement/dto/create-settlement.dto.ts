export interface CreateSettlementDto {
  contractVersionId: string;
  code: string;
  periodLabel: string;
  amountCents: number;
  isFinal?: boolean;
}
