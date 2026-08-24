import type {
  BusinessEntryDraftPayload,
  BusinessEntrySceneDefinition,
  BusinessEntrySubmissionTarget,
  BusinessEntryValidationResult
} from "@jiangkong/shared-domain";

export const BUSINESS_PARTY_SCENE_KEY = "business_party" as const;
export const BUSINESS_PARTY_DEFINITION_KEY = "business_party" as const;
export const BUSINESS_PARTY_RECOVERY_STORAGE_KEY =
  "jiangkong-business-party-create-recovery" as const;

export interface BusinessPartyValues {
  [key: string]: unknown;
  type: "organization";
  name: string;
  unifiedSocialCreditCode?: string;
  attachments: [];
}

export interface BusinessPartyCreateTargetResponse {
  createTarget: string;
  expiresAt: string;
}

export interface BusinessPartyCreatePayload extends BusinessEntryDraftPayload {
  sceneKey: typeof BUSINESS_PARTY_SCENE_KEY;
  definitionVersion: number;
  definitionKey: typeof BUSINESS_PARTY_DEFINITION_KEY;
  target: Extract<BusinessEntrySubmissionTarget, { createTarget: string }>;
  values: BusinessPartyValues;
  idempotencyKey: string;
}

export interface BusinessPartyCreateFlowDependencies {
  issueCreateTarget(input: {
    definitionKey: typeof BUSINESS_PARTY_DEFINITION_KEY;
    definitionVersion: number;
    idempotencyKey: string;
    fingerprint: string;
  }): Promise<BusinessPartyCreateTargetResponse>;
  fetchDefinition(target: BusinessEntrySubmissionTarget): Promise<BusinessEntrySceneDefinition>;
  validate(payload: BusinessPartyCreatePayload): Promise<BusinessEntryValidationResult>;
  create(
    payload: BusinessPartyCreatePayload,
    options?: { onRequestSent?: () => void }
  ): Promise<unknown>;
}

export interface BusinessPartyProbeDependencies {
  issueCreateTarget(input: {
    definitionKey: typeof BUSINESS_PARTY_DEFINITION_KEY;
    definitionVersion: number;
    idempotencyKey: string;
    fingerprint: string;
  }): Promise<BusinessPartyCreateTargetResponse>;
  fetchDefinition(target: BusinessEntrySubmissionTarget): Promise<BusinessEntrySceneDefinition>;
}

export interface BusinessPartyPendingRecovery {
  idempotencyKey: string;
  definitionKey: typeof BUSINESS_PARTY_DEFINITION_KEY;
  definitionVersion: number;
  values: BusinessPartyValues;
}

export interface BusinessPartyCreateConfirmation {
  state: "confirm";
  payload: BusinessPartyCreatePayload;
  definition: BusinessEntrySceneDefinition;
  validation: BusinessEntryValidationResult;
}

export interface BusinessPartyCreateInvalid {
  state: "invalid";
  payload: BusinessPartyCreatePayload;
  definition: BusinessEntrySceneDefinition;
  validation: BusinessEntryValidationResult;
}

export type BusinessPartyCreatePreparation =
  | BusinessPartyCreateConfirmation
  | BusinessPartyCreateInvalid;

