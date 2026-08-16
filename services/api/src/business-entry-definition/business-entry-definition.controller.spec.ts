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

  it("passes trusted upload metadata with the buffer to the Excel safety boundary", () => {
    const excel = { preview: jest.fn().mockReturnValue({ zeroWrites: true, rows: [] }) };
    const controller = new BusinessEntryDefinitionController({} as never, excel as never);
    const file = {
      originalname: "费用明细.xlsx",
      mimetype: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      size: 4,
      buffer: Buffer.from([0x50, 0x4b, 0x03, 0x04])
    };

    controller.previewExcel(
      "expense_line",
      "project-1",
      { id: "user-1" } as never,
      {
        definitionVersion: 3,
        targetEntityType: "operating_takeover_row",
        targetEntityId: "project-1"
      },
      file
    );

    expect(excel.preview).toHaveBeenCalledWith(
      "expense_line",
      "project-1",
      "user-1",
      {
        definitionVersion: 3,
        target: { entityType: "operating_takeover_row", entityId: "project-1" }
      },
      file
    );
  });
});
