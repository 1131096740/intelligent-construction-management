import { ServiceUnavailableException } from "@nestjs/common";
import { Prisma } from "@prisma/client";

// 与数据库触发器共用同一事务级锁。文件正式绑定频率低，先用单一锁保证
// 所有旧入口、收货照片、实付凭证、退款凭证和替换链之间不存在双提交窗口。
// 若未来吞吐量需要优化，可在保持全入口一致的前提下改为按 fileId 排序取锁。
const FILE_BUSINESS_BINDING_LOCK_NAMESPACE = 190_731;
const FILE_BUSINESS_BINDING_LOCK_KEY = 13;

export const NON_RECEIPT_FILE_BINDINGS = [
  { table: "RegisteredPaymentVoucher", columns: ["fileId"] },
 {table:"CompanyTransfer",columns:["evidenceFileId"]},
  { table: "ContractBankVerificationRequest", columns: ["evidenceFileId", "holderEvidenceFileId"] },
  { table: "ContractProxyExecution", columns: ["evidenceFileId"] },
  { table: "UpwardContractAmountRevision", columns: ["evidenceFileId"] },
  { table: "GeneralProcurement", columns: ["archiveFileId"] },
  { table: "User", columns: ["signatureFileId"] },
  { table: "AffiliateClearingAuthorityVersion", columns: ["evidenceFileId"] },
  { table: "WageApprovedSourceVersion", columns: ["evidenceFileId"] },
  {
    table: "InterEntityRelationshipEntry",
    columns: [
      "evidenceFileId",
      "authorizationEvidenceFileId",
      "actualPayerVerificationEvidenceFileId"
    ]
  },
  {
    table: "PaymentExecutionPayerAttestation",
    columns: ["verificationEvidenceFileId", "proxyAuthorizationEvidenceFileId"]
  },
  {
    table: "PaymentExecutionPayerVerification",
    columns: ["verificationEvidenceFileId"]
  },
  {
    table: "VerifiedBankTransactionObservation",
    columns: ["verificationEvidenceFileId", "transactionEvidenceFileId"]
  },
  { table: "InterEntityRelationshipEvidenceClaim", columns: ["fileId"] },
  { table: "HandwrittenSignatureVersion", columns: ["fileId"] },
  { table: "ContractVersion", columns: ["taxFactEvidenceFileId"] },
  { table: "ContractTaxFactRevision", columns: ["evidenceFileId"] },
  {
    table: "ContractTakeoverCorrection",
    columns: ["attachmentFileId"]
  },
  { table: "ContractTakeoverSettlementEvidence", columns: ["fileId"] },
  { table: "ContractTakeoverHistoricalPaymentVoucher", columns: ["fileId"] },
  { table: "ContractTakeoverExcessEvidence", columns: ["fileId"] },
  { table: "ContractArchiveFile", columns: ["fileId"] },
  { table: "ContractArchiveEvidenceFile", columns: ["fileId"] },
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
  { table: "SettlementRecoveryEntry", columns: ["evidenceFileId"] },
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
  {
    table: "InvoiceEvidenceRepairResolution",
    columns: ["replacementFileId"]
  },
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
    columns: ["voucherFileId", "confirmationSignatureFileId"]
  },
  {
    table: "ProjectUpstreamFundFact",
    columns: ["evidenceFileId", "confirmationSignatureFileId"]
  },
  { table: "ProjectOwnerContract", columns: ["fileId"] },
  {
    table: "ProjectAffiliateContractFact",
    columns: ["evidenceFileId", "confirmationSignatureFileId"]
  },
  {
    table: "ProjectAffiliateSettlementFact",
    columns: ["evidenceFileId", "confirmationSignatureFileId"]
  },
  {
    table: "ProjectAffiliatePaymentFact",
    columns: ["evidenceFileId", "confirmationSignatureFileId"]
  },
  { table: "ProjectAffiliateBusinessEvidence", columns: ["fileId"] },
  {
    table: "ProjectAffiliateCompanyContract",
    columns: ["fileId", "confirmationSignatureFileId"]
  },
  { table: "OperatingTakeoverBatch", columns: ["sourceFileId"] },
  { table: "OperatingTakeoverAttachmentLink", columns: ["fileId"] },
  {
    table: "ProjectSettlementExceptionQuota",
    columns: ["attachmentFileId"]
  },
  {
    table: "ProjectFinancingQuota",
    columns: ["attachmentFileId", "terminationSignatureFileId"]
  },
  {
    table: "ProjectNecessaryExpenseReserveEntry",
    columns: ["evidenceFileId"]
  },
  {
    table: "ProjectFundDisputeEntry",
    columns: ["evidenceFileId"]
  },
  { table: "EmployeeLoanRepayment", columns: ["voucherFileId"] },
  { table: "EmployeeProjectLoanEntry", columns: ["voucherFileId"] },
  { table: "ApprovalActionLog", columns: ["signatureFileIdSnapshot"] },
  { table: "ArchiveRecord", columns: ["fileId"] },
  { table: "PdfDocument", columns: ["fileId"] },
  {
    table: "ApprovalFormGenerationClaim",
    columns: ["uploadedFileId"],
    rowIdColumn: "approvalInstanceId"
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
  { table: "ContractDraftAttachment", columns: ["fileId"] },
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

/** The supplemental voucher is installed atomically after the migration-only schema. */
export async function registeredPaymentVoucherInstalled(tx: Prisma.TransactionClient): Promise<boolean> {
  const [row, extra] = await tx.$queryRaw<Array<{ state: string }>>(Prisma.sql`
    /* registered_payment_voucher_catalog */
    WITH scope AS (
      SELECT pg_catalog.to_regclass('public."PaymentExecution"')::oid AS payment,
        pg_catalog.to_regclass('public."FileObject"')::oid AS file,
        pg_catalog.to_regclass('public."RegisteredPaymentVoucher"')::oid AS voucher,
        pg_catalog.to_regclass('public."RegisteredPaymentFunding"')::oid AS funding,
        pg_catalog.to_regclass('public."RegisteredFundPaymentAllocation"')::oid AS allocation,
        pg_catalog.to_regclass('public."RegisteredPaymentEvent"')::oid AS event,
        pg_catalog.to_regclass('public."RegisteredContractHistoryRevision"')::oid AS history,
        pg_catalog.to_regprocedure('public.jg_file_business_binding_columns()')::oid AS registry,
        pg_catalog.to_regprocedure('public.jg_file_business_binding_columns_before_registered_payment()')::oid AS alias,
        pg_catalog.to_regprocedure('public.jg_registered_payment_voucher_file_immutable()')::oid AS guard
    ), voucher_columns(name, type) AS (VALUES
      ('executionId',25), ('fileId',25), ('uploadedByUserId',25), ('contentSha256',25), ('createdAt',1114)
    ), anchor AS (
      SELECT scope.*, p.relowner AS owner, a.attnotnull AS legacy_voucher
      FROM scope JOIN pg_catalog.pg_class p ON p.oid=payment AND p.relkind='r'
      JOIN pg_catalog.pg_class f ON f.oid=file AND f.relkind='r' AND f.relowner=p.relowner
      JOIN pg_catalog.pg_attribute a ON a.attrelid=p.oid AND a.attname='voucherFileId'
        AND a.attnum>0 AND NOT a.attisdropped AND a.atttypid='pg_catalog.text'::regtype
    )
    SELECT CASE
      WHEN legacy_voucher AND num_nonnulls(voucher,funding,allocation,event,history,alias,guard)=0
        AND EXISTS (SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=registry AND p.proowner=owner
          AND pg_catalog.strpos(p.prosrc,'RegisteredPaymentVoucher')=0
          AND pg_catalog.strpos(p.prosrc,'jg_file_business_binding_columns_before_registered_payment')=0)
        AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger WHERE tgrelid=file
          AND tgname='RegisteredPaymentVoucher_file_immutable')
        THEN 'absent'
      WHEN NOT legacy_voucher AND num_nonnulls(voucher,funding,allocation,event,history,alias,guard)=7
        AND (SELECT count(*) FROM pg_catalog.pg_class c WHERE c.oid IN (voucher,funding,allocation,event,history)
          AND c.relowner=owner AND c.relkind='r' AND c.relpersistence='p'
          AND NOT (c.relispartition OR c.relrowsecurity OR c.relforcerowsecurity))=5
        AND (SELECT count(*) FROM pg_catalog.pg_attribute a JOIN voucher_columns v
          ON v.name=a.attname AND v.type::oid=a.atttypid WHERE a.attrelid=voucher
          AND a.attnum>0 AND NOT a.attisdropped AND a.attnotnull)=5
        AND EXISTS (SELECT 1 FROM pg_catalog.pg_constraint k WHERE k.conrelid=voucher
          AND k.conname='RegisteredPaymentVoucher_fileId_fkey' AND k.contype='f'
          AND k.confrelid=file AND k.convalidated AND NOT k.condeferrable
          AND k.confupdtype='r' AND k.confdeltype='r')
        AND EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_proc predecessor ON predecessor.oid=alias
          WHERE p.oid=registry AND p.proowner=owner AND predecessor.proowner=owner AND NOT p.prosecdef
          AND pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p.prosrc,'UTF8')),'hex')
            ='46e6f6acb43b69175637009a272eec11a945928f055272aeea13ea86c384a4a3')
        AND EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_proc p ON p.oid=t.tgfoid
          WHERE t.tgrelid=file AND t.tgname='RegisteredPaymentVoucher_file_immutable'
          AND t.tgenabled='O' AND NOT t.tgisinternal AND t.tgtype=27
          AND p.oid=guard AND p.proowner=owner AND NOT p.prosecdef
          AND pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p.prosrc,'UTF8')),'hex')
            ='91b57f66e67bb1d888d1d0e8803cabbe08c289b01d2a6e810bfa69fe82a48d62')
        AND EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t
          WHERE t.tgrelid=voucher AND t.tgname='jg_efb_registered_payment_voucher'
          AND t.tgenabled='O' AND NOT t.tgisinternal AND t.tgtype=7
          AND t.tgfoid=pg_catalog.to_regprocedure('public.jg_enforce_exclusive_file_business_binding()'))
        THEN 'installed'
      ELSE 'unavailable'
    END AS state FROM anchor
  `);
  if (!extra && row?.state === "absent") return false;
  if (!extra && row?.state === "installed") return true;
  throw new ServiceUnavailableException("付款凭证文件绑定暂不可核验，请稍后重试");
}

export async function hasNonReceiptBusinessFileBinding(
  tx: Prisma.TransactionClient,
  fileIds: string[],
  excludedBindings: readonly NonReceiptFileBindingExclusion[] = []
): Promise<boolean> {
  return (await nonReceiptBusinessFileBindingIds(tx, fileIds, excludedBindings)).length > 0;
}

export async function hasAnyBusinessFileBinding(
  tx: Prisma.TransactionClient,
  fileIds: string[]
): Promise<boolean> {
  const uniqueIds = [...new Set(fileIds)].sort();
  if (!uniqueIds.length) return false;
  if (await hasNonReceiptBusinessFileBinding(tx, uniqueIds)) return true;
  return Boolean(await tx.spotProcurementReceiptPhoto.findFirst({
    where: {
      OR: [
        { originalFileId: { in: uniqueIds } },
        { watermarkedFileId: { in: uniqueIds } }
      ]
    },
    select: { id: true }
  }));
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
  const includeVoucher = !excludedBindingKeys.has("RegisteredPaymentVoucher.fileId") &&
    await registeredPaymentVoucherInstalled(tx);
  const bindingQueries = NON_RECEIPT_FILE_BINDINGS.flatMap(
    ({ table, columns }) =>
      columns
        .filter((column) => table === "RegisteredPaymentVoucher" ? includeVoucher :
          !excludedBindingKeys.has(`${table}.${column}`))
        .map((column) => {
          const field = sqlIdentifier(column);
          const relation = table === "RegisteredPaymentVoucher"
            ? Prisma.sql`public.${sqlIdentifier(table)}`
            : sqlIdentifier(table);
          return Prisma.sql`
            SELECT x.${field} AS "fileId"
            FROM ${relation} x
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

/** Nonblocking variant for callers already holding the complete file set. */
export async function tryAcquireFileBusinessBindingTransactionLock(
  tx: Prisma.TransactionClient
): Promise<boolean> {
  const rows = await tx.$queryRaw<Array<{ acquired: boolean }>>(Prisma.sql`
    SELECT pg_try_advisory_xact_lock(
      ${FILE_BUSINESS_BINDING_LOCK_NAMESPACE}::int,
      ${FILE_BUSINESS_BINDING_LOCK_KEY}::int
    ) AS "acquired"
  `);
  if (!Array.isArray(rows) || rows.length !== 1 || typeof rows[0]?.acquired !== "boolean") {
    throw new ServiceUnavailableException("文件绑定锁结果尚未确认，请查询原归档标识，不要重复发起");
  }
  return rows[0].acquired;
}
