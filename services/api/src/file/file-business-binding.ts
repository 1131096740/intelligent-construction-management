import { Prisma } from "@prisma/client";

export const NON_RECEIPT_FILE_BINDINGS = [
  { table: "User", columns: ["signatureFileId"] },
  {
    table: "ContractTakeoverCorrection",
    columns: ["attachmentFileId"]
  },
  { table: "ContractArchiveFile", columns: ["fileId"] },
  { table: "SettlementImport", columns: ["fileId"] },
  {
    table: "SettlementTemplateVersion",
    columns: [
      "xlsxFileId",
      "previewXlsxFileId",
      "previewPdfFileId"
    ]
  },
  {
    table: "SettlementTemplatePreviewJob",
    columns: ["previewXlsxFileId", "previewPdfFileId"]
  },
  { table: "SettlementArchiveFile", columns: ["fileId"] },
  { table: "PaymentExecution", columns: ["voucherFileId"] },
  { table: "SpotProcurementAttachment", columns: ["fileId"] },
  {
    table: "SpotProcurementPayment",
    columns: [
      "supportingAttachmentFileId",
      "merchantPaymentProofFileId"
    ]
  },
  {
    table: "SpotProcurementPaymentExecution",
    columns: ["voucherFileId"]
  },
  { table: "SpotProcurementRefund", columns: ["voucherFileId"] },
  { table: "InvoiceRecord", columns: ["fileId"] },
  { table: "NoInvoiceConfirmation", columns: ["proofFileId"] },
  {
    table: "InvoiceExceptionConfirmation",
    columns: ["proofFileId"]
  },
  {
    table: "ProjectExpenseRequest",
    columns: ["attachmentFileId"]
  },
  {
    table: "ProjectExpenseExecution",
    columns: ["voucherFileId"]
  },
  { table: "ProjectReceipt", columns: ["voucherFileId"] },
  { table: "ProjectProxyPayment", columns: ["voucherFileId"] },
  {
    table: "ProjectUpstreamSettlement",
    columns: ["voucherFileId"]
  },
  { table: "ProjectOwnerContract", columns: ["fileId"] },
  {
    table: "ProjectSettlementExceptionQuota",
    columns: ["attachmentFileId"]
  },
  {
    table: "ProjectFinancingQuota",
    columns: ["attachmentFileId"]
  },
  { table: "ArchiveRecord", columns: ["fileId"] },
  { table: "PdfDocument", columns: ["fileId"] },
  {
    table: "ContractLayoutTemplateVersion",
    columns: ["docxFileId", "previewPdfFileId"]
  },
  {
    table: "ContractLayoutPreviewJob",
    columns: ["previewPdfFileId"]
  },
  { table: "ContractBill", columns: ["sourceExcelFileId"] },
  { table: "ContractBillImport", columns: ["fileId"] },
  {
    table: "ContractGeneratedDocument",
    columns: ["docxFileId", "pdfFileId"]
  },
  {
    table: "ContractOfflineRevision",
    columns: ["fileId", "previewPdfFileId"]
  }
] as const;

function sqlIdentifier(value: string): Prisma.Sql {
  if (!/^[A-Za-z][A-Za-z0-9]*$/u.test(value)) {
    throw new Error("静态文件绑定标识不合法");
  }
  return Prisma.raw(`"${value}"`);
}

export async function hasNonReceiptBusinessFileBinding(
  tx: Prisma.TransactionClient,
  fileIds: string[]
): Promise<boolean> {
  const uniqueIds = [...new Set(fileIds)].sort();
  if (!uniqueIds.length) return false;
  const candidates = Prisma.join(
    uniqueIds.map((fileId) => Prisma.sql`(${fileId})`)
  );
  const bindingQueries = NON_RECEIPT_FILE_BINDINGS.flatMap(
    ({ table, columns }) =>
      columns.map((column) => {
        const field = sqlIdentifier(column);
        return Prisma.sql`
          SELECT x.${field} AS "fileId"
          FROM ${sqlIdentifier(table)} x
          JOIN candidates c ON c."id" = x.${field}
        `;
      })
  );
  const rows = await tx.$queryRaw<Array<{ fileId: string }>>(
    Prisma.sql`
      /* receipt_non_receipt_file_binding */
      WITH candidates("id") AS (VALUES ${candidates})
      SELECT bindings."fileId"
      FROM (
        ${Prisma.join(bindingQueries, " UNION ALL ")}
        UNION ALL
        SELECT x."id"
        FROM "FileObject" x
        JOIN candidates c ON c."id" = x."id"
        WHERE x."supersedesFileObjectId" IS NOT NULL
        UNION ALL
        SELECT x."supersedesFileObjectId"
        FROM "FileObject" x
        JOIN candidates c ON c."id" = x."supersedesFileObjectId"
      ) bindings
      LIMIT 1
    `
  );
  return rows.length > 0;
}
