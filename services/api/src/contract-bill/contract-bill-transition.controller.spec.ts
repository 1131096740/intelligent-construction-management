import { REQUIRED_PROJECT_ACTION_KEY } from "../auth/decorators/require-project-role.decorator";
import { ContractBillTransitionController } from "./contract-bill-transition.controller";

describe("ContractBillTransitionController project guard", () => {
  it.each(["save", "confirm", "discard"])(
    "requires contract.create for %s",
    (handler) => {
      expect(Reflect.getMetadata(
        REQUIRED_PROJECT_ACTION_KEY,
        ContractBillTransitionController.prototype[
          handler as keyof ContractBillTransitionController
        ]
      )).toBe("contract.create");
    }
  );
});
