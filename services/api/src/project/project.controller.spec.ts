import "reflect-metadata";
import { REQUIRED_POSITIONS_KEY } from "../auth/decorators/require-positions.decorator";
import { ProjectController } from "./project.controller";

describe("ProjectController authorization wiring", () => {
  type OwnerContractRecordBody = {
    ownerName: string;
    contractName: string;
    contractCode: string;
    signedAt: string;
    amountCents: string;
    taxRateBps: number;
    pricingMethod: string;
    paymentTermsSummary: string;
    retentionSummary: string;
    fileId: string;
  };
  type OwnerContractConfirmBody = { confirmationPassword: string };
  type SettlementExceptionQuotaRequestBody = {
    contractId: string;
    amountCents: string;
    reason: string;
    validUntil: string;
    attachmentFileId: string;
  };
  type SettlementExceptionQuotaReviewBody = {
    decision: "approve" | "reject";
    confirmationPassword: string;
    comment?: string;
  };
  type ProjectFinancingQuotaRequestBody = {
    amountCents: string;
    reason: string;
    validUntil: string;
    attachmentFileId: string;
  };
  type ProjectFinancingQuotaReviewBody = {
    decision: "approve" | "reject";
    confirmationPassword: string;
    comment?: string;
  };

  const fundsOverviewPositions = [
    "chairman",
    "general_manager",
    "project_manager",
    "finance_director",
    "finance_staff"
  ];
  const projectCreatePositions = ["chairman", "general_manager"];

  it("lets project list rely on authentication plus service-level project visibility", () => {
    expect(Reflect.getMetadata(REQUIRED_POSITIONS_KEY, ProjectController.prototype.list)).toBeUndefined();
  });

  it("lets contract creation project options rely on authentication plus service-level action visibility", () => {
    expect(Reflect.getMetadata(REQUIRED_POSITIONS_KEY, ProjectController.prototype.contractCreateOptions)).toBeUndefined();
  });

  it("lets project roster rely on authentication plus service-level project visibility", () => {
    expect(Reflect.getMetadata(REQUIRED_POSITIONS_KEY, ProjectController.prototype.roster)).toBeUndefined();
  });

  it("guards project creation with company decision roles", () => {
    expect(Reflect.getMetadata(REQUIRED_POSITIONS_KEY, ProjectController.prototype.create)).toEqual(
      projectCreatePositions
    );
  });

  it("guards project updates with company decision roles", () => {
    expect(Reflect.getMetadata(REQUIRED_POSITIONS_KEY, ProjectController.prototype.update)).toEqual(
      projectCreatePositions
    );
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

  it("guards project owner contract recording and confirmation with contract project roles", () => {
    expect(
      Reflect.getMetadata(
        "requiredProjectAction",
        (ProjectController.prototype as never as { recordOwnerContract: object }).recordOwnerContract
      )
    ).toBe("project.owner_contract.record");
    expect(
      Reflect.getMetadata(
        "requiredProjectAction",
        (ProjectController.prototype as never as { confirmOwnerContract: object }).confirmOwnerContract
      )
    ).toBe("project.owner_contract.confirm");
  });

  it("guards settlement exception quota request and approval with project roles", () => {
    expect(
      Reflect.getMetadata(
        "requiredProjectAction",
        (ProjectController.prototype as never as { requestSettlementExceptionQuota: object })
          .requestSettlementExceptionQuota
      )
    ).toBe("project.settlement_exception_quota.request");
    expect(
      Reflect.getMetadata(
        "requiredProjectAction",
        (ProjectController.prototype as never as { reviewSettlementExceptionQuota: object })
          .reviewSettlementExceptionQuota
      )
    ).toBe("project.settlement_exception_quota.approve");
  });

  it("guards project financing quota request and approval with project roles", () => {
    expect(
      Reflect.getMetadata(
        "requiredProjectAction",
        (ProjectController.prototype as never as { requestProjectFinancingQuota: object })
          .requestProjectFinancingQuota
      )
    ).toBe("project.financing_quota.request");
    expect(
      Reflect.getMetadata(
        "requiredProjectAction",
        (ProjectController.prototype as never as { reviewProjectFinancingQuota: object })
          .reviewProjectFinancingQuota
      )
    ).toBe("project.financing_quota.approve");
  });

  it("forwards the authenticated user id when listing projects", async () => {
    const projects = { listActiveOptions: jest.fn() };
    const controller = new ProjectController(projects as never);

    await controller.list({ id: "user-1" } as never);

    expect(projects.listActiveOptions).toHaveBeenCalledWith("user-1");
  });

  it("forwards project creation payload with authenticated user id", async () => {
    const projects = { createProject: jest.fn() };
    const controller = new ProjectController(projects as never);
    const body = { code: "KM-2023-001", name: "昆明项目" };

    await controller.create({ id: "chairman-1" } as never, body);

    expect(projects.createProject).toHaveBeenCalledWith("chairman-1", body);
  });

  it("forwards project update payload with authenticated user id", async () => {
    const projects = { updateProject: jest.fn() };
    const controller = new ProjectController(projects as never);
    const body = { name: "昆明项目" };

    await controller.update("project-1", { id: "chairman-1" } as never, body);

    expect(projects.updateProject).toHaveBeenCalledWith("project-1", "chairman-1", body);
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
      amountCents: "100000",
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
      amountCents: "100000",
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
      reportedAmountCents: "120000",
      approvedAmountCents: "100000",
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

  it("forwards project owner contract record payload with authenticated user id", async () => {
    const projects = { recordOwnerContract: jest.fn() };
    const controller = new ProjectController(projects as never);
    const body = {
      ownerName: "建设单位",
      contractName: "一期施工总承包合同",
      contractCode: "YZ-2026-001",
      signedAt: "2026-07-02T00:00:00.000Z",
      amountCents: "200000000",
      taxRateBps: 900,
      pricingMethod: "fixed_total",
      paymentTermsSummary: "按进度支付",
      retentionSummary: "3%质保金",
      fileId: "file-1"
    };

    await (controller as never as {
      recordOwnerContract: (
        projectId: string,
        user: { id: string },
        body: OwnerContractRecordBody
      ) => Promise<unknown>;
    }).recordOwnerContract("project-1", { id: "contract-staff-1" }, body);

    expect(projects.recordOwnerContract).toHaveBeenCalledWith(
      "project-1",
      "contract-staff-1",
      body
    );
  });

  it("forwards project owner contract confirmation metadata and actor", async () => {
    const projects = { confirmOwnerContract: jest.fn() };
    const controller = new ProjectController(projects as never);
    const body = { confirmationPassword: "current-password" };

    await (controller as never as {
      confirmOwnerContract: (
        projectId: string,
        ownerContractId: string,
        user: { id: string },
        body: OwnerContractConfirmBody
      ) => Promise<unknown>;
    }).confirmOwnerContract("project-1", "owner-contract-1", { id: "director-1" }, body);

    expect(projects.confirmOwnerContract).toHaveBeenCalledWith(
      "project-1",
      "owner-contract-1",
      "director-1",
      body
    );
  });

  it("forwards settlement exception quota request payload with authenticated user id", async () => {
    const projects = { requestSettlementExceptionQuota: jest.fn() };
    const controller = new ProjectController(projects as never);
    const body = {
      contractId: "contract-1",
      amountCents: "1000000",
      reason: "对上审定暂未覆盖本期必要结算",
      validUntil: "2099-07-02T00:00:00.000Z",
      attachmentFileId: "file-1"
    };

    await (controller as never as {
      requestSettlementExceptionQuota: (
        projectId: string,
        user: { id: string },
        body: SettlementExceptionQuotaRequestBody
      ) => Promise<unknown>;
    }).requestSettlementExceptionQuota("project-1", { id: "project-manager-1" }, body);

    expect(projects.requestSettlementExceptionQuota).toHaveBeenCalledWith(
      "project-1",
      "project-manager-1",
      body
    );
  });

  it("forwards settlement exception quota approval metadata and actor", async () => {
    const projects = { reviewSettlementExceptionQuota: jest.fn() };
    const controller = new ProjectController(projects as never);
    const body = {
      decision: "approve" as const,
      confirmationPassword: "current-password",
      comment: "同意"
    };

    await (controller as never as {
      reviewSettlementExceptionQuota: (
        projectId: string,
        quotaId: string,
        user: { id: string },
        body: SettlementExceptionQuotaReviewBody
      ) => Promise<unknown>;
    }).reviewSettlementExceptionQuota("project-1", "quota-1", { id: "budget-director-1" }, body);

    expect(projects.reviewSettlementExceptionQuota).toHaveBeenCalledWith(
      "project-1",
      "quota-1",
      "budget-director-1",
      body
    );
  });

  it("forwards project financing quota request payload with authenticated user id", async () => {
    const projects = { requestProjectFinancingQuota: jest.fn() };
    const controller = new ProjectController(projects as never);
    const body = {
      amountCents: "1000000",
      reason: "阶段性垫资保障项目付款",
      validUntil: "2099-07-02T00:00:00.000Z",
      attachmentFileId: "file-1"
    };

    await (controller as never as {
      requestProjectFinancingQuota: (
        projectId: string,
        user: { id: string },
        body: ProjectFinancingQuotaRequestBody
      ) => Promise<unknown>;
    }).requestProjectFinancingQuota("project-1", { id: "project-manager-1" }, body);

    expect(projects.requestProjectFinancingQuota).toHaveBeenCalledWith(
      "project-1",
      "project-manager-1",
      body
    );
  });

  it("forwards project financing quota approval metadata and actor", async () => {
    const projects = { reviewProjectFinancingQuota: jest.fn() };
    const controller = new ProjectController(projects as never);
    const body = {
      decision: "approve" as const,
      confirmationPassword: "current-password",
      comment: "同意"
    };

    await (controller as never as {
      reviewProjectFinancingQuota: (
        projectId: string,
        quotaId: string,
        user: { id: string },
        body: ProjectFinancingQuotaReviewBody
      ) => Promise<unknown>;
    }).reviewProjectFinancingQuota("project-1", "quota-1", { id: "finance-director-1" }, body);

    expect(projects.reviewProjectFinancingQuota).toHaveBeenCalledWith(
      "project-1",
      "quota-1",
      "finance-director-1",
      body
    );
  });
});
