import type { ExecutionContext } from "@nestjs/common";
import { currentUserFactory } from "./current-user.decorator";

function mockContext(request: unknown): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request })
  } as unknown as ExecutionContext;
}

describe("currentUserFactory", () => {
  it("returns the authenticated user attached by the auth guard", () => {
    const user = { id: "u1", name: "合同部 李工", phone: "13800000001" };

    expect(currentUserFactory(undefined, mockContext({ user }))).toBe(user);
  });

  it("rejects requests without an authenticated user", () => {
    expect(() => currentUserFactory(undefined, mockContext({}))).toThrow(
      "未获取到登录用户，请重新登录"
    );
  });
});
