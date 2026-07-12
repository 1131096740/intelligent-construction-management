import "reflect-metadata";
import { REQUIRED_PROJECT_ACTION_KEY } from "../auth/decorators/require-project-role.decorator";
import { PreviewSettlementImportDto } from "./dto/preview-settlement-import.dto";
import { SettlementImportController } from "./settlement-import.controller";

describe("SettlementImportController", () => {
  it("uses a runtime DTO and settlement.create guard for import preview", async () => {
    const previewImport = jest.fn().mockResolvedValue({ importId: "import-1" });
    const controller = new SettlementImportController({ previewImport } as never);
    const body = { fileId: "file-1" };

    await expect(
      controller.preview("version-1", { id: "user-1" } as never, body)
    ).resolves.toEqual({ importId: "import-1" });
    expect(previewImport).toHaveBeenCalledWith("version-1", "user-1", body);
    expect(
      Reflect.getMetadata(
        REQUIRED_PROJECT_ACTION_KEY,
        SettlementImportController.prototype.preview
      )
    ).toBe("settlement.create");
    const parameterTypes = Reflect.getMetadata(
      "design:paramtypes",
      SettlementImportController.prototype,
      "preview"
    ) as unknown[];
    expect(parameterTypes[2]).toBe(PreviewSettlementImportDto);
  });

  it("keeps apply bound to the guarded project route", async () => {
    const applyImport = jest.fn().mockResolvedValue({ status: "applied" });
    const controller = new SettlementImportController({ applyImport } as never);

    await expect(
      controller.apply("project-1", "import-1", { id: "user-1" } as never)
    ).resolves.toEqual({ status: "applied" });
    expect(applyImport).toHaveBeenCalledWith("project-1", "import-1", "user-1");
    expect(
      Reflect.getMetadata(REQUIRED_PROJECT_ACTION_KEY, SettlementImportController.prototype.apply)
    ).toBe("settlement.create");
  });

  it("uses the business filename returned by the service for download headers", async () => {
    const buffer = Buffer.from("xlsx");
    const exportTemplate = jest.fn().mockResolvedValue({
      buffer,
      fileName: "本期结算导入模板.xlsx"
    });
    const controller = new SettlementImportController({ exportTemplate } as never);
    const set = jest.fn();

    await controller.downloadTemplate(
      "version-1",
      { id: "user-1" } as never,
      { set }
    );

    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({
        "Content-Disposition": expect.stringContaining(
          "filename*=UTF-8''%E6%9C%AC%E6%9C%9F%E7%BB%93%E7%AE%97%E5%AF%BC%E5%85%A5%E6%A8%A1%E6%9D%BF.xlsx"
        )
      })
    );
    expect(JSON.stringify(set.mock.calls)).not.toContain("version-1");
  });
});
