import { BadRequestException } from "@nestjs/common";
import {
  assertValidUnifiedSocialCreditCode,
  normalizeUnifiedSocialCreditCode
} from "./unified-social-credit-code";

function expectBadRequest(action: () => unknown, message: string): void {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(BadRequestException);
    expect((error as BadRequestException).getStatus()).toBe(400);
    expect((error as Error).message).toBe(message);
    return;
  }

  throw new Error("Expected BadRequestException");
}

describe("unified social credit code", () => {
  it("normalizes formatting without treating the Y43 fixture as a valid code", () => {
    const normalized = normalizeUnifiedSocialCreditCode(" 91350211M000100Y43 ");

    expect(normalized).toBe("91350211M000100Y43");
    expectBadRequest(
      () => assertValidUnifiedSocialCreditCode(normalized),
      "统一社会信用代码校验位不正确"
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

  it("accepts a synthetic checksum vector whose check character resolves to zero", () => {
    // Algorithm boundary vector only; this is not an issued company identifier.
    const syntheticCode = "9135A211M100100YD0";

    expect(syntheticCode[4]).not.toBe("0");
    expect(syntheticCode[9]).not.toBe("0");
    expect(assertValidUnifiedSocialCreditCode(syntheticCode)).toBe(syntheticCode);
  });

  it.each(["91350211M000100Y4", "91350211M000100Y466"])(
    "rejects a non-18-character code: %s",
    (code) => {
      expectBadRequest(
        () => assertValidUnifiedSocialCreditCode(code),
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
    expectBadRequest(
      () => assertValidUnifiedSocialCreditCode("91350211M000100Y44"),
      "统一社会信用代码校验位不正确"
    );
  });
});
