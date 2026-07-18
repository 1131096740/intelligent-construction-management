import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("payment request frozen stage migration", () => {
  const migration = readFileSync(
    resolve(
      __dirname,
      "../../prisma/migrations/20260718100000_payment_request_frozen_stage/migration.sql"
    ),
    "utf8"
  );

  it("adds a nullable stage reference without rewriting historical requests", () => {
    expect(migration).toContain('ADD COLUMN "paymentTermsStageId" TEXT;');
    expect(migration).not.toMatch(/paymentTermsStageId"\s+TEXT\s+NOT NULL/iu);
    expect(migration).not.toMatch(/UPDATE\s+"PaymentRequest"/iu);
  });

  it("retains referenced stages and prevents stage facts on unrelated source types", () => {
    expect(migration).toContain('CREATE INDEX "PaymentRequest_paymentTermsStageId_idx"');
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "PaymentTermsStage_id_paymentTermsVersionId_key"'
    );
    expect(migration).toContain(
      'FOREIGN KEY ("paymentTermsStageId", "paymentTermsVersionId")'
    );
    expect(migration).toContain(
      'REFERENCES "PaymentTermsStage"("id", "paymentTermsVersionId")'
    );
    expect(migration).toMatch(/ON DELETE RESTRICT/iu);
    expect(migration).toMatch(/ON UPDATE RESTRICT/iu);
    expect(migration).toContain('"paymentTermsStageId" IS NULL');
    expect(migration).toContain("OR \"sourceType\" = 'contract_due'");
  });
});
