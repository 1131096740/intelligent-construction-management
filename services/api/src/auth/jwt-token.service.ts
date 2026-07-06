import { Injectable, UnauthorizedException } from "@nestjs/common";
import { createHmac, createHash } from "node:crypto";
import type { AuthenticatedUser, JwtPayload } from "./auth.types";

const DEFAULT_SECRET_MARKERS = new Set([
  "local-access-secret",
  "local-refresh-secret",
  "replace-with-long-random-secret"
]);

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
      throw new UnauthorizedException("Invalid access token");
    }

    return payload;
  }

  verifyRefreshToken(token: string) {
    const payload = this.verify(token);

    if (payload.type !== "refresh") {
      throw new UnauthorizedException("Invalid refresh token");
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
    const parts = token.split(".");

    if (parts.length !== 3) {
      throw new UnauthorizedException("Invalid token");
    }

    const [header, payload, signature] = parts;
    const parsedPayload = JSON.parse(Buffer.from(payload, "base64url").toString()) as JwtPayload;
    const expected = this.signature(`${header}.${payload}`, this.secret(parsedPayload.type));

    if (signature !== expected) {
      throw new UnauthorizedException("Invalid token signature");
    }

    if (!parsedPayload.exp || parsedPayload.exp < this.nowSeconds()) {
      throw new UnauthorizedException("Token expired");
    }

    return parsedPayload;
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
