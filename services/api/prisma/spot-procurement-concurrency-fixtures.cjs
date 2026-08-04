const { createHash } = require("node:crypto");

const UNIFIED_SOCIAL_CREDIT_CODE_CHARSET =
  "0123456789ABCDEFGHJKLMNPQRTUWXY";
const UNIFIED_SOCIAL_CREDIT_CODE_WEIGHTS = [
  1, 3, 9, 27, 19, 26, 16, 17, 20, 29, 25, 13, 8, 24, 10, 30, 28
];

function deriveFixtureUnifiedSocialCreditCode(seed) {
  const prefix = `91530100${createHash("sha256")
    .update(seed)
    .digest("hex")
    .slice(0, 9)
    .toUpperCase()}`;
  const sum = prefix
    .split("")
    .reduce(
      (total, char, index) =>
        total +
        UNIFIED_SOCIAL_CREDIT_CODE_CHARSET.indexOf(char) *
          UNIFIED_SOCIAL_CREDIT_CODE_WEIGHTS[index],
      0
    );
  const check =
    UNIFIED_SOCIAL_CREDIT_CODE_CHARSET[(31 - (sum % 31)) % 31];
  return `${prefix}${check}`;
}

module.exports = {
  deriveFixtureUnifiedSocialCreditCode
};
