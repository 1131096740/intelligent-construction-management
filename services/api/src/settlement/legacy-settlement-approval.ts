export function isLegacySettlementApproval(instance: { businessType: string; flowType: string }): boolean {
  return instance.businessType === "settlement" && instance.flowType === "settlement.approve";
}
