import { readFileSync } from "node:fs";
import { join } from "node:path";

const schema = readFileSync(join(__dirname, "schema.prisma"), "utf8");
const realFormMigration = readFileSync(
  join(
    __dirname,
    "migrations",
    "20260718110000_spot_procurement_real_form_redesign",
    "migration.sql"
  ),
  "utf8"
);
const returnedDraftMigration = readFileSync(
  join(
    __dirname,
    "migrations",
    "20260720100000_allow_returned_spot_payment_draft",
    "migration.sql"
  ),
  "utf8"
);

describe("spot procurement real-form schema", () => {
  it("keeps the A4 procurement application amount-free and freezes its real-form snapshots", () => {
    expect(schema).toMatch(/applicationDepartmentSnapshot\s+String/);
    expect(schema).toMatch(/applicationNameSnapshot\s+String/);
    expect(schema).toMatch(/purchaserNameSnapshot\s+String/);
    expect(schema).toMatch(/requestedArrivalAt\s+DateTime/);
    expect(schema).toMatch(/supplierKey\s+String\?/);
    expect(schema).toMatch(/unitPrice\s+Decimal\?/);
    expect(schema).toMatch(/amountCents\s+BigInt\?/);
  });

  it("has the payment, execution, invoice, archive, and abnormal-termination fact tables", () => {
    for (const model of [
      "SpotProcurementPaymentLine",
      "SpotProcurementPaymentChannel",
      "SpotProcurementPaymentMethodOption",
      "SpotProcurementPaymentAttachment",
      "SpotProcurementPaymentExecutionVoucher",
      "SpotProcurementPaymentInvoice",
      "SpotProcurementPaymentArchive",
      "SpotProcurementPaymentArchiveFile",
      "SpotProcurementAbnormalTermination"
    ]) {
      expect(schema).toContain(`model ${model} {`);
    }
  });

  it("installs a zero-record guard, current-payment uniqueness, and exclusive file binding guards", () => {
    expect(realFormMigration).toContain('FROM "SpotProcurement"');
    expect(realFormMigration).toContain("零星采购新模型已有记录");
    expect(realFormMigration).toContain(
      'CREATE UNIQUE INDEX "SpotProcurementPayment_one_current_per_procurement"'
    );
    expect(realFormMigration).toContain("SpotProcurementPaymentExecutionVoucher");
    expect(realFormMigration).toContain("SpotProcurementPaymentInvoice");
    expect(realFormMigration).toContain("jg_file_business_binding_columns");
  });

  it("atomically allows returned payments beside one active current payment", () => {
    expect(returnedDraftMigration.trim()).toBe(
      [
        "BEGIN;",
        "",
        'DROP INDEX IF EXISTS "SpotProcurementPayment_one_current_per_procurement";',
        "",
        'CREATE UNIQUE INDEX "SpotProcurementPayment_one_current_per_procurement"',
        '  ON "SpotProcurementPayment"("procurementId")',
        `  WHERE "status" NOT IN ('invalidated', 'voided', 'withdrawn', 'rejected', 'returned');`,
        "",
        "COMMIT;"
      ].join("\n")
    );

    const predicate = returnedDraftMigration.match(
      /WHERE "status" NOT IN \(([^)]+)\)/u
    )?.[1];
    expect(predicate).toBeDefined();

    const excludedStatuses = Array.from(
      predicate?.matchAll(/'([^']+)'/gu) ?? [],
      (match) => match[1]
    );
    expect(excludedStatuses).toEqual([
      "invalidated",
      "voided",
      "withdrawn",
      "rejected",
      "returned"
    ]);
    for (const activeStatus of [
      "draft",
      "approval_pending",
      "approved_pending_payment",
      "partially_paid"
    ]) {
      expect(excludedStatuses).not.toContain(activeStatus);
    }
  });
});
