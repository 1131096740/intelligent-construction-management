import { UnauthorizedException } from "@nestjs/common";
import { JwtTokenService } from "./jwt-token.service";

describe("JwtTokenService", () => {
  const service = new JwtTokenService();

  beforeEach(() => {
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
});
