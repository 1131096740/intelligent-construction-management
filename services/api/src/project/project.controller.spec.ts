import "reflect-metadata";
import { BadRequestException } from "@nestjs/common";
import { REQUIRED_POSITIONS_KEY } from "../auth/decorators/require-positions.decorator";
import { createApiValidationPipe } from "../validation/api-validation";
import { ProjectController } from "./project.controller";

type ProjectMoneyBodyMethod =
  | "recordReceipt"
  | "recordProxyPayment"
  | "recordUpstreamSettlement"
  | "recordOwnerContract"
  | "confirmOwnerContract"
  | "requestSettlementExceptionQuota"
  | "reviewSettlementExceptionQuota"
  | "requestProjectFinancingQuota"
  | "reviewProjectFinancingQuota";

const projectMoneyBodyIndex: Record<ProjectMoneyBodyMethod, number> = {
  recordReceipt: 2,
  recordProxyPayment: 2,
  recordUpstreamSettlement: 2,
  recordOwnerContract: 2,
  confirmOwnerContract: 3,
  requestSettlementExceptionQuota: 2,
  reviewSettlementExceptionQuota: 3,
  requestProjectFinancingQuota: 2,
  reviewProjectFinancingQuota: 3
};

function projectMoneyBodyMetatype(method: ProjectMoneyBodyMethod) {
  const paramTypes = Reflect.getMetadata(
    "design:paramtypes",
    ProjectController.prototype,
    method
  ) as Array<new () => object> | undefined;
  expect(paramTypes).toBeDefined();
  const metatype = paramTypes?.[projectMoneyBodyIndex[method]];
  expect(metatype).toBeDefined();
  expect(metatype).not.toBe(Object);
  return metatype as new () => object;
}

async function validateProjectMoneyBody(method: ProjectMoneyBodyMethod, value: unknown) {
  return createApiValidationPipe().transform(value, {
    type: "body",
    metatype: projectMoneyBodyMetatype(method),
    data: undefined
  });
}

async function getProjectMoneyValidationResponse(
  method: ProjectMoneyBodyMethod,
  value: unknown
): Promise<Record<string, unknown>> {
  try {
    await validateProjectMoneyBody(method, value);
  } catch (error) {
    expect(error).toBeInstanceOf(BadRequestException);
    return (error as BadRequestException).getResponse() as Record<string, unknown>;
  }
  throw new Error("Expected project money body validation to reject the request");
}

