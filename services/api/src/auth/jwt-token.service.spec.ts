import { UnauthorizedException } from "@nestjs/common";
import { JwtTokenService } from "./jwt-token.service";

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
