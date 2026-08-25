import type { BusinessEntrySubmissionTarget } from "@jiangkong/shared-domain";

export const BUSINESS_PARTY_CREATE_SCENE = "business_party" as const;
export const BUSINESS_PARTY_CREATE_ENTITY = "business_party" as const;
export const BUSINESS_PARTY_CREATE_DEFINITION_KEY = "business_party" as const;
export const BUSINESS_PARTY_CREATE_DEFINITION_VERSION = 1 as const;
export const BUSINESS_PARTY_CREATE_RECOVERY_STORAGE_KEY =
  "jgzg.business-party.create.recovery.v1" as const;

export interface BusinessPartyCreateFormValues {
  name: string;
  unifiedSocialCreditCode: string;
}

export interface BusinessPartyCreateRecoveryEnvelope {
  version: 1;
  sceneKey: typeof BUSINESS_PARTY_CREATE_SCENE;
  definitionKey: typeof BUSINESS_PARTY_CREATE_DEFINITION_KEY;
  definitionVersion: typeof BUSINESS_PARTY_CREATE_DEFINITION_VERSION;
  idempotencyKey: string;
  fingerprint: string;
  values: BusinessPartyCreateFormValues;
  savedAt: string;
}

export type BusinessPartyCreateFailureKind =
  | "capability"
  | "probe_expired"
  | "definition_stale"
  | "submission_expired"
  | "validation"
  | "freeze"
  | "conflict"
  | "request_failed";

export interface BusinessPartyCreateFailure {
  kind: BusinessPartyCreateFailureKind;
  message: string;
}

export function normalizeBusinessPartyCreateValues(
  input: Partial<BusinessPartyCreateFormValues> | Record<string, unknown>
): BusinessPartyCreateFormValues {
  const rawName = typeof input.name === "string" ? input.name : "";
  const rawCode = typeof input.unifiedSocialCreditCode === "string"
    ? input.unifiedSocialCreditCode
    : "";
  return {
    name: rawName.normalize("NFC").trim().replace(/\s+/gu, " "),
    unifiedSocialCreditCode: rawCode.trim().toUpperCase()
  };
}

const UNIFIED_SOCIAL_CREDIT_CODE_CHARSET = "0123456789ABCDEFGHJKLMNPQRTUWXY";
const UNIFIED_SOCIAL_CREDIT_CODE_WEIGHTS = [1, 3, 9, 27, 19, 26, 16, 17, 20, 29, 25, 13, 8, 24, 10, 30, 28];

function isValidUnifiedSocialCreditCode(value: string) {
  if (!/^[0-9A-Z]{18}$/u.test(value)) return false;
  if ([...value].some((character) => !UNIFIED_SOCIAL_CREDIT_CODE_CHARSET.includes(character))) {
    return false;
  }
  const sum = UNIFIED_SOCIAL_CREDIT_CODE_WEIGHTS.reduce(
    (total, weight, index) => total + UNIFIED_SOCIAL_CREDIT_CODE_CHARSET.indexOf(value[index]) * weight,
    0
  );
  const check = (31 - (sum % 31)) % 31;
  return UNIFIED_SOCIAL_CREDIT_CODE_CHARSET[check] === value[17];
}

export function validateBusinessPartyCreateValues(
  input: Partial<BusinessPartyCreateFormValues> | Record<string, unknown>
) {
  const values = normalizeBusinessPartyCreateValues(input);
  const errors: string[] = [];
  if (!values.name) errors.push("请填写合作单位名称");
  if (values.unifiedSocialCreditCode && !isValidUnifiedSocialCreditCode(values.unifiedSocialCreditCode)) {
    errors.push("统一社会信用代码格式或校验位不正确");
  }
  return errors;
}

