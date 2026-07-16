import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("contract tax facts readiness inspection script", () => {
  const scriptPath = resolve(
    __dirname,
    "../../scripts/inspect-contract-tax-facts-readiness.cjs"
  );
  const script = readFileSync(scriptPath, "utf8");

  it("stays read-only and exposes the required migration groups", () => {
    expect(script).toContain('process.argv.includes("--json")');
    expect(script).toContain('"historical_takeover"');
    expect(script).toContain("decimalPlaces");
    expect(script).toContain("draftData");
    expect(script).not.toContain("UPDATE ");
    expect(script).not.toContain("DELETE ");
    expect(script).not.toContain("INSERT ");
  });
});
