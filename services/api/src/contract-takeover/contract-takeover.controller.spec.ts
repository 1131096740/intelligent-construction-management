import { REQUIRED_PROJECT_ACTION_KEY } from "../auth/decorators/require-project-role.decorator";
import { ContractTakeoverController } from "./contract-takeover.controller";

describe("ContractTakeoverController", () => {
  function expectProjectAction(handler: object, action: string) {
    expect(Reflect.getMetadata(REQUIRED_PROJECT_ACTION_KEY, handler)).toBe(action);
  }

  it("protects create and submit with contract staff project roles", () => {
    expectProjectAction(ContractTakeoverController.prototype.create, "contract.create");
    expectProjectAction(ContractTakeoverController.prototype.updateDraft, "contract.create");
    expectProjectAction(ContractTakeoverController.prototype.precheckImport, "contract.create");
    expectProjectAction(ContractTakeoverController.prototype.attachEvidence, "contract.create");
    expectProjectAction(ContractTakeoverController.prototype.submitReview, "contract.submit");
  });

  it("protects confirmation with contract archive confirmation role", () => {
    expectProjectAction(
      ContractTakeoverController.prototype.confirm,
      "contract.archive.confirm"
    );
  });
});