export function normalizedBusinessPartySnapshot(
  input: Partial<BusinessPartyCreateFormValues> | Record<string, unknown>
) {
  const values = normalizeBusinessPartyCreateValues(input);
  return {
    attachments: [],
    name: values.name,
    type: "organization" as const,
    ...(values.unifiedSocialCreditCode
      ? { unifiedSocialCreditCode: values.unifiedSocialCreditCode }
      : {})
  };
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export async function fingerprintBusinessPartyValues(
  input: Partial<BusinessPartyCreateFormValues> | Record<string, unknown>
) {
  const bytes = new TextEncoder().encode(stableJson(normalizedBusinessPartySnapshot(input)));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function isUuidV4(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);
}

function isRecoveryValues(value: unknown): value is BusinessPartyCreateFormValues {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const values = value as Record<string, unknown>;
  return typeof values.name === "string" && typeof values.unifiedSocialCreditCode === "string";
}

export function createBusinessPartyRecoveryEnvelope(input: {
  idempotencyKey: string;
  fingerprint: string;
  values: BusinessPartyCreateFormValues;
}): BusinessPartyCreateRecoveryEnvelope {
  if (!isUuidV4(input.idempotencyKey)) throw new Error("合作单位待处理幂等键无效");
  if (!/^[0-9a-f]{64}$/iu.test(input.fingerprint)) throw new Error("合作单位待处理指纹无效");
  return {
    version: 1,
    sceneKey: BUSINESS_PARTY_CREATE_SCENE,
    definitionKey: BUSINESS_PARTY_CREATE_DEFINITION_KEY,
    definitionVersion: BUSINESS_PARTY_CREATE_DEFINITION_VERSION,
    idempotencyKey: input.idempotencyKey,
    fingerprint: input.fingerprint,
    values: normalizeBusinessPartyCreateValues(input.values),
    savedAt: new Date().toISOString()
  };
}

export type RecoveryStorage =
  | Pick<Storage, "getItem" | "setItem" | "removeItem">
  | Map<string, string>;

export function getBusinessPartyRecoveryStorage(): RecoveryStorage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function assertBusinessPartyCreateDefinition(key: string, version: number) {
  if (
    key !== BUSINESS_PARTY_CREATE_DEFINITION_KEY ||
    version !== BUSINESS_PARTY_CREATE_DEFINITION_VERSION
  ) {
    throw new Error("合作单位字段定义已变化，请刷新页面后重试");
  }
}

export function assertBusinessPartyCreateValidation(errors: string[]) {
  if (errors.length > 0) {
    throw new Error(errors.join("；"));
  }
}

export function assertBusinessPartyEntryValidation(result: {
  valid: boolean;
  errors: Array<{ message: string }>;
}) {
  if (!result.valid) {
    throw new Error(result.errors.map((error) => error.message).join("；") || "合作单位资料未通过校验");
  }
}

export function businessPartyIdFromCreateResult(result: unknown) {
  const party = result && typeof result === "object" && "party" in result
    ? result.party
    : null;
  const partyId = party && typeof party === "object" && "id" in party
    ? String(party.id)
    : "";
  if (!partyId) throw new Error("服务器未返回合作单位档案编号");
  return partyId;
}

export function businessPartyDetailPath(partyId: string) {
  return `/business-parties/${encodeURIComponent(partyId)}`;
}

function readStorage(storage: RecoveryStorage | null, key: string) {
  if (!storage) return null;
  return storage instanceof Map ? storage.get(key) ?? null : storage.getItem(key);
}

function writeStorage(storage: RecoveryStorage | null, key: string, value: string) {
  if (!storage) return;
  if (storage instanceof Map) storage.set(key, value);
  else storage.setItem(key, value);
}

function removeStorage(storage: RecoveryStorage | null, key: string) {
  if (!storage) return;
  if (storage instanceof Map) storage.delete(key);
  else storage.removeItem(key);
}

export function saveBusinessPartyRecoveryEnvelope(
  storage: RecoveryStorage | null,
  envelope: BusinessPartyCreateRecoveryEnvelope
) {
  writeStorage(
    storage,
    BUSINESS_PARTY_CREATE_RECOVERY_STORAGE_KEY,
    JSON.stringify(envelope)
  );
}

export function readBusinessPartyRecoveryEnvelope(
  storage: RecoveryStorage | null
): BusinessPartyCreateRecoveryEnvelope | null {
  if (!storage) return null;
  const raw = readStorage(storage, BUSINESS_PARTY_CREATE_RECOVERY_STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<BusinessPartyCreateRecoveryEnvelope>;
    if (
      parsed.version !== 1 ||
      parsed.sceneKey !== BUSINESS_PARTY_CREATE_SCENE ||
      parsed.definitionKey !== BUSINESS_PARTY_CREATE_DEFINITION_KEY ||
      parsed.definitionVersion !== BUSINESS_PARTY_CREATE_DEFINITION_VERSION ||
      !isUuidV4(parsed.idempotencyKey) ||
      typeof parsed.fingerprint !== "string" ||
      !/^[0-9a-f]{64}$/iu.test(parsed.fingerprint) ||
      !isRecoveryValues(parsed.values) ||
      typeof parsed.savedAt !== "string" ||
      !Number.isFinite(Date.parse(parsed.savedAt))
    ) {
      throw new Error("invalid recovery envelope");
    }
    return {
      ...parsed,
      values: normalizeBusinessPartyCreateValues(parsed.values)
    } as BusinessPartyCreateRecoveryEnvelope;
  } catch {
    removeStorage(storage, BUSINESS_PARTY_CREATE_RECOVERY_STORAGE_KEY);
    return null;
  }
}

export function clearBusinessPartyRecoveryEnvelope(storage: RecoveryStorage | null) {
  removeStorage(storage, BUSINESS_PARTY_CREATE_RECOVERY_STORAGE_KEY);
}

export function reconcileBusinessPartyRecoveryState(input: {
  visible: boolean;
  recoveryFingerprint: string;
  currentFingerprint: string;
  existingIdempotencyKey: string;
  issueIdempotencyKey: () => string;
}) {
  const rotate = input.visible && input.recoveryFingerprint !== input.currentFingerprint;
  return {
    idempotencyKey: rotate ? input.issueIdempotencyKey() : input.existingIdempotencyKey,
    visible: rotate ? false : input.visible
  };
}

export function createSingleFlight<T>() {
  let active: Promise<T> | null = null;
  return (factory: () => Promise<T>): Promise<T> => {
    if (active) return active;
    active = Promise.resolve().then(factory).finally(() => {
      active = null;
    });
    return active;
  };
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error ?? "");
}

