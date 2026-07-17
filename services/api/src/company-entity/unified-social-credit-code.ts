import { BadRequestException } from "@nestjs/common";

const CHARSET = "0123456789ABCDEFGHJKLMNPQRTUWXY";
const WEIGHTS = [1, 3, 9, 27, 19, 26, 16, 17, 20, 29, 25, 13, 8, 24, 10, 30, 28] as const;

export function normalizeUnifiedSocialCreditCode(raw: string): string {
  return raw.trim().toUpperCase();
}

export function assertValidUnifiedSocialCreditCode(raw: string): string {
  const code = normalizeUnifiedSocialCreditCode(raw);
  if (!new RegExp(`^[${CHARSET}]{18}$`).test(code)) {
    throw new BadRequestException("统一社会信用代码必须为 18 位规范字符");
  }

  const sum = code
    .slice(0, 17)
    .split("")
    .reduce(
      (total, char, index) => total + CHARSET.indexOf(char) * WEIGHTS[index],
      0
    );
  const check = CHARSET[(31 - (sum % 31)) % 31];
  if (code[17] !== check) {
    throw new BadRequestException("统一社会信用代码校验位不正确");
  }

  return code;
}
