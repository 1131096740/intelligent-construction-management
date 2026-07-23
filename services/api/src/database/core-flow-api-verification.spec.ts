import { readFileSync } from "node:fs";
import { join } from "node:path";
import { coreFlowApiVerificationTargets } from "./core-flow-api-verification";

describe("coreFlowApiVerificationTargets", () => {
  it("covers contract, settlement, and payment detail read endpoints", () => {
    expect(coreFlowApiVerificationTargets.map((target) => target.path)).toEqual([
      "/contracts/HT-2026-001",
      "/settlements/JS-2026-018",
      "/payments/FK-2026-006"
    ]);
    expect(coreFlowApiVerificationTargets[0].requiredText).toContain("钢材采购合同");
    expect(coreFlowApiVerificationTargets[1].requiredText).toContain("JS-2026-018");
    expect(coreFlowApiVerificationTargets[2].requiredText).toContain("approved_pending_payment");
  });

  it("seeds an archiveable settlement contract for the writable core-flow rehearsal", () => {
    const verifier = readFileSync(
      join(process.cwd(), "prisma/verify-core-flow.cjs"),
      "utf8"
    );

    expect(verifier).toContain('contractTypeKey: "material_purchase"');
    expect(verifier).toContain('invoiceType: "vat_general"');
    expect(verifier).toContain('defaultTaxRatePercent: new Prisma.Decimal("13")');
  });
});

describe("money column schema", () => {
  it("stores every remaining cent amount as BigInt", () => {
    const schema = readFileSync(join(process.cwd(), "prisma/schema.prisma"), "utf8");
    const legacyIntColumns = schema
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => /\w+Cents\s+Int\??(?:\s|$)/.test(line));

    expect(legacyIntColumns).toEqual([]);
  });
});
