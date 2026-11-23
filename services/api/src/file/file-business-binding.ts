import { ServiceUnavailableException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { readFileBindingCatalog, registeredPaymentInstalled as registeredPaymentVoucherInstalled } from "../database/registered-payment-catalog";

export { registeredPaymentVoucherInstalled };

// 与数据库触发器共用同一事务级锁。文件正式绑定频率低，先用单一锁保证
// 所有旧入口、收货照片、实付凭证、退款凭证和替换链之间不存在双提交窗口。
// 若未来吞吐量需要优化，可在保持全入口一致的前提下改为按 fileId 排序取锁。
const FILE_BUSINESS_BINDING_LOCK_NAMESPACE = 190_731;
const FILE_BUSINESS_BINDING_LOCK_KEY = 13;

export const NON_RECEIPT_FILE_BINDINGS = [
  { table: "RegisteredPaymentVoucher", columns: ["fileId"] },
  { table: "ContractSignedChange", columns: ["appendixFormalFileId"] },
  { table: "SignedContractSettlementAttachment", columns: ["fileId"] },
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
  { table: "ProjectOwnerSettlementEntry", columns: ["voucherFileId"] },
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

// The signed-change reference is to a formal-file row, not a FileObject ID.
export const SIGNED_CONTRACT_FILE_BINDING_SOURCES: ReadonlyMap<string, Prisma.Sql> = new Map([
  ["ContractSignedChange", Prisma.sql`(
    SELECT x."id" AS "rowId", f."fileId"
    FROM public."ContractSignedChange" x
    JOIN public."ContractFormalFile" f ON f."id"=x."appendixFormalFileId"
  )`],
  ["SignedContractSettlementAttachment", Prisma.sql`(
    SELECT x."settlementId" AS "rowId", x."fileId"
    FROM public."SignedContractSettlementAttachment" x
  )`],
]);

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

export type ProcurementFileBindingScope = Readonly<{
  procurementId: string;
  projectId: string;
  actorUserId: string;
  revision: number;
}> | Readonly<{
  claimId: string;
  projectId: string;
  actorUserId: string;
}>;

export type RegisteredVoucherBindingScope = Readonly<{ executionId: string; actorUserId: string; read?: true }>;

export async function hasNonReceiptBusinessFileBinding(
  tx: Prisma.TransactionClient,
  fileIds: string[],
  excludedBindings: readonly NonReceiptFileBindingExclusion[] = [],
  registeredVoucher?: RegisteredVoucherBindingScope,
  procurementBinding?: ProcurementFileBindingScope
): Promise<boolean> {
  return (await nonReceiptBusinessFileBindingIds(
    tx, fileIds, excludedBindings, undefined, registeredVoucher, procurementBinding
  )).length > 0;
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
  excludedBindings: readonly NonReceiptFileBindingExclusion[] = [],
  upwardDirectVersionId?: string,
  registeredVoucher?: RegisteredVoucherBindingScope,
  procurementBinding?: ProcurementFileBindingScope,
  outsideOriginalPair?: Readonly<{ contractVersionId: string; actorUserId: string; orderedFileIds: readonly [string, string] }>
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
  const catalog = await readFileBindingCatalog(tx, true);
  const includeVoucher = catalog.registeredPayment && !excludedBindingKeys.has("RegisteredPaymentVoucher.fileId");
  const includeOwnerSettlement = catalog.ownerSettlementVoucher && !excludedBindingKeys.has("ProjectOwnerSettlementEntry.voucherFileId");
  const scopedVoucherCheck = includeOwnerSettlement && upwardDirectVersionId !== undefined
    ? await tx.$queryRaw<Array<{ executable: boolean }>>(Prisma.sql`
      SELECT COALESCE(pg_catalog.has_function_privilege(current_user,
        pg_catalog.to_regprocedure('public.jg_check_a08_direct_original_voucher_v1(text,text)'), 'EXECUTE'), false) AS executable
    `)
    : [];
  const outsideOriginalCheck = includeOwnerSettlement && outsideOriginalPair && uniqueIds.length === 2
    ? await tx.$queryRaw<Array<{ executable: boolean }>>(Prisma.sql`
      SELECT current_user=session_user AND current_user::text ~ '^jg_fixture_app_[a-f0-9]{24}$'
        AND COALESCE(pg_catalog.has_function_privilege(current_user,
          pg_catalog.to_regprocedure('public.jg_check_a08_outside_original_pair_v1(text,text,text,integer)'), 'EXECUTE'), false) AS executable
    `)
    : [];
  const registeredVoucherRoutine = registeredVoucher?.read
    ? "public.jg_read_registered_payment_voucher_binding_v1(text,text,text)"
    : "public.jg_check_registered_payment_voucher_binding_v1(text,text,text)";
  const registeredVoucherCheck = includeOwnerSettlement && registeredVoucher
    ? await tx.$queryRaw<Array<{ executable: boolean }>>(Prisma.sql`
      SELECT current_user=session_user AND current_user='jg_task01_runtime'
        AND COALESCE(pg_catalog.has_function_privilege(current_user,
          pg_catalog.to_regprocedure(${registeredVoucherRoutine}), 'EXECUTE'), false) AS executable
    `)
    : [];
  const procurementRoutine = procurementBinding && "claimId" in procurementBinding
    ? "public.jg_check_legacy_procurement_expense_voucher_v1(text,text,text,text)"
    : "public.jg_check_general_procurement_archive_voucher_v1(text,text,text,text,integer)";
  const procurementBindingCheck = includeOwnerSettlement && procurementBinding
    ? await tx.$queryRaw<Array<{ executable: boolean }>>(Prisma.sql`
      SELECT current_user=session_user
        AND (current_user='general_procurement_runtime' OR
          (current_user='project_business_scope_runtime'
            AND ${!("claimId" in procurementBinding) && procurementBinding.projectId === "legacy-project-business-scope"}::boolean))
        AND COALESCE(pg_catalog.has_function_privilege(current_user,
          pg_catalog.to_regprocedure(${procurementRoutine}), 'EXECUTE'), false) AS executable
    `)
    : [];
  const availableBindings = NON_RECEIPT_FILE_BINDINGS.filter(({ table }) =>
    catalog.signedContractFileBindings || !SIGNED_CONTRACT_FILE_BINDING_SOURCES.has(table)
  );
  const bindingQueries = availableBindings.flatMap(
    ({ table, columns }) =>
      columns
        .filter((column) => table === "RegisteredPaymentVoucher" ? includeVoucher :
          table === "ProjectOwnerSettlementEntry" ? includeOwnerSettlement : !excludedBindingKeys.has(`${table}.${column}`))
        .map((column) => {
          if (table === "ProjectOwnerSettlementEntry") {
            const referenced = scopedVoucherCheck[0]?.executable
              ? Prisma.sql`public.jg_check_a08_direct_original_voucher_v1(${upwardDirectVersionId}, c."id")`
              : outsideOriginalPair && outsideOriginalCheck[0]?.executable
                ? Prisma.sql`public.jg_check_a08_outside_original_pair_v1(
                    ${outsideOriginalPair.contractVersionId}, c."id", ${outsideOriginalPair.actorUserId},
                    CASE WHEN c."id"=${outsideOriginalPair.orderedFileIds[0]} THEN 0
                         WHEN c."id"=${outsideOriginalPair.orderedFileIds[1]} THEN 1 ELSE -1 END)`
              : registeredVoucher && registeredVoucherCheck[0]?.executable
                ? registeredVoucher.read
                  ? Prisma.sql`public.jg_read_registered_payment_voucher_binding_v1(${registeredVoucher.executionId}, c."id", ${registeredVoucher.actorUserId})`
                  : Prisma.sql`public.jg_check_registered_payment_voucher_binding_v1(${registeredVoucher.executionId}, c."id", ${registeredVoucher.actorUserId})`
                : procurementBinding && procurementBindingCheck[0]?.executable
                  ? "claimId" in procurementBinding
                    ? Prisma.sql`public.jg_check_legacy_procurement_expense_voucher_v1(
                        ${procurementBinding.claimId}, ${procurementBinding.projectId}, c."id", ${procurementBinding.actorUserId})`
                    : Prisma.sql`public.jg_check_general_procurement_archive_voucher_v1(
                        ${procurementBinding.procurementId}, ${procurementBinding.projectId}, c."id",
                        ${procurementBinding.actorUserId}, ${procurementBinding.revision}::integer)`
                  : Prisma.sql`public.jg_project_owner_settlement_voucher_bound(c."id")`;
            return Prisma.sql`SELECT c."id" AS "fileId" FROM candidates c WHERE ${referenced}`;
          }
          const signedSource = SIGNED_CONTRACT_FILE_BINDING_SOURCES.get(table);
          if (signedSource) {
            return Prisma.sql`SELECT x."fileId" FROM ${signedSource} x JOIN candidates c ON c."id"=x."fileId"`;
          }
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
