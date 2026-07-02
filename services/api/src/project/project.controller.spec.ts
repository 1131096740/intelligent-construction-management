import "reflect-metadata";
import { REQUIRED_POSITIONS_KEY } from "../auth/decorators/require-positions.decorator";
import { ProjectController } from "./project.controller";

describe("ProjectController authorization wiring", () => {
  const fundsOverviewPositions = [
    "chairman",
    "general_manager",
    "project_manager",
    "finance_director",
    "finance_staff"
  ];

  it("lets project list rely on authentication plus service-level project visibility", () => {
    expect(Reflect.getMetadata(REQUIRED_POSITIONS_KEY, ProjectController.prototype.list)).toBeUndefined();
  });

  it("guards project overview with funds overview positions so project-scoped roles see :projectId", () => {
    expect(Reflect.getMetadata(REQUIRED_POSITIONS_KEY, ProjectController.prototype.operatingFundsOverview)).toEqual(
      fundsOverviewPositions
    );
  });

  it("guards project receipt recording with finance project role", () => {
    expect(Reflect.getMetadata("requiredProjectAction", ProjectController.prototype.recordReceipt)).toBe(
      "project.receipt.record"
    );
  });

  it("guards project proxy payment recording with finance project role", () => {
    expect(
      Reflect.getMetadata("requiredProjectAction", ProjectController.prototype.recordProxyPayment)
    ).toBe("project.proxy_payment.record");
  });

  it("guards project upstream settlement recording with budget project role", () => {
    expect(
      Reflect.getMetadata("requiredProjectAction", ProjectController.prototype.recordUpstreamSettlement)
    ).toBe("project.upstream_settlement.record");
  });

  it("forwards the authenticated user id when listing projects", async () => {
    const projects = { listActiveOptions: jest.fn() };
    const controller = new ProjectController(projects as never);

    await controller.list({ id: "user-1" } as never);

    expect(projects.listActiveOptions).toHaveBeenCalledWith("user-1");
  });

  it("forwards overview project id to the service", async () => {
    const projects = { getOperatingFundsOverview: jest.fn() };
    const controller = new ProjectController(projects as never);

    await controller.operatingFundsOverview("project-1");

    expect(projects.getOperatingFundsOverview).toHaveBeenCalledWith("project-1");
  });

  it("forwards project receipt payload with authenticated user id", async () => {
    const projects = { recordReceipt: jest.fn() };
    const controller = new ProjectController(projects as never);
    const body = {
      receivedAt: "2026-07-02T00:00:00.000Z",
      amountCents: 100000,
      payerName: "总包单位",
      sourceType: "general_contractor_payment" as const,
      voucherFileId: "file-1",
      confirmationPassword: "current-password"
    };

    await controller.recordReceipt("project-1", { id: "finance-1" } as never, body);

    expect(projects.recordReceipt).toHaveBeenCalledWith("project-1", "finance-1", body);
  });

  it("forwards project proxy payment payload with authenticated user id", async () => {
    const projects = { recordProxyPayment: jest.fn() };
    const controller = new ProjectController(projects as never);
    const body = {
      paidAt: "2026-07-02T00:00:00.000Z",
      amountCents: 100000,
      generalContractorName: "总包单位",
      paidTargetName: "材料供应商",
      paymentType: "material" as const,
      voucherFileId: "file-1",
      confirmationPassword: "current-password"
    };

    await controller.recordProxyPayment("project-1", { id: "finance-1" } as never, body);

    expect(projects.recordProxyPayment).toHaveBeenCalledWith(
      "project-1",
      "finance-1",
      body
    );
  });

  it("forwards project upstream settlement payload with authenticated user id", async () => {
    const projects = { recordUpstreamSettlement: jest.fn() };
    const controller = new ProjectController(projects as never);
    const body = {
      settledAt: "2026-07-02T00:00:00.000Z",
      reportedAmountCents: 120000,
      approvedAmountCents: 100000,
      approvingPartyName: "总包单位",
      periodLabel: "2026-06",
      isFinal: false,
      voucherFileId: "file-1",
      confirmationPassword: "current-password"
    };

    await controller.recordUpstreamSettlement("project-1", { id: "budget-1" } as never, body);

    expect(projects.recordUpstreamSettlement).toHaveBeenCalledWith(
      "project-1",
      "budget-1",
      body
    );
  });
});
