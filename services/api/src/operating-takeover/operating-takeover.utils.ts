import { createHash } from "node:crypto";
import {
  OPERATING_TAKEOVER_SCENE_DEFINITIONS,
  type EvidenceLevel,
  type OperatingTakeoverSceneKey
} from "@jiangkong/shared-domain";

export const OPERATING_TAKEOVER_SOURCE_TYPE = "operating_takeover";
export const OPERATING_TAKEOVER_BATCH_STATUS = [
  "draft",
  "under_review",
  "activated"
] as const;
export const OPERATING_TAKEOVER_ROW_REVIEW_STATUS = [
  "pending",
  "accepted",
  "blocked",
  "activated"
] as const;
export const OPERATING_TAKEOVER_DUPLICATE_STATUS = [
  "none",
  "suspected",
  "confirmed"
] as const;

export interface NormalizedTakeoverRow {
  sceneKey: OperatingTakeoverSceneKey;
  values: Record<string, unknown>;
  occurredAt: Date;
  amountCents: bigint;
  evidenceLevel: EvidenceLevel;
  rowFingerprint: string;
}

export function parseAmountCents(value: unknown): bigint {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) {
      throw new Error("金额必须是非负的元，最多保留两位小数");
    }
    value = String(value);
  }
  if (typeof value !== "string" || !/^\d+(?:\.\d{1,2})?$/.test(value.trim())) {
    throw new Error("金额必须是非负的元，最多保留两位小数");
  }
  const [yuan, cents = ""] = value.trim().split(".");
  return BigInt(yuan) * 100n + BigInt((cents + "00").slice(0, 2));
}

export function parseDateOnly(value: unknown): Date {
  const text = value instanceof Date
    ? value.toISOString().slice(0, 10)
    : typeof value === "string"
      ? value.trim()
      : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error("发生日期必须使用 YYYY-MM-DD");
  const date = new Date(`${text}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text) {
    throw new Error("发生日期无效");
  }
  return date;
}

export function isBlank(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === "string" && !value.trim());
}

export function textValue(value: unknown): string | undefined {
  if (isBlank(value)) return undefined;
  return typeof value === "string" ? value.trim() : String(value).trim();
}

export function jsonValue(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return { ...(value as Record<string, unknown>) };
}

export function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)])
    );
  }
  if (typeof value === "bigint") return value.toString();
  return value;
}

export function fingerprint(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex");
}

export function normalizeTakeoverRow(
  sceneKey: string,
  rawValues: Record<string, unknown>
): NormalizedTakeoverRow {
  const definition = OPERATING_TAKEOVER_SCENE_DEFINITIONS.find((item) => item.key === sceneKey);
  if (!definition) throw new Error("历史接管场景不存在");
  const values = jsonValue(rawValues);
  const occurredAt = parseDateOnly(values.occurredAt);
  const amountCents = parseAmountCents(values.amountYuan);
  const evidenceLevel = values.evidenceLevel;
  if (evidenceLevel !== "A" && evidenceLevel !== "B" && evidenceLevel !== "C") {
    throw new Error("证据等级必须是 A、B 或 C");
  }
  return {
    sceneKey: definition.key,
    values,
    occurredAt,
    amountCents,
    evidenceLevel,
    rowFingerprint: fingerprint({
      sceneKey: definition.key,
      values: {
        businessRef: textValue(values.businessRef),
        occurredAt: occurredAt.toISOString().slice(0, 10),
        periodLabel: textValue(values.periodLabel),
        amountYuan: amountCents.toString(),
        counterpartyName: textValue(values.counterpartyName),
        costBearingCompanyName: textValue(values.costBearingCompanyName),
        actualPayerName: textValue(values.actualPayerName),
        payeeName: textValue(values.payeeName),
        paymentStatus: textValue(values.paymentStatus),
        costCategoryCode: textValue(values.costCategoryCode),
        evidenceLevel,
        sourceDescription: textValue(values.sourceDescription)
      }
    })
  };
}

export function isHistoricalPostEffectiveOwnPayment(
  sceneKey: OperatingTakeoverSceneKey,
  occurredAt: Date,
  effectiveDate: Date | null,
  values: Record<string, unknown>
): boolean {
  if (!effectiveDate || occurredAt < effectiveDate) return false;
  if (["owner_settlement", "owner_payment", "construction_enterprise_company_payment", "construction_enterprise_downstream_payment", "construction_enterprise_deduction"].includes(sceneKey)) {
    return false;
  }
  return !isBlank(values.actualPayerName);
}

export function formatAmountCents(amountCents: bigint | number | string): string {
  const cents = typeof amountCents === "bigint" ? amountCents : BigInt(amountCents);
  const yuan = cents / 100n;
  const fraction = (cents % 100n).toString().padStart(2, "0");
  return `${yuan}.${fraction}`;
}

export function sceneDefinition(sceneKey: string) {
  return OPERATING_TAKEOVER_SCENE_DEFINITIONS.find((item) => item.key === sceneKey);
}
