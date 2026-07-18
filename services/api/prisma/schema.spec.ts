import { readFileSync } from "node:fs";
import { join } from "node:path";

const schema = readFileSync(join(__dirname, "schema.prisma"), "utf8");
const migration = readFileSync(
  join(
    __dirname,
    "migrations",
    "20260718110000_spot_procurement_real_form_redesign",
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
    expect(migration).toContain('FROM "SpotProcurement"');
    expect(migration).toContain("零星采购新模型已有记录");
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "SpotProcurementPayment_one_current_per_procurement"'
    );
    expect(migration).toContain("SpotProcurementPaymentExecutionVoucher");
    expect(migration).toContain("SpotProcurementPaymentInvoice");
    expect(migration).toContain("jg_file_business_binding_columns");
  });
});
