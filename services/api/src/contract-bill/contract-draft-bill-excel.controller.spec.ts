import "reflect-metadata";
import { PATH_METADATA } from "@nestjs/common/constants";
import type { AuthenticatedUser } from "../auth/auth.types";
import { ContractDraftBillExcelController } from "./contract-draft-bill-excel.controller";

describe("ContractDraftBillExcelController", () => {
  const user = { id: "owner-1" } as AuthenticatedUser;

  it("downloads a template by exact contract version and bill key", async () => {
    const buffer = Buffer.from("xlsx");
    const excel = {
      exportDraftTemplate: jest.fn().mockResolvedValue({
        buffer,
        fileName: "主合同清单-清单导入模板.xlsx"
      })
    };
    const controller = new ContractDraftBillExcelController(excel as never);
    const set = jest.fn();

    await controller.downloadTemplate("version-1", "main_bill", user, { set });

    expect(excel.exportDraftTemplate).toHaveBeenCalledWith(
      "version-1",
      "main_bill",
      "owner-1"
    );
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({
        "Content-Disposition": expect.stringContaining("filename*=UTF-8''")
      })
    );
    expect(
      Reflect.getMetadata(
        PATH_METADATA,
        ContractDraftBillExcelController.prototype.downloadTemplate
      )
    ).toBe("contract-drafts/:contractVersionId/bills/:billKey/template");
  });

  it("previews candidates without exposing a legacy apply command", async () => {
    const preview = {
      billKey: "main_bill",
      targetBillRevision: 7,
      rows: [{ clientRowKey: "import-1", itemName: "钢筋" }],
      errors: []
    };
    const excel = {
      previewDraftImport: jest.fn().mockResolvedValue(preview),
      applyImport: jest.fn()
    };
    const controller = new ContractDraftBillExcelController(excel as never);
    const body = { fileId: "file-1" };

    await expect(
      controller.previewImport("version-1", "main_bill", user, body)
    ).resolves.toEqual(preview);
    expect(excel.previewDraftImport).toHaveBeenCalledWith(
      "version-1",
      "main_bill",
      "owner-1",
      body
    );
    expect(excel.applyImport).not.toHaveBeenCalled();
    expect(
      Reflect.getMetadata(
        PATH_METADATA,
        ContractDraftBillExcelController.prototype.previewImport
      )
    ).toBe("contract-drafts/:contractVersionId/bills/:billKey/import-preview");
  });
});
