import { Reflector } from "@nestjs/core";
import { REQUIRED_PROJECT_ACTION_KEY } from "../auth/decorators/require-project-role.decorator";
import { BusinessEntryDefinitionController } from "./business-entry-definition.controller";

describe("BusinessEntryDefinitionController", () => {
  it("does not pin any unified-entry route to the project operating-profile action", () => {
    const reflector = new Reflector();

    for (const handler of [
      BusinessEntryDefinitionController.prototype.getSceneDefinition,
      BusinessEntryDefinitionController.prototype.validateDraft,
      BusinessEntryDefinitionController.prototype.freezeSubmissionSnapshot,
      BusinessEntryDefinitionController.prototype.downloadExcelTemplate,
      BusinessEntryDefinitionController.prototype.previewExcel
    ]) {
      expect(reflector.get(
        REQUIRED_PROJECT_ACTION_KEY,
        handler
      )).toBeUndefined();
    }
  });

  it("passes a global target without inventing a project scope", async () => {
    const definitions = {
      getSceneDefinitionForOperation: jest.fn().mockResolvedValue({ key: "company_profile" }),
      validateDraft: jest.fn().mockResolvedValue({ valid: true }),
      freezeSubmissionSnapshot: jest.fn().mockResolvedValue({ sceneKey: "company_profile" })
    };
    const excel = {
      exportTemplate: jest.fn().mockResolvedValue({ buffer: Buffer.from("xlsx"), fileName: "我方公司.xlsx" }),
      preview: jest.fn().mockResolvedValue({ zeroWrites: true, rows: [] })
    };
    const controller = new BusinessEntryDefinitionController(definitions as never, excel as never);
    const user = { id: "user-1" } as never;
    const target = {
      definitionVersion: 1,
      target: { entityType: "company_entity", entityId: "company-1" },
      values: { name: "我方公司" }
    };

    await controller.downloadExcelTemplate(
      "company_profile",
      undefined,
      user,
      { set: jest.fn() }
    );
    await controller.getSceneDefinition("company_profile", undefined, "edit", user);
    await controller.validateDraft("company_profile", undefined, target, user);
    await controller.freezeSubmissionSnapshot("company_profile", undefined, target, user);
    const file = {
      originalname: "我方公司.xlsx",
      mimetype: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      size: 4,
      buffer: Buffer.from([0x50, 0x4b, 0x03, 0x04])
    };
    controller.previewExcel(
      "company_profile",
      undefined,
      user,
      {
        definitionVersion: 1,
        targetEntityType: "company_entity",
        targetEntityId: "company-1"
      },
      file
    );

    expect(excel.exportTemplate).toHaveBeenCalledWith("company_profile", undefined, "user-1");
    expect(definitions.getSceneDefinitionForOperation).toHaveBeenCalledWith(
      "company_profile",
      undefined,
      "user-1",
      "edit"
    );
    expect(definitions.validateDraft).toHaveBeenCalledWith(
      "company_profile",
      undefined,
      "user-1",
      target
    );
    expect(definitions.freezeSubmissionSnapshot).toHaveBeenCalledWith(
      "company_profile",
      undefined,
      "user-1",
      target
    );
    expect(excel.preview).toHaveBeenCalledWith(
      "company_profile",
      undefined,
      "user-1",
      {
        definitionVersion: 1,
        target: { entityType: "company_entity", entityId: "company-1" }
      },
      file
    );
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
