import { UnauthorizedException } from "@nestjs/common";
import { createHmac } from "node:crypto";
import { JwtTokenService } from "./jwt-token.service";

const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");

function tokenWithPayload(payload: unknown, secret = "test-access-secret") {
  return tokenWithHeaderAndPayload({ alg: "HS256", typ: "JWT" }, payload, secret);
}

function tokenWithHeaderAndPayload(
  header: unknown,
  payload: unknown,
  secret = "test-access-secret"
) {
  const unsigned = `${encode(header)}.${encode(payload)}`;
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
      type: "refresh",
      jti: expect.stringMatching(/^[0-9a-f-]{36}$/u)
    });
  });

  it("accepts a valid legacy refresh token without jti so it can rotate once after deployment", () => {
    const now = Math.floor(Date.now() / 1000);
    const token = tokenWithPayload(
      { sub: "user-1", type: "refresh", iat: now, exp: now + 60 },
      "test-refresh-secret"
    );

    expect(service.verifyRefreshToken(token)).toMatchObject({
      sub: "user-1",
      type: "refresh"
    });
  });

  it("issues unique refresh tokens for the same user within one second", () => {
    const user = {
      id: "user-1",
      name: "测试用户",
      phone: "13800000000"
    };

    const first = service.signRefreshToken(user);
    const second = service.signRefreshToken(user);

    expect(second).not.toBe(first);
    expect(service.verifyRefreshToken(second).jti).not.toBe(
      service.verifyRefreshToken(first).jti
    );
  });

  it("maps malformed JSON payloads to a fixed 401 without exposing submitted content", () => {
    const secret = "TOP-SECRET";

    expectFixedUnauthorized(
      () => service.verifyAccessToken(malformedTokenWithRawPayload(`{"secret":"${secret}"`)),
      secret
    );
  });

  it("maps a non-JSON header to the fixed 401 without exposing submitted content", () => {
    const secret = "TOP-SECRET";
    const now = Math.floor(Date.now() / 1000);
    const header = Buffer.from(secret).toString("base64url");
    const payload = encode({ sub: "user-1", type: "access", iat: now, exp: now + 60 });

    expectFixedUnauthorized(
      () => service.verifyAccessToken(`${header}.${payload}.signature`),
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
    { label: "alg none", header: { alg: "none", typ: "JWT" } },
    { label: "wrong typ", header: { alg: "HS256", typ: "NOT-JWT" } },
    { label: "array header", header: [] },
    { label: "extra header field", header: { alg: "HS256", typ: "JWT", kid: "key-1" } }
  ])("rejects a signed token with $label using the fixed 401", ({ header }) => {
    const now = Math.floor(Date.now() / 1000);
    const token = tokenWithHeaderAndPayload(header, {
      sub: "user-1",
      type: "access",
      iat: now,
      exp: now + 60
    });

    expectFixedUnauthorized(() => service.verifyAccessToken(token));
  });

  it("rejects non-canonical header and payload segments using the fixed 401", () => {
    const now = Math.floor(Date.now() / 1000);
    const canonical = tokenWithPayload({
      sub: "user-1",
      type: "access",
      iat: now,
      exp: now + 60
    });
    const [header, payload, signature] = canonical.split(".");

    expectFixedUnauthorized(() => service.verifyAccessToken(`${header}=.${payload}.${signature}`));
    expectFixedUnauthorized(() => service.verifyAccessToken(`${header}.${payload}=.${signature}`));
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

  it.each([
    {
      label: "subject with surrounding whitespace",
      payload: { sub: " user-1 ", type: "access" }
    },
    { label: "non-string name", payload: { sub: "user-1", name: 123, type: "access" } },
    {
      label: "invalid phone type",
      payload: { sub: "user-1", phone: { value: "13800000000" }, type: "access" }
    },
    { label: "negative issued-at", payload: { sub: "user-1", type: "access", iat: -1 } },
    {
      label: "unsafe issued-at integer",
      payload: { sub: "user-1", type: "access", iat: Number.MAX_SAFE_INTEGER + 1 }
    },
    {
      label: "future issued-at",
      payload: { sub: "user-1", type: "access", iatOffset: 60 }
    },
    { label: "expiry equal to issued-at", payload: { sub: "user-1", type: "access", expOffset: 0 } },
    { label: "expired token", payload: { sub: "user-1", type: "access", expOffset: -1 } }
  ])("rejects a signed token with $label using the fixed 401", ({ payload }) => {
    const now = Math.floor(Date.now() / 1000);
    const values = payload as Record<string, unknown>;
    const { iatOffset, expOffset, ...claims } = values;
    const iat = typeof iatOffset === "number" ? now + iatOffset : (values.iat ?? now);
    const exp = typeof expOffset === "number" ? Number(iat) + expOffset : now + 60;
    const tokenPayload = { ...claims, iat, exp };

    expectFixedUnauthorized(() => service.verifyAccessToken(tokenWithPayload(tokenPayload)));
  });

  it("rejects extra payload claims without exposing them", () => {
    const now = Math.floor(Date.now() / 1000);
    const secret = "TOP-SECRET";
    const token = tokenWithPayload({
      sub: "user-1",
      type: "access",
      iat: now,
      exp: now + 60,
      internalSecret: secret
    });

    expectFixedUnauthorized(() => service.verifyAccessToken(token), secret);
  });

  it("maps an incorrect signature and an expired token to the fixed 401", () => {
    const now = Math.floor(Date.now() / 1000);
    const token = tokenWithPayload({
      sub: "user-1",
      type: "access",
      iat: now,
      exp: now + 60
    });
    const [header, payload] = token.split(".");
    const expired = tokenWithPayload({
      sub: "user-1",
      type: "access",
      iat: now - 120,
      exp: now - 60
    });

    expectFixedUnauthorized(() => service.verifyAccessToken(`${header}.${payload}.wrong`));
    expectFixedUnauthorized(() => service.verifyAccessToken(expired));
  });

  it("rejects refresh tokens when access tokens are required", () => {
    const token = service.signRefreshToken({
      id: "user-1",
      name: "测试用户",
      phone: "13800000000"
    });

    expect(() => service.verifyAccessToken(token)).toThrow("登录凭证类型不正确，请重新登录");
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
