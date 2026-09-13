import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual
} from "node:crypto";

import { BadRequestException } from "@nestjs/common";

import type { ProjectionFilters, ProjectionScopeInput } from "./operating-projection.reducer";

const CURSOR_PURPOSE = "operating-projection-detail-cursor/V2";
const CURSOR_TTL_MS = 15 * 60 * 1_000;

export type OperatingProjectionCursorPosition =
  | { phase: "facts"; occurredAt: string; impactId: string }
  | { phase: "risks"; projectId?: string; clearingCaseId?: string; itemOffset?: number }
  | { phase: "done" };

export interface OperatingProjectionCursorClaims {
  version: 2;
  purpose: typeof CURSOR_PURPOSE;
  actorUserId: string;
  requestedAsOf: string | null;
  requestScopeFingerprint: string;
  scopeFingerprint: string;
  projectionContextFingerprint: string;
  readAt: string;
  cutoffAt: string;
  pageSize: number;
  position: OperatingProjectionCursorPosition;
  expiresAt: string;
}

export interface OperatingProjectionCursorBinding {
  actorUserId: string;
  scope: ProjectionScopeInput;
  pageSize: number;
  asOf?: string;
}

export class OperatingProjectionCursorCodec {
  private readonly key: Buffer;

  constructor(
    secret = process.env.JWT_ACCESS_SECRET ?? "local-access-secret",
    private readonly now: () => Date = () => new Date()
  ) {
    if (process.env.NODE_ENV === "production" && !process.env.JWT_ACCESS_SECRET &&
        secret === "local-access-secret") {
      throw new Error("生产环境必须配置 JWT_ACCESS_SECRET 才能签发经营投影游标");
    }
    this.key = createHash("sha256")
      .update(`${CURSOR_PURPOSE}\u0000${secret}`, "utf8")
      .digest();
  }

  issue(input: Omit<
    OperatingProjectionCursorClaims,
    "version" | "purpose" | "expiresAt" | "requestScopeFingerprint" | "scopeFingerprint"
  > & {
    requestScope: ProjectionScopeInput;
    scope: ProjectionScopeInput;
  }): string {
    const { requestScope, scope, ...coordinates } = input;
    const claims: OperatingProjectionCursorClaims = {
      ...coordinates,
      version: 2,
      purpose: CURSOR_PURPOSE,
      requestScopeFingerprint: projectionScopeFingerprint(requestScope),
      scopeFingerprint: projectionScopeFingerprint(scope),
      expiresAt: new Date(this.now().getTime() + CURSOR_TTL_MS).toISOString()
    };
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    cipher.setAAD(Buffer.from(CURSOR_PURPOSE, "utf8"));
    const encrypted = Buffer.concat([
      cipher.update(JSON.stringify(claims), "utf8"),
      cipher.final()
    ]);
    return [iv, encrypted, cipher.getAuthTag()]
      .map((value) => value.toString("base64url"))
      .join(".");
  }

  read(token: string, binding: OperatingProjectionCursorBinding): OperatingProjectionCursorClaims {
    try {
      const parts = token.split(".");
      if (parts.length !== 3 || parts.some((part) => !part)) throw new Error("游标格式错误");
      const [iv, encrypted, tag] = parts.map((part) => Buffer.from(part, "base64url"));
      if ([iv, encrypted, tag].some((value, index) =>
        value!.toString("base64url") !== parts[index]
      )) throw new Error("游标编码错误");
      if (iv!.length !== 12 || tag!.length !== 16) throw new Error("游标长度错误");
      const decipher = createDecipheriv("aes-256-gcm", this.key, iv!);
      decipher.setAAD(Buffer.from(CURSOR_PURPOSE, "utf8"));
      decipher.setAuthTag(tag!);
      const raw = Buffer.concat([decipher.update(encrypted!), decipher.final()])
        .toString("utf8");
      const claims = JSON.parse(raw) as OperatingProjectionCursorClaims;
      validateClaims(claims);
      if (Date.parse(claims.expiresAt) <= this.now().getTime()) throw new Error("游标已过期");
      if (
        claims.actorUserId !== binding.actorUserId ||
        claims.pageSize !== binding.pageSize ||
        claims.requestedAsOf !== (binding.asOf?.trim() || null) ||
        claims.requestScopeFingerprint !== projectionScopeFingerprint(binding.scope)
      ) {
        throw new Error("游标查询绑定不匹配");
      }
      return claims;
    } catch {
      throw new BadRequestException("经营投影明细游标无效、已过期或与当前查询不匹配");
    }
  }
}

function validateClaims(value: OperatingProjectionCursorClaims): void {
  if (!value || value.version !== 2 || value.purpose !== CURSOR_PURPOSE ||
      typeof value.actorUserId !== "string" || !value.actorUserId ||
      !(value.requestedAsOf === null || typeof value.requestedAsOf === "string") ||
      !Number.isInteger(value.pageSize) || value.pageSize < 1 || value.pageSize > 200 ||
      !validDate(value.readAt) || !validDate(value.cutoffAt) || !validDate(value.expiresAt) ||
      !validFingerprint(value.requestScopeFingerprint) ||
      !validFingerprint(value.scopeFingerprint) ||
      !validFingerprint(value.projectionContextFingerprint) || !value.position ||
      !["facts", "risks", "done"].includes(value.position.phase)) {
    throw new Error("游标声明错误");
  }
  if (value.position.phase === "facts" &&
      (!validDate(value.position.occurredAt) || !value.position.impactId)) {
    throw new Error("游标事实位置错误");
  }
  if (value.position.phase === "risks" &&
      (value.position.itemOffset !== undefined &&
        (!Number.isInteger(value.position.itemOffset) || value.position.itemOffset < 0))) {
    throw new Error("游标风险位置错误");
  }
}

function validDate(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function validFingerprint(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

export function projectionScopeFingerprint(scope: ProjectionScopeInput): string {
  const filters: ProjectionFilters = Object.fromEntries(
    Object.entries(scope.filters ?? {})
      .filter(([, value]) => typeof value === "string" && value.length > 0)
      .sort(([left], [right]) => left.localeCompare(right))
  );
  return createHash("sha256").update(JSON.stringify({
    kind: scope.kind,
    projectId: scope.projectId ?? null,
    companyEntityId: scope.companyEntityId ?? null,
    projectIds: [...scope.projectIds].sort(),
    filters
  }), "utf8").digest("hex");
}

export function projectionContextFingerprint(context: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(context), "utf8")
    .digest("hex");
}

export function projectionFingerprintsMatch(left: string, right: string): boolean {
  if (!validFingerprint(left) || !validFingerprint(right)) return false;
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}
