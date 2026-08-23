import { BadRequestException, Injectable } from "@nestjs/common";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { BusinessEntryTargetScope } from "./business-entry-scene-access";

const CREATE_TARGET_TTL_SECONDS = 5 * 60;
const CREATE_TARGET_VERSION = 1;

interface BusinessEntryCreateTargetClaims {
  v: typeof CREATE_TARGET_VERSION;
  actorUserId: string;
  scene: string;
  entityType: string;
  scope: BusinessEntryTargetScope;
  action?: string;
  definitionKey?: string;
  definitionVersion?: number;
  idempotencyKey?: string;
  fingerprint?: string;
  projectId?: string;
  iat: number;
  exp: number;
}

function encode(value: unknown) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function decode(segment: string): unknown {
  return JSON.parse(Buffer.from(segment, "base64url").toString("utf8")) as unknown;
}

@Injectable()
export class BusinessEntryCreateTargetService {
  private readonly secret: string;

  constructor() {
    this.secret = process.env.BUSINESS_ENTRY_CREATE_TARGET_SECRET ??
      process.env.JWT_ACCESS_SECRET ??
      "local-access-secret";
    if (
      process.env.NODE_ENV === "production" &&
      (this.secret.length < 32 || this.secret === "local-access-secret")
    ) {
      throw new Error("生产环境必须配置独立的业务录入 create-target 签名密钥");
    }
  }

  issue(input: Omit<BusinessEntryCreateTargetClaims, "v" | "iat" | "exp">) {
    if (
      (input.idempotencyKey !== undefined && !this.isUuidV4(input.idempotencyKey)) ||
      (input.fingerprint !== undefined && !/^[0-9a-f]{64}$/iu.test(input.fingerprint)) ||
      (input.definitionVersion !== undefined &&
        (!Number.isSafeInteger(input.definitionVersion) || input.definitionVersion <= 0))
    ) {
      throw new BadRequestException("新建目标意图参数无效");
    }
    const now = Math.floor(Date.now() / 1000);
    const claims: BusinessEntryCreateTargetClaims = {
      ...input,
      v: CREATE_TARGET_VERSION,
      iat: now,
      exp: now + CREATE_TARGET_TTL_SECONDS
    };
    const payload = encode(claims);
    return {
      createTarget: `${payload}.${this.sign(payload)}`,
      expiresAt: new Date(claims.exp * 1000).toISOString()
    };
  }

  verify(
    token: string,
    expected: Omit<BusinessEntryCreateTargetClaims, "v" | "iat" | "exp">
  ) {
    try {
      if (typeof token !== "string") throw new Error("invalid token");
      const [payload, signature, ...extra] = token.split(".");
      if (!payload || !signature || extra.length) throw new Error("invalid token");
      const left = Buffer.from(signature);
      const right = Buffer.from(this.sign(payload));
      if (left.length !== right.length || !timingSafeEqual(left, right)) {
        throw new Error("invalid signature");
      }
      const claims = decode(payload) as Partial<BusinessEntryCreateTargetClaims>;
      const now = Math.floor(Date.now() / 1000);
      const issuedAt = claims.iat;
      const expiresAt = claims.exp;
      if (
        typeof issuedAt !== "number" ||
        typeof expiresAt !== "number" ||
        !Number.isSafeInteger(issuedAt) ||
        !Number.isSafeInteger(expiresAt)
      ) {
        throw new Error("invalid token lifetime");
      }
      if (
        claims.v !== CREATE_TARGET_VERSION ||
        typeof claims.actorUserId !== "string" ||
        typeof claims.scene !== "string" ||
        typeof claims.entityType !== "string" ||
        (claims.scope !== "global" && claims.scope !== "project") ||
        issuedAt > now ||
        expiresAt <= now ||
        expiresAt <= issuedAt ||
        (claims.scope === "project" && typeof claims.projectId !== "string") ||
        (claims.scope === "global" && claims.projectId !== undefined) ||
        (claims.action !== undefined && typeof claims.action !== "string") ||
        (claims.definitionKey !== undefined && typeof claims.definitionKey !== "string") ||
        (claims.definitionVersion !== undefined &&
          (!Number.isSafeInteger(claims.definitionVersion) || claims.definitionVersion <= 0)) ||
        (claims.idempotencyKey !== undefined && !this.isUuidV4(claims.idempotencyKey)) ||
        (claims.fingerprint !== undefined && !/^[0-9a-f]{64}$/iu.test(claims.fingerprint)) ||
        claims.actorUserId !== expected.actorUserId ||
        claims.scene !== expected.scene ||
        claims.entityType !== expected.entityType ||
        claims.scope !== expected.scope ||
        claims.projectId !== expected.projectId ||
        (expected.action !== undefined && claims.action !== expected.action) ||
        (expected.definitionKey !== undefined && claims.definitionKey !== expected.definitionKey) ||
        (expected.definitionVersion !== undefined && claims.definitionVersion !== expected.definitionVersion) ||
        (expected.idempotencyKey !== undefined && claims.idempotencyKey !== expected.idempotencyKey) ||
        (expected.fingerprint !== undefined && claims.fingerprint !== expected.fingerprint)
      ) {
        throw new Error("target binding mismatch");
      }
      return claims as BusinessEntryCreateTargetClaims;
    } catch {
      throw new BadRequestException("新建目标令牌无效、已过期或与当前业务范围不匹配");
    }
  }

  private sign(payload: string) {
    return createHmac("sha256", this.secret).update(payload).digest("base64url");
  }

  private isUuidV4(value: string) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);
  }
}
