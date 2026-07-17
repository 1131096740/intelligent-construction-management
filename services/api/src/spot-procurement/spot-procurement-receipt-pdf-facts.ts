import { SPOT_PROCUREMENT_RECEIPT_PDF_TEMPLATE_KEY } from "./spot-procurement.constants";

export const RECEIPT_PDF_REFRESH_ACTION =
  "spot_procurement.receipt.pdf.refresh";

const FORMAL_RECEIPT_PDF_STATUSES = new Set([
  "reviewed",
  "locked"
]);

export function isCurrentFormalReceiptPdfFact(input: {
  binding: {
    id: string;
    fileId: string;
    templateKey: string;
  };
  receipt: {
    id: string;
    status: string;
    currentRevisionNo: number;
  };
  latestReview:
    | {
        id: string;
        receiptRevisionNo: number;
        decision: string;
      }
    | null
    | undefined;
  refreshMetadata: unknown;
}): boolean {
  const { binding, receipt, latestReview } = input;
  if (
    binding.templateKey !==
      SPOT_PROCUREMENT_RECEIPT_PDF_TEMPLATE_KEY ||
    !FORMAL_RECEIPT_PDF_STATUSES.has(receipt.status) ||
    !Number.isSafeInteger(receipt.currentRevisionNo) ||
    receipt.currentRevisionNo <= 0 ||
    !latestReview ||
    latestReview.receiptRevisionNo !==
      receipt.currentRevisionNo ||
    latestReview.decision !== "approved"
  ) {
    return false;
  }

  const metadata = jsonObject(input.refreshMetadata);
  const token = jsonObject(metadata?.sourceSnapshotToken);
  const tokenStatusIsCurrent =
    token?.receiptStatus === receipt.status ||
    (receipt.status === "locked" &&
      token?.receiptStatus === "reviewed");
  return Boolean(
    metadata &&
      token &&
      metadata.pdfDocumentId === binding.id &&
      metadata.newFileId === binding.fileId &&
      metadata.templateKey ===
        SPOT_PROCUREMENT_RECEIPT_PDF_TEMPLATE_KEY &&
      token.receiptId === receipt.id &&
      tokenStatusIsCurrent &&
      token.currentRevisionNo ===
        receipt.currentRevisionNo &&
      token.sourceRevisionNo ===
        receipt.currentRevisionNo &&
      token.reviewId === latestReview.id &&
      token.latestReviewId === latestReview.id
  );
}

function jsonObject(
  value: unknown
): Record<string, unknown> | null {
  return value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
