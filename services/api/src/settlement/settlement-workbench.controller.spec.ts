import "reflect-metadata";
import { REQUIRED_PROJECT_ACTION_KEY } from "../auth/decorators/require-project-role.decorator";
import { SettlementWorkbenchController } from "./settlement-workbench.controller";

describe("SettlementWorkbenchController", () => {
  it("protects source lines with settlement.create and delegates by contractVersionId", async () => {
    const sourceLines = jest.fn().mockResolvedValue({ rows: [] });
    const controller = new SettlementWorkbenchController({ sourceLines } as never);

    await expect(controller.sourceLines("version-1")).resolves.toEqual({ rows: [] });
    expect(sourceLines).toHaveBeenCalledWith("version-1");
    expect(
      Reflect.getMetadata(
        REQUIRED_PROJECT_ACTION_KEY,
        SettlementWorkbenchController.prototype.sourceLines
      )
    ).toBe("settlement.create");
  });
});
