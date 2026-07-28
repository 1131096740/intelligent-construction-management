import { ContractDraftController } from "./contract-draft.controller";
import { RequestMethod } from "@nestjs/common";
import { METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";

describe("ContractDraftController", () => {
  function makeController() {
    const aggregate = {
      getWorkbench: jest.fn().mockResolvedValue({ version: { id: "cv-1" } }),
      saveAggregate: jest.fn().mockResolvedValue({
        contractVersionId: "cv-1",
        draftRevision: 8
      })
    };
    const editLease = {
      acquire: jest.fn().mockResolvedValue({ token: "lease-token" }),
      heartbeat: jest.fn().mockResolvedValue({ leaseRevision: 1 }),
      takeOver: jest.fn().mockResolvedValue({ token: "replacement-token" }),
      release: jest.fn().mockResolvedValue({ released: true })
    };
    const contracts = {
      abandonDraft: jest.fn().mockResolvedValue({
        contractVersionId: "cv-1",
        status: "abandoned",
        lifecycleKind: "pristine_draft"
      })
    };
    return {
      aggregate,
      editLease,
      contracts,
      controller: new ContractDraftController(
        aggregate as never,
        editLease as never,
        contracts as never
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

  it("forwards the global aggregate save with the opaque lease token", async () => {
    const { aggregate, controller } = makeController();
    const body = {
      idempotencyKey: "7ea6e68d-18cd-4ca7-83b8-99e7d1457125",
      expectedRevision: 7
    };

    await expect(
      controller.saveDraft(
        "cv-1",
        "opaque-lease-token",
        body as never,
        { id: "owner-1" } as never
      )
    ).resolves.toEqual({
      contractVersionId: "cv-1",
      draftRevision: 8
    });
    expect(aggregate.saveAggregate).toHaveBeenCalledWith(
      "cv-1",
      "owner-1",
      "opaque-lease-token",
      body
    );
  });

  it("publishes the global save and daily delete on their exact HTTP contracts", () => {
    expect(
      Reflect.getMetadata(
        METHOD_METADATA,
        ContractDraftController.prototype.saveDraft
      )
    ).toBe(RequestMethod.PUT);
    expect(
      Reflect.getMetadata(
        PATH_METADATA,
        ContractDraftController.prototype.saveDraft
      )
    ).toBe(":contractVersionId");
    expect(
      Reflect.getMetadata(
        METHOD_METADATA,
        ContractDraftController.prototype.deleteDraft
      )
    ).toBe(RequestMethod.DELETE);
    expect(
      Reflect.getMetadata(
        PATH_METADATA,
        ContractDraftController.prototype.deleteDraft
      )
    ).toBe(":contractVersionId");
  });

  it("delegates daily deletion to the existing logical draft lifecycle", async () => {
    const { contracts, controller } = makeController();
    const body = {
      expectedRevision: 7,
      reason: "主管代清理重复测试草稿",
      currentPassword: "current-password"
    };

    await expect(
      controller.deleteDraft("cv-1", body, { id: "director-1" } as never)
    ).resolves.toMatchObject({
      status: "abandoned",
      lifecycleKind: "pristine_draft"
    });
    expect(contracts.abandonDraft).toHaveBeenCalledWith(
      "cv-1",
      "director-1",
      {
        ...body,
        action: "delete_pristine_draft"
      }
    );
  });
});
