import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { NON_RECEIPT_FILE_BINDINGS } from "../file/file-business-binding";

type PrismaModelExpectation = {
  fields: string[];
  attributes: string[];
};

type SqlColumn = {
  name: string;
  type: string;
  nullable: boolean;
  defaultValue: string;
};

type SqlIndex = {
  name: string;
  table: string;
  columns: string[];
  unique: boolean;
  predicate: string;
};

type SqlForeignKey = {
  name: string;
  table: string;
  columns: string[];
  referencedTable: string;
  referencedColumns: string[];
};

type CheckExpectation = {
  table: string;
  name: string;
  expression: string;
};

const expectedModel = (
  fields: string[],
  attributes: string[]
): PrismaModelExpectation => ({ fields, attributes });

const expectedIndex = (
  name: string,
  table: string,
  columns: string[],
  unique = false,
  predicate = ""
): SqlIndex => ({ name, table, columns, unique, predicate });

const expectedForeignKey = (
  name: string,
  table: string,
  columns: string[],
  referencedTable: string,
  referencedColumns: string[]
): SqlForeignKey => ({ name, table, columns, referencedTable, referencedColumns });

const expectedCheck = (
  table: string,
  name: string,
  expression: string
): CheckExpectation => ({ table, name, expression });

const EXPECTED_PRISMA_MODELS: Record<string, PrismaModelExpectation> = {
  SpotProcurement: expectedModel(
    [
      "id String @id @default(uuid())",
      "projectId String",
      "code String @unique",
      "supplierPartyId String?",
      "supplierKey String? // legacy: new real-form applications do not select a supplier",
      "supplierNameSnapshot String? // legacy: new real-form applications do not select a supplier",
      "applicantUserId String",
      "handlerUserId String",
      "currentVersionId String?",
      "status String",
      "approvedAmountCents BigInt? // legacy: approval amount is now frozen on the payment application",
      "actualCostCents BigInt?",
      "closedAt DateTime?",
      "voidedAt DateTime?",
      "voidedByUserId String?",
      "voidReason String?",
      "abandonedAt DateTime?",
      "abandonedByUserId String?",
      "abandonReason String?",
      "createdAt DateTime @default(now())",
      "updatedAt DateTime @updatedAt"
    ],
    [
      "@@unique([projectId, id])",
      "@@index([projectId, status])",
      "@@index([projectId, supplierKey])",
      "@@index([status, updatedAt])"
    ]
  ),
  SpotProcurementVersion: expectedModel(
    [
      "id String @id @default(uuid())",
      "procurementId String",
      "versionNo Int",
      "status String",
      "reason String",
      "note String?",
      "supplierPartyId String?",
      "supplierKey String? // legacy: actual merchant is frozen on the payment application",
      "supplierNameSnapshot String? // legacy: actual merchant is frozen on the payment application",
      "handlerUserId String",
      "applicationDepartmentSnapshot String",
      "applicationNameSnapshot String",
      "purchaserNameSnapshot String",
      "purchaserDepartmentId String?",
      "purchaserDepartmentNameSnapshot String",
      "requestedArrivalAt DateTime",
      "totalAmountCents BigInt? // legacy: the A4 procurement application has no amount",
      "changeReason String?",
      "changeSummary Json?",
      "submittedAt DateTime?",
      "approvedAt DateTime?",
      "abandonedAt DateTime?",
      "abandonedByUserId String?",
      "abandonReason String?",
      "createdByUserId String",
      "createdAt DateTime @default(now())",
      "updatedAt DateTime @updatedAt"
    ],
    [
      "@@unique([procurementId, versionNo])",
      "@@unique([procurementId, id])",
      "@@index([procurementId, status])",
      "@@index([status, updatedAt])"
    ]
  ),
  SpotProcurementLine: expectedModel(
    [
      "id String @id @default(uuid())",
      "versionId String",
      "sortOrder Int",
      "materialName String",
      "specification String?",
      "unit String",
      "quantity Decimal @db.Decimal(24, 6)",
      "invoiceMode String? // legacy: expected invoice facts belong to payment lines",
      "invoiceType String?",
      "vatRateOptionId String?",
      "vatRateValueSnapshot Decimal? @db.Decimal(9, 6)",
      "vatRateLabelSnapshot String?",
      "unitPrice Decimal? @db.Decimal(24, 6) // legacy: price belongs to payment lines",
      "amountCents BigInt? // legacy: amount belongs to payment lines",
      "usageLocation String?",
      "note String?",
      "createdAt DateTime @default(now())"
    ],
    ["@@unique([versionId, sortOrder])", "@@index([versionId])"]
  ),
  SpotProcurementAttachment: expectedModel(
    [
      "id String @id @default(uuid())",
      "versionId String",
      "fileId String",
      "category String",
      "uploadedByUserId String",
      "createdAt DateTime @default(now())"
    ],
    ["@@unique([versionId, fileId])", "@@index([fileId])"]
  ),
  SpotProcurementPayment: expectedModel(
    [
      "id String @id @default(uuid())",
      "projectId String",
      "procurementId String",
      "procurementVersionId String",
      "code String @unique",
      'status String @default("draft")',
      "settlementAmountCents BigInt @default(0)",
      "supplierBalanceAmountCents BigInt @default(0)",
      "companyPaymentAmountCents BigInt @default(0)",
      "paidAmountCents BigInt @default(0)",
      "executedSupplierBalanceAmountCents BigInt @default(0)",
      "canceledAmountCents BigInt @default(0)",
      "canceledCompanyPaymentAmountCents BigInt @default(0)",
      "canceledSupplierBalanceAmountCents BigInt @default(0)",
      "paymentPath String?",
      "paymentMethod String?",
      "paymentType String?",
      "merchantNameSnapshot String?",
      "merchantPayeeMismatchNote String?",
      "payeePartyId String?",
      "payeeUserId String?",
      "payeeNameSnapshot String?",
      "payeeAccountNameSnapshot String?",
      "payeeBankNameSnapshot String?",
      "payeeBankAccountSnapshot String?",
      "expectedPaymentAt DateTime?",
      "paymentNote String?",
      "supportingAttachmentFileId String?",
      "merchantPaymentProofFileId String?",
      "balanceOverrideReason String?",
      "payerCompanyEntityId String?",
      "payerCompanyNameSnapshot String?",
      "payerUnifiedSocialCreditCodeSnapshot String?",
      "approvalAmountCents BigInt @default(0)",
      "primaryPaymentChannelId String?",
      "submittedVersionNo Int?",
      "factsFrozenAt DateTime?",
      "handlerUserId String",
      "createdByUserId String",
      "submittedAt DateTime?",
      "approvedAt DateTime?",
      "invalidatedAt DateTime?",
      "invalidatedByUserId String?",
      "invalidatedReason String?",
      "draftOrigin String?",
      "sourcePaymentId String?",
      'sourcePayment SpotProcurementPayment? @relation("SpotProcurementPaymentSource", fields: [sourcePaymentId], references: [id], onDelete: Restrict, onUpdate: Restrict)',
      'derivedPayments SpotProcurementPayment[] @relation("SpotProcurementPaymentSource")',
      "createdAt DateTime @default(now())",
      "updatedAt DateTime @updatedAt"
    ],
    [
      "@@unique([id, procurementVersionId])",
      "@@index([projectId, status])",
      "@@index([procurementId, status])",
      "@@index([procurementVersionId])",
      "@@index([supportingAttachmentFileId])",
      "@@index([merchantPaymentProofFileId])",
      "@@index([payerCompanyEntityId])",
      "@@index([sourcePaymentId])"
    ]
  ),
  SpotProcurementPaymentExecution: expectedModel(
    [
      "id String @id @default(uuid())",
      "paymentId String",
      "amountCents BigInt",
      "paidAt DateTime",
      "paymentMethod String",
      "paymentChannelId String?",
      "executedByUserId String",
      "voucherFileId String? // legacy: new executions use SpotProcurementPaymentExecutionVoucher",
      "idempotencyKey String @unique",
      "voidedAt DateTime?",
      "voidedByUserId String?",
      "voidReason String?",
      "createdAt DateTime @default(now())"
    ],
    [
      "@@index([paymentId])",
      "@@index([paymentChannelId])",
      "@@index([voucherFileId])"
    ]
  ),
  SupplierBalanceAccount: expectedModel(
    [
      "id String @id @default(uuid())",
      "projectId String",
      "supplierPartyId String?",
      "supplierKey String",
      "supplierNameSnapshot String",
      "availableAmountCents BigInt @default(0)",
      "reservedAmountCents BigInt @default(0)",
      "createdAt DateTime @default(now())",
      "updatedAt DateTime @updatedAt"
    ],
    ["@@unique([projectId, supplierKey])", "@@index([supplierPartyId])"]
  ),
  SupplierBalanceReservation: expectedModel(
    [
      "id String @id @default(uuid())",
      "accountId String",
      "paymentId String",
      "amountCents BigInt",
      "releasedAmountCents BigInt @default(0)",
      'status String @default("reserved")',
      "reservedByUserId String",
      "releasedAt DateTime?",
      "releasedByUserId String?",
      "releaseReason String?",
      "executedAt DateTime?",
      "executedByUserId String?",
      "createdAt DateTime @default(now())",
      "updatedAt DateTime @updatedAt"
    ],
    ["@@unique([paymentId])", "@@index([accountId, status])"]
  ),
  SupplierBalanceEntry: expectedModel(
    [
      "id String @id @default(uuid())",
      "accountId String",
      "sequenceNo BigInt",
      "reservationId String?",
      "paymentId String?",
      "procurementId String?",
      "entryType String",
      "availableDeltaCents BigInt",
      "reservedDeltaCents BigInt",
      "availableAmountAfterCents BigInt",
      "reservedAmountAfterCents BigInt",
      "actorUserId String",
      "reason String?",
      "createdAt DateTime @default(now())"
    ],
    [
      "@@unique([accountId, sequenceNo])",
      "@@index([accountId, createdAt])",
      "@@index([reservationId])",
      "@@index([paymentId])",
      "@@index([procurementId])"
    ]
  ),
  VatRateOption: expectedModel(
    [
      "id String @id @default(uuid())",
      "rateValue Decimal @db.Decimal(9, 6)",
      "label String",
      "enabled Boolean @default(true)",
      "sortOrder Int",
      "createdByUserId String",
      "createdAt DateTime @default(now())",
      "updatedAt DateTime @updatedAt"
    ],
    ["@@unique([rateValue, label])", "@@index([enabled, sortOrder])"]
  )
};

