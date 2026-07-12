import "reflect-metadata";
import { REQUIRED_POSITIONS_KEY } from "../auth/decorators/require-positions.decorator";
import { REQUIRED_PROJECT_ACTION_KEY } from "../auth/decorators/require-project-role.decorator";
import {
  CreateSettlementTemplateDto,
  UpdateSettlementTemplateVersionDto
} from "./dto/settlement-template.dto";
import {
  SettlementTemplateGovernanceController,
  SettlementTemplateRecommendationController
} from "./settlement-template.controller";

describe("Settlement template controllers", () => {
  it("restricts governance to contract director or global super admin and keeps runtime DTOs", () => {
    expect(
      Reflect.getMetadata(REQUIRED_POSITIONS_KEY, SettlementTemplateGovernanceController)
    ).toEqual(["contract_director", "super_admin"]);
    const createTypes = Reflect.getMetadata(
      "design:paramtypes",
      SettlementTemplateGovernanceController.prototype,
      "create"
    ) as unknown[];
    const updateTypes = Reflect.getMetadata(
      "design:paramtypes",
      SettlementTemplateGovernanceController.prototype,
      "update"
    ) as unknown[];
    expect(createTypes[0]).toBe(CreateSettlementTemplateDto);
    expect(updateTypes[1]).toBe(UpdateSettlementTemplateVersionDto);
  });

  it("protects recommendation reads with settlement.create and project route binding", async () => {
    const recommend = jest.fn().mockResolvedValue({ selectionMode: "automatic" });
    const controller = new SettlementTemplateRecommendationController({ recommend } as never);

    await expect(controller.recommend("project-1", "version-1")).resolves.toEqual({
      selectionMode: "automatic"
    });
    expect(recommend).toHaveBeenCalledWith("project-1", "version-1");
    expect(
      Reflect.getMetadata(
        REQUIRED_PROJECT_ACTION_KEY,
        SettlementTemplateRecommendationController.prototype.recommend
      )
    ).toBe("settlement.create");
  });
});
