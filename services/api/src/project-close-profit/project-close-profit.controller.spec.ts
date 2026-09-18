import { ProjectCloseProfitController } from "./project-close-profit.controller";

describe("ProjectCloseProfitController", () => {
  it("delegates every public command with the authenticated user and project scope", async () => {
    const service = {
      getWorkbench: jest.fn().mockResolvedValue({}),
      completeStage: jest.fn().mockResolvedValue({}),
      attestDownstreamCost: jest.fn().mockResolvedValue({}),
      submitFinalProfit: jest.fn().mockResolvedValue({}),
      confirmFinalProfit: jest.fn().mockResolvedValue({}),
      createTemporaryDistribution: jest.fn().mockResolvedValue({}),
      reconcileImpacts: jest.fn().mockResolvedValue({}),
      submitDistribution: jest.fn().mockResolvedValue({}),
      confirmDistribution: jest.fn().mockResolvedValue({})
    };
    const controller = new ProjectCloseProfitController(service as never);
    const user = { id: "user-1" } as never;
    const base = {
      expectedProjectionFingerprint: "fingerprint",
      idempotencyKey: "2a648f91-5085-4dad-b6fb-d5b9aac5d9f7",
      basis: { summary: "确认依据", evidenceFileIds: [] }
    };

    await controller.getWorkbench(user, "project-1");
    await controller.completeStage(user, "project-1", "construction_completed", base);
    await controller.attestContractDownstreamCost(user, "project-1", base);
    await controller.attestFinanceDownstreamCost(user, "project-1", base);
    await controller.submitFinalProfit(user, "project-1", base);
    await controller.confirmFinalProfit(user, "project-1", {
      expectedProjectionFingerprint: base.expectedProjectionFingerprint,
      idempotencyKey: base.idempotencyKey,
      submissionId: "3a648f91-5085-4dad-b6fb-d5b9aac5d9f7"
    });
    await controller.createTemporaryDistribution(user, "project-1", {
      ...base,
      projectParticipatingCompanyId: "participant-1",
      amountCents: "1200"
    });
    await controller.reconcileImpacts(user, "project-1", base);
    await controller.submitDistribution(user, "project-1", {
      ...base,
      lines: [{ projectParticipatingCompanyId: "participant-1", finalShareCents: "6000" }]
    });
    await controller.confirmDistribution(user, "project-1", {
      expectedProjectionFingerprint: base.expectedProjectionFingerprint,
      idempotencyKey: base.idempotencyKey,
      submissionId: "4a648f91-5085-4dad-b6fb-d5b9aac5d9f7"
    });

    expect(service.getWorkbench).toHaveBeenCalledWith("user-1", "project-1");
    expect(service.completeStage).toHaveBeenCalledWith("user-1", "project-1", {
      ...base,
      stageKey: "construction_completed"
    });
    expect(service.attestDownstreamCost).toHaveBeenCalledWith("user-1", "project-1", {
      ...base,
      specialty: "contract"
    });
    expect(service.attestDownstreamCost).toHaveBeenCalledWith("user-1", "project-1", {
      ...base,
      specialty: "finance"
    });
    expect(service.submitFinalProfit).toHaveBeenCalledWith("user-1", "project-1", base);
    expect(service.confirmFinalProfit).toHaveBeenCalledWith(
      "user-1",
      "project-1",
      expect.objectContaining({ submissionId: expect.any(String) })
    );
    expect(service.createTemporaryDistribution).toHaveBeenCalledWith(
      "user-1",
      "project-1",
      expect.objectContaining({ amountCents: "1200" })
    );
    expect(service.reconcileImpacts).toHaveBeenCalledWith("user-1", "project-1", base);
    expect(service.submitDistribution).toHaveBeenCalledWith(
      "user-1",
      "project-1",
      expect.objectContaining({ lines: expect.any(Array) })
    );
    expect(service.confirmDistribution).toHaveBeenCalledWith(
      "user-1",
      "project-1",
      expect.objectContaining({ submissionId: expect.any(String) })
    );
  });
});
