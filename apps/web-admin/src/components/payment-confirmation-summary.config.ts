export interface PaymentConfirmationSummaryItem {
  label: string;
  value: string;
  missing?: boolean;
  blocking?: boolean;
}

export function missingPaymentFact(value: string | null | undefined) {
  return value?.trim() || "—";
}

export function normalizePaymentConfirmationItems(
  items: readonly PaymentConfirmationSummaryItem[]
) {
  return items.map((item) => {
    const normalizedValue = missingPaymentFact(item.value);
    return {
      label: item.label.trim(),
      value: normalizedValue,
      missing: item.missing ?? normalizedValue === "—",
      blocking: item.blocking === true
    };
  });
}
