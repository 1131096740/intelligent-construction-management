import { PaymentExecutionSelectionRefService } from "./payment-execution-selection-ref.service";

const baseInput = {
  actorUserId: "finance-user",
  caseId: "payable-ref-1",
  companyId: "company-1",
  projectId: "project-1",
  paymentExecutionId: "execution-secret-id",
  executionFingerprint: "execution-fingerprint",
  caseRevision: 3,
  balanceFingerprint: "balance-fingerprint"
};

describe("PaymentExecutionSelectionRefService", () => {
  it("issues a short-lived opaque HMAC reference without exposing the internal execution id", () => {
    const service = new PaymentExecutionSelectionRefService("test-selection-secret");
    const now = new Date("2026-08-27T17:00:00.000Z");

    const result = service.issue(baseInput, now);

    expect(result.expiresAt).toBe("2026-08-27T17:08:00.000Z");
    expect(result.selectionRef).toMatch(/^pes1\.[A-Za-z0-9_-]{43}$/u);
    expect(result.selectionRef).not.toContain(baseInput.paymentExecutionId);
    expect(service.matches(result.selectionRef, result.expiresAt, baseInput, now)).toBe(true);
  });

  it.each([
    ["actor", { actorUserId: "other-user" }],
    ["case", { caseId: "payable-ref-2" }],
    ["company", { companyId: "company-2" }],
    ["project", { projectId: "project-2" }],
    ["execution revision/status", { executionFingerprint: "changed-execution" }],
    ["case revision", { caseRevision: 4 }],
    ["balance", { balanceFingerprint: "changed-balance" }]
  ])("rejects a reference rebound to another %s", (_label, override) => {
    const service = new PaymentExecutionSelectionRefService("test-selection-secret");
    const now = new Date("2026-08-27T17:00:00.000Z");
    const result = service.issue(baseInput, now);

    expect(service.matches(result.selectionRef, result.expiresAt, { ...baseInput, ...override }, now)).toBe(false);
  });

  it("rejects tampered expiry and expired references", () => {
    const service = new PaymentExecutionSelectionRefService("test-selection-secret");
    const now = new Date("2026-08-27T17:00:00.000Z");
    const result = service.issue(baseInput, now);

    expect(service.matches(result.selectionRef, "2026-08-27T17:09:00.000Z", baseInput, now)).toBe(false);
    expect(service.matches(result.selectionRef, result.expiresAt, baseInput, new Date(result.expiresAt))).toBe(false);
  });

  it("fails closed in production unless the dedicated selection secret is configured", () => {
    const previousEnvironment = process.env.NODE_ENV;
    const previousSelectionSecret = process.env.PAYMENT_EXECUTION_SELECTION_SECRET;
    const previousJwtSecret = process.env.JWT_ACCESS_SECRET;
    try {
      process.env.NODE_ENV = "production";
      delete process.env.PAYMENT_EXECUTION_SELECTION_SECRET;
      process.env.JWT_ACCESS_SECRET = "jwt-only-secret-that-must-not-sign-payment-candidates";

      expect(() => new PaymentExecutionSelectionRefService()).toThrow(
        "独立的付款候选 selectionRef 签名密钥"
      );
    } finally {
      if (previousEnvironment === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousEnvironment;
      if (previousSelectionSecret === undefined) delete process.env.PAYMENT_EXECUTION_SELECTION_SECRET;
      else process.env.PAYMENT_EXECUTION_SELECTION_SECRET = previousSelectionSecret;
      if (previousJwtSecret === undefined) delete process.env.JWT_ACCESS_SECRET;
      else process.env.JWT_ACCESS_SECRET = previousJwtSecret;
    }
  });
});
