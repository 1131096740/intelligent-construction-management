export interface BusinessPartyCreateForm {
  name: string;
  unifiedSocialCreditCode: string;
}

export interface BusinessPartyCreateValues {
  type: "organization";
  name: string;
  unifiedSocialCreditCode?: string;
  attachments: readonly [];
}

export interface BusinessPartyCreateValidation {
  valid: boolean;
  values?: BusinessPartyCreateValues;
  errors: Partial<Record<keyof BusinessPartyCreateForm, string>>;
}

export interface BusinessPartyCreateRecoveryEnvelope {
  idempotencyKey: string;
  definitionKey: "business_party";
  definitionVersion: number;
  values: BusinessPartyCreateValues;
}

const RECOVERY_STORAGE_KEY = "jiangkong-business-party-create-recovery";
const CREDIT_CODE_CHARSET = "0123456789ABCDEFGHJKLMNPQRTUWXY";
const CREDIT_CODE_WEIGHTS = [1, 3, 9, 27, 19, 26, 16, 17, 20, 29, 25, 13, 8, 24, 10, 30, 28] as const;

export function normalizeBusinessPartyCreateValues(
  form: BusinessPartyCreateForm
): BusinessPartyCreateValues {
  const name = form.name.normalize("NFC").trim().replace(/\s+/gu, " ");
  const code = form.unifiedSocialCreditCode.trim().toUpperCase();
  return {
    type: "organization",
    name,
    ...(code ? { unifiedSocialCreditCode: code } : {}),
    attachments: []
  };
}

export function validateBusinessPartyCreateForm(
  form: BusinessPartyCreateForm
): BusinessPartyCreateValidation {
  const values = normalizeBusinessPartyCreateValues(form);
  const errors: Partial<Record<keyof BusinessPartyCreateForm, string>> = {};
  if (!values.name) {
    errors.name = "请填写合作单位名称";
  } else if (Array.from(values.name).length > 100) {
    errors.name = "合作单位名称不能超过 100 个字符";
  } else if (Array.from(values.name).some((character) =>
    /\p{Cc}/u.test(character) && !/\s/u.test(character)
  )) {
    errors.name = "合作单位名称包含不受支持的控制字符";
  }
  if (values.unifiedSocialCreditCode && !validUnifiedSocialCreditCode(values.unifiedSocialCreditCode)) {
    errors.unifiedSocialCreditCode = "统一社会信用代码校验位不正确";
  }
  return Object.keys(errors).length
    ? { valid: false, errors }
    : { valid: true, values, errors };
}

export async function fingerprintBusinessPartyValues(
  values: BusinessPartyCreateValues
): Promise<string> {
  const payload = stableJson(values);
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(payload)
  );
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function createBusinessPartyIdempotencyKey() {
  const key = globalThis.crypto?.randomUUID?.();
  if (!key) throw new Error("当前浏览器无法生成安全幂等键，请升级浏览器后重试");
  return key;
}

export const businessPartyCreateRecovery = {
  save(envelope: BusinessPartyCreateRecoveryEnvelope) {
    if (typeof sessionStorage === "undefined") return;
    sessionStorage.setItem(RECOVERY_STORAGE_KEY, JSON.stringify(envelope));
  },
  load(): BusinessPartyCreateRecoveryEnvelope | null {
    if (typeof sessionStorage === "undefined") return null;
    const raw = sessionStorage.getItem(RECOVERY_STORAGE_KEY);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as Partial<BusinessPartyCreateRecoveryEnvelope>;
      const definitionVersion = parsed.definitionVersion;
      if (
        parsed.definitionKey !== "business_party" ||
        typeof parsed.idempotencyKey !== "string" ||
        !/^\w{8}-\w{4}-4\w{3}-[89ab]\w{3}-\w{12}$/iu.test(parsed.idempotencyKey) ||
        typeof definitionVersion !== "number" ||
        !Number.isSafeInteger(definitionVersion) ||
        definitionVersion <= 0 ||
        !parsed.values ||
        parsed.values.type !== "organization" ||
        typeof parsed.values.name !== "string" ||
        !Array.isArray(parsed.values.attachments) ||
        parsed.values.attachments.length !== 0
      ) {
        throw new Error("invalid recovery");
      }
      return parsed as BusinessPartyCreateRecoveryEnvelope;
    } catch {
      this.clear();
      return null;
    }
  },
  clear() {
    if (typeof sessionStorage !== "undefined") sessionStorage.removeItem(RECOVERY_STORAGE_KEY);
  }
};

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>).sort().map((key) =>
      `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`
    ).join(",")}}`;
  }
  return JSON.stringify(value);
}

function validUnifiedSocialCreditCode(code: string) {
  if (!new RegExp(`^[${CREDIT_CODE_CHARSET}]{18}$`, "u").test(code)) return false;
  const sum = code.slice(0, 17).split("").reduce(
    (total, character, index) => total + CREDIT_CODE_CHARSET.indexOf(character) * CREDIT_CODE_WEIGHTS[index]!,
    0
  );
  return code[17] === CREDIT_CODE_CHARSET[(31 - (sum % 31)) % 31];
}
