import { calculateBusinessLineAmount, normalizeBusinessAmount, sumBusinessAmounts, type GeneralProcurementRequestLine } from "@jiangkong/shared-domain";
export function generalRequestEstimateText(value: { toString(): string } | null | undefined) {
  return value == null ? null : normalizeBusinessAmount(value.toString());
}
/** Advisory estimate only. Unknown rows stay unknown and never become payment capacity. */
export function generalRequestLineSummary(lines: readonly GeneralProcurementRequestLine[]) {
  const amounts = lines.map(line => line.estimatedAmount ?? calculateBusinessLineAmount(line.quantity, line.unitPrice));
  const known = amounts.filter((amount): amount is string => amount !== null);
  return { knownLineEstimatedSubtotal: known.length ? sumBusinessAmounts(known) : null, unknownLineCount: amounts.length - known.length };
}
