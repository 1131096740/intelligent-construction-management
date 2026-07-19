import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const schema = readFileSync(resolve(__dirname, "../../prisma/schema.prisma"), "utf8");
const migration = readFileSync(
  resolve(
    __dirname,
    "../../prisma/migrations/20260719211000_payment_spot_draft_lifecycle/migration.sql"
  ),
  "utf8"
);

function modelBlock(name: string) {
  const match = schema.match(new RegExp(`model ${name} \\{([\\s\\S]*?)\\n\\}`, "u"));
  if (!match) throw new Error(`missing model ${name}`);
  return match[1];
}

describe("M71 payment and spot procurement draft lifecycle schema", () => {
  it.each(["PaymentRequest", "SpotProcurement", "SpotProcurementVersion"])(
    "adds nullable abandonment facts to %s",
    (model) => {
      const block = modelBlock(model);
      expect(block).toMatch(/\babandonedAt\s+DateTime\?/u);
      expect(block).toMatch(/\babandonedByUserId\s+String\?/u);
      expect(block).toMatch(/\babandonReason\s+String\?/u);
    }
  );

  it("adds a nullable, restricted self-reference for payment draft provenance", () => {
    const block = modelBlock("SpotProcurementPayment");
    expect(block).toMatch(/\bdraftOrigin\s+String\?/u);
    expect(block).toMatch(/\bsourcePaymentId\s+String\?/u);
    expect(block).toMatch(
      /sourcePayment\s+SpotProcurementPayment\?\s+@relation\("SpotProcurementPaymentSource", fields: \[sourcePaymentId\], references: \[id\], onDelete: Restrict, onUpdate: Restrict\)/u
    );
    expect(block).toMatch(
      /derivedPayments\s+SpotProcurementPayment\[\]\s+@relation\("SpotProcurementPaymentSource"\)/u
    );
    expect(block).toContain("@@index([sourcePaymentId])");

    expect(migration).toContain('ADD COLUMN "draftOrigin" TEXT');
    expect(migration).toContain('ADD COLUMN "sourcePaymentId" TEXT');
    expect(migration).toMatch(
      /FOREIGN KEY \("sourcePaymentId"\)[\s\S]*REFERENCES "SpotProcurementPayment"\("id"\)[\s\S]*ON DELETE RESTRICT[\s\S]*ON UPDATE RESTRICT/u
    );
    expect(migration).toContain(
      'CREATE INDEX "SpotProcurementPayment_sourcePaymentId_idx" ON "SpotProcurementPayment"("sourcePaymentId")'
    );
  });

  it("adds nullable invalidation facts and status support to receipt drafts", () => {
    const block = modelBlock("SpotProcurementReceipt");
    expect(block).toMatch(/\binvalidatedAt\s+DateTime\?/u);
    expect(block).toMatch(/\binvalidatedByUserId\s+String\?/u);
    expect(block).toMatch(/\binvalidationReason\s+String\?/u);
    expect(migration).toContain('"SpotProcurementReceipt_status_check"');
    expect(migration).toMatch(
      /ADD CONSTRAINT "SpotProcurementReceipt_status_check"[\s\S]*'invalidated'/u
    );
    expect(migration).toContain('"SpotProcurementReceipt_invalidation_facts_check"');
  });

  it("adds abandoned to payment and procurement status constraints with coherent facts", () => {
    for (const table of ["PaymentRequest", "SpotProcurement", "SpotProcurementVersion"]) {
      expect(migration).toMatch(
        new RegExp(`ADD CONSTRAINT "${table}_status_check"[\\s\\S]*'abandoned'`, "u")
      );
      expect(migration).toContain(`"${table}_abandonment_facts_check"`);
    }
  });

  it("keeps all new history columns nullable and does not invent legacy origins", () => {
    for (const table of ["PaymentRequest", "SpotProcurement", "SpotProcurementVersion"]) {
      expect(migration).toContain(`ALTER TABLE "${table}" ADD COLUMN "abandonedAt" TIMESTAMP(3)`);
      expect(migration).toContain(`ALTER TABLE "${table}" ADD COLUMN "abandonedByUserId" TEXT`);
      expect(migration).toContain(`ALTER TABLE "${table}" ADD COLUMN "abandonReason" TEXT`);
    }
    expect(migration).not.toMatch(/UPDATE[\s\S]*"draftOrigin"/iu);
    expect(migration).not.toMatch(/DEFAULT\s+'(?:legacy_unknown|system_generated|manual_recreate)'/iu);
  });

  it("does not touch payment execution, refunds, balances, vouchers, ledgers, files, or business rows", () => {
    expect(migration).not.toMatch(/\b(INSERT\s+INTO|UPDATE\s+"|DELETE\s+FROM|TRUNCATE|MERGE\s+INTO)\b/iu);
    expect(migration).not.toMatch(/ALTER TABLE "(?:PaymentExecution|SpotProcurementPaymentExecution|SpotProcurementRefund|SupplierBalanceAccount|SupplierBalanceEntry|SpotProcurementPaymentExecutionVoucher|FileObject)"/u);
    expect(migration).not.toMatch(/ON\s+DELETE\s+CASCADE/iu);
    expect(migration).not.toMatch(/DROP\s+TABLE|DROP\s+COLUMN/iu);
    expect(migration).toContain("BEGIN;");
    expect(migration).toContain("COMMIT;");
  });
});