export function newBusinessPartyIdempotencyKey() {
  const randomUUID = globalThis.crypto?.randomUUID;
  if (randomUUID) return randomUUID.call(globalThis.crypto);
  throw new Error("当前浏览器不支持安全的提交标识生成");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export async function fingerprintBusinessPartyValues(values: BusinessPartyValues) {
  const digest = await globalThis.crypto?.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(stableJson(values))
  );
  if (!digest) throw new Error("当前浏览器不支持提交快照指纹");
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function normalizeBusinessPartyValues(raw: {
  name?: unknown;
  unifiedSocialCreditCode?: unknown;
}): BusinessPartyValues {
  const name = typeof raw.name === "string"
    ? raw.name.normalize("NFC").trim().replace(/\s+/gu, " ")
    : "";
  const code = typeof raw.unifiedSocialCreditCode === "string"
    ? raw.unifiedSocialCreditCode.trim().toUpperCase()
    : "";
  return {
    type: "organization",
    name,
    ...(code ? { unifiedSocialCreditCode: code } : {}),
    attachments: []
  };
}

export function retainBusinessPartyRecovery(
  recovery: BusinessPartyPendingRecovery | null,
  values: BusinessPartyValues
) {
  if (!recovery) return null;
  return JSON.stringify(values) === JSON.stringify(recovery.values)
    ? recovery
    : null;
}

export function businessPartyDefinitionVersion(
  definition: { version: number } | null
) {
  return definition ? definition.version : 1;
}

export function businessPartyRecoveryIdempotencyKey(
  recovery: BusinessPartyPendingRecovery | null
) {
  return recovery ? recovery.idempotencyKey : null;
}

export function businessPartyCreateIdempotencyKey(
  recovery: BusinessPartyPendingRecovery | null
) {
  return businessPartyRecoveryIdempotencyKey(recovery) ?? newBusinessPartyIdempotencyKey();
}

function emptyProbeValues(): BusinessPartyValues {
  return { type: "organization", name: "", attachments: [] };
}

export function createBusinessPartySubmissionController(
  dependencies: BusinessPartyCreateFlowDependencies,
  options: { probeDefinitionVersion?: number } = {}
) {
  let probeResult: { definition: BusinessEntrySceneDefinition; target: BusinessPartyCreateTargetResponse } | null = null;
  let pendingSubmit: Promise<unknown> | null = null;

  async function probe() {
    const definitionVersion = options.probeDefinitionVersion ?? 1;
    const idempotencyKey = newBusinessPartyIdempotencyKey();
    const fingerprint = await fingerprintBusinessPartyValues(emptyProbeValues());
    const target = await dependencies.issueCreateTarget({
      definitionKey: BUSINESS_PARTY_DEFINITION_KEY,
      definitionVersion,
      idempotencyKey,
      fingerprint
    });
    const formalTarget: Extract<BusinessEntrySubmissionTarget, { createTarget: string }> = {
      entityType: BUSINESS_PARTY_SCENE_KEY,
      createTarget: target.createTarget
    };
    const definition = await dependencies.fetchDefinition(formalTarget);
    probeResult = { definition, target };
    return { definition, target: formalTarget };
  }

  async function prepare(
    raw: { name?: unknown; unifiedSocialCreditCode?: unknown },
    prepareOptions: { idempotencyKey?: string } = {}
  ) {
    const currentProbe = probeResult ?? await probe();
    const values = normalizeBusinessPartyValues(raw);
    const idempotencyKey = prepareOptions.idempotencyKey ?? newBusinessPartyIdempotencyKey();
    const targetResponse = await dependencies.issueCreateTarget({
      definitionKey: BUSINESS_PARTY_DEFINITION_KEY,
      definitionVersion: currentProbe.definition.version,
      idempotencyKey,
      fingerprint: await fingerprintBusinessPartyValues(values)
    });
    const target: Extract<BusinessEntrySubmissionTarget, { createTarget: string }> = {
      entityType: BUSINESS_PARTY_SCENE_KEY,
      createTarget: targetResponse.createTarget
    };
    const definition = await dependencies.fetchDefinition(target);
    const payload: BusinessPartyCreatePayload = {
      sceneKey: BUSINESS_PARTY_SCENE_KEY,
      definitionVersion: definition.version,
      definitionKey: BUSINESS_PARTY_DEFINITION_KEY,
      target,
      values,
      idempotencyKey
    };
    const validation = await dependencies.validate(payload);
    return {
      state: validation.valid ? "confirm" : "invalid",
      payload,
      definition,
      validation
    } as BusinessPartyCreatePreparation;
  }

  function submit(prepared: BusinessPartyCreatePreparation, options?: { onRequestSent?: () => void }) {
    if (prepared.state !== "confirm") return Promise.reject(new Error("业务字段校验未通过"));
    if (pendingSubmit) return pendingSubmit;
    pendingSubmit = dependencies.create(prepared.payload, options).finally(() => {
      pendingSubmit = null;
    });
    return pendingSubmit;
  }

  return { probe, prepare, submit };
}

export async function probeBusinessPartyCreateDefinition(
  dependencies: BusinessPartyProbeDependencies,
  probeDefinitionVersion = 1
) {
  const idempotencyKey = newBusinessPartyIdempotencyKey();
  const targetResponse = await dependencies.issueCreateTarget({
    definitionKey: BUSINESS_PARTY_DEFINITION_KEY,
    definitionVersion: probeDefinitionVersion,
    idempotencyKey,
    fingerprint: await fingerprintBusinessPartyValues(emptyProbeValues())
  });
  const target: Extract<BusinessEntrySubmissionTarget, { createTarget: string }> = {
    entityType: BUSINESS_PARTY_SCENE_KEY,
    createTarget: targetResponse.createTarget
  };
  return {
    definition: await dependencies.fetchDefinition(target),
    target
  };
}

export interface StorageAdapter {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function safeValues(value: unknown): BusinessPartyValues | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (record.type !== "organization" || typeof record.name !== "string") return null;
  if (!Array.isArray(record.attachments) || record.attachments.length !== 0) return null;
  if (
    record.unifiedSocialCreditCode !== undefined &&
    typeof record.unifiedSocialCreditCode !== "string"
  ) return null;
  return {
    type: "organization",
    name: record.name,
    ...(record.unifiedSocialCreditCode
      ? { unifiedSocialCreditCode: record.unifiedSocialCreditCode }
      : {}),
    attachments: []
  };
}

export function writeBusinessPartyPendingRecovery(
  storage: StorageAdapter,
  recovery: BusinessPartyPendingRecovery
) {
  const values = safeValues(recovery.values);
  if (!values || !recovery.idempotencyKey || recovery.definitionKey !== BUSINESS_PARTY_DEFINITION_KEY) {
    throw new Error("合作单位恢复信息无效");
  }
  storage.setItem(BUSINESS_PARTY_RECOVERY_STORAGE_KEY, JSON.stringify({
    idempotencyKey: recovery.idempotencyKey,
    definitionKey: BUSINESS_PARTY_DEFINITION_KEY,
    definitionVersion: recovery.definitionVersion,
    values
  } satisfies BusinessPartyPendingRecovery));
}

export function readBusinessPartyPendingRecovery(
  storage: StorageAdapter
): BusinessPartyPendingRecovery | null {
  const raw = storage.getItem(BUSINESS_PARTY_RECOVERY_STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const values = safeValues(parsed.values);
    if (
      typeof parsed.idempotencyKey !== "string" ||
      parsed.definitionKey !== BUSINESS_PARTY_DEFINITION_KEY ||
      !Number.isInteger(parsed.definitionVersion) ||
      Number(parsed.definitionVersion) <= 0 ||
      !values
    ) return null;
    return {
      idempotencyKey: parsed.idempotencyKey,
      definitionKey: BUSINESS_PARTY_DEFINITION_KEY,
      definitionVersion: Number(parsed.definitionVersion),
      values
    };
  } catch {
    return null;
  }
}

export function clearBusinessPartyPendingRecovery(storage: StorageAdapter) {
  storage.removeItem(BUSINESS_PARTY_RECOVERY_STORAGE_KEY);
}