const CORE_MIGRATION_FIELD_OVERRIDES: Record<string, Record<string, string>> = {
  SpotProcurement: {
    supplierKey: "supplierKey String",
    supplierNameSnapshot: "supplierNameSnapshot String",
    approvedAmountCents: "approvedAmountCents BigInt @default(0)"
  },
  SpotProcurementVersion: {
    supplierKey: "supplierKey String",
    supplierNameSnapshot: "supplierNameSnapshot String",
    totalAmountCents: "totalAmountCents BigInt"
  },
  SpotProcurementLine: {
    invoiceMode: "invoiceMode String",
    unitPrice: "unitPrice Decimal @db.Decimal(24, 6)",
    amountCents: "amountCents BigInt"
  },
  SpotProcurementPayment: {
    payeeNameSnapshot: "payeeNameSnapshot String"
  },
  SpotProcurementPaymentExecution: {
    voucherFileId: "voucherFileId String"
  }
};

const CORE_MIGRATION_FORWARD_FIELDS = new Set([
  "SpotProcurement.abandonedAt",
  "SpotProcurement.abandonedByUserId",
  "SpotProcurement.abandonReason",
  "SpotProcurementVersion.applicationDepartmentSnapshot",
  "SpotProcurementVersion.applicationNameSnapshot",
  "SpotProcurementVersion.purchaserNameSnapshot",
  "SpotProcurementVersion.purchaserDepartmentId",
  "SpotProcurementVersion.purchaserDepartmentNameSnapshot",
  "SpotProcurementVersion.requestedArrivalAt",
  "SpotProcurementVersion.abandonedAt",
  "SpotProcurementVersion.abandonedByUserId",
  "SpotProcurementVersion.abandonReason",
  "SpotProcurementPayment.paymentType",
  "SpotProcurementPayment.merchantNameSnapshot",
  "SpotProcurementPayment.merchantPayeeMismatchNote",
  "SpotProcurementPayment.payerCompanyEntityId",
  "SpotProcurementPayment.payerCompanyNameSnapshot",
  "SpotProcurementPayment.payerUnifiedSocialCreditCodeSnapshot",
  "SpotProcurementPayment.approvalAmountCents",
  "SpotProcurementPayment.primaryPaymentChannelId",
  "SpotProcurementPayment.submittedVersionNo",
  "SpotProcurementPayment.factsFrozenAt",
  "SpotProcurementPayment.draftOrigin",
  "SpotProcurementPayment.sourcePaymentId",
  "SpotProcurementPayment.sourcePayment",
  "SpotProcurementPayment.derivedPayments",
  "SpotProcurementPaymentExecution.paymentChannelId",
  "SupplierBalanceReservation.releasedAmountCents"
]);

const REAL_FORM_FILE_BINDING_TABLES = new Set([
  "SpotProcurementPaymentAttachment",
  "SpotProcurementPaymentExecutionVoucher",
  "SpotProcurementPaymentInvoice",
  "SpotProcurementPaymentArchive",
  "SpotProcurementPaymentArchiveFile"
]);

