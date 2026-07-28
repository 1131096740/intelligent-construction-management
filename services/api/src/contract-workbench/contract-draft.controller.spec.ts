import { ContractDraftController } from "./contract-draft.controller";

describe("ContractDraftController", () => {
  function makeController() {
    const aggregate = {
      getWorkbench: jest.fn().mockResolvedValue({ version: { id: "cv-1" } })
    };
    const editLease = {
      acquire: jest.fn().mockResolvedValue({ token: "lease-token" }),
      heartbeat: jest.fn().mockResolvedValue({ leaseRevision: 1 }),
      takeOver: jest.fn().mockResolvedValue({ token: "replacement-token" }),
      release: jest.fn().mockResolvedValue({ released: true })
    };
    return {
      aggregate,
      editLease,
      controller: new ContractDraftController(
        aggregate as never,
        editLease as never
      )
    };
  }

  it("forwards the exact route version and authenticated user", async () => {
    const { aggregate, controller } = makeController();

    await expect(
      controller.workbench("cv-1", { id: "actor-1" } as never)
    ).resolves.toEqual({ version: { id: "cv-1" } });
    expect(aggregate.getWorkbench).toHaveBeenCalledWith("cv-1", "actor-1");
  });

  it("forwards edit lease acquisition, heartbeat, takeover and release", async () => {
    const { controller, editLease } = makeController();

    await controller.acquireEditLease("cv-1", { id: "owner-1" } as never);
    await controller.heartbeatEditLease("cv-1", "lease-token");
    await controller.takeOverEditLease(
      "cv-1",
      { id: "director-1" } as never,
      { currentPassword: "current-password" }
    );
    await controller.releaseEditLease("cv-1", "replacement-token");

    expect(editLease.acquire).toHaveBeenCalledWith("cv-1", "owner-1");
    expect(editLease.heartbeat).toHaveBeenCalledWith("cv-1", "lease-token");
    expect(editLease.takeOver).toHaveBeenCalledWith("cv-1", "director-1", {
      currentPassword: "current-password"
    });
    expect(editLease.release).toHaveBeenCalledWith(
      "cv-1",
      "replacement-token"
    );
  });
});
