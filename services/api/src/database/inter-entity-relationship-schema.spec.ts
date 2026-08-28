import { readFileSync } from "node:fs";
import { join } from "node:path";

const migrationRoot = join(__dirname, "../../prisma/migrations");
const relationshipMigration = readFileSync(
  join(migrationRoot, "20260828070000_pol13b_inter_entity_relationship/migration.sql"),
  "utf8"
);
const guardMigration = readFileSync(
  join(migrationRoot, "20260828071000_pol13b_proxy_scope_guards/migration.sql"),
  "utf8"
);

describe("POL-13B inter-entity relationship schema", () => {
  it("keeps the relationship append-only and draft-first at the database boundary", () => {
    expect(relationshipMigration).toContain('CREATE TABLE "InterEntityRelationshipEntry"');
    expect(relationshipMigration).toContain('IF TG_OP = \'INSERT\' THEN\n    NEW."status" := \'draft\';');
    expect(relationshipMigration).toContain("inter_entity_relationship_entry_immutable");
    expect(relationshipMigration).toContain('"entryKind" = \'proxy_payment\'');
    expect(relationshipMigration).toContain('"entryKind" = \'proxy_return\'');
    expect(relationshipMigration).toContain('"InterEntityRelationshipEntry_case_kind_key"');
  });

  it("allows the explicitly authorized cross-company proxy while retaining project and source guards", () => {
    expect(guardMigration).toContain(
      "CREATE OR REPLACE FUNCTION guard_payable_settlement_allocation_source()"
    );
    expect(guardMigration).toContain(
      "CREATE OR REPLACE FUNCTION guard_payment_execution_wage_payable_binding_scope()"
    );
    expect(guardMigration).toContain(
      'IF request_project_id IS DISTINCT FROM NEW."beneficiaryProjectId" THEN'
    );
    expect(guardMigration).toContain(
      'OR request_project_id IS DISTINCT FROM NEW."projectId" THEN'
    );
    expect(guardMigration).not.toContain(
      'execution_company_entity_id IS DISTINCT FROM NEW."debtorCompanyId"'
    );
    expect(guardMigration).not.toContain(
      'contract_company_entity_id IS DISTINCT FROM NEW."debtorCompanyId"'
    );
    expect(guardMigration).toContain("payable_settlement_source_snapshot_invalid");
    expect(guardMigration).toContain("payment_execution_wage_binding_source_invalid");
  });
});
