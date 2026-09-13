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
const CURSOR_MAX_LENGTH = 2_048;
const CURSOR_TEXT_MAX_LENGTH = 256;

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
    try {
      validateClaims(claims);
    } catch {
      throw new BadRequestException("经营投影明细游标签发坐标无效");
    }
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    cipher.setAAD(Buffer.from(CURSOR_PURPOSE, "utf8"));
    const encrypted = Buffer.concat([
      cipher.update(JSON.stringify(claims), "utf8"),
      cipher.final()
    ]);
    const token = [iv, encrypted, cipher.getAuthTag()]
      .map((value) => value.toString("base64url"))
      .join(".");
    if (token.length > CURSOR_MAX_LENGTH) {
      throw new BadRequestException("经营投影明细游标超出安全长度");
    }
    return token;
  }

  read(token: unknown, binding: OperatingProjectionCursorBinding): OperatingProjectionCursorClaims {
    try {
      if (typeof token !== "string" || !token || token.length > CURSOR_MAX_LENGTH) {
        throw new Error("游标输入长度错误");
      }
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
      const claims: unknown = JSON.parse(raw);
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

function validateClaims(value: unknown): asserts value is OperatingProjectionCursorClaims {
  if (!value || typeof value !== "object") throw new Error("游标声明错误");
  const claims = value as Partial<OperatingProjectionCursorClaims>;
  if (claims.version !== 2 || claims.purpose !== CURSOR_PURPOSE ||
      !validBoundedText(claims.actorUserId) ||
      !(claims.requestedAsOf === null ||
        (typeof claims.requestedAsOf === "string" &&
          claims.requestedAsOf.length <= CURSOR_TEXT_MAX_LENGTH)) ||
      !Number.isInteger(claims.pageSize) || claims.pageSize! < 1 || claims.pageSize! > 200 ||
      !validDate(claims.readAt) || !validDate(claims.cutoffAt) || !validDate(claims.expiresAt) ||
      !validFingerprint(claims.requestScopeFingerprint) ||
      !validFingerprint(claims.scopeFingerprint) ||
      !validFingerprint(claims.projectionContextFingerprint) || !claims.position ||
      typeof claims.position !== "object" ||
      !["facts", "risks", "done"].includes(claims.position.phase)) {
    throw new Error("游标声明错误");
  }
  if (claims.position.phase === "facts" &&
      (!validDate(claims.position.occurredAt) ||
        !validBoundedText(claims.position.impactId))) {
    throw new Error("游标事实位置错误");
  }
  if (claims.position.phase === "risks" &&
      ((claims.position.projectId !== undefined &&
        !validBoundedText(claims.position.projectId)) ||
        (claims.position.clearingCaseId !== undefined &&
          !validBoundedText(claims.position.clearingCaseId)) ||
        (claims.position.itemOffset !== undefined &&
          (!Number.isSafeInteger(claims.position.itemOffset) ||
            claims.position.itemOffset < 0)))) {
    throw new Error("游标风险位置错误");
  }
}

function validBoundedText(value: unknown): value is string {
  return typeof value === "string" && value.length >= 1 &&
    value.length <= CURSOR_TEXT_MAX_LENGTH;
}

function validDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
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
