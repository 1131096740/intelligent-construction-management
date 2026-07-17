import "reflect-metadata";
import { REQUIRED_PROJECT_ACTION_KEY } from "../auth/decorators/require-project-role.decorator";
import { PreviewSettlementLinesDto } from "./dto/preview-settlement-lines.dto";
import { SettlementWorkbenchController } from "./settlement-workbench.controller";

describe("SettlementWorkbenchController", () => {
  it("protects source lines with settlement.create and delegates by contractVersionId", async () => {
    const sourceLines = jest.fn().mockResolvedValue({ rows: [] });
    const controller = new SettlementWorkbenchController(
      { sourceLines } as never,
      { previewLines: jest.fn() } as never
    );

    await expect(controller.sourceLines("version-1")).resolves.toEqual({ rows: [] });
    expect(sourceLines).toHaveBeenCalledWith("version-1");
    expect(
      Reflect.getMetadata(
        REQUIRED_PROJECT_ACTION_KEY,
        SettlementWorkbenchController.prototype.sourceLines
      )
    ).toBe("settlement.create");
  });

  it("protects canonical preview and delegates without adding unselected rows", async () => {
    const previewLines = jest.fn().mockResolvedValue({ amountCents: "100" });
    const controller = new SettlementWorkbenchController(
      { sourceLines: jest.fn() } as never,
      { previewLines } as never
    );
    const body = {
      settlementLines: [
        { sourceType: "contract_bill_row" as const, contractBillRowId: "row-1", quantity: "1" }
      ]
    };

    await expect(controller.preview("version-1", body)).resolves.toEqual({ amountCents: "100" });
    expect(previewLines).toHaveBeenCalledWith("version-1", body);
    expect(
      Reflect.getMetadata(
        REQUIRED_PROJECT_ACTION_KEY,
        SettlementWorkbenchController.prototype.preview
      )
    ).toBe("settlement.create");
    const parameterTypes = Reflect.getMetadata(
      "design:paramtypes",
      SettlementWorkbenchController.prototype,
      "preview"
    ) as unknown[];
    expect(parameterTypes[1]).toBe(PreviewSettlementLinesDto);
  });

  it("protects project participant options and excludes the applicant in the service", async () => {
    const participantOptions = jest.fn().mockResolvedValue({
      route: "material_mechanical",
      options: []
    });
    const controller = new SettlementWorkbenchController(
      { sourceLines: jest.fn(), participantOptions } as never,
      { previewLines: jest.fn() } as never
    );

    await expect(controller.participantOptions(
      "version-1",
      { id: "contract-staff-1" } as never
    )).resolves.toEqual({ route: "material_mechanical", options: [] });
    expect(participantOptions).toHaveBeenCalledWith("version-1", "contract-staff-1");
    expect(
      Reflect.getMetadata(
        REQUIRED_PROJECT_ACTION_KEY,
        SettlementWorkbenchController.prototype.participantOptions
      )
    ).toBe("settlement.create");
  });
});
