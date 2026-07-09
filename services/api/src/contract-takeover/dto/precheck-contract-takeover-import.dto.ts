export interface PrecheckContractTakeoverImportRowDto extends Record<string, unknown> {
  rowNo?: number;
}

export interface PrecheckContractTakeoverImportDto {
  rows: PrecheckContractTakeoverImportRowDto[];
  batchNo?: string;
  takeoverCutoffDate?: string;
  responsibleUserId?: string;
  reviewComment?: string;
  acceptanceConclusion?: string;
}
