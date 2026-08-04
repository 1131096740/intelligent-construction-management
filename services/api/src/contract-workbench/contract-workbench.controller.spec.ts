import { REQUIRED_PROJECT_ACTION_KEY } from "../auth/decorators/require-project-role.decorator";
import { ContractWorkbenchController } from "./contract-workbench.controller";

describe("ContractWorkbenchController project guards", () => {
  it.each([
    "confirmSettlementMode",
    "previewTypeChange",
    "applyTypeChange",
    "transferCapability",
    "transfer"
  ] as const)("guards %s with contract.create", (method) => {
    expect(
      Reflect.getMetadata(
        REQUIRED_PROJECT_ACTION_KEY,
        ContractWorkbenchController.prototype[method]
      )
    ).toBe("contract.create");
  });
});