export function classifyBusinessPartyCreateFailure(
  stage: "capability" | "probe" | "definition" | "submission" | "validation" | "freeze" | "create",
  error: unknown
): BusinessPartyCreateFailure {
  const text = errorText(error);
  if (stage === "capability" || /无权|权限|禁止|岗位/u.test(text)) {
    return { kind: "capability", message: "当前账号无权创建合作单位，请使用合同部岗位账号。" };
  }
  if (stage === "probe" && /令牌|过期|失效|冻结/u.test(text)) {
    return { kind: "probe_expired", message: "定义探针已失效，请刷新页面后重试。" };
  }
  if (stage === "definition" || /定义|版本|刷新/u.test(text)) {
    return { kind: "definition_stale", message: "业务字段定义已变化，请刷新页面后重试。" };
  }
  if (stage === "submission" || /令牌|过期|失效|业务范围/u.test(text)) {
    return { kind: "submission_expired", message: "提交授权已失效，请重新确认后重试。" };
  }
  if (stage === "validation") {
    return { kind: "validation", message: text || "合作单位资料未通过校验，请修正后重试。" };
  }
  if (stage === "freeze" || /冻结|快照/u.test(text)) {
    return { kind: "freeze", message: "当前主数据写入已冻结，请稍后刷新重试。" };
  }
  if (stage === "create" && /已存在|重复|幂等键/u.test(text)) {
    return { kind: "conflict", message: text || "合作单位已存在，请核对既有档案。" };
  }
  return { kind: "request_failed", message: text || "合作单位创建暂时失败，请稍后重试。" };
}

export function submissionTargetOf(value: {
  target?: BusinessEntrySubmissionTarget;
  createTarget?: string;
}): Extract<BusinessEntrySubmissionTarget, { createTarget: string }> {
  const target = value.target ?? (
    typeof value.createTarget === "string"
      ? { entityType: BUSINESS_PARTY_CREATE_ENTITY, createTarget: value.createTarget }
      : undefined
  );
  if (
    !target ||
    target.entityType !== BUSINESS_PARTY_CREATE_ENTITY ||
    !("createTarget" in target) ||
    typeof target.createTarget !== "string" ||
    !target.createTarget.trim()
  ) {
    throw new Error("服务器未返回独立合作单位提交授权");
  }
  return target;
}