// These FileObject references were introduced by the contract/settlement
// governance migrations after the immutable 20260717140000/150000 guards.
// The final combined manifest is verified by unified-file-business-binding-guard.spec.ts.
const GOVERNANCE_FILE_BINDING_TABLES = new Set([
  "HandwrittenSignatureVersion",
  "ContractVersion",
  "ContractTaxFactRevision",
  "ContractFormalFile",
  "ContractAuthorization",
  "Settlement",
  "SettlementSignedDocument",
  "SettlementSignedDocumentGenerationClaim",
  "ApprovalActionLog",
  "ApprovalFormGenerationClaim"
]);

// These file facts were added by later phase-one migrations. The two
// 2026071714/150000 migrations are immutable historical snapshots; their
// expected registries must not be retroactively compared with later tables.
// The final registry remains covered by unified-file-business-binding-guard.
const POST_INVOICE_EVIDENCE_FILE_BINDING_TABLES = new Set([
  "SettlementLineAttachment",
  "EmployeeLoanRepayment",
  "EmployeeProjectLoanEntry",
  "ExpenseClaimAttachment",
  "ExpenseClaimPaymentExecution"
]);

const existedAtInvoiceEvidenceGuard = (table: string) =>
  !REAL_FORM_FILE_BINDING_TABLES.has(table) &&
  !GOVERNANCE_FILE_BINDING_TABLES.has(table) &&
  !POST_INVOICE_EVIDENCE_FILE_BINDING_TABLES.has(table);

const fieldsAtCoreMigration = (table: string, fields: string[]) =>
  fields
    .filter((field) => {
      const fieldName = field.split(" ")[0];
      return !CORE_MIGRATION_FORWARD_FIELDS.has(`${table}.${fieldName}`);
    })
    .map((field) => {
      const fieldName = field.split(" ")[0];
      return CORE_MIGRATION_FIELD_OVERRIDES[table]?.[fieldName] ?? field;
    });

const LEGACY_PROJECT_EXPENSE_FIELDS = [
  "id",
  "projectId",
  "code",
  "expenseType",
  "expenseSubtype",
  "paymentSubject",
  "reason",
  "requestedAmountCents",
  "approvedAmountCents",
  "paidAmountCents",
  "paymentMethod",
  "counterpartyName",
  "counterpartyAccountName",
  "counterpartyBankName",
  "counterpartyBankAccount",
  "handlerUserId",
  "applicantUserId",
  "attachmentFileId",
  "purchaseExecutedByUserId",
  "purchaseExecutedAt",
  "purchaseExecutionNote",
  "receiptConfirmedByUserId",
  "receiptConfirmedAt",
  "receiptConfirmationNote",
  "status",
  "voidedAt",
  "voidedByUserId",
  "voidReason",
  "createdAt",
  "updatedAt"
];

const EXPECTED_INDEXES: SqlIndex[] = [
  expectedIndex("VatRateOption_rateValue_label_key", "VatRateOption", ["rateValue", "label"], true),
  expectedIndex("VatRateOption_enabled_sortOrder_idx", "VatRateOption", ["enabled", "sortOrder"]),
  expectedIndex("SpotProcurement_code_key", "SpotProcurement", ["code"], true),
  expectedIndex("SpotProcurement_projectId_id_key", "SpotProcurement", ["projectId", "id"], true),
  expectedIndex("SpotProcurement_projectId_status_idx", "SpotProcurement", ["projectId", "status"]),
  expectedIndex("SpotProcurement_projectId_supplierKey_idx", "SpotProcurement", ["projectId", "supplierKey"]),
  expectedIndex("SpotProcurementVersion_procurementId_versionNo_key", "SpotProcurementVersion", ["procurementId", "versionNo"], true),
  expectedIndex("SpotProcurementVersion_procurementId_id_key", "SpotProcurementVersion", ["procurementId", "id"], true),
  expectedIndex("SpotProcurementVersion_procurementId_status_idx", "SpotProcurementVersion", ["procurementId", "status"]),
  expectedIndex("SpotProcurementLine_versionId_sortOrder_key", "SpotProcurementLine", ["versionId", "sortOrder"], true),
  expectedIndex("SpotProcurementLine_versionId_idx", "SpotProcurementLine", ["versionId"]),
  expectedIndex("SpotProcurementAttachment_versionId_fileId_key", "SpotProcurementAttachment", ["versionId", "fileId"], true),
  expectedIndex("SpotProcurementAttachment_fileId_idx", "SpotProcurementAttachment", ["fileId"]),
  expectedIndex("SpotProcurementPayment_code_key", "SpotProcurementPayment", ["code"], true),
  expectedIndex("SpotProcurementPayment_projectId_status_idx", "SpotProcurementPayment", ["projectId", "status"]),
  expectedIndex("SpotProcurementPayment_procurementId_status_idx", "SpotProcurementPayment", ["procurementId", "status"]),
  expectedIndex("SpotProcurementPayment_procurementVersionId_idx", "SpotProcurementPayment", ["procurementVersionId"]),
  expectedIndex("SpotProcurementPayment_supportingAttachmentFileId_idx", "SpotProcurementPayment", ["supportingAttachmentFileId"]),
  expectedIndex("SpotProcurementPayment_merchantPaymentProofFileId_idx", "SpotProcurementPayment", ["merchantPaymentProofFileId"]),
  expectedIndex("SpotProcurementPaymentExecution_idempotencyKey_key", "SpotProcurementPaymentExecution", ["idempotencyKey"], true),
  expectedIndex(
    "SpotProcurementPaymentExecution_active_voucherFileId_key",
    "SpotProcurementPaymentExecution",
    ["voucherFileId"],
    true,
    '"voidedAt"ISNULL'
  ),
  expectedIndex("SpotProcurementPaymentExecution_paymentId_idx", "SpotProcurementPaymentExecution", ["paymentId"]),
  expectedIndex("SpotProcurementPaymentExecution_voucherFileId_idx", "SpotProcurementPaymentExecution", ["voucherFileId"]),
  expectedIndex("SupplierBalanceAccount_projectId_supplierKey_key", "SupplierBalanceAccount", ["projectId", "supplierKey"], true),
  expectedIndex("SupplierBalanceAccount_supplierPartyId_idx", "SupplierBalanceAccount", ["supplierPartyId"]),
  expectedIndex("SupplierBalanceReservation_paymentId_key", "SupplierBalanceReservation", ["paymentId"], true),
  expectedIndex("SupplierBalanceReservation_accountId_status_idx", "SupplierBalanceReservation", ["accountId", "status"]),
  expectedIndex("SupplierBalanceEntry_accountId_sequenceNo_key", "SupplierBalanceEntry", ["accountId", "sequenceNo"], true),
  expectedIndex("SupplierBalanceEntry_accountId_createdAt_idx", "SupplierBalanceEntry", ["accountId", "createdAt"]),
  expectedIndex("SupplierBalanceEntry_reservationId_idx", "SupplierBalanceEntry", ["reservationId"]),
  expectedIndex("SupplierBalanceEntry_paymentId_idx", "SupplierBalanceEntry", ["paymentId"]),
  expectedIndex("SupplierBalanceEntry_procurementId_idx", "SupplierBalanceEntry", ["procurementId"])
];

