export function executionHasActiveVoucher(
  execution: { id: string; voucherFileId: string | null },
  activeVoucherFileIds: ReadonlySet<string>,
  voucherFilesByExecutionId: ReadonlyMap<string, Array<{ fileId: string }>>
) {
  const associatedVouchers = voucherFilesByExecutionId.get(execution.id) ?? [];
  if (associatedVouchers.length) {
    return associatedVouchers.some((voucher) =>
      activeVoucherFileIds.has(voucher.fileId)
    );
  }
  return Boolean(
    execution.voucherFileId && activeVoucherFileIds.has(execution.voucherFileId)
  );
}
