import "reflect-metadata";
import { REQUIRED_PROJECT_ACTION_KEY } from "../auth/decorators/require-project-role.decorator";
import { BusinessPartyController } from "./business-party.controller";

describe("BusinessPartyController creation-result recovery", () => {
  it("keeps the read-only recovery route behind the company create capability", () => {
    expect(Reflect.getMetadata(
      REQUIRED_PROJECT_ACTION_KEY,
      BusinessPartyController.prototype.creationResult
    )).toBe("business_party.create");
  });

  it("binds recovery lookup to the authenticated actor", async () => {
    const businessParties = {
      getCreationResult: jest.fn().mockResolvedValue({
        status: "completed",
        partyId: "party-1"
      })
    };
    const controller = new BusinessPartyController(businessParties as never);

    await expect(controller.creationResult(
      "11111111-1111-4111-8111-111111111111",
      "a".repeat(64),
      { id: "staff-1" } as never
    )).resolves.toEqual({ status: "completed", partyId: "party-1" });
    expect(businessParties.getCreationResult).toHaveBeenCalledWith(
      "staff-1",
      "11111111-1111-4111-8111-111111111111",
      "a".repeat(64)
    );
  });
});
