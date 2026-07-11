import { UnauthorizedException } from "@nestjs/common";
import { createHmac } from "node:crypto";
import { JwtTokenService } from "./jwt-token.service";

const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");

function tokenWithPayload(payload: unknown, secret = "test-access-secret") {
  const unsigned = `${encode({ alg: "HS256", typ: "JWT" })}.${encode(payload)}`;
  const signature = createHmac("sha256", secret).update(unsigned).digest("base64url");
  return `${unsigned}.${signature}`;
}

function malformedTokenWithRawPayload(rawPayload: string) {
  return `${encode({ alg: "HS256", typ: "JWT" })}.${Buffer.from(rawPayload).toString("base64url")}.signature`;
}

function expectFixedUnauthorized(action: () => unknown, secret?: string) {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(UnauthorizedException);
    expect((error as UnauthorizedException).getStatus()).toBe(401);
    expect((error as UnauthorizedException).message).toBe("登录凭证无效，请重新登录");
    if (secret) {
      expect(JSON.stringify(error)).not.toContain(secret);
      expect(String(error)).not.toContain(secret);
    }
    return;
  }
  throw new Error("Expected token verification to reject the token");
}

describe("JwtTokenService", () => {
  const service = new JwtTokenService();
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    process.env.JWT_ACCESS_SECRET = "test-access-secret";
    process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
  });

  it("signs and verifies access tokens", () => {
    const token = service.signAccessToken({
      id: "user-1",
      name: "测试用户",
      phone: "13800000000"
    });

    expect(service.verifyAccessToken(token)).toMatchObject({
      sub: "user-1",
      type: "access"
    });
  });

  it("signs and verifies refresh tokens", () => {
    const token = service.signRefreshToken({
      id: "user-1",
      name: "测试用户",
      phone: "13800000000"
    });

    expect(service.verifyRefreshToken(token)).toMatchObject({
      sub: "user-1",
      type: "refresh"
    });
  });

  it("maps malformed JSON payloads to a fixed 401 without exposing submitted content", () => {
    const secret = "TOP-SECRET";

    expectFixedUnauthorized(
      () => service.verifyAccessToken(malformedTokenWithRawPayload(`{"secret":"${secret}"`)),
      secret
    );
  });

  it.each([
    { label: "wrong segment count", token: "header.payload" },
    { label: "invalid base64url payload", token: "header.%%%.signature" }
  ])("maps $label to the same fixed 401", ({ token }) => {
    expectFixedUnauthorized(() => service.verifyAccessToken(token));
  });

  it.each([
    { label: "null payload", payload: null },
    { label: "array payload", payload: [] },
    {
      label: "unsupported token type",
      payload: { sub: "user-1", type: "admin", iat: 1, exp: Date.now() / 1000 + 60 }
    },
    {
      label: "empty subject",
      payload: { sub: "", type: "access", iat: 1, exp: Date.now() / 1000 + 60 }
    },
    {
      label: "invalid issued-at claim",
      payload: { sub: "user-1", type: "access", iat: "now", exp: Date.now() / 1000 + 60 }
    },
    {
      label: "invalid expiry claim",
      payload: { sub: "user-1", type: "access", iat: 1, exp: "later" }
    }
  ])("maps $label to the same fixed 401", ({ payload }) => {
    expectFixedUnauthorized(() => service.verifyAccessToken(tokenWithPayload(payload)));
  });

  it("rejects refresh tokens when access tokens are required", () => {
    const token = service.signRefreshToken({
      id: "user-1",
      name: "测试用户",
      phone: "13800000000"
    });

    expect(() => service.verifyAccessToken(token)).toThrow(UnauthorizedException);
  });

  it("fails closed when production JWT secrets are missing or default", () => {
    const previous = {
      nodeEnv: process.env.NODE_ENV,
      access: process.env.JWT_ACCESS_SECRET,
      refresh: process.env.JWT_REFRESH_SECRET
    };
    process.env.NODE_ENV = "production";
    process.env.JWT_ACCESS_SECRET = "local-access-secret";
    process.env.JWT_REFRESH_SECRET = "b".repeat(40);

    try {
      expect(() => new JwtTokenService()).toThrow("JWT_ACCESS_SECRET");
    } finally {
      process.env.NODE_ENV = previous.nodeEnv;
      if (previous.access === undefined) delete process.env.JWT_ACCESS_SECRET;
      else process.env.JWT_ACCESS_SECRET = previous.access;
      if (previous.refresh === undefined) delete process.env.JWT_REFRESH_SECRET;
      else process.env.JWT_REFRESH_SECRET = previous.refresh;
    }
  });
});
