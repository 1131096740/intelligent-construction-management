import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

import { BadRequestException } from "@nestjs/common";

const CURSOR_PURPOSE = "project-upstream-fund-fact-cursor/V2";
const CURSOR_TTL_MS = 15 * 60 * 1_000;
const MAX_CURSOR_LENGTH = 2_048;
const MAX_CURSOR_TEXT_LENGTH = 256;
const POSTGRES_BIGINT_MAX = 9_223_372_036_854_775_807n;

export interface ProjectUpstreamFundFactCursorPosition {
  occurredAt: string;
  createdAt: string;
  id: string;
}

interface ProjectUpstreamFundFactCursorClaims {
  version: 2;
  purpose: typeof CURSOR_PURPOSE;
  actorUserId: string;
  projectId: string;
  pageSize: number;
  readAt: string;
  snapshotRowCount: string;
  snapshotStateFingerprint: string;
  position: ProjectUpstreamFundFactCursorPosition;
  expiresAt: string;
}

export class ProjectUpstreamFundFactCursorCodec {
  private readonly key: Buffer;

  constructor(
    secret = process.env.JWT_ACCESS_SECRET ?? "local-access-secret",
    private readonly now: () => Date = () => new Date()
  ) {
    if (
      process.env.NODE_ENV === "production" &&
      !process.env.JWT_ACCESS_SECRET &&
      secret === "local-access-secret"
    ) {
      throw new Error("生产环境必须配置 JWT_ACCESS_SECRET 才能签发上游资金明细游标");
    }
    this.key = createHash("sha256")
      .update(`${CURSOR_PURPOSE}\u0000${secret}`, "utf8")
      .digest();
  }

  issue(input: Omit<ProjectUpstreamFundFactCursorClaims, "version" | "purpose" | "expiresAt">) {
    const claims: ProjectUpstreamFundFactCursorClaims = {
      ...input,
      version: 2,
      purpose: CURSOR_PURPOSE,
      expiresAt: new Date(this.now().getTime() + CURSOR_TTL_MS).toISOString()
    };
    validateClaims(claims);
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
    if (token.length > MAX_CURSOR_LENGTH) {
      throw new BadRequestException("上游资金明细游标内容超出安全上限");
    }
    return token;
  }

  read(
    token: unknown,
    binding: { actorUserId: string; projectId: string; pageSize: number }
  ): ProjectUpstreamFundFactCursorClaims {
    try {
      if (typeof token !== "string" || token.length > MAX_CURSOR_LENGTH) {
        throw new Error("游标长度错误");
      }
      const parts = token.split(".");
      if (parts.length !== 3 || parts.some((part) => !part)) throw new Error("游标格式错误");
      const [iv, encrypted, tag] = parts.map((part) => Buffer.from(part, "base64url"));
      if (parts.some((part, index) =>
        [iv, encrypted, tag][index]!.toString("base64url") !== part
      )) throw new Error("游标编码错误");
      if (iv!.length !== 12 || tag!.length !== 16) throw new Error("游标长度错误");
      const decipher = createDecipheriv("aes-256-gcm", this.key, iv!);
      decipher.setAAD(Buffer.from(CURSOR_PURPOSE, "utf8"));
      decipher.setAuthTag(tag!);
      const claims = JSON.parse(Buffer.concat([
        decipher.update(encrypted!),
        decipher.final()
      ]).toString("utf8")) as ProjectUpstreamFundFactCursorClaims;
      validateClaims(claims);
      if (Date.parse(claims.expiresAt) <= this.now().getTime()) throw new Error("游标已过期");
      if (
        claims.actorUserId !== binding.actorUserId ||
        claims.projectId !== binding.projectId ||
        claims.pageSize !== binding.pageSize
      ) {
        throw new Error("游标查询绑定不匹配");
      }
      return claims;
    } catch {
      throw new BadRequestException("上游资金明细游标无效、已过期或与当前查询不匹配");
    }
  }
}

function validateClaims(value: ProjectUpstreamFundFactCursorClaims): void {
  if (
    !value ||
    value.version !== 2 ||
    value.purpose !== CURSOR_PURPOSE ||
    !validText(value.actorUserId) ||
    !validText(value.projectId) ||
    !Number.isInteger(value.pageSize) || value.pageSize < 1 || value.pageSize > 200 ||
    !validDate(value.readAt) ||
    !validBigintDecimal(value.snapshotRowCount) ||
    typeof value.snapshotStateFingerprint !== "string" ||
      !/^[0-9a-f]{64}$/u.test(value.snapshotStateFingerprint) ||
    !validDate(value.expiresAt) ||
    !value.position ||
    !validDate(value.position.occurredAt) ||
    !validDate(value.position.createdAt) ||
    !validText(value.position.id)
  ) {
    throw new Error("游标声明错误");
  }
}

function validDate(value: unknown): value is string {
  if (typeof value !== "string" || value.length > MAX_CURSOR_TEXT_LENGTH) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

function validText(value: unknown): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= MAX_CURSOR_TEXT_LENGTH;
}

function validBigintDecimal(value: unknown): value is string {
  return typeof value === "string" &&
    /^(?:0|[1-9][0-9]*)$/u.test(value) &&
    BigInt(value) <= POSTGRES_BIGINT_MAX;
}
