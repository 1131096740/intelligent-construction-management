import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const REQUIRED_MODELS = [
  "SpotProcurementReceipt",
  "SpotProcurementReceiptRevision",
  "SpotProcurementReceiptLine",
  "SpotProcurementReceiptPhoto",
  "SpotProcurementReceiptDelegation",
  "SpotProcurementReceiptReview",
  "SpotProcurementDiscrepancy",
  "SpotProcurementRefund",
  "InvoiceRecord",
  "InvoiceLine",
  "InvoiceAllocation",
  "NoInvoiceConfirmation",
  "InvoiceExceptionConfirmation"
] as const;

type ModelExpectation = {
  fields: string[];
  attributes: string[];
};

type SqlColumn = {
  name: string;
  type: string;
  nullable: boolean;
  defaultValue: string;
};

const expectedModel = (fields: string[], attributes: string[]): ModelExpectation => ({
  fields,
  attributes
});

const EXPECTED_MODELS: Record<(typeof REQUIRED_MODELS)[number], ModelExpectation> = {
  SpotProcurementReceipt: expectedModel(
    [
      "id String @id @default(uuid())",
      "projectId String",
      "procurementId String @unique",
      "procurementVersionId String",
      'status String @default("draft")',
      "currentRevisionNo Int @default(1)",
      "handlerUserId String",
      "note String?",
      "actualCostCents BigInt @default(0)",
      "firstSubmittedAt DateTime?",
      "submittedAt DateTime?",
      "submittedByUserId String?",
      "submissionDelegationId String?",
      "lockedAt DateTime?",
      "createdByUserId String",
      "createdAt DateTime @default(now())",
      "updatedAt DateTime @updatedAt"
    ],
    [
      "@@unique([id, procurementId])",
      "@@index([projectId, status])",
      "@@index([procurementVersionId, status])",
      "@@index([handlerUserId, status])",
      "@@index([submissionDelegationId])"
    ]
  ),
  SpotProcurementReceiptRevision: expectedModel(
    [
      "id String @id @default(uuid())",
      "receiptId String",
      "revisionNo Int",
      "procurementId String",
      "procurementVersionId String",
      "handlerUserId String",
      "note String?",
      "actualCostCents BigInt @default(0)",
      "submittedAt DateTime?",
      "submittedByUserId String?",
      "submissionDelegationId String?",
      "createdByUserId String",
      "createdAt DateTime @default(now())",
      "updatedAt DateTime @updatedAt"
    ],
    [
      "@@unique([receiptId, revisionNo])",
      "@@unique([receiptId, revisionNo, procurementId, procurementVersionId])",
      "@@index([procurementId, procurementVersionId])",
      "@@index([handlerUserId])",
      "@@index([submittedByUserId])",
      "@@index([submissionDelegationId])"
    ]
  ),
  SpotProcurementReceiptLine: expectedModel(
    [
      "id String @id @default(uuid())",
      "receiptId String",
      "receiptRevisionNo Int",
      "procurementId String",
      "procurementVersionId String",
      "procurementLineId String",
      "approvedQuantitySnapshot Decimal @db.Decimal(24, 6)",
      "qualifiedQuantity Decimal @db.Decimal(24, 6)",
      "unqualifiedQuantity Decimal @db.Decimal(24, 6)",
      "unqualifiedReason String?",
      "freeGiftQuantity Decimal @db.Decimal(24, 6)",
      "replenishmentPending Boolean @default(false)",
      "discrepancyNote String?",
      "actualCostCents BigInt",
      "createdByUserId String",
      "createdAt DateTime @default(now())",
      "updatedAt DateTime @updatedAt"
    ],
    [
      "@@unique([receiptId, receiptRevisionNo, procurementId, procurementVersionId, procurementLineId])",
      "@@index([procurementId, procurementVersionId])",
      "@@index([procurementVersionId, procurementLineId])",
      "@@index([receiptId, receiptRevisionNo])"
    ]
  ),
  SpotProcurementReceiptPhoto: expectedModel(
    [
      "id String @id @default(uuid())",
      "receiptId String",
      "receiptRevisionNo Int",
      "originalFileId String @unique",
      "watermarkedFileId String @unique",
      "originalSha256 String",
      "watermarkedSha256 String",
      "source String",
      "category String",
      "serverRecordedAt DateTime @default(now())",
      "note String?",
      "uploadedByUserId String",
      "lockedAtFirstSubmission Boolean @default(false)",
      "lockedAt DateTime?",
      "appendReason String?",
      "createdAt DateTime @default(now())",
      "updatedAt DateTime @updatedAt"
    ],
    [
      "@@index([receiptId, category, createdAt])",
      "@@index([uploadedByUserId, createdAt])"
    ]
  ),
  SpotProcurementReceiptDelegation: expectedModel(
    [
      "id String @id @default(uuid())",
      "receiptId String",
      "delegatorUserId String",
      "delegateUserId String",
      'scope String @default("receipt_confirmation")',
      "delegatedAt DateTime @default(now())",
      "revokedAt DateTime?",
      "revokedByUserId String?",
      "revocationReason String?",
      "createdAt DateTime @default(now())"
    ],
    [
      "@@unique([receiptId, id])",
      "@@index([receiptId, revokedAt])",
      "@@index([delegateUserId, revokedAt])"
    ]
  ),
  SpotProcurementReceiptReview: expectedModel(
    [
      "id String @id @default(uuid())",
      "receiptId String",
      "receiptRevisionNo Int",
      "procurementId String",
      "procurementVersionId String",
      "sequenceNo Int",
      "decision String",
      "comment String?",
      "reviewedByUserId String",
      "reviewedByNameSnapshot String",
      "submissionDelegationId String?",
      "targetReviewId String?",
      "createdAt DateTime @default(now())"
    ],
    [
      "@@unique([receiptId, sequenceNo])",
      "@@unique([receiptId, receiptRevisionNo, procurementId, procurementVersionId, id])",
      "@@unique([targetReviewId])",
      "@@index([procurementId, procurementVersionId])",
      "@@index([procurementVersionId])",
      "@@index([reviewedByUserId, createdAt])",
      "@@index([submissionDelegationId])"
    ]
  ),
  SpotProcurementDiscrepancy: expectedModel(
    [
      "id String @id @default(uuid())",
      "projectId String",
      "procurementId String",
      "procurementVersionId String",
      "receiptId String",
      "receiptRevisionNo Int",
      "receiptReviewId String",
      'status String @default("pending_resolution")',
      "approvedAmountCentsSnapshot BigInt",
      "actualCostCentsSnapshot BigInt",
      "shortageAmountCents BigInt",
      "canceledUnexecutedAmountCents BigInt @default(0)",
      "paidAmountCentsSnapshot BigInt",
      "supplierBalanceUsedAmountCentsSnapshot BigInt",
      "overpaidAmountCents BigInt",
      "resolutionType String?",
      "supplierBalanceEntryId String? @unique",
      "note String?",
      "createdByUserId String",
      "resolvedAt DateTime?",
      "resolvedByUserId String?",
      "invalidatedAt DateTime?",
      "invalidatedByUserId String?",
      "invalidationReason String?",
      "createdAt DateTime @default(now())",
      "updatedAt DateTime @updatedAt"
    ],
    [
      "@@unique([procurementId, id])",
      "@@index([projectId, status])",
      "@@index([receiptId, status])",
      "@@index([procurementId, status])",
      "@@index([procurementVersionId])",
      "@@index([receiptReviewId])"
    ]
  ),
  SpotProcurementRefund: expectedModel(
    [
      "id String @id @default(uuid())",
      "discrepancyId String @unique",
      "procurementId String",
      "amountCents BigInt",
      "receivedAt DateTime",
      "refundMethod String",
      "voucherFileId String @unique",
      "recordedByUserId String",
      "idempotencyKey String @unique",
      "createdAt DateTime @default(now())"
    ],
    [
      "@@index([procurementId, receivedAt])",
      "@@index([recordedByUserId, createdAt])"
    ]
  ),
  InvoiceRecord: expectedModel(
    [
      "id String @id @default(uuid())",
      "projectId String",
      "identityKey String @unique",
      "invoiceType String",
      "invoiceCode String?",
      "invoiceNumber String?",
      "externalIdentifier String?",
      "issueDate DateTime @db.Date",
      "sellerName String",
      "buyerName String",
      "totalAmountCents BigInt",
      "allocatableAmountCents BigInt",
      "allocatedAmountCents BigInt @default(0)",
      'status String @default("active")',
      "fileId String @unique",
      "uploadedByUserId String",
      "sourceBusinessType String",
      "sourceBusinessId String",
      "sourceProcurementId String?",
      "invalidatedAt DateTime?",
      "invalidatedByUserId String?",
      "invalidationReason String?",
      "createdAt DateTime @default(now())",
      "updatedAt DateTime @updatedAt"
    ],
    [
      "@@unique([projectId, id])",
      "@@index([projectId, status])",
      "@@index([sourceBusinessType, sourceBusinessId])",
      "@@index([sourceProcurementId, status])"
    ]
  ),
  InvoiceLine: expectedModel(
    [
      "id String @id @default(uuid())",
      "projectId String",
      "invoiceRecordId String",
      "lineNo Int",
      "description String?",
      "vatRateOptionId String",
      "vatRateValueSnapshot Decimal @db.Decimal(9, 6)",
      "vatRateLabelSnapshot String",
      "taxInclusiveAmountCents BigInt",
      "allocatedAmountCents BigInt @default(0)",
      "createdAt DateTime @default(now())",
      "updatedAt DateTime @updatedAt"
    ],
    [
      "@@unique([invoiceRecordId, lineNo])",
      "@@unique([projectId, id])",
      "@@index([projectId, invoiceRecordId])",
      "@@index([vatRateOptionId])"
    ]
  ),
  InvoiceAllocation: expectedModel(
    [
      "id String @id @default(uuid())",
      "projectId String",
      "invoiceLineId String",
      "receiptId String",
      "receiptRevisionNo Int",
      "procurementId String",
      "procurementVersionId String",
      "procurementLineId String",
      "paymentId String?",
      "amountCents BigInt",
      "createdByUserId String",
      "invalidatedAt DateTime?",
      "invalidatedByUserId String?",
      "invalidationReason String?",
      "createdAt DateTime @default(now())"
    ],
    [
      "@@index([invoiceLineId, invalidatedAt])",
      "@@index([procurementLineId, invalidatedAt])",
      "@@index([paymentId, invalidatedAt])",
      "@@index([receiptId, receiptRevisionNo])",
      "@@index([projectId, procurementId])"
    ]
  ),
  NoInvoiceConfirmation: expectedModel(
    [
      "id String @id @default(uuid())",
      "projectId String",
      "receiptId String",
      "receiptRevisionNo Int",
      "procurementId String",
      "procurementVersionId String",
      "procurementLineId String",
      "paymentId String?",
      "amountCents BigInt",
      "reason String",
      "proofFileId String",
      'status String @default("pending_review")',
      "submittedByUserId String",
      "submittedAt DateTime @default(now())",
      "reviewedByUserId String?",
      "reviewedAt DateTime?",
      "reviewComment String?",
      "reversedAt DateTime?",
      "reversedByUserId String?",
      "reversalReason String?",
      "createdAt DateTime @default(now())",
      "updatedAt DateTime @updatedAt"
    ],
    [
      "@@index([procurementLineId, status])",
      "@@index([receiptId, receiptRevisionNo])",
      "@@index([paymentId])",
      "@@index([proofFileId])"
    ]
  ),
  InvoiceExceptionConfirmation: expectedModel(
    [
      "id String @id @default(uuid())",
      "projectId String",
      "receiptId String",
      "receiptRevisionNo Int",
      "procurementId String",
      "procurementVersionId String",
      "procurementLineId String",
      "paymentId String?",
      "invoiceLineId String?",
      "expectedInvoiceType String",
      "expectedVatRateOptionId String",
      "expectedVatRateValueSnapshot Decimal @db.Decimal(9, 6)",
      "expectedVatRateLabelSnapshot String",
      "expectedUnitPriceSnapshot Decimal @db.Decimal(24, 6)",
      "amountCents BigInt",
      "reason String",
      "proofFileId String",
      'status String @default("pending_review")',
      "submittedByUserId String",
      "submittedAt DateTime @default(now())",
      "reviewedByUserId String?",
      "reviewedAt DateTime?",
      "reviewComment String?",
      "reversedAt DateTime?",
      "reversedByUserId String?",
      "reversalReason String?",
      "createdAt DateTime @default(now())",
      "updatedAt DateTime @updatedAt"
    ],
    [
      "@@index([procurementLineId, status])",
      "@@index([receiptId, receiptRevisionNo])",
      "@@index([paymentId])",
      "@@index([invoiceLineId])",
      "@@index([proofFileId])"
    ]
  )
};

