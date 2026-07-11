import { Injectable, UnauthorizedException } from "@nestjs/common";
import { createHmac, createHash } from "node:crypto";
import type { AuthenticatedUser, JwtPayload } from "./auth.types";

const DEFAULT_SECRET_MARKERS = new Set([
  "local-access-secret",
  "local-refresh-secret",
  "replace-with-long-random-secret"
]);
const INVALID_TOKEN_MESSAGE = "登录凭证无效，请重新登录";
const BASE64URL_SEGMENT = /^[A-Za-z0-9_-]+$/u;
const JWT_HEADER_KEYS = new Set(["alg", "typ"]);
const JWT_PAYLOAD_KEYS = new Set(["sub", "name", "phone", "type", "iat", "exp"]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasOnlyKeys(value: Record<string, unknown>, allowedKeys: ReadonlySet<string>) {
  return Object.keys(value).every((key) => allowedKeys.has(key));
}

function isJwtHeader(value: unknown): boolean {
  if (!isPlainObject(value) || !hasOnlyKeys(value, JWT_HEADER_KEYS)) {
    return false;
  }
  return (
    Object.keys(value).length === JWT_HEADER_KEYS.size &&
    value.alg === "HS256" &&
    value.typ === "JWT"
  );
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isJwtPayload(value: unknown, now: number): value is JwtPayload {
  if (!isPlainObject(value) || !hasOnlyKeys(value, JWT_PAYLOAD_KEYS)) {
    return false;
  }

  return (
    (value.type === "access" || value.type === "refresh") &&
    typeof value.sub === "string" &&
    value.sub.length > 0 &&
    value.sub.trim() === value.sub &&
    (value.name === undefined || typeof value.name === "string") &&
    (value.phone === undefined || value.phone === null || typeof value.phone === "string") &&
    isPositiveSafeInteger(value.iat) &&
    value.iat <= now &&
    isPositiveSafeInteger(value.exp) &&
    value.exp > value.iat &&
    value.exp > now
  );
}

function decodeCanonicalJson(segment: string): unknown {
  const decoded = Buffer.from(segment, "base64url").toString("utf8");
  if (Buffer.from(decoded, "utf8").toString("base64url") !== segment) {
    throw new Error("invalid token encoding");
  }
  return JSON.parse(decoded) as unknown;
}

@Injectable()
export class JwtTokenService {
  constructor() {
    this.assertProductionSecret("JWT_ACCESS_SECRET");
    this.assertProductionSecret("JWT_REFRESH_SECRET");
  }

  accessTokenTtlSeconds() {
    return Number(process.env.JWT_ACCESS_TTL_SECONDS ?? 15 * 60);
  }

  refreshTokenTtlSeconds() {
    return Number(process.env.JWT_REFRESH_TTL_SECONDS ?? 7 * 24 * 60 * 60);
  }

  signAccessToken(user: AuthenticatedUser) {
    return this.sign({
      sub: user.id,
      name: user.name,
      phone: user.phone,
      type: "access",
      iat: this.nowSeconds(),
      exp: this.nowSeconds() + this.accessTokenTtlSeconds()
    });
  }

  signRefreshToken(user: AuthenticatedUser) {
    return this.sign({
      sub: user.id,
      name: user.name,
      phone: user.phone,
      type: "refresh",
      iat: this.nowSeconds(),
      exp: this.nowSeconds() + this.refreshTokenTtlSeconds()
    });
  }

  verifyAccessToken(token: string) {
    const payload = this.verify(token);

    if (payload.type !== "access") {
      throw new UnauthorizedException("登录凭证类型不正确，请重新登录");
    }

    return payload;
  }

  verifyRefreshToken(token: string) {
    const payload = this.verify(token);

    if (payload.type !== "refresh") {
      throw new UnauthorizedException("刷新登录凭证类型不正确，请重新登录");
    }

    return payload;
  }

  hashToken(token: string) {
    return createHash("sha256").update(token).digest("hex");
  }

  private sign(payload: JwtPayload) {
    const header = { alg: "HS256", typ: "JWT" };
    const unsigned = `${this.encode(header)}.${this.encode(payload)}`;
    return `${unsigned}.${this.signature(unsigned, this.secret(payload.type))}`;
  }

  private verify(token: string): JwtPayload {
    try {
      if (typeof token !== "string") {
        throw new Error("invalid token type");
      }
      const parts = token.split(".");
      if (
        parts.length !== 3 ||
        parts.some((part) => !part || !BASE64URL_SEGMENT.test(part))
      ) {
        throw new Error("invalid token structure");
      }

      const [header, payload, signature] = parts;
      const parsedHeader = decodeCanonicalJson(header);
      if (!isJwtHeader(parsedHeader)) {
        throw new Error("invalid token header");
      }

      const parsedPayload = decodeCanonicalJson(payload);
      const now = this.nowSeconds();
      if (!isJwtPayload(parsedPayload, now)) {
        throw new Error("invalid token payload");
      }

      const expected = this.signature(`${header}.${payload}`, this.secret(parsedPayload.type));
      if (signature !== expected) {
        throw new Error("invalid token signature");
      }

      return parsedPayload;
    } catch {
      throw new UnauthorizedException(INVALID_TOKEN_MESSAGE);
    }
  }

  private encode(value: unknown) {
    return Buffer.from(JSON.stringify(value)).toString("base64url");
  }

  private signature(value: string, secret: string) {
    return createHmac("sha256", secret).update(value).digest("base64url");
  }

  private secret(type: JwtPayload["type"]) {
    if (type === "refresh") {
      return process.env.JWT_REFRESH_SECRET ?? "local-refresh-secret";
    }

    return process.env.JWT_ACCESS_SECRET ?? "local-access-secret";
  }

  private assertProductionSecret(key: "JWT_ACCESS_SECRET" | "JWT_REFRESH_SECRET") {
    if (process.env.NODE_ENV !== "production") {
      return;
    }

    const value = process.env[key]?.trim();
    if (!value || DEFAULT_SECRET_MARKERS.has(value) || value.length < 32) {
      throw new Error(`${key} must be set to a non-default production secret`);
    }
  }

  private nowSeconds() {
    return Math.floor(Date.now() / 1000);
  }
}
