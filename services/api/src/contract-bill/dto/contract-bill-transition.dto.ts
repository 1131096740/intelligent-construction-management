export interface SaveContractBillTransitionDto {
  fromContractVersionId: string;
  expectedTargetVersionRevision: number;
  mappings: Array<{
    sourceContractBillRowId: string;
    targetContractBillRowId: string;
    sourceSettledQuantityAllocated: string;
    targetOpeningQuantity: string;
    settledAmountAllocatedCents: string;
    quantityConversionBasis?: string;
  }>;
}

export interface ConfirmContractBillTransitionsDto {
  expectedTargetVersionRevision: number;
}

export interface DiscardContractBillTransitionsDto {
  fromContractVersionId: string;
  expectedTargetVersionRevision: number;
}