describe("spot procurement receipt and invoice schema", () => {
  const schema = readFileSync(join(process.cwd(), "prisma/schema.prisma"), "utf8");
  const migrationPath = join(
    process.cwd(),
    "prisma/migrations/20260716200000_spot_procurement_receipt_invoice/migration.sql"
  );
  const migration = existsSync(migrationPath) ? readFileSync(migrationPath, "utf8") : "";
  const reviewerSnapshotMigrationPath = join(
    process.cwd(),
    "prisma/migrations/20260717111000_spot_receipt_reviewer_name_snapshot/migration.sql"
  );
  const reviewerSnapshotMigration = existsSync(
    reviewerSnapshotMigrationPath
  )
    ? readFileSync(reviewerSnapshotMigrationPath, "utf8")
    : "";

  const modelBody = (name: string) =>
    schema.match(new RegExp(`model ${name} \\{([\\s\\S]*?)\\n\\}`))?.[1] ?? "";

  const fieldDeclarations = (name: string) =>
    modelBody(name)
      .split("\n")
      .map((line) => line.trim().replace(/\s+/g, " "))
      .filter((line) => line !== "" && !line.startsWith("//") && !line.startsWith("@@"))
      .filter((line) => /^[A-Za-z_][A-Za-z0-9_]*\s+/.test(line));

  const modelAttributes = (name: string) =>
    modelBody(name)
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("@@"));

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

  const tableBody = (name: string) => {
    const marker = `CREATE TABLE "${name}"`;
    const start = migration.indexOf(marker);
    if (start < 0) return "";
    const openingParenthesis = migration.indexOf("(", start + marker.length);
    return openingParenthesis < 0
      ? ""
      : extractParenthesizedBody(migration, openingParenthesis);
  };

  const sqlColumns = (name: string): SqlColumn[] =>
    splitTopLevelClauses(tableBody(name))
      .filter((clause) => clause.startsWith('"'))
      .map((clause) => {
        const match = clause.match(
          /^"([^"]+)"\s+([A-Z]+(?:\(\d+(?:,\s*\d+)?\))?)([\s\S]*)$/
        );
        if (!match) throw new Error(`无法解析 ${name} SQL 列：${clause}`);
        const remainder = match[3].trim();
        const defaultMatch = remainder.match(/\bDEFAULT\s+(.+)$/);
        return {
          name: match[1],
          type: match[2].replace(/\s+/g, ""),
          nullable: !/\bNOT NULL\b/.test(remainder),
          defaultValue: defaultMatch?.[1].trim() ?? ""
        };
      });

  const prismaFieldToSqlColumn = (declaration: string): SqlColumn => {
    const [name, rawType] = declaration.split(/\s+/, 2);
    const optional = rawType.endsWith("?");
    const type = rawType.replace(/\?$/, "");
    const decimal = declaration.match(/@db\.Decimal\((\d+),\s*(\d+)\)/);
    const sqlType =
      type === "String"
        ? "TEXT"
        : type === "Int"
          ? "INTEGER"
          : type === "BigInt"
            ? "BIGINT"
            : type === "Boolean"
              ? "BOOLEAN"
              : type === "DateTime" && declaration.includes("@db.Date")
                ? "DATE"
                : type === "DateTime"
                  ? "TIMESTAMP(3)"
                  : type === "Decimal" && decimal
                    ? `DECIMAL(${decimal[1]},${decimal[2]})`
                    : "";
    if (!sqlType) throw new Error(`缺少 ${name} 的 Prisma -> SQL 类型映射`);

    const defaultValue = declaration.includes("@default(uuid())")
      ? "uuid()"
      : declaration.includes("@default(now())")
        ? "now()"
        : (declaration.match(/@default\(([^)]*)\)/)?.[1] ?? "");
    return {
      name,
      type: sqlType,
      nullable: optional,
      defaultValue:
        defaultValue === "uuid()"
          ? ""
          : defaultValue === "now()"
            ? "CURRENT_TIMESTAMP"
            : /^".*"$/.test(defaultValue)
              ? `'${defaultValue.slice(1, -1)}'`
              : defaultValue
    };
  };

  const normalizeSql = (value: string) =>
    value
      .replace(/--.*$/gm, "")
      .replace(/\s+/g, "")
      .trim();

  it.each(REQUIRED_MODELS)("freezes Prisma model %s", (modelName) => {
    expect(fieldDeclarations(modelName)).toEqual(EXPECTED_MODELS[modelName].fields);
    expect(modelAttributes(modelName)).toEqual(EXPECTED_MODELS[modelName].attributes);
  });

  it.each(REQUIRED_MODELS)("keeps migration columns aligned for %s", (modelName) => {
    const baseFields =
      modelName === "SpotProcurementReceiptReview"
        ? EXPECTED_MODELS[modelName].fields.filter(
            (field) =>
              !field.startsWith(
                "reviewedByNameSnapshot "
              )
          )
        : EXPECTED_MODELS[modelName].fields;
    expect(sqlColumns(modelName)).toEqual(
      baseFields.map(prismaFieldToSqlColumn)
    );
  });

  it("adds and freezes the receipt reviewer name through a forward-only migration", () => {
    const sql = normalizeSql(reviewerSnapshotMigration);

    expect(sql).toContain(
      'ALTERTABLE"SpotProcurementReceiptReview"ADDCOLUMN"reviewedByNameSnapshot"TEXT'
    );
    expect(sql).toContain(
      'UPDATE"SpotProcurementReceiptReview"reviewSET"reviewedByNameSnapshot"=BTRIM("User"."name")FROM"User"WHERE"User"."id"=review."reviewedByUserId"'
    );
    expect(sql).toContain(
      'ALTERTABLE"SpotProcurementReceiptReview"ALTERCOLUMN"reviewedByNameSnapshot"SETNOTNULL'
    );
    expect(sql).toContain(
      '"reviewedByNameSnapshot"ISNULLOR"reviewedByNameSnapshot"=\'\''
    );
    expect(reviewerSnapshotMigration).not.toMatch(
      /\b(?:DROP|TRUNCATE|DELETE)\b/i
    );
  });

  it("creates the required second-stage tables without recreating VAT rates", () => {
    const createdTables = Array.from(
      migration.matchAll(/CREATE TABLE "([^"]+)"/g),
      (match) => match[1]
    );

    expect(createdTables.sort()).toEqual([...REQUIRED_MODELS].sort());
    expect(migration).not.toMatch(/CREATE TABLE "VatRateOption"/);
    expect(migration).not.toMatch(/\b(?:INSERT|UPDATE|DELETE)\b/i);
    expect(migration).not.toMatch(/\b(?:DROP|TRUNCATE)\b/i);
    expect(migration).not.toContain("ProjectExpenseRequest");
  });

  it("freezes the coordinate and current-fact uniqueness guards", () => {
    const sql = normalizeSql(migration);
    const requiredFacts = [
      'CREATEUNIQUEINDEX"SpotProcurementLine_versionId_id_key"ON"SpotProcurementLine"("versionId","id")',
      'CREATEUNIQUEINDEX"SpotProcurementPayment_procurementId_procurementVersionId_id_key"ON"SpotProcurementPayment"("procurementId","procurementVersionId","id")',
      'CREATEUNIQUEINDEX"SupplierBalanceEntry_procurementId_id_key"ON"SupplierBalanceEntry"("procurementId","id")',
      'CREATEUNIQUEINDEX"SpotProcurementReceipt_procurementId_key"ON"SpotProcurementReceipt"("procurementId")',
      'CREATEUNIQUEINDEX"SpotProcurementReceipt_id_procurementId_key"ON"SpotProcurementReceipt"("id","procurementId")',
      'CREATEUNIQUEINDEX"SpotProcurementReceiptRevision_receiptId_revisionNo_key"ON"SpotProcurementReceiptRevision"("receiptId","revisionNo")',
      'CREATEUNIQUEINDEX"SpotProcurementReceiptLine_revision_procurement_version_line_key"ON"SpotProcurementReceiptLine"("receiptId","receiptRevisionNo","procurementId","procurementVersionId","procurementLineId")',
      'CREATEUNIQUEINDEX"SpotProcurementReceiptDelegation_active_receiptId_key"ON"SpotProcurementReceiptDelegation"("receiptId")WHERE"revokedAt"ISNULL',
      'CREATEUNIQUEINDEX"SpotProcurementDiscrepancy_active_receiptId_key"ON"SpotProcurementDiscrepancy"("receiptId")WHERE"invalidatedAt"ISNULL',
      'CREATEUNIQUEINDEX"InvoiceRecord_projectId_id_key"ON"InvoiceRecord"("projectId","id")',
      'CREATEUNIQUEINDEX"InvoiceLine_projectId_id_key"ON"InvoiceLine"("projectId","id")',
      'CREATEUNIQUEINDEX"InvoiceAllocation_active_without_payment_key"ON"InvoiceAllocation"("invoiceLineId","procurementLineId")WHERE"invalidatedAt"ISNULLAND"paymentId"ISNULL',
      'CREATEUNIQUEINDEX"InvoiceAllocation_active_with_payment_key"ON"InvoiceAllocation"("invoiceLineId","procurementLineId","paymentId")WHERE"invalidatedAt"ISNULLAND"paymentId"ISNOTNULL',
      'CREATEUNIQUEINDEX"NoInvoiceConfirmation_current_procurementLineId_key"ON"NoInvoiceConfirmation"("procurementLineId")WHERE"status"IN(\'pending_review\',\'confirmed\')',
      'CREATEUNIQUEINDEX"InvoiceExceptionConfirmation_current_procurementLineId_key"ON"InvoiceExceptionConfirmation"("procurementLineId")WHERE"status"IN(\'pending_review\',\'confirmed\')'
    ];

    requiredFacts.forEach((fact) => expect(sql).toContain(fact));
  });

  it("freezes composite business-coordinate foreign keys", () => {
    const foreignKeyNames = Array.from(
      migration.matchAll(/CONSTRAINT "([^"]+_fkey)"/g),
      (match) => match[1]
    );
    expect(foreignKeyNames).toEqual(
      expect.arrayContaining([
        "SpotProcurementReceipt_procurement_coordinates_fkey",
        "SpotProcurementReceipt_version_coordinates_fkey",
        "SpotProcurementReceipt_submissionDelegation_coordinates_fkey",
        "SpotProcurementReceipt_current_revision_coordinates_fkey",
        "SpotProcurementReceiptRevision_receipt_procurement_coordinates_fkey",
        "SpotProcurementReceiptRevision_version_coordinates_fkey",
        "SpotProcurementReceiptRevision_submissionDelegation_coordinates_fkey",
        "SpotProcurementReceiptLine_revision_coordinates_fkey",
        "SpotProcurementReceiptLine_procurement_line_coordinates_fkey",
        "SpotProcurementReceiptPhoto_revision_coordinates_fkey",
        "SpotProcurementReceiptReview_revision_coordinates_fkey",
        "SpotProcurementReceiptReview_submissionDelegation_coordinates_fkey",
        "SpotProcurementReceiptReview_target_coordinates_fkey",
        "SpotProcurementDiscrepancy_review_coordinates_fkey",
        "SpotProcurementDiscrepancy_supplier_balance_coordinates_fkey",
        "SpotProcurementRefund_discrepancy_coordinates_fkey",
        "InvoiceRecord_source_procurement_coordinates_fkey",
        "InvoiceLine_invoice_coordinates_fkey",
        "InvoiceAllocation_invoice_line_coordinates_fkey",
        "InvoiceAllocation_procurement_coordinates_fkey",
        "InvoiceAllocation_version_coordinates_fkey",
        "InvoiceAllocation_procurement_line_coordinates_fkey",
        "InvoiceAllocation_payment_coordinates_fkey",
        "InvoiceAllocation_receipt_line_coordinates_fkey",
        "NoInvoiceConfirmation_procurement_coordinates_fkey",
        "NoInvoiceConfirmation_version_coordinates_fkey",
        "NoInvoiceConfirmation_procurement_line_coordinates_fkey",
        "NoInvoiceConfirmation_payment_coordinates_fkey",
        "NoInvoiceConfirmation_receipt_line_coordinates_fkey",
        "InvoiceExceptionConfirmation_procurement_coordinates_fkey",
        "InvoiceExceptionConfirmation_version_coordinates_fkey",
        "InvoiceExceptionConfirmation_procurement_line_coordinates_fkey",
        "InvoiceExceptionConfirmation_payment_coordinates_fkey",
        "InvoiceExceptionConfirmation_receipt_line_coordinates_fkey",
        "InvoiceExceptionConfirmation_invoice_line_coordinates_fkey",
        "InvoiceExceptionConfirmation_expectedVatRateOptionId_fkey"
      ])
    );

    const sql = normalizeSql(migration);
    [
      'FOREIGNKEY("id","currentRevisionNo","procurementId","procurementVersionId")REFERENCES"SpotProcurementReceiptRevision"("receiptId","revisionNo","procurementId","procurementVersionId")DEFERRABLEINITIALLYDEFERRED',
      'FOREIGNKEY("receiptId","receiptRevisionNo","procurementId","procurementVersionId")REFERENCES"SpotProcurementReceiptRevision"("receiptId","revisionNo","procurementId","procurementVersionId")',
      'FOREIGNKEY("receiptId","receiptRevisionNo","procurementId","procurementVersionId","targetReviewId")REFERENCES"SpotProcurementReceiptReview"("receiptId","receiptRevisionNo","procurementId","procurementVersionId","id")',
      'FOREIGNKEY("receiptId","receiptRevisionNo","procurementId","procurementVersionId","receiptReviewId")REFERENCES"SpotProcurementReceiptReview"("receiptId","receiptRevisionNo","procurementId","procurementVersionId","id")',
      'FOREIGNKEY("procurementId","supplierBalanceEntryId")REFERENCES"SupplierBalanceEntry"("procurementId","id")',
      'FOREIGNKEY("procurementId","discrepancyId")REFERENCES"SpotProcurementDiscrepancy"("procurementId","id")',
      'FOREIGNKEY("projectId","sourceProcurementId")REFERENCES"SpotProcurement"("projectId","id")',
      'FOREIGNKEY("projectId","invoiceRecordId")REFERENCES"InvoiceRecord"("projectId","id")',
      'FOREIGNKEY("projectId","invoiceLineId")REFERENCES"InvoiceLine"("projectId","id")',
      'FOREIGNKEY("receiptId","receiptRevisionNo","procurementId","procurementVersionId","procurementLineId")REFERENCES"SpotProcurementReceiptLine"("receiptId","receiptRevisionNo","procurementId","procurementVersionId","procurementLineId")'
    ].forEach((fact) => expect(sql).toContain(fact));
  });

  it("freezes the database checks that protect quantities, evidence and money", () => {
    const checkNames = Array.from(
      migration.matchAll(/CONSTRAINT "([^"]+_check)"/g),
      (match) => match[1]
    );
    expect(checkNames).toEqual(
      expect.arrayContaining([
        "SpotProcurementReceipt_status_check",
        "SpotProcurementReceipt_submission_tuple_check",
        "SpotProcurementReceipt_lock_tuple_check",
        "SpotProcurementReceiptRevision_submission_tuple_check",
        "SpotProcurementReceiptRevision_actual_cost_nonnegative_check",
        "SpotProcurementReceiptLine_quantities_nonnegative_check",
        "SpotProcurementReceiptLine_qualified_within_approved_check",
        "SpotProcurementReceiptLine_unqualified_reason_check",
        "SpotProcurementReceiptPhoto_source_check",
        "SpotProcurementReceiptPhoto_category_check",
        "SpotProcurementReceiptPhoto_distinct_files_check",
        "SpotProcurementReceiptPhoto_sha256_check",
        "SpotProcurementReceiptPhoto_supplement_lock_reason_check",
        "SpotProcurementReceiptDelegation_distinct_users_check",
        "SpotProcurementReceiptDelegation_revocation_tuple_check",
        "SpotProcurementReceiptReview_decision_check",
        "SpotProcurementReceiptReview_reason_target_check",
        "SpotProcurementDiscrepancy_shortage_check",
        "SpotProcurementDiscrepancy_overpaid_check",
        "SpotProcurementDiscrepancy_resolution_type_check",
        "SpotProcurementDiscrepancy_invalidation_tuple_check",
        "SpotProcurementRefund_amount_positive_check",
        "InvoiceRecord_invoice_type_check",
        "InvoiceRecord_identity_fields_check",
        "InvoiceRecord_amounts_check",
        "InvoiceRecord_status_invalidation_check",
        "InvoiceLine_rate_amounts_check",
        "InvoiceAllocation_invalidation_tuple_check",
        "NoInvoiceConfirmation_review_state_check",
        "InvoiceExceptionConfirmation_expected_invoice_check",
        "InvoiceExceptionConfirmation_review_state_check"
      ])
    );
    expect(normalizeSql(migration)).toContain(
      '("lockedAt"ISNULLAND"appendReason"ISNULL)OR"lockedAtFirstSubmission"'
    );
  });
});
