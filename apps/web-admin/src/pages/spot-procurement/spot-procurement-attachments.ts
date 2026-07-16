import type { SpotProcurementAttachmentCategory } from "../../api/spot-procurement.api";

interface ExistingSpotProcurementAttachment {
  fileId: string;
  purpose: string;
  status: string;
}

const ATTACHMENT_CATEGORIES = new Set<SpotProcurementAttachmentCategory>([
  "merchant_quote",
  "material_list",
  "reference_photo",
  "other"
]);

export function activeSpotProcurementAttachmentIds(
  files: readonly ExistingSpotProcurementAttachment[]
) {
  return files
    .filter((file) => file.status === "active")
    .map((file) => file.fileId);
}

export function retainedSpotProcurementAttachments(
  files: readonly ExistingSpotProcurementAttachment[],
  retainedFileIds: readonly string[]
) {
  const retainedIds = new Set(retainedFileIds);
  return files.flatMap((file) =>
    file.status === "active" && retainedIds.has(file.fileId)
      ? [
          {
            fileId: file.fileId,
            category: attachmentCategory(file.purpose)
          }
        ]
      : []
  );
}

function attachmentCategory(
  value: string
): SpotProcurementAttachmentCategory {
  return ATTACHMENT_CATEGORIES.has(
    value as SpotProcurementAttachmentCategory
  )
    ? (value as SpotProcurementAttachmentCategory)
    : "other";
}