const EXPECTED_FOREIGN_KEYS: SqlForeignKey[] = [
  expectedForeignKey("VatRateOption_createdByUserId_fkey", "VatRateOption", ["createdByUserId"], "User", ["id"]),
  expectedForeignKey("SpotProcurement_projectId_fkey", "SpotProcurement", ["projectId"], "Project", ["id"]),
  expectedForeignKey("SpotProcurement_supplierPartyId_fkey", "SpotProcurement", ["supplierPartyId"], "BusinessParty", ["id"]),
  expectedForeignKey("SpotProcurement_applicantUserId_fkey", "SpotProcurement", ["applicantUserId"], "User", ["id"]),
  expectedForeignKey("SpotProcurement_handlerUserId_fkey", "SpotProcurement", ["handlerUserId"], "User", ["id"]),
  expectedForeignKey("SpotProcurement_voidedByUserId_fkey", "SpotProcurement", ["voidedByUserId"], "User", ["id"]),
  expectedForeignKey(
    "SpotProcurement_currentVersion_coordinates_fkey",
    "SpotProcurement",
    ["id", "currentVersionId"],
    "SpotProcurementVersion",
    ["procurementId", "id"]
  ),
  expectedForeignKey("SpotProcurementVersion_procurementId_fkey", "SpotProcurementVersion", ["procurementId"], "SpotProcurement", ["id"]),
  expectedForeignKey("SpotProcurementVersion_supplierPartyId_fkey", "SpotProcurementVersion", ["supplierPartyId"], "BusinessParty", ["id"]),
  expectedForeignKey("SpotProcurementVersion_handlerUserId_fkey", "SpotProcurementVersion", ["handlerUserId"], "User", ["id"]),
  expectedForeignKey("SpotProcurementVersion_createdByUserId_fkey", "SpotProcurementVersion", ["createdByUserId"], "User", ["id"]),
  expectedForeignKey("SpotProcurementLine_versionId_fkey", "SpotProcurementLine", ["versionId"], "SpotProcurementVersion", ["id"]),
  expectedForeignKey("SpotProcurementLine_vatRateOptionId_fkey", "SpotProcurementLine", ["vatRateOptionId"], "VatRateOption", ["id"]),
  expectedForeignKey("SpotProcurementAttachment_versionId_fkey", "SpotProcurementAttachment", ["versionId"], "SpotProcurementVersion", ["id"]),
  expectedForeignKey("SpotProcurementAttachment_fileId_fkey", "SpotProcurementAttachment", ["fileId"], "FileObject", ["id"]),
  expectedForeignKey("SpotProcurementAttachment_uploadedByUserId_fkey", "SpotProcurementAttachment", ["uploadedByUserId"], "User", ["id"]),
  expectedForeignKey("SpotProcurementPayment_projectId_fkey", "SpotProcurementPayment", ["projectId"], "Project", ["id"]),
  expectedForeignKey(
    "SpotProcurementPayment_procurement_coordinates_fkey",
    "SpotProcurementPayment",
    ["projectId", "procurementId"],
    "SpotProcurement",
    ["projectId", "id"]
  ),
  expectedForeignKey(
    "SpotProcurementPayment_version_coordinates_fkey",
    "SpotProcurementPayment",
    ["procurementId", "procurementVersionId"],
    "SpotProcurementVersion",
    ["procurementId", "id"]
  ),
  expectedForeignKey("SpotProcurementPayment_payeePartyId_fkey", "SpotProcurementPayment", ["payeePartyId"], "BusinessParty", ["id"]),
  expectedForeignKey("SpotProcurementPayment_payeeUserId_fkey", "SpotProcurementPayment", ["payeeUserId"], "User", ["id"]),
  expectedForeignKey("SpotProcurementPayment_supportingAttachmentFileId_fkey", "SpotProcurementPayment", ["supportingAttachmentFileId"], "FileObject", ["id"]),
  expectedForeignKey("SpotProcurementPayment_merchantPaymentProofFileId_fkey", "SpotProcurementPayment", ["merchantPaymentProofFileId"], "FileObject", ["id"]),
  expectedForeignKey("SpotProcurementPayment_handlerUserId_fkey", "SpotProcurementPayment", ["handlerUserId"], "User", ["id"]),
  expectedForeignKey("SpotProcurementPayment_createdByUserId_fkey", "SpotProcurementPayment", ["createdByUserId"], "User", ["id"]),
  expectedForeignKey("SpotProcurementPayment_invalidatedByUserId_fkey", "SpotProcurementPayment", ["invalidatedByUserId"], "User", ["id"]),
  expectedForeignKey("SpotProcurementPaymentExecution_paymentId_fkey", "SpotProcurementPaymentExecution", ["paymentId"], "SpotProcurementPayment", ["id"]),
  expectedForeignKey("SpotProcurementPaymentExecution_executedByUserId_fkey", "SpotProcurementPaymentExecution", ["executedByUserId"], "User", ["id"]),
  expectedForeignKey("SpotProcurementPaymentExecution_voucherFileId_fkey", "SpotProcurementPaymentExecution", ["voucherFileId"], "FileObject", ["id"]),
  expectedForeignKey("SpotProcurementPaymentExecution_voidedByUserId_fkey", "SpotProcurementPaymentExecution", ["voidedByUserId"], "User", ["id"]),
  expectedForeignKey("SupplierBalanceAccount_projectId_fkey", "SupplierBalanceAccount", ["projectId"], "Project", ["id"]),
  expectedForeignKey("SupplierBalanceAccount_supplierPartyId_fkey", "SupplierBalanceAccount", ["supplierPartyId"], "BusinessParty", ["id"]),
  expectedForeignKey("SupplierBalanceReservation_accountId_fkey", "SupplierBalanceReservation", ["accountId"], "SupplierBalanceAccount", ["id"]),
  expectedForeignKey("SupplierBalanceReservation_paymentId_fkey", "SupplierBalanceReservation", ["paymentId"], "SpotProcurementPayment", ["id"]),
  expectedForeignKey("SupplierBalanceReservation_reservedByUserId_fkey", "SupplierBalanceReservation", ["reservedByUserId"], "User", ["id"]),
  expectedForeignKey("SupplierBalanceReservation_releasedByUserId_fkey", "SupplierBalanceReservation", ["releasedByUserId"], "User", ["id"]),
  expectedForeignKey("SupplierBalanceReservation_executedByUserId_fkey", "SupplierBalanceReservation", ["executedByUserId"], "User", ["id"]),
  expectedForeignKey("SupplierBalanceEntry_accountId_fkey", "SupplierBalanceEntry", ["accountId"], "SupplierBalanceAccount", ["id"]),
  expectedForeignKey("SupplierBalanceEntry_reservationId_fkey", "SupplierBalanceEntry", ["reservationId"], "SupplierBalanceReservation", ["id"]),
  expectedForeignKey("SupplierBalanceEntry_paymentId_fkey", "SupplierBalanceEntry", ["paymentId"], "SpotProcurementPayment", ["id"]),
  expectedForeignKey("SupplierBalanceEntry_procurementId_fkey", "SupplierBalanceEntry", ["procurementId"], "SpotProcurement", ["id"]),
  expectedForeignKey("SupplierBalanceEntry_actorUserId_fkey", "SupplierBalanceEntry", ["actorUserId"], "User", ["id"])
];

