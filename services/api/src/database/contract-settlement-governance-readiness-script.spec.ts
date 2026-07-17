import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("contract settlement governance readiness inspection script", () => {
  const scriptPath = resolve(
    __dirname,
    "../../scripts/inspect-contract-settlement-governance-readiness.cjs"
  );

  it("keeps the governance audit read-only", () => {
    const source = readFileSync(scriptPath, "utf8");
    expect(source).toContain("SET default_transaction_read_only = on");
    expect(source).not.toMatch(/\b(INSERT|UPDATE|DELETE|ALTER|DROP|TRUNCATE)\b/i);
    expect(source).toContain("20260716160000_contract_tax_facts_and_settlement_drafts");
  });
});
