import { createHmac, timingSafeEqual } from "node:crypto";

import { Optional } from "@nestjs/common";

const PREFIX = "hwt1";
const PURPOSE = "historical_wage_takeover_selection";
const TTL_MS = 10 * 60 * 1000;
const SHA256 = /^[0-9a-f]{64}$/iu;

export type HistoricalWageSelectionCoordinate = {
  projectId: string;
  sourceType: "project_wage";
  sourceBusinessId: string;
  sourceVersion: number;
  sourceFingerprint: string;
};

/**
 * The serialised payload is opaque to callers because it is HMAC-bound. It is
 * not a client input model: activation always reloads these coordinates and
 * validates the source/fingerprint again inside its Serializable transaction.
 */
type HistoricalWageSelectionBindingBase = {
  actorUserId: string;
  delegatorUserId?: string;
  selectionFingerprint: string;
  atomicScopeVersionId?: string;
  legacyCoordinates: HistoricalWageSelectionCoordinate[];
};

export type HistoricalWageSelectionBinding = HistoricalWageSelectionBindingBase & (
  | {
      grade: "A";
      sourceVersionId: string;
      sourceFingerprint: string;
      sourceClosureFingerprint: string;
      summaryFingerprint?: never;
      negativeAuthorityFrontierFingerprint?: never;
    }
  | {
      grade: "B";
      sourceVersionId?: never;
      sourceFingerprint?: never;
      sourceClosureFingerprint?: never;
      summaryFingerprint: string;
      negativeAuthorityFrontierFingerprint?: never;
    }
  | {
      grade: "C";
      sourceVersionId?: never;
      sourceFingerprint?: never;
      sourceClosureFingerprint?: never;
      summaryFingerprint?: never;
      negativeAuthorityFrontierFingerprint: string;
    }
);

type HistoricalWageSelectionCandidate = HistoricalWageSelectionBindingBase & {
  grade: "A" | "B" | "C";
  sourceVersionId?: string;
  sourceFingerprint?: string;
  sourceClosureFingerprint?: string;
  summaryFingerprint?: string;
  negativeAuthorityFrontierFingerprint?: string;
};

export class HistoricalWageTakeoverSelectionRefService {
  private readonly secret: string;

  constructor(@Optional() secrets: { secret?: string } = {}) {
    const secret = secrets.secret ?? process.env.HISTORICAL_WAGE_TAKEOVER_SELECTION_SECRET;
    if (process.env.NODE_ENV === "production" && (!secret || secret.length < 32)) {
      throw new Error("生产环境必须配置独立的历史工资接管 selectionRef 签名密钥");
    }
    this.secret = secret ?? "local-historical-wage-takeover-selection-secret";
  }

  issue(binding: HistoricalWageSelectionBinding, now = new Date()): string {
    const normalized = normalize(binding);
    const expiresAt = now.getTime() + TTL_MS;
    const payload = Buffer.from(JSON.stringify(normalized)).toString("base64url");
    const expiry = expiresAt.toString(36);
    return `${PREFIX}.${expiry}.${payload}.${this.signature(payload, expiresAt)}`;
  }

  /**
   * Server-internal continuation only: it copies every authoritative source
   * coordinate from an already signed scoped reference and changes just the
   * effective command identity. The caller still has to authorize that
   * identity and revalidate the scope before returning this token.
   */
  issueScopedForActor(
    scopedSelectionRef: string,
    actorUserId: string,
    delegatorUserId: string | undefined,
    now = new Date()
  ): string {
    const source = this.read(scopedSelectionRef, now);
    if (!source?.atomicScopeVersionId) {
      throw new Error("历史工资接管续签必须基于有效的原子范围 selectionRef");
    }
    if (!text(actorUserId) || (text(delegatorUserId) && actorUserId.trim() === delegatorUserId.trim())) {
      throw new Error("历史工资接管续签的有效身份无效");
    }
    const sourceWithoutPriorDelegator = { ...source };
    delete sourceWithoutPriorDelegator.delegatorUserId;
    return this.issue({
      ...sourceWithoutPriorDelegator,
      actorUserId: actorUserId.trim(),
      ...(text(delegatorUserId) ? { delegatorUserId: delegatorUserId.trim() } : {})
    }, now);
  }

  read(selectionRef: string, now = new Date()): HistoricalWageSelectionBinding | null {
    if (typeof selectionRef !== "string") return null;
    const parts = selectionRef.split(".");
    if (parts.length !== 4 || parts[0] !== PREFIX) return null;
    const expiry = parts[1]!;
    if (!/^[0-9a-z]+$/u.test(expiry)) return null;
    const expiresAt = Number.parseInt(expiry, 36);
    const payload = parts[2]!;
    const signature = parts[3]!;
    if (
      !Number.isSafeInteger(expiresAt) ||
      expiresAt.toString(36) !== expiry ||
      expiresAt <= now.getTime() ||
      expiresAt > now.getTime() + TTL_MS
    ) return null;
    const expected = Buffer.from(this.signature(payload, expiresAt));
    const actual = Buffer.from(signature);
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
    try {
      return normalize(JSON.parse(Buffer.from(payload, "base64url").toString("utf8")));
    } catch {
      return null;
    }
  }

