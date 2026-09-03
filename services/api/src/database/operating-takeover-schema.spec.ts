import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const schemaPath = resolve(__dirname, "../../prisma/schema.prisma");
const migrationPath = resolve(__dirname, "../../prisma/migrations/20260902090000_pol215_authority_takeover_manifest/migration.sql");

describe("POL-215 authority takeover persistence", () => {
  it("defines the generic manifest, mapping, bridge, receipt and causal line models", () => {
    const schema = readFileSync(schemaPath, "utf8");
    for (const model of [
      "OperatingTakeoverManifestVersion",
      "OperatingTakeoverRowMapping",
      "OperatingTakeoverLegacySourceBridge",
      "OperatingTakeoverCommandReceipt",
      "OperatingTakeoverCommandReceiptLine"
    ]) {
      expect(schema).toContain(`model ${model}`);
    }
    expect(schema).toContain("candidateBaselineSha");
    expect(schema).toContain("causesReceiptId");
    expect(schema).toContain("reversesLineId");
  });

  it("uses forward-only append-only SQL with source/target and role-summary guards", () => {
    const migration = readFileSync(migrationPath, "utf8");
    expect(migration).toContain("OperatingTakeoverLegacySourceBridge_source_key");
    expect(migration).toContain("OperatingTakeoverLegacySourceBridge_target_key");
    expect(migration).toContain("OperatingTakeoverRowMapping_role_summary_no_person_check");
    expect(migration).toContain("jg_pol215_reject_operating_takeover_history_mutation");
    expect(migration).toContain("BEFORE UPDATE OR DELETE");
  });
});
