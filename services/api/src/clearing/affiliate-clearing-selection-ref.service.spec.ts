import {
  AffiliateClearingSelectionRefService,
  affiliateClearingSelectionRefFingerprint
} from "./affiliate-clearing-selection-ref.service";

describe("#214 authority selectionRef", () => {
  const service = new AffiliateClearingSelectionRefService({
    secret: "affiliate-clearing-authority-secret-for-test-123456"
  });
  const now = new Date("2026-09-01T00:00:00.000Z");
  const binding = {
    actorUserId: "finance-staff",
    authorityVersionId: "authority-1",
    authorityFingerprint: "fingerprint-1",
    purpose: "wage" as const,
    selectedKey: "person:user-1",
    amountCents: 12345n,
    revision: 2
  };

  it("hashes the opaque reference for an immutable receipt", () => {
    expect(affiliateClearingSelectionRefFingerprint(" abc ")).toMatch(/^[0-9a-f]{64}$/);
    expect(affiliateClearingSelectionRefFingerprint(" abc ")).toBe(
      affiliateClearingSelectionRefFingerprint("abc")
    );
  });

  it("issues a short-lived opaque reference bound to actor, authority, selection and amount", () => {
    const ref = service.issue(binding, now);
    expect(ref).toMatch(/^fac1\.[^.]+\.[A-Za-z0-9_-]+$/);
    expect(ref).not.toContain(binding.authorityVersionId);
    expect(ref).not.toContain(binding.selectedKey);
    expect(service.matches(ref, binding, now)).toBe(true);
    expect(service.matches(ref, { ...binding, amountCents: 12346n }, now)).toBe(false);
    expect(service.matches(ref, binding, new Date("2026-09-01T00:05:00.001Z"))).toBe(false);
  });

  it("requires an independent production secret", () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      expect(() => new AffiliateClearingSelectionRefService({ secret: "short" })).toThrow(
        "生产环境必须配置独立的挂靠清算 authority selectionRef 签名密钥"
      );
    } finally {
      if (previous === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previous;
    }
  });
});