const EXPECTED_CHECKS: CheckExpectation[] = [
  expectedCheck("VatRateOption", "VatRateOption_rate_nonnegative_check", `"rateValue" >= 0`),
  expectedCheck("VatRateOption", "VatRateOption_sortOrder_positive_check", `"sortOrder" > 0`),
  expectedCheck(
    "SpotProcurement",
    "SpotProcurement_amounts_nonnegative_check",
    `"approvedAmountCents" >= 0 AND ("actualCostCents" IS NULL OR "actualCostCents" >= 0)`
  ),
  expectedCheck(
    "SpotProcurement",
    "SpotProcurement_void_tuple_check",
    `(
      "voidedAt" IS NULL
      AND "voidedByUserId" IS NULL
      AND "voidReason" IS NULL
    ) OR (
      "voidedAt" IS NOT NULL
      AND "voidedByUserId" IS NOT NULL
      AND "voidReason" IS NOT NULL
    )`
  ),
  expectedCheck("SpotProcurementVersion", "SpotProcurementVersion_versionNo_positive_check", `"versionNo" > 0`),
  expectedCheck("SpotProcurementVersion", "SpotProcurementVersion_totalAmountCents_nonnegative_check", `"totalAmountCents" >= 0`),
  expectedCheck("SpotProcurementLine", "SpotProcurementLine_sortOrder_positive_check", `"sortOrder" > 0`),
  expectedCheck("SpotProcurementLine", "SpotProcurementLine_quantity_positive_check", `"quantity" > 0`),
  expectedCheck("SpotProcurementLine", "SpotProcurementLine_price_amount_nonnegative_check", `"unitPrice" >= 0 AND "amountCents" >= 0`),
  expectedCheck(
    "SpotProcurementLine",
    "SpotProcurementLine_vatRateValueSnapshot_nonnegative_check",
    `"vatRateValueSnapshot" IS NULL OR "vatRateValueSnapshot" >= 0`
  ),
  expectedCheck(
    "SpotProcurementPayment",
    "SpotProcurementPayment_amounts_nonnegative_check",
    `
      "settlementAmountCents" >= 0
      AND "supplierBalanceAmountCents" >= 0
      AND "companyPaymentAmountCents" >= 0
      AND "paidAmountCents" >= 0
      AND "executedSupplierBalanceAmountCents" >= 0
      AND "canceledAmountCents" >= 0
      AND "canceledCompanyPaymentAmountCents" >= 0
      AND "canceledSupplierBalanceAmountCents" >= 0
    `
  ),
  expectedCheck(
    "SpotProcurementPayment",
    "SpotProcurementPayment_composition_check",
    `"settlementAmountCents" = "supplierBalanceAmountCents" + "companyPaymentAmountCents"`
  ),
  expectedCheck(
    "SpotProcurementPayment",
    "SpotProcurementPayment_canceled_composition_check",
    `"canceledAmountCents" = "canceledCompanyPaymentAmountCents" + "canceledSupplierBalanceAmountCents"`
  ),
  expectedCheck(
    "SpotProcurementPayment",
    "SpotProcurementPayment_company_execution_within_requested_check",
    `"paidAmountCents" + "canceledCompanyPaymentAmountCents" <= "companyPaymentAmountCents"`
  ),
  expectedCheck(
    "SpotProcurementPayment",
    "SpotProcurementPayment_balance_execution_within_requested_check",
    `"executedSupplierBalanceAmountCents" + "canceledSupplierBalanceAmountCents" <= "supplierBalanceAmountCents"`
  ),
  expectedCheck(
    "SpotProcurementPayment",
    "SpotProcurementPayment_cumulative_within_settlement_check",
    `"paidAmountCents" + "executedSupplierBalanceAmountCents" + "canceledAmountCents" <= "settlementAmountCents"`
  ),
  expectedCheck(
    "SpotProcurementPayment",
    "SpotProcurementPayment_invalidation_tuple_check",
    `(
      "invalidatedAt" IS NULL
      AND "invalidatedByUserId" IS NULL
      AND "invalidatedReason" IS NULL
    ) OR (
      "invalidatedAt" IS NOT NULL
      AND "invalidatedByUserId" IS NOT NULL
      AND "invalidatedReason" IS NOT NULL
    )`
  ),
  expectedCheck("SpotProcurementPaymentExecution", "SpotProcurementPaymentExecution_amountCents_positive_check", `"amountCents" > 0`),
  expectedCheck(
    "SpotProcurementPaymentExecution",
    "SpotProcurementPaymentExecution_void_tuple_check",
    `(
      "voidedAt" IS NULL
      AND "voidedByUserId" IS NULL
      AND "voidReason" IS NULL
    ) OR (
      "voidedAt" IS NOT NULL
      AND "voidedByUserId" IS NOT NULL
      AND "voidReason" IS NOT NULL
    )`
  ),
  expectedCheck(
    "SupplierBalanceAccount",
    "SupplierBalanceAccount_amounts_nonnegative_check",
    `"availableAmountCents" >= 0 AND "reservedAmountCents" >= 0`
  ),
  expectedCheck(
    "SupplierBalanceAccount",
    "SupplierBalanceAccount_reserved_within_available_check",
    `"reservedAmountCents" <= "availableAmountCents"`
  ),
  expectedCheck("SupplierBalanceReservation", "SupplierBalanceReservation_amountCents_positive_check", `"amountCents" > 0`),
  expectedCheck("SupplierBalanceEntry", "SupplierBalanceEntry_sequenceNo_positive_check", `"sequenceNo" > 0`),
  expectedCheck(
    "SupplierBalanceEntry",
    "SupplierBalanceEntry_delta_nonzero_check",
    `"availableDeltaCents" <> 0 OR "reservedDeltaCents" <> 0`
  ),
  expectedCheck(
    "SupplierBalanceEntry",
    "SupplierBalanceEntry_after_amounts_nonnegative_check",
    `"availableAmountAfterCents" >= 0 AND "reservedAmountAfterCents" >= 0`
  ),
  expectedCheck(
    "SupplierBalanceEntry",
    "SupplierBalanceEntry_reserved_after_within_available_check",
    `"reservedAmountAfterCents" <= "availableAmountAfterCents"`
  )
];

