export function canApplySettlementSourceResponse(
  responseRequestId: number,
  latestRequestId: number,
  requestedContractVersionId: string,
  selectedContractVersionId: string
): boolean {
  return (
    responseRequestId === latestRequestId &&
    requestedContractVersionId === selectedContractVersionId
  );
}
