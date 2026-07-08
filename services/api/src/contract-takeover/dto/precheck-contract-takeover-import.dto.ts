export interface PrecheckContractTakeoverImportRowDto extends Record<string, unknown> {
  rowNo?: number;
}

export interface PrecheckContractTakeoverImportDto {
  rows: PrecheckContractTakeoverImportRowDto[];
}