const validProjectReceiptBody = {
  receivedAt: "2026-07-11",
  amountCents: "10000",
  payerName: "总包单位",
  sourceType: "general_contractor_payment",
  voucherFileId: "file-1",
  confirmationPassword: "current-password"
};

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

  it.each([
    ["recordReceipt", validProjectReceiptBody],
    [
      "recordProxyPayment",
      {
        paidAt: "2026-07-11T10:00:00.000Z",
        amountCents: "10000",
        generalContractorName: "总包单位",
        paidTargetName: "材料供应商",
        paymentType: "material",
        voucherFileId: "file-1",
        confirmationPassword: "current-password"
      }
    ],
    [
      "recordUpstreamSettlement",
      {
        settledAt: "2026-07-11",
        reportedAmountCents: "12000",
        approvedAmountCents: "10000",
        approvingPartyName: "总包单位",
        periodLabel: "2026-06",
        isFinal: false,
        voucherFileId: "file-1",
        confirmationPassword: "current-password"
      }
    ],
    [
      "recordOwnerContract",
      {
        ownerName: "建设单位",
        contractName: "施工总承包合同",
        contractCode: "YZ-2026-001",
        signedAt: "2026-07-11",
        amountCents: "200000000",
        taxRateBps: 900,
        pricingMethod: "fixed_total",
        paymentTermsSummary: "按进度支付",
        retentionSummary: "3%质保金",
        fileId: "file-1"
      }
    ],
    ["confirmOwnerContract", { confirmationPassword: "current-password" }],
    [
      "requestSettlementExceptionQuota",
      {
        contractId: "contract-1",
        amountCents: "10000",
        reason: "临时额度",
        validUntil: "2099-07-11",
        attachmentFileId: "file-1"
      }
    ],
    [
      "reviewSettlementExceptionQuota",
      { decision: "approve", confirmationPassword: "current-password", comment: "同意" }
    ],
    [
      "requestProjectFinancingQuota",
      {
        amountCents: "10000",
        reason: "项目垫资",
        validUntil: "2099-07-11T10:00:00.000Z",
        attachmentFileId: "file-1"
      }
    ],
    [
      "reviewProjectFinancingQuota",
      { decision: "reject", confirmationPassword: "current-password", comment: "资料不足" }
    ]
  ] as const)("accepts a valid %s body through its controller runtime DTO", async (method, value) => {
    const result = await validateProjectMoneyBody(method, value);

    expect(result).toEqual(value);
    expect(result).toBeInstanceOf(projectMoneyBodyMetatype(method));
  });

  it("keeps project create and update DTO validation outside Task 3", () => {
    const createTypes = Reflect.getMetadata(
      "design:paramtypes",
      ProjectController.prototype,
      "create"
    ) as unknown[];
    const updateTypes = Reflect.getMetadata(
      "design:paramtypes",
      ProjectController.prototype,
      "update"
    ) as unknown[];

    expect(createTypes[1]).toBe(Object);
    expect(updateTypes[2]).toBe(Object);
  });

  it.each([100, -1, "-1", "1.2", "1e3", " 1", "01", ""])(
    "rejects a non-canonical project receipt amount: %p",
    async (amountCents) => {
      const response = await getProjectMoneyValidationResponse("recordReceipt", {
        ...validProjectReceiptBody,
        amountCents
      });

      expect(response.errors).toEqual(expect.arrayContaining([expect.any(String)]));
    }
  );

  it("allows zero through the receipt DTO and leaves the positive rule in the service", async () => {
    const result = await validateProjectMoneyBody("recordReceipt", {
      ...validProjectReceiptBody,
      amountCents: "0"
    });

    expect(result).toEqual({ ...validProjectReceiptBody, amountCents: "0" });
  });

  it.each(["general_contractor_payment", "owner_direct_payment", "other"])(
    "accepts the %s project receipt source",
    async (sourceType) => {
      await expect(
        validateProjectMoneyBody("recordReceipt", { ...validProjectReceiptBody, sourceType })
      ).resolves.toBeDefined();
    }
  );

  it.each(["material", "equipment", "labor", "professional_subcontract", "other"])(
    "accepts the %s proxy payment type",
    async (paymentType) => {
      await expect(
        validateProjectMoneyBody("recordProxyPayment", {
          paidAt: "2026-07-11",
          amountCents: "10000",
          generalContractorName: "总包单位",
          paidTargetName: "收款方",
          paymentType,
          voucherFileId: "file-1",
          confirmationPassword: "current-password"
        })
      ).resolves.toBeDefined();
    }
  );

  it("accepts a proxy payment without optional contract or settlement association", async () => {
    const result = await validateProjectMoneyBody("recordProxyPayment", {
      paidAt: "2026-07-11",
      amountCents: "10000",
      generalContractorName: "总包单位",
      paidTargetName: "收款方",
      paymentType: "other",
      voucherFileId: "file-1",
      confirmationPassword: "current-password"
    });

    expect(result).toBeInstanceOf(projectMoneyBodyMetatype("recordProxyPayment"));
  });

  it("rejects unsupported receipt and proxy payment enums", async () => {
    const receiptResponse = await getProjectMoneyValidationResponse("recordReceipt", {
      ...validProjectReceiptBody,
      sourceType: "invoice"
    });
    const proxyResponse = await getProjectMoneyValidationResponse("recordProxyPayment", {
      paidAt: "2026-07-11",
      amountCents: "10000",
      generalContractorName: "总包单位",
      paidTargetName: "收款方",
      paymentType: "salary",
      voucherFileId: "file-1",
      confirmationPassword: "current-password"
    });

    expect(receiptResponse.errors).toContain("到账来源类型不正确");
    expect(proxyResponse.errors).toContain("代付类型不正确");
  });

  it("rejects string isFinal without implicit boolean conversion", async () => {
    const response = await getProjectMoneyValidationResponse("recordUpstreamSettlement", {
      settledAt: "2026-07-11",
      reportedAmountCents: "12000",
      approvedAmountCents: "10000",
      approvingPartyName: "总包单位",
      periodLabel: "2026-06",
      isFinal: "false",
      voucherFileId: "file-1",
      confirmationPassword: "current-password"
    });

    expect(response.errors).toContain("最终结算标记必须是布尔值");
  });

  it.each([0, 10_000])("accepts owner contract tax rate boundary %s", async (taxRateBps) => {
    await expect(
      validateProjectMoneyBody("recordOwnerContract", {
        ownerName: "建设单位",
        contractName: "施工总承包合同",
        contractCode: "YZ-2026-001",
        signedAt: "2026-07-11",
        amountCents: "200000000",
        taxRateBps,
        pricingMethod: "fixed_total",
        paymentTermsSummary: "按进度支付",
        retentionSummary: "3%质保金",
        fileId: "file-1"
      })
    ).resolves.toBeDefined();
  });

  it.each([-1, 10_001, "900"])("rejects invalid owner contract tax rate %p", async (taxRateBps) => {
    const response = await getProjectMoneyValidationResponse("recordOwnerContract", {
      ownerName: "建设单位",
      contractName: "施工总承包合同",
      contractCode: "YZ-2026-001",
      signedAt: "2026-07-11",
      amountCents: "200000000",
      taxRateBps,
      pricingMethod: "fixed_total",
      paymentTermsSummary: "按进度支付",
      retentionSummary: "3%质保金",
      fileId: "file-1"
    });

    expect(response.errors).toEqual(expect.arrayContaining([expect.any(String)]));
  });

  it.each(["not-a-date", "2026-13-40"])("rejects invalid quota date %s", async (validUntil) => {
    const response = await getProjectMoneyValidationResponse("requestProjectFinancingQuota", {
      amountCents: "10000",
      reason: "项目垫资",
      validUntil,
      attachmentFileId: "file-1"
    });

    expect(response.errors).toContain("额度有效期格式不正确");
  });

  it.each([
    ["recordReceipt", { ...validProjectReceiptBody, receivedAt: "2026-02-30" }, "到账日期格式不正确"],
    [
      "recordProxyPayment",
      {
        paidAt: "2026-02-30",
        amountCents: "100",
        generalContractorName: "总包单位",
        paidTargetName: "收款方",
        paymentType: "other",
        voucherFileId: "file-1",
        confirmationPassword: "pwd"
      },
      "代付日期格式不正确"
    ],
    [
      "recordUpstreamSettlement",
      {
        settledAt: "2026-02-30",
        reportedAmountCents: "100",
        approvedAmountCents: "100",
        approvingPartyName: "总包单位",
        periodLabel: "2026-02",
        voucherFileId: "file-1",
        confirmationPassword: "pwd"
      },
      "对上结算日期格式不正确"
    ],
    [
      "recordOwnerContract",
      {
        ownerName: "建设单位",
        contractName: "总包合同",
        contractCode: "YZ-1",
        signedAt: "2026-02-30",
        amountCents: "100",
        taxRateBps: 900,
        pricingMethod: "fixed",
        paymentTermsSummary: "按进度",
        retentionSummary: "3%",
        fileId: "file-1"
      },
      "业主合同签订日期格式不正确"
    ],
    [
      "requestSettlementExceptionQuota",
      { contractId: "contract-1", amountCents: "100", reason: "临时", validUntil: "2026-02-30", attachmentFileId: "file-1" },
      "额度有效期格式不正确"
    ],
    [
      "requestProjectFinancingQuota",
      { amountCents: "100", reason: "垫资", validUntil: "2026-02-30", attachmentFileId: "file-1" },
      "额度有效期格式不正确"
    ]
  ] as const)("rejects a non-existent calendar date for %s", async (method, value, message) => {
    const response = await getProjectMoneyValidationResponse(method, value);

    expect(response.errors).toContain(message);
  });

  it.each(["2099-07-11", "2099-07-11T10:00:00.000Z"])(
    "accepts supported quota date %s",
    async (validUntil) => {
      await expect(
        validateProjectMoneyBody("requestProjectFinancingQuota", {
          amountCents: "10000",
          reason: "项目垫资",
          validUntil,
          attachmentFileId: "file-1"
        })
      ).resolves.toBeDefined();
    }
  );

  it("rejects empty required project money fields and unknown fields", async () => {
    const requiredResponse = await getProjectMoneyValidationResponse("recordReceipt", {
      ...validProjectReceiptBody,
      voucherFileId: "",
      confirmationPassword: ""
    });
    const unknownResponse = await getProjectMoneyValidationResponse("recordReceipt", {
      ...validProjectReceiptBody,
      internalSecret: "TOP-SECRET"
    });

    expect(requiredResponse.errors).toEqual(expect.arrayContaining([expect.any(String)]));
    expect(unknownResponse.errors).toEqual(["internalSecret 不是允许提交的字段"]);
    expect(JSON.stringify(unknownResponse)).not.toContain("TOP-SECRET");
  });

  it("rejects whitespace-only required project money fields without trimming values", async () => {
    const response = await getProjectMoneyValidationResponse("recordReceipt", {
      ...validProjectReceiptBody,
      payerName: "   ",
      voucherFileId: "   ",
      confirmationPassword: "   "
    });

    expect(response.errors).toEqual(
      expect.arrayContaining([
        "付款方名称不能为空白",
        "到账凭证不能为空白",
        "请输入当前登录密码"
      ])
    );
  });

  it.each([
    { contractId: null },
    { settlementId: "   " }
  ])("rejects an invalid optional proxy association: %p", async (association) => {
    const response = await getProjectMoneyValidationResponse("recordProxyPayment", {
      paidAt: "2026-07-11",
      amountCents: "10000",
      generalContractorName: "总包单位",
      paidTargetName: "收款方",
      paymentType: "other",
      voucherFileId: "file-1",
      confirmationPassword: "current-password",
      ...association
    });

    expect(response.errors).toEqual(expect.arrayContaining([expect.any(String)]));
  });

  it.each([
    ["recordReceipt", { ...validProjectReceiptBody, description: null }],
    [
      "recordProxyPayment",
      {
        paidAt: "2026-07-11",
        amountCents: "100",
        generalContractorName: "总包单位",
        paidTargetName: "收款方",
        paymentType: "other",
        voucherFileId: "file-1",
        confirmationPassword: "pwd",
        description: null
      }
    ],
    ["reviewProjectFinancingQuota", { decision: "approve", confirmationPassword: "pwd", comment: null }]
  ] as const)("rejects explicit null for optional text in %s", async (method, value) => {
    const response = await getProjectMoneyValidationResponse(method, value);

    expect(response.errors).toEqual(expect.arrayContaining([expect.any(String)]));
  });

  it.each([
    [{ ...validProjectReceiptBody, payerName: "   " }, "付款方名称不能为空白"],
    [{ ...validProjectReceiptBody, voucherFileId: "   " }, "到账凭证不能为空白"],
    [{ ...validProjectReceiptBody, confirmationPassword: "   " }, "请输入当前登录密码"],
    [{ ...validProjectReceiptBody, amountCents: 100 }, "到账金额格式不正确"]
  ])("returns one precise project receipt field error for %p", async (value, message) => {
    const response = await getProjectMoneyValidationResponse("recordReceipt", value);

    expect(response.errors).toEqual([message]);
  });

  it("returns one precise optional project link error", async () => {
    const response = await getProjectMoneyValidationResponse("recordProxyPayment", {
      paidAt: "2026-07-11",
      amountCents: "100",
      generalContractorName: "总包单位",
      paidTargetName: "收款方",
      paymentType: "other",
      voucherFileId: "file-1",
      confirmationPassword: "pwd",
      contractId: null
    });

    expect(response.errors).toEqual(["关联合同编号必须是文字"]);
  });

  it("passes the transformed receipt DTO to the project service exactly once", async () => {
    const projects = { recordReceipt: jest.fn().mockResolvedValue({ id: "receipt-1" }) };
    const controller = new ProjectController(projects as never);
    const body = await validateProjectMoneyBody("recordReceipt", validProjectReceiptBody);

    await controller.recordReceipt("project-1", { id: "finance-1" } as never, body as never);

    expect(projects.recordReceipt).toHaveBeenCalledTimes(1);
    expect(projects.recordReceipt).toHaveBeenCalledWith("project-1", "finance-1", body);
  });

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