const normalizeSql = (value: string) =>
  value
    .replace(/--.*$/gm, "")
    .replace(/\s+/g, "")
    .trim();

const extractParenthesizedBody = (source: string, openingParenthesis: number) => {
  let depth = 0;
  for (let index = openingParenthesis; index < source.length; index += 1) {
    if (source[index] === "(") depth += 1;
    if (source[index] === ")") {
      depth -= 1;
      if (depth === 0) return source.slice(openingParenthesis + 1, index);
    }
  }
  return "";
};

const splitTopLevelClauses = (body: string) => {
  const clauses: string[] = [];
  let start = 0;
  let depth = 0;
  for (let index = 0; index < body.length; index += 1) {
    if (body[index] === "(") depth += 1;
    if (body[index] === ")") depth -= 1;
    if (body[index] === "," && depth === 0) {
      clauses.push(body.slice(start, index).trim());
      start = index + 1;
    }
  }
  clauses.push(body.slice(start).trim());
  return clauses.filter(Boolean);
};

const quotedNames = (value: string) =>
  Array.from(value.matchAll(/"([^"]+)"/g), (match) => match[1]);

const sortByName = <T extends { name: string }>(values: T[]) =>
  [...values].sort((left, right) => left.name.localeCompare(right.name));

describe("spot procurement core schema", () => {
  const schema = readFileSync(join(process.cwd(), "prisma/schema.prisma"), "utf8");
  const migrationPath = join(
    process.cwd(),
    "prisma/migrations/20260716190000_spot_procurement_core/migration.sql"
  );
  const migration = existsSync(migrationPath) ? readFileSync(migrationPath, "utf8") : "";
  const reservationLifecycleMigrationPath = join(
    process.cwd(),
    "prisma/migrations/20260717130000_supplier_balance_reservation_lifecycle/migration.sql"
  );
  const reservationLifecycleMigration = existsSync(
    reservationLifecycleMigrationPath
  )
    ? readFileSync(reservationLifecycleMigrationPath, "utf8")
    : "";
  const exclusiveFileBindingMigrationPath = join(
    process.cwd(),
    "prisma/migrations/20260717140000_exclusive_file_business_binding_guard/migration.sql"
  );
  const exclusiveFileBindingMigration = existsSync(
    exclusiveFileBindingMigrationPath
  )
    ? readFileSync(exclusiveFileBindingMigrationPath, "utf8")
    : "";
  const invoiceEvidenceExclusiveMigrationPath = join(
    process.cwd(),
    "prisma/migrations/20260717150000_invoice_evidence_exclusive_binding/migration.sql"
  );
  const invoiceEvidenceExclusiveMigration = existsSync(
    invoiceEvidenceExclusiveMigrationPath
  )
    ? readFileSync(invoiceEvidenceExclusiveMigrationPath, "utf8")
    : "";

  const modelBody = (name: string) =>
    schema.match(new RegExp(`model ${name} \\{([\\s\\S]*?)\\n\\}`))?.[1] ?? "";

  const fieldDeclarations = (name: string) =>
    modelBody(name)
      .split("\n")
      .map((line) => line.trim().replace(/\s+/g, " "))
      .filter((line) => line !== "" && !line.startsWith("//") && !line.startsWith("@@"))
      .filter((line) => /^[A-Za-z_][A-Za-z0-9_]*\s+/.test(line));

  const fieldNames = (name: string) =>
    fieldDeclarations(name).map((declaration) => declaration.split(" ")[0]);

  const modelAttributes = (name: string) =>
    modelBody(name)
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("@@"));

  const tableBody = (name: string) => {
    const marker = `CREATE TABLE "${name}"`;
    const tableStart = migration.indexOf(marker);
    if (tableStart < 0) return "";
    const openingParenthesis = migration.indexOf("(", tableStart + marker.length);
    if (openingParenthesis < 0) return "";
    return extractParenthesizedBody(migration, openingParenthesis);
  };

  const tableClauses = (name: string) => splitTopLevelClauses(tableBody(name));

  const sqlColumns = (table: string): SqlColumn[] =>
    tableClauses(table)
      .filter((clause) => clause.startsWith('"'))
      .map((clause) => {
        const nameMatch = clause.match(/^"([^"]+)"\s+/);
        const name = nameMatch?.[1] ?? "";
        const remainder = clause.slice(nameMatch?.[0].length ?? 0);
        const keyword = remainder.match(/\s+(?:NOT NULL|NULL|DEFAULT)\b/i);
        const type = remainder
          .slice(0, keyword?.index ?? remainder.length)
          .trim()
          .replace(/\s+/g, " ");
        const defaultMatch = remainder.match(/\bDEFAULT\s+(.+)$/i);
        return {
          name,
          type,
          nullable: !/\bNOT NULL\b/i.test(remainder),
          defaultValue: defaultMatch?.[1].trim() ?? ""
        };
      });

  const expectedSqlColumns = (fields: string[]): SqlColumn[] =>
    fields.map((declaration) => {
      const fieldMatch = declaration.match(/^([A-Za-z_][A-Za-z0-9_]*)\s+([A-Za-z]+\??)/);
      const name = fieldMatch?.[1] ?? "";
      const prismaType = fieldMatch?.[2] ?? "";
      const baseType = prismaType.replace(/\?$/, "");
      let type = "";
      if (baseType === "String") type = "TEXT";
      if (baseType === "Int") type = "INTEGER";
      if (baseType === "BigInt") type = "BIGINT";
      if (baseType === "DateTime") type = "TIMESTAMP(3)";
      if (baseType === "Boolean") type = "BOOLEAN";
      if (baseType === "Json") type = "JSONB";
      if (baseType === "Decimal") {
        const decimal = declaration.match(/@db\.Decimal\((\d+),\s*(\d+)\)/);
        type = `DECIMAL(${decimal?.[1]}, ${decimal?.[2]})`;
      }

      let defaultValue = "";
      if (declaration.includes("@default(now())")) defaultValue = "CURRENT_TIMESTAMP";
      const stringDefault = declaration.match(/@default\("([^"]*)"\)/);
      if (stringDefault) defaultValue = `'${stringDefault[1]}'`;
      const scalarDefault = declaration.match(/@default\((true|false|-?\d+)\)/);
      if (scalarDefault) defaultValue = scalarDefault[1];

      return {
        name,
        type,
        nullable: prismaType.endsWith("?"),
        defaultValue
      };
    });

  const checkExpression = (table: string, constraintName: string) => {
    const clause = tableClauses(table).find((candidate) =>
      candidate.startsWith(`CONSTRAINT "${constraintName}"`)
    );
    if (!clause) return "";
    const checkStart = clause.indexOf("CHECK");
    if (checkStart < 0) return "";
    const openingParenthesis = clause.indexOf("(", checkStart + "CHECK".length);
    if (openingParenthesis < 0) return "";
    return normalizeSql(extractParenthesizedBody(clause, openingParenthesis));
  };

  const indexes = (): SqlIndex[] =>
    sortByName(
      Array.from(
        migration.matchAll(
          /CREATE\s+(UNIQUE\s+)?INDEX\s+"([^"]+)"\s+ON\s+"([^"]+)"\s*\(([\s\S]*?)\)(?:\s+WHERE\s+([\s\S]*?))?;/gi
        ),
        (match) => ({
          name: match[2],
          table: match[3],
          columns: quotedNames(match[4]),
          unique: match[1] !== undefined,
          predicate: normalizeSql(match[5] ?? "")
        })
      )
    );

  const inlineForeignKeys = (): SqlForeignKey[] =>
    Object.keys(EXPECTED_PRISMA_MODELS).flatMap((table) =>
      tableClauses(table)
        .filter((clause) => clause.includes("FOREIGN KEY"))
        .map((clause) => {
          const normalized = clause.replace(/\s+/g, " ");
          const match = normalized.match(
            /^CONSTRAINT "([^"]+)" FOREIGN KEY \(([^)]+)\) REFERENCES "([^"]+)"\s*\(([^)]+)\)$/
          );
          return {
            name: match?.[1] ?? "",
            table,
            columns: quotedNames(match?.[2] ?? ""),
            referencedTable: match?.[3] ?? "",
            referencedColumns: quotedNames(match?.[4] ?? "")
          };
        })
    );

  const alteredForeignKeys = (): SqlForeignKey[] =>
    Array.from(
      migration.matchAll(
        /ALTER\s+TABLE\s+"([^"]+)"\s+ADD\s+CONSTRAINT\s+"([^"]+)"\s+FOREIGN\s+KEY\s*\(([^)]+)\)\s+REFERENCES\s+"([^"]+)"\s*\(([^)]+)\)\s*;/gi
      ),
      (match) => ({
        name: match[2],
        table: match[1],
        columns: quotedNames(match[3]),
        referencedTable: match[4],
        referencedColumns: quotedNames(match[5])
      })
    );

  it("matches the complete Prisma declarations and model attributes", () => {
    for (const [name, expected] of Object.entries(EXPECTED_PRISMA_MODELS)) {
      expect(fieldDeclarations(name)).toEqual(expected.fields);
      expect(modelAttributes(name)).toEqual(expected.attributes);
    }
  });

  it("freezes the complete legacy ProjectExpenseRequest field whitelist", () => {
    expect(fieldNames("ProjectExpenseRequest")).toEqual(LEGACY_PROJECT_EXPENSE_FIELDS);
    expect(modelBody("ProjectExpenseRequest")).not.toMatch(
      /procurementLine|invoice|receiptPhoto|supplierBalance/i
    );
  });

  it("creates exactly ten core tables whose SQL columns match the schema at that migration", () => {
    const createdTables = Array.from(
      migration.matchAll(/CREATE\s+TABLE\s+"([^"]+)"/gi),
      (match) => match[1]
    ).sort();
    expect(createdTables).toEqual(Object.keys(EXPECTED_PRISMA_MODELS).sort());

    for (const [table, expected] of Object.entries(EXPECTED_PRISMA_MODELS)) {
      expect(sqlColumns(table)).toEqual(
        expectedSqlColumns(fieldsAtCoreMigration(table, expected.fields))
      );
    }
  });

  it("adds the released reservation amount and freezes the balance lifecycle contract", () => {
    const normalized = normalizeSql(reservationLifecycleMigration);
    expect(normalized).toContain(
      normalizeSql(
        `ALTER TABLE "SupplierBalanceReservation"
          ADD COLUMN "releasedAmountCents" BIGINT NOT NULL DEFAULT 0;`
      )
    );
    expect(normalized).toContain(
      normalizeSql(
        `UPDATE "SupplierBalanceReservation"
          SET "releasedAmountCents" = "amountCents"
          WHERE "status" = 'released';`
      )
    );
    expect(normalized).toContain(
      'CONSTRAINT"SupplierBalanceReservation_released_amount_range_check"'
    );
    expect(normalized).toContain(
      '"releasedAmountCents">=0AND"releasedAmountCents"<="amountCents"'
    );
    expect(normalized).toContain(
      'CONSTRAINT"SupplierBalanceReservation_status_check"CHECK("status"IN(\'reserved\',\'released\',\'executed\'))'
    );
    expect(normalized).toContain(
      'CONSTRAINT"SupplierBalanceReservation_lifecycle_check"'
    );
    expect(normalized).toContain(
      'CONSTRAINT"SupplierBalanceEntry_entry_type_check"'
    );
    expect(normalized).toContain(
      'DROPCONSTRAINT"SpotProcurementDiscrepancy_resolution_type_check"'
    );
    expect(normalized).toContain(
      '"resolutionType"=\'full_refund\'AND"status"IN(\'pending_resolution\',\'awaiting_refund\',\'resolved\',\'invalidated\')'
    );
    expect(normalized).toContain(
      '"resolutionType"=\'full_supplier_balance\'AND"status"IN(\'pending_resolution\',\'awaiting_supplier_balance\',\'resolved\',\'invalidated\')'
    );
    for (const entryType of [
      "reserve",
      "release",
      "partial_release",
      "credit_from_discrepancy",
      "execute"
    ]) {
      expect(normalized).toContain(`'${entryType}'`);
    }
  });

  it("keeps the database file-binding guard aligned with the central registry", () => {
    const exclusiveBindings = new Set([
      "SpotProcurementPaymentExecution.voucherFileId",
      "SpotProcurementRefund.voucherFileId",
      "SpotProcurementReceiptPhoto.originalFileId",
      "SpotProcurementReceiptPhoto.watermarkedFileId"
    ]);
    const expectedBindings = [
      ...NON_RECEIPT_FILE_BINDINGS.filter(({ table }) =>
        existedAtInvoiceEvidenceGuard(table)
      ).flatMap(({ table, columns }) =>
        columns.map((column) => ({
          table,
          column,
          exclusive: exclusiveBindings.has(`${table}.${column}`)
        }))
      ),
      {
        table: "SpotProcurementReceiptPhoto",
        column: "originalFileId",
        exclusive: true
      },
      {
        table: "SpotProcurementReceiptPhoto",
        column: "watermarkedFileId",
        exclusive: true
      }
    ].sort((left, right) =>
      `${left.table}.${left.column}`.localeCompare(
        `${right.table}.${right.column}`
      )
    );
    const actualBindings = Array.from(
      exclusiveFileBindingMigration.matchAll(
        /\('([^']+)', '([^']+)', (TRUE|FALSE)\)/g
      ),
      (match) => ({
        table: match[1],
        column: match[2],
        exclusive: match[3] === "TRUE"
      })
    ).sort((left, right) =>
      `${left.table}.${left.column}`.localeCompare(
        `${right.table}.${right.column}`
      )
    );

    expect(actualBindings).toEqual(expectedBindings);
    expect(normalizeSql(exclusiveFileBindingMigration)).toMatch(
      /^BEGIN;[\s\S]*COMMIT;$/u
    );
    expect(exclusiveFileBindingMigration).toContain(
      "LOCK TABLE %I IN SHARE ROW EXCLUSIVE MODE"
    );
    expect(exclusiveFileBindingMigration).toContain(
      "pg_advisory_xact_lock(190731, 13)"
    );
    expect(exclusiveFileBindingMigration).toContain(
      "BEFORE INSERT OR UPDATE OF"
    );
    expect(exclusiveFileBindingMigration).toContain(
      "jg_enforce_file_replacement_exclusive_binding"
    );
    expect(exclusiveFileBindingMigration).toContain(
      'UPDATE OF "supersedesFileObjectId" ON "FileObject"'
    );
    expect(exclusiveFileBindingMigration).toContain(
      "IF binding_count > 1 THEN"
    );
    expect(exclusiveFileBindingMigration).toContain(
      "exclusive_file_business_binding_guard"
    );
  });

  it("promotes all three invoice evidence columns to exclusive file facts", () => {
    const normalized = normalizeSql(
      invoiceEvidenceExclusiveMigration
    );
    const exclusiveBindings = new Set([
      "SpotProcurementPaymentExecution.voucherFileId",
      "SpotProcurementRefund.voucherFileId",
      "InvoiceRecord.fileId",
      "NoInvoiceConfirmation.proofFileId",
      "InvoiceExceptionConfirmation.proofFileId",
      "SpotProcurementReceiptPhoto.originalFileId",
      "SpotProcurementReceiptPhoto.watermarkedFileId"
    ]);
    const expectedBindings = [
      ...NON_RECEIPT_FILE_BINDINGS.filter(({ table }) =>
        existedAtInvoiceEvidenceGuard(table)
      ).flatMap(({ table, columns }) =>
        columns.map((column) => ({
          table,
          column,
          exclusive: exclusiveBindings.has(`${table}.${column}`)
        }))
      ),
      {
        table: "SpotProcurementReceiptPhoto",
        column: "originalFileId",
        exclusive: true
      },
      {
        table: "SpotProcurementReceiptPhoto",
        column: "watermarkedFileId",
        exclusive: true
      }
    ].sort((left, right) =>
      `${left.table}.${left.column}`.localeCompare(
        `${right.table}.${right.column}`
      )
    );
    const actualBindings = Array.from(
      invoiceEvidenceExclusiveMigration.matchAll(
        /\('([^']+)', '([^']+)', (TRUE|FALSE)\)/g
      ),
      (match) => ({
        table: match[1],
        column: match[2],
        exclusive: match[3] === "TRUE"
      })
    ).sort((left, right) =>
      `${left.table}.${left.column}`.localeCompare(
        `${right.table}.${right.column}`
      )
    );
    expect(actualBindings).toEqual(expectedBindings);
    expect(normalized).toMatch(/^BEGIN;[\s\S]*COMMIT;$/u);
    expect(invoiceEvidenceExclusiveMigration).toContain(
      "pg_advisory_xact_lock(190731, 13)"
    );
    for (const [table, column, trigger] of [
      ["InvoiceRecord", "fileId", "jg_efb_17"],
      [
        "NoInvoiceConfirmation",
        "proofFileId",
        "jg_efb_18"
      ],
      [
        "InvoiceExceptionConfirmation",
        "proofFileId",
        "jg_efb_19"
      ]
    ] as const) {
      expect(invoiceEvidenceExclusiveMigration).toContain(
        `('${table}', '${column}', TRUE)`
      );
      expect(invoiceEvidenceExclusiveMigration).toContain(
        `DROP TRIGGER IF EXISTS ${trigger} ON "${table}"`
      );
      expect(invoiceEvidenceExclusiveMigration).toContain(
        `EXECUTE FUNCTION jg_enforce_exclusive_file_business_binding('${column}', 'true')`
      );
    }
    expect(invoiceEvidenceExclusiveMigration).toContain(
      "IF binding_count > 1 THEN"
    );
    expect(invoiceEvidenceExclusiveMigration).toContain(
      "jg_has_exclusive_file_business_binding"
    );
    expect(invoiceEvidenceExclusiveMigration).toContain(
      'FROM "InvoiceRecord"'
    );
    expect(invoiceEvidenceExclusiveMigration).toContain(
      'FROM "NoInvoiceConfirmation"'
    );
    expect(invoiceEvidenceExclusiveMigration).toContain(
      'FROM "InvoiceExceptionConfirmation"'
    );
  });

  it("allows ALTER only for the new root table and forbids legacy mutations", () => {
    const alteredTables = Array.from(
      migration.matchAll(/ALTER\s+TABLE\s+"([^"]+)"/gi),
      (match) => match[1]
    );
    expect(alteredTables).toEqual(["SpotProcurement"]);
    expect(migration).not.toMatch(/\bINSERT\s+INTO\b/i);
    expect(migration).not.toMatch(/\bUPDATE\b/i);
    expect(migration).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(migration).not.toMatch(/\bCREATE\s+TRIGGER\b/i);
    expect(migration).not.toContain("ProjectExpenseRequest");
  });

  it("matches every named CHECK within its own table definition", () => {
    for (const expected of EXPECTED_CHECKS) {
      expect(checkExpression(expected.table, expected.name)).toBe(
        normalizeSql(expected.expression)
      );
    }
  });

  it("matches the complete unique and ordinary index set", () => {
    expect(indexes()).toEqual(sortByName(EXPECTED_INDEXES));
    expect(fieldDeclarations("SpotProcurementPaymentExecution")).toContain(
      "voucherFileId String? // legacy: new executions use SpotProcurementPaymentExecutionVoucher"
    );
  });

  it("matches the complete inline and ALTER foreign key set", () => {
    expect(sortByName([...inlineForeignKeys(), ...alteredForeignKeys()])).toEqual(
      sortByName(EXPECTED_FOREIGN_KEYS)
    );
  });
});
