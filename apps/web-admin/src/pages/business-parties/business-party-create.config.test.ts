import { beforeEach, describe, expect, it } from "vitest";
import {
  businessPartyCreateRecovery,
  fingerprintBusinessPartyValues,
  normalizeBusinessPartyCreateValues,
  validateBusinessPartyCreateForm,
  type BusinessPartyCreateRecoveryEnvelope
} from "./business-party-create.config";

describe("business-party create preparation", () => {
  it("normalizes the server-owned organization snapshot", () => {
    expect(normalizeBusinessPartyCreateValues({
      name: "  e\u0301  建设  有限公司 ",
      unifiedSocialCreditCode: " 91350211m000100y46 "
    })).toEqual({
      type: "organization",
      name: "é 建设 有限公司",
      unifiedSocialCreditCode: "91350211M000100Y46",
      attachments: []
    });
  });

  it("rejects missing names and malformed credit codes before any target or write", () => {
    expect(validateBusinessPartyCreateForm({ name: " ", unifiedSocialCreditCode: "" })).toEqual({
      valid: false,
      errors: { name: "请填写合作单位名称" }
    });
    expect(validateBusinessPartyCreateForm({
      name: "受控单位",
      unifiedSocialCreditCode: "91350211M000100Y47"
    })).toEqual({
      valid: false,
      errors: { unifiedSocialCreditCode: "统一社会信用代码校验位不正确" }
    });
  });

  it("uses the server-compatible stable fingerprint", async () => {
    await expect(fingerprintBusinessPartyValues({
      type: "organization",
      name: "受控单位",
      unifiedSocialCreditCode: "91350211M000100Y46",
      attachments: []
    })).resolves.toBe("eb686e468363ef492292019f8f2c2272f1eb254f6ee0c031f2ea20ce6f357f73");
  });

  describe("pending recovery", () => {
    beforeEach(() => {
      const values = new Map<string, string>();
      Object.defineProperty(globalThis, "sessionStorage", {
        configurable: true,
        value: {
          clear: () => values.clear(),
          getItem: (key: string) => values.get(key) ?? null,
          removeItem: (key: string) => values.delete(key),
          setItem: (key: string, value: string) => values.set(key, value)
        }
      });
    });

    it("stores only the non-secret normalized envelope in the current session", () => {
      const envelope: BusinessPartyCreateRecoveryEnvelope = {
        idempotencyKey: "11111111-1111-4111-8111-111111111111",
        definitionKey: "business_party",
        definitionVersion: 1,
        values: {
          type: "organization" as const,
          name: "受控单位",
          attachments: []
        }
      };

      businessPartyCreateRecovery.save(envelope);

      expect(businessPartyCreateRecovery.load()).toEqual(envelope);
      expect(sessionStorage.getItem("jiangkong-business-party-create-recovery")).not.toContain("createTarget");
      expect(sessionStorage.getItem("jiangkong-business-party-create-recovery")).not.toContain("token");
    });

    it("clears a completed or malformed envelope", () => {
      businessPartyCreateRecovery.clear();
      expect(businessPartyCreateRecovery.load()).toBeNull();
      sessionStorage.setItem("jiangkong-business-party-create-recovery", "{bad json");
      expect(businessPartyCreateRecovery.load()).toBeNull();
      expect(sessionStorage.getItem("jiangkong-business-party-create-recovery")).toBeNull();
    });
  });
});
