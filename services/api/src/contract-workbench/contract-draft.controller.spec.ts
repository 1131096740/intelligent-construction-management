import { ContractDraftController } from "./contract-draft.controller";

describe("ContractDraftController", () => {
  it("forwards the exact route version and authenticated user", async () => {
    const aggregate = {
      getWorkbench: jest.fn().mockResolvedValue({ version: { id: "cv-1" } })
    };
    const controller = new ContractDraftController(aggregate as never);

    await expect(
      controller.workbench("cv-1", { id: "actor-1" } as never)
    ).resolves.toEqual({ version: { id: "cv-1" } });
    expect(aggregate.getWorkbench).toHaveBeenCalledWith("cv-1", "actor-1");
  });
});
