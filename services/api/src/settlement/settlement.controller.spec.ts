import "reflect-metadata";
import { IS_PUBLIC_KEY } from "../auth/decorators/public.decorator";
import { REQUIRED_PROJECT_ACTION_KEY } from "../auth/decorators/require-project-role.decorator";
import { SettlementController } from "./settlement.controller";

describe("SettlementController authorization wiring", () => {
  it("is not publicly accessible (auth guard must run)", () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, SettlementController)).toBeFalsy();
  });

  it.each([
    ["reviewApproval", "settlement.approve"],
    ["uploadArchiveFile", "settlement.archive.upload"],
    ["confirmArchiveFile", "settlement.archive.confirm"]
  ])("guards %s with the %s action", (method, action) => {
    const handler = (SettlementController.prototype as unknown as Record<string, object>)[method];

    expect(Reflect.getMetadata(REQUIRED_PROJECT_ACTION_KEY, handler)).toBe(action);
  });
});