  private signature(payload: string, expiresAt: number) {
    return createHmac("sha256", this.secret)
      .update(JSON.stringify([PURPOSE, payload, expiresAt]))
      .digest("base64url");
  }
}

function normalize(value: unknown): HistoricalWageSelectionBinding {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("历史工资接管 selectionRef 载荷无效");
  const candidate = value as Partial<HistoricalWageSelectionCandidate>;
  if (!text(candidate.actorUserId) || !hash(candidate.selectionFingerprint) || !["A", "B", "C"].includes(candidate.grade ?? "")) {
    throw new Error("历史工资接管 selectionRef 载荷无效");
  }
  if (!Array.isArray(candidate.legacyCoordinates) || !candidate.legacyCoordinates.length) {
    throw new Error("历史工资接管 selectionRef 缺少 legacy 坐标");
  }
  const coordinates = candidate.legacyCoordinates.map((coordinate) => {
    if (
      !coordinate ||
      coordinate.sourceType !== "project_wage" ||
      !text(coordinate.projectId) ||
      !text(coordinate.sourceBusinessId) ||
      !Number.isInteger(coordinate.sourceVersion) ||
      coordinate.sourceVersion < 1 ||
      !hash(coordinate.sourceFingerprint)
    ) {
      throw new Error("历史工资接管 selectionRef legacy 坐标无效");
    }
    return {
      projectId: coordinate.projectId.trim(),
      sourceType: "project_wage" as const,
      sourceBusinessId: coordinate.sourceBusinessId.trim(),
      sourceVersion: coordinate.sourceVersion,
      sourceFingerprint: coordinate.sourceFingerprint.toLowerCase()
    };
  }).sort((left, right) => coordinateKey(left).localeCompare(coordinateKey(right)));
  if (new Set(coordinates.map(coordinateKey)).size !== coordinates.length) {
    throw new Error("历史工资接管 selectionRef 含重复 legacy 坐标");
  }
  const grade = candidate.grade as "A" | "B" | "C";
  if (grade === "A" && (!text(candidate.sourceVersionId) || !hash(candidate.sourceFingerprint) || !hash(candidate.sourceClosureFingerprint))) {
    throw new Error("A 级历史工资接管 selectionRef 缺少权威闭合来源");
  }
  if (grade === "A" && candidate.summaryFingerprint !== undefined) {
    throw new Error("A 级历史工资接管 selectionRef 不得携带 B 级历史汇总权威");
  }
  if (grade === "B" && !hash(candidate.summaryFingerprint)) {
    throw new Error("B 级历史工资接管 selectionRef 缺少历史汇总权威指纹");
  }
  if (grade === "B" && (
    candidate.sourceVersionId !== undefined ||
    candidate.sourceFingerprint !== undefined ||
    candidate.sourceClosureFingerprint !== undefined
  )) {
    throw new Error("B 级历史工资接管 selectionRef 不得携带 A 级权威闭合来源");
  }
  if (grade === "C" && !hash(candidate.negativeAuthorityFrontierFingerprint)) {
    throw new Error("C 级历史工资接管 selectionRef 缺少负权威前沿指纹");
  }
  if (grade === "C" && (
    candidate.sourceVersionId !== undefined ||
    candidate.sourceFingerprint !== undefined ||
    candidate.sourceClosureFingerprint !== undefined ||
    candidate.summaryFingerprint !== undefined
  )) {
    throw new Error("C 级历史工资接管 selectionRef 不得携带 A/B 级权威来源");
  }
  if (grade !== "C" && candidate.negativeAuthorityFrontierFingerprint !== undefined) {
    throw new Error("A/B 级历史工资接管 selectionRef 不得携带 C 级负权威前沿");
  }
  const base = {
    actorUserId: candidate.actorUserId.trim(),
    ...(text(candidate.delegatorUserId) ? { delegatorUserId: candidate.delegatorUserId.trim() } : {}),
    selectionFingerprint: candidate.selectionFingerprint!.toLowerCase(),
    ...(text(candidate.atomicScopeVersionId) ? { atomicScopeVersionId: candidate.atomicScopeVersionId.trim() } : {}),
    legacyCoordinates: coordinates
  };
  if (grade === "A") {
    return {
      ...base,
      grade,
      sourceVersionId: candidate.sourceVersionId!.trim(),
      sourceFingerprint: candidate.sourceFingerprint!.toLowerCase(),
      sourceClosureFingerprint: candidate.sourceClosureFingerprint!.toLowerCase()
    };
  }
  if (grade === "B") {
    return {
      ...base,
      grade,
      summaryFingerprint: candidate.summaryFingerprint!.toLowerCase()
    };
  }
  return {
    ...base,
    grade,
    negativeAuthorityFrontierFingerprint: candidate.negativeAuthorityFrontierFingerprint!.toLowerCase()
  };
}

function coordinateKey(coordinate: HistoricalWageSelectionCoordinate) {
  return [coordinate.projectId, coordinate.sourceType, coordinate.sourceBusinessId, coordinate.sourceVersion].join(":");
}

function text(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function hash(value: unknown): value is string {
  return typeof value === "string" && SHA256.test(value);
}
