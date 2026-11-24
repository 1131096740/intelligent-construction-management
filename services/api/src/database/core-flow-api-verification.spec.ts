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

  it("uses the approved contract and signed settlement payment basis in the writable rehearsal", () => {
    const verifier = readFileSync(
      join(process.cwd(), "prisma/verify-core-flow.cjs"),
      "utf8"
    );

    expect(verifier).toContain('contractTypeKey: "material_purchase"');
    expect(verifier).toContain('invoiceType: "vat_general"');
    expect(verifier).toContain('defaultTaxRatePercent: new Prisma.Decimal("13")');
    expect(verifier).toContain('signed.upload(tokens.contractStaff');
    expect(verifier).toContain('signed.submit(draft, tokens.contractStaff)');
    expect(verifier).toContain('signed.confirm(submitted, tokens.contractDirector)');
    expect(verifier).toContain('paymentBasis.downstreamCapacity.wholeCentLimit');
    expect(verifier).toContain('signed.verifyOriginal(tokens.contractStaff');
    expect(verifier).not.toContain('/settlement-drafts');
    expect(verifier).toContain('/me/signature/canvas');
    expect(verifier).toContain('一期闭环验证手写签名.png');
    expect(verifier).toContain('Object.values(tokens)');
    expect(verifier).toContain('payment request settlement source');
    expect(verifier).toContain('payment request settlement link');
    expect(verifier).not.toContain('/payments/contract-application');
    expect(verifier).toContain('responseBody.includes("付款申请金额")');
    expect(verifier).toContain('["comprehensiveDirector", tokens.comprehensiveDirector]');
    expect(verifier).not.toContain('["contractDirector", tokens.contractDirector]');
    expect(verifier).toContain('"settlement.signed_confirmed"');
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
