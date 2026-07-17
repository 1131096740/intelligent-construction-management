import {
  assertValidUnifiedSocialCreditCode,
  normalizeUnifiedSocialCreditCode
} from "./unified-social-credit-code";

describe("unified social credit code", () => {
  it("trims a canonical code without changing it", () => {
    expect(normalizeUnifiedSocialCreditCode(" 91350211M000100Y43 ")).toBe(
      "91350211M000100Y43"
    );
  });

  it("normalizes lowercase characters before validation", () => {
    expect(assertValidUnifiedSocialCreditCode(" 91350211m000100y46 ")).toBe(
      "91350211M000100Y46"
    );
  });

  it.each(["91350211M000100Y46", "91440300708461136T"])(
    "accepts a GB 32100 valid code: %s",
    (code) => {
      expect(assertValidUnifiedSocialCreditCode(code)).toBe(code);
    }
  );

  it.each(["91350211M000100Y4", "91350211M000100Y466"])(
    "rejects a non-18-character code: %s",
    (code) => {
      expect(() => assertValidUnifiedSocialCreditCode(code)).toThrow(
        "统一社会信用代码必须为 18 位规范字符"
      );
    }
  );

  it.each(["I", "O", "S", "V", "Z"])(
    "rejects forbidden character %s",
    (forbiddenCharacter) => {
      const code = `${forbiddenCharacter}1350211M000100Y46`;

      expect(() => assertValidUnifiedSocialCreditCode(code)).toThrow(
        "统一社会信用代码必须为 18 位规范字符"
      );
    }
  );

  it("rejects an incorrect check character", () => {
    expect(() => assertValidUnifiedSocialCreditCode("91350211M000100Y44")).toThrow(
      "校验位"
    );
  });
});
