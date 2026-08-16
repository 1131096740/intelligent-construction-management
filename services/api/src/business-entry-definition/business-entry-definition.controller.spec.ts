import { Reflector } from "@nestjs/core";
import { REQUIRED_PROJECT_ACTION_KEY } from "../auth/decorators/require-project-role.decorator";
import { BusinessEntryDefinitionController } from "./business-entry-definition.controller";

describe("BusinessEntryDefinitionController", () => {
  it("guards validation and freeze with the project operating-profile action", () => {
    const reflector = new Reflector();

    expect(
      reflector.get(
        REQUIRED_PROJECT_ACTION_KEY,
        BusinessEntryDefinitionController.prototype.getSceneDefinition
      )
    ).toBe("project.operating_profile.manage");
    expect(
      reflector.get(
        REQUIRED_PROJECT_ACTION_KEY,
        BusinessEntryDefinitionController.prototype.validateDraft
      )
    ).toBe("project.operating_profile.manage");
    expect(
      reflector.get(
        REQUIRED_PROJECT_ACTION_KEY,
        BusinessEntryDefinitionController.prototype.freezeSubmissionSnapshot
      )
    ).toBe("project.operating_profile.manage");
    expect(
      reflector.get(
        REQUIRED_PROJECT_ACTION_KEY,
        BusinessEntryDefinitionController.prototype.downloadExcelTemplate
      )
    ).toBe("project.operating_profile.manage");
    expect(
      reflector.get(
        REQUIRED_PROJECT_ACTION_KEY,
        BusinessEntryDefinitionController.prototype.previewExcel
      )
    ).toBe("project.operating_profile.manage");
  });
});
