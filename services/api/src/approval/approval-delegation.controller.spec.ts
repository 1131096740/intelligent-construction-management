import "reflect-metadata";
import { IS_PUBLIC_KEY } from "../auth/decorators/public.decorator";
import { REQUIRED_PROJECT_ACTION_KEY } from "../auth/decorators/require-project-role.decorator";
import { ApprovalDelegationController } from "./approval-delegation.controller";

describe("ApprovalDelegationController authorization wiring", () => {
  it("is not publicly accessible (auth guard must run)", () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, ApprovalDelegationController)).toBeFalsy();
  });

  it.each([["create"], ["list"], ["revoke"]])(
    "lets any authenticated user manage their own delegations without project approval action metadata for %s",
    (method) => {
      const handler = (ApprovalDelegationController.prototype as unknown as Record<string, object>)[
        method
      ];

      expect(Reflect.getMetadata(REQUIRED_PROJECT_ACTION_KEY, handler)).toBeUndefined();
    }
  );
});
