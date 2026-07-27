import { Prisma } from "@prisma/client";

// 与数据库触发器共用同一事务级锁。文件正式绑定频率低，先用单一锁保证
// 所有旧入口、收货照片、实付凭证、退款凭证和替换链之间不存在双提交窗口。
// 若未来吞吐量需要优化，可在保持全入口一致的前提下改为按 fileId 排序取锁。
const FILE_BUSINESS_BINDING_LOCK_NAMESPACE = 190_731;
const FILE_BUSINESS_BINDING_LOCK_KEY = 13;

export const NON_RECEIPT_FILE_BINDINGS = [
  { table: "User", columns: ["signatureFileId"] },
  { table: "HandwrittenSignatureVersion", columns: ["fileId"] },
  { table: "ContractVersion", columns: ["taxFactEvidenceFileId"] },
  { table: "ContractTaxFactRevision", columns: ["evidenceFileId"] },
  {
    table: "ContractTakeoverCorrection",
    columns: ["attachmentFileId"]
  },
  { table: "ContractArchiveFile", columns: ["fileId"] },
  { table: "ContractFormalFile", columns: ["fileId"] },
  { table: "ContractAuthorization", columns: ["fileId"] },
  { table: "Settlement", columns: ["preparerSignatureFileId"] },
  { table: "SettlementSignedDocument", columns: ["fileId"] },
  {
    table: "SettlementSignedDocumentGenerationClaim",
    columns: ["uploadedFileId"]
  },
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
  { table: "SettlementLineAttachment", columns: ["fileId"] },
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
  { table: "SpotProcurementPaymentAttachment", columns: ["fileId"] },
  {
    table: "SpotProcurementPaymentExecutionVoucher",
    columns: ["fileId"]
  },
  { table: "SpotProcurementPaymentInvoice", columns: ["fileId"] },
  {
    table: "SpotProcurementPaymentArchive",
    columns: ["generatedPackageFileId"]
  },
  { table: "SpotProcurementPaymentArchiveFile", columns: ["fileId"] },
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
  { table: "ExpenseClaimAttachment", columns: ["fileId"] },
  { table: "ExpenseClaimPaymentExecution", columns: ["voucherFileId"] },
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
  { table: "EmployeeLoanRepayment", columns: ["voucherFileId"] },
  { table: "EmployeeProjectLoanEntry", columns: ["voucherFileId"] },
  { table: "ApprovalActionLog", columns: ["signatureFileIdSnapshot"] },
  { table: "ArchiveRecord", columns: ["fileId"] },
  { table: "PdfDocument", columns: ["fileId"] },
  {
    table: "ApprovalFormGenerationClaim",
    columns: ["uploadedFileId"]
  },
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

export interface NonReceiptFileBindingExclusion {
  table: string;
  column: string;
}

export async function acquireFileBusinessBindingTransactionLock(
  tx: Prisma.TransactionClient
): Promise<void> {
  await tx.$queryRaw(
    Prisma.sql`
      SELECT pg_advisory_xact_lock(
        ${FILE_BUSINESS_BINDING_LOCK_NAMESPACE}::int,
        ${FILE_BUSINESS_BINDING_LOCK_KEY}::int
      )::text AS "lockResult"
    `
  );
}

function sqlIdentifier(value: string): Prisma.Sql {
  if (!/^[A-Za-z][A-Za-z0-9]*$/u.test(value)) {
    throw new Error("静态文件绑定标识不合法");
  }
  return Prisma.raw(`"${value}"`);
}

export async function hasNonReceiptBusinessFileBinding(
  tx: Prisma.TransactionClient,
  fileIds: string[],
  excludedBindings: readonly NonReceiptFileBindingExclusion[] = []
): Promise<boolean> {
  return (await nonReceiptBusinessFileBindingIds(tx, fileIds, excludedBindings)).length > 0;
}

export async function nonReceiptBusinessFileBindingIds(
  tx: Prisma.TransactionClient,
  fileIds: string[],
  excludedBindings: readonly NonReceiptFileBindingExclusion[] = []
): Promise<string[]> {
  const uniqueIds = [...new Set(fileIds)].sort();
  if (!uniqueIds.length) return [];
  const registeredBindings = new Set(
    NON_RECEIPT_FILE_BINDINGS.flatMap(({ table, columns }) =>
      columns.map((column) => `${table}.${column}`)
    )
  );
  const excludedBindingKeys = new Set(
    excludedBindings.map(({ table, column }) => {
      const bindingKey = `${table}.${column}`;
      if (!registeredBindings.has(bindingKey)) {
        throw new Error("文件绑定排除项未在中心注册表登记");
      }
      return bindingKey;
    })
  );
  const candidates = Prisma.join(
    uniqueIds.map((fileId) => Prisma.sql`(${fileId})`)
  );
  const bindingQueries = NON_RECEIPT_FILE_BINDINGS.flatMap(
    ({ table, columns }) =>
      columns
        .filter((column) => !excludedBindingKeys.has(`${table}.${column}`))
        .map((column) => {
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
      SELECT DISTINCT bindings."fileId"
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
    `
  );
  return rows.map((row) => row.fileId);
}
