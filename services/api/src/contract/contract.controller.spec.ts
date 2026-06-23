import "reflect-metadata";
import { IS_PUBLIC_KEY } from "../auth/decorators/public.decorator";
import { REQUIRED_PROJECT_ACTION_KEY } from "../auth/decorators/require-project-role.decorator";
import { ContractController } from "./contract.controller";

describe("ContractController authorization wiring", () => {
  it("is not publicly accessible (auth guard must run)", () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, ContractController)).toBeFalsy();
  });

  it.each([
    ["submitApproval", "contract.submit"],
    ["reviewApproval", "contract.approve"],
    ["approveSeal", "contract.seal"],
    ["uploadArchiveFile", "contract.archive.upload"],
    ["confirmArchiveFile", "contract.archive.confirm"]
  ])("guards %s with the %s action", (method, action) => {
    const handler = (ContractController.prototype as unknown as Record<string, object>)[method];

    expect(Reflect.getMetadata(REQUIRED_PROJECT_ACTION_KEY, handler as object)).toBe(action);
  });

  it.each([["withdrawApproval"], ["remindApproval"]])(
    "allows the approval applicant to %s without project approval action metadata",
    (method) => {
      const handler = (ContractController.prototype as unknown as Record<string, object>)[method];

      expect(Reflect.getMetadata(REQUIRED_PROJECT_ACTION_KEY, handler as object)).toBeUndefined();
    }
  );
});
