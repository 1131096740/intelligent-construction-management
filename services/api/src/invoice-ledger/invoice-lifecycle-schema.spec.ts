import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("POL-11B invoice lifecycle schema artifact", () => {
  const schema = readFileSync(join(__dirname, "../../prisma/schema.prisma"), "utf8");
  const lifecycleMigration = readFileSync(join(__dirname, "../../prisma/migrations/20260827115000_pol11b_invoice_lifecycle/migration.sql"), "utf8");
  const legalFactMigration = readFileSync(join(__dirname, "../../prisma/migrations/20260827116000_pol11b_invoice_legal_fact_immutability/migration.sql"), "utf8");

  it("keeps lifecycle and red references as append-only facts", () => {
    expect(schema).toContain("model InvoiceLifecycleEvent {");
    expect(schema).toContain("model InvoiceRedAllocationReference {");
    expect(lifecycleMigration).toContain('CREATE TRIGGER "InvoiceLifecycleEvent_immutable"');
    expect(lifecycleMigration).toContain('CREATE TRIGGER "InvoiceRedAllocationReference_immutable"');
  });

  it("prevents mutation of global invoice legal facts while leaving derived counters operable", () => {
    expect(legalFactMigration).toContain('CREATE TRIGGER "InvoiceRecord_global_legal_fact_immutable"');
    expect(legalFactMigration).toContain('NEW."identityKey" IS DISTINCT FROM OLD."identityKey"');
    expect(legalFactMigration).toContain('NEW."fileId" IS DISTINCT FROM OLD."fileId"');
    expect(legalFactMigration).not.toContain('NEW."allocatedAmountCents" IS DISTINCT FROM OLD."allocatedAmountCents"');
  });
});
