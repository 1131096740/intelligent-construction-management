import "reflect-metadata";
import { PATH_METADATA } from "@nestjs/common/constants";
import { REQUIRED_POSITIONS_KEY } from "../auth/decorators/require-positions.decorator";
import { ContractEndedApplicationRetentionController } from "./contract-ended-retention.controller";

describe("ContractEndedApplicationRetentionController", () => {
  const retention = {
    preview: jest.fn(),
    createHold: jest.fn(),
    releaseHold: jest.fn()
  };
  const controller = new ContractEndedApplicationRetentionController(retention as never);

  it("restricts the preview and hold routes to the contract director", () => {
    expect(
      Reflect.getMetadata(REQUIRED_POSITIONS_KEY, ContractEndedApplicationRetentionController)
    ).toEqual(["contract_director"]);
    expect(
      Reflect.getMetadata(PATH_METADATA, ContractEndedApplicationRetentionController)
    ).toBe("contract-ended-retention");
    expect(
      Reflect.getMetadata(PATH_METADATA, ContractEndedApplicationRetentionController.prototype.createHold)
    ).toBe(":contractVersionId/holds");
    expect(
      Reflect.getMetadata(PATH_METADATA, ContractEndedApplicationRetentionController.prototype.releaseHold)
    ).toBe(":contractVersionId/hold-release");
  });

  it("forwards the authenticated director and reason to hold mutations", async () => {
    retention.createHold.mockResolvedValue({ holdCreated: true });
    retention.releaseHold.mockResolvedValue({ holdReleased: true });
    const user = { id: "director-1" };
    const body = { reason: "存在争议" };

    await expect(controller.createHold("version-1", body, user as never)).resolves.toEqual({
      holdCreated: true
    });
    await expect(controller.releaseHold("version-1", body, user as never)).resolves.toEqual({
      holdReleased: true
    });
    expect(retention.createHold).toHaveBeenCalledWith("version-1", "director-1", body);
    expect(retention.releaseHold).toHaveBeenCalledWith("version-1", "director-1", body);
  });
});
