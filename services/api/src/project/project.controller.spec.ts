import "reflect-metadata";
import { BadRequestException, GoneException } from "@nestjs/common";
import { REQUIRED_POSITIONS_KEY } from "../auth/decorators/require-positions.decorator";
import { REQUIRED_PROJECT_ACTION_KEY } from "../auth/decorators/require-project-role.decorator";
import { PROJECT_OVERVIEW_READ_POSITION_KEYS } from "../auth/ledger-read-positions";
import { createApiValidationPipe } from "../validation/api-validation";
import { ProjectController } from "./project.controller";

type ProjectMoneyBodyMethod =
  | "assignAffiliate"
  | "recordReceipt"
  | "recordUpstreamFundFact"
  | "confirmUpstreamFundFact"
  | "recordAffiliateContractFact"
  | "confirmAffiliateContractFact"
  | "recordAffiliateSettlementFact"
  | "confirmAffiliateSettlementFact"
  | "recordAffiliatePaymentFact"
  | "confirmAffiliatePaymentFact"
  | "supplementAffiliateBusinessEvidence"
  | "recordAffiliateCompanyContract"
  | "confirmAffiliateCompanyContract"
  | "recordProxyPayment"
  | "recordUpstreamSettlement"
  | "confirmUpstreamSettlement"
  | "recordOwnerContract"
  | "confirmOwnerContract"
  | "requestSettlementExceptionQuota"
  | "reviewSettlementExceptionQuota"
  | "requestProjectFinancingQuota"
  | "reviewProjectFinancingQuota"
  | "terminateProjectFinancingQuota";

const projectMoneyBodyIndex: Record<ProjectMoneyBodyMethod, number> = {
  assignAffiliate: 2,
  recordReceipt: 2,
  recordUpstreamFundFact: 2,
  confirmUpstreamFundFact: 3,
  recordAffiliateContractFact: 2,
  confirmAffiliateContractFact: 3,
  recordAffiliateSettlementFact: 2,
  confirmAffiliateSettlementFact: 3,
  recordAffiliatePaymentFact: 2,
  confirmAffiliatePaymentFact: 3,
  supplementAffiliateBusinessEvidence: 3,
  recordAffiliateCompanyContract: 2,
  confirmAffiliateCompanyContract: 3,
  recordProxyPayment: 2,
  recordUpstreamSettlement: 2,
  confirmUpstreamSettlement: 3,
  recordOwnerContract: 2,
  confirmOwnerContract: 3,
  requestSettlementExceptionQuota: 2,
  reviewSettlementExceptionQuota: 3,
  requestProjectFinancingQuota: 2,
  reviewProjectFinancingQuota: 3,
  terminateProjectFinancingQuota: 3
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
const validFinancingQuotaIdempotencyKey =
  "11111111-1111-4111-8111-111111111111";

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
    idempotencyKey: string;
    amountCents: string;
    reason: string;
    validUntil: string;
    attachmentFileId: string;
  };
  type ProjectFinancingQuotaReviewBody = {
    actionId: string;
    expectedLifecycleToken: string;
    decision: "approve" | "reject";
    confirmationPassword: string;
    comment?: string;
    selfReviewReason?: string;
  };
  type ProjectFinancingQuotaTerminationBody = {
    actionId: string;
    expectedLifecycleToken: string;
    reason: string;
    confirmationPassword: string;
  };

  const projectCreatePositions = ["chairman", "general_manager"];

  it.each([
    [
      "assignAffiliate",
      {
        businessPartyVersionId: "party-version-1",
        effectiveFrom: "2026-07-28T00:00:00.000Z",
        changeReason: "建立项目唯一挂靠企业映射"
      }
    ],
    ["recordReceipt", validProjectReceiptBody],
    [
      "recordUpstreamFundFact",
      {
        factType: "affiliate_remittance_to_company",
        basisType: "written",
        occurredAt: "2026-07-11",
        amountCents: "10000",
        counterpartyName: "挂靠企业",
        evidenceFileId: "file-1",
        idempotencyKey: "9ae0147a-da7b-4dba-b378-e80f87efdc46"
      }
    ],
    [
      "confirmUpstreamFundFact",
      {
        confirmationPassword: "current-password",
        confirmationActionId: "6f9ac3b7-8c5e-4f98-8284-221ce7844a36"
      }
    ],
    [
      "recordAffiliateContractFact",
      {
        contractType: "material_purchase",
        externalContractReference: "GK-HT-2026-001",
        counterpartyName: "材料供应商",
        signedAt: "2026-07-20",
        amountNature: "fixed",
        amountCents: "100000",
        basisType: "oral",
        advanceAllowed: false,
        idempotencyKey: "2dfca5de-eb12-4b9e-b093-e392653a5cdf"
      }
    ],
    [
      "confirmAffiliateContractFact",
      {
        confirmationPassword: "current-password",
        confirmationActionId: "e832035b-e073-4c04-8d43-b72583e99c32"
      }
    ],
    [
      "recordAffiliateSettlementFact",
      {
        contractLedgerId: "contract-ledger-1",
        counterpartyName: "材料供应商",
        settledAt: "2026-07-25",
        periodLabel: "2026-07",
        amountCents: "50000",
        basisType: "oral",
        idempotencyKey: "e974f2f0-5b2e-4e6a-9d9d-03b81e1868ad"
      }
    ],
    [
      "confirmAffiliateSettlementFact",
      {
        confirmationPassword: "current-password",
        confirmationActionId: "0763bc87-efb9-42dd-830f-e8f60ce3df59"
      }
    ],
    [
      "recordAffiliatePaymentFact",
      {
        contractLedgerId: "contract-ledger-1",
        settlementLedgerId: "settlement-ledger-1",
        counterpartyName: "材料供应商",
        paidAt: "2026-07-29",
        amountCents: "5000",
        paymentKind: "normal",
        externalPaymentReference: "BANK-20260729-001",
        basisType: "oral",
        idempotencyKey: "cdad0cb7-2e78-48db-ae27-86253bf54bbd"
      }
    ],
    [
      "confirmAffiliatePaymentFact",
      {
        confirmationPassword: "current-password",
        confirmationActionId: "439f38e7-d374-4275-9066-794a59a1cf0d"
      }
    ],
    [
      "supplementAffiliateBusinessEvidence",
      {
        businessType: "contract",
        fileId: "file-1",
        idempotencyKey: "c22598c5-98ff-4029-98e9-e4920a4b1d5f",
        description: "补充外部盖章合同"
      }
    ],
    [
      "recordAffiliateCompanyContract",
      {
        contractReference: "GL-2026-001",
        contractName: "项目挂靠管理协议",
        signedAt: "2026-07-20",
        rightsObligationsSummary: "双方权利义务摘要",
        companyEntityId: "company-1",
        fileId: "file-2",
        idempotencyKey: "a43073f9-9731-4d71-9498-b9727344dbd4"
      }
    ],
    [
      "confirmAffiliateCompanyContract",
      {
        confirmationPassword: "current-password",
        confirmationActionId: "6dfbdece-803c-44c5-bf68-edbcf1529ce5"
      }
    ],
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
        voucherFileId: "file-1"
      }
    ],
    ["confirmUpstreamSettlement", { confirmationPassword: "current-password" }],
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
        idempotencyKey: validFinancingQuotaIdempotencyKey,
        amountCents: "10000",
        reason: "项目垫资",
        validUntil: "2099-07-11T10:00:00.000Z",
        attachmentFileId: "file-1"
      }
    ],
    [
      "reviewProjectFinancingQuota",
      {
        actionId: "22222222-2222-4222-8222-222222222222",
        expectedLifecycleToken: "a".repeat(64),
        decision: "reject",
        confirmationPassword: "current-password",
        comment: "资料不足"
      }
    ],
    [
      "terminateProjectFinancingQuota",
      {
        actionId: "33333333-3333-4333-8333-333333333333",
        expectedLifecycleToken: "a".repeat(64),
        reason: "项目已具备自有资金，不再允许新占用",
        confirmationPassword: "current-password"
      }
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

  it("rejects invalid upstream fund enums, money text, and idempotency UUIDs", async () => {
    const response = await getProjectMoneyValidationResponse(
      "recordUpstreamFundFact",
      {
        factType: "other_receipt",
        basisType: "phone",
        occurredAt: "2026-07-11",
        amountCents: "1.00",
        counterpartyName: "挂靠企业",
        idempotencyKey: "not-a-uuid"
      }
    );

    expect(response.errors).toEqual(
      expect.arrayContaining([
        "上游资金事实类型不正确",
        "上游资金依据类型不正确",
        "上游资金金额必须按分填写为 0 或更大的整数",
        "上游资金登记幂等键必须是 UUID"
      ])
    );
  });

  it("rejects a non-UUID upstream fund confirmation action", async () => {
    const response = await getProjectMoneyValidationResponse(
      "confirmUpstreamFundFact",
      {
        confirmationPassword: "current-password",
        confirmationActionId: "not-a-uuid"
      }
    );

    expect(response.errors).toContain("上游资金确认幂等键必须是 UUID");
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
      voucherFileId: "file-1"
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

  it.each(["not-a-date", "2026-13-40", "2099-07-11T10:00:00"])(
    "rejects invalid quota date %s",
    async (validUntil) => {
    const response = await getProjectMoneyValidationResponse("requestProjectFinancingQuota", {
      idempotencyKey: validFinancingQuotaIdempotencyKey,
      amountCents: "10000",
      reason: "项目垫资",
      validUntil,
      attachmentFileId: "file-1"
    });

    expect(response.errors).toContain("额度有效期格式不正确");
    }
  );

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
        voucherFileId: "file-1"
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
      {
        idempotencyKey: validFinancingQuotaIdempotencyKey,
        amountCents: "100",
        reason: "垫资",
        validUntil: "2026-02-30",
        attachmentFileId: "file-1"
      },
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
          idempotencyKey: validFinancingQuotaIdempotencyKey,
          amountCents: "10000",
          reason: "项目垫资",
          validUntil,
          attachmentFileId: "file-1"
        })
      ).resolves.toBeDefined();
    }
  );

  it("enforces the project financing quota reason Unicode boundary in the API", async () => {
    await expect(
      validateProjectMoneyBody("requestProjectFinancingQuota", {
        idempotencyKey: validFinancingQuotaIdempotencyKey,
        amountCents: "10000",
        reason: "🚀".repeat(500),
        attachmentFileId: "file-1"
      })
    ).resolves.toBeDefined();

    const response = await getProjectMoneyValidationResponse(
      "requestProjectFinancingQuota",
      {
        idempotencyKey: validFinancingQuotaIdempotencyKey,
        amountCents: "10000",
        reason: "🚀".repeat(501),
        attachmentFileId: "file-1"
      }
    );
    expect(response.errors).toContain("融资额度申请原因不能超过 500 个字符");
  });

  it("accepts a project financing quota without an expiry date", async () => {
    await expect(
      validateProjectMoneyBody("requestProjectFinancingQuota", {
        idempotencyKey: validFinancingQuotaIdempotencyKey,
        amountCents: "10000",
        reason: "项目垫资",
        attachmentFileId: "file-1"
      })
    ).resolves.toBeDefined();
  });

  it.each([undefined, "", "not-a-uuid", "11111111-1111-3111-8111-111111111111"])(
    "rejects an invalid project financing quota idempotency key %p",
    async (idempotencyKey) => {
      const response = await getProjectMoneyValidationResponse(
        "requestProjectFinancingQuota",
        {
          amountCents: "10000",
          reason: "项目垫资",
          attachmentFileId: "file-1",
          ...(idempotencyKey === undefined ? {} : { idempotencyKey })
        }
      );

      expect(response.errors).toContain("项目垫资申请幂等键必须是 UUID");
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
    ["reviewProjectFinancingQuota", {
      actionId: "22222222-2222-4222-8222-222222222222",
      expectedLifecycleToken: "a".repeat(64),
      decision: "approve",
      confirmationPassword: "pwd",
      comment: null
    }]
  ] as const)("rejects explicit null for optional text in %s", async (method, value) => {
    const response = await getProjectMoneyValidationResponse(method, value);

    expect(response.errors).toEqual(expect.arrayContaining([expect.any(String)]));
  });

  it.each([
    [
      {
        actionId: "not-a-uuid",
        expectedLifecycleToken: "a".repeat(64),
        decision: "approve",
        confirmationPassword: "pwd"
      },
      "审批 actionId 必须是 UUIDv4"
    ],
    [
      {
        actionId: "22222222-2222-4222-8222-222222222222",
        expectedLifecycleToken: "A".repeat(64),
        decision: "approve",
        confirmationPassword: "pwd"
      },
      "审批生命周期令牌无效"
    ]
  ])("rejects invalid project financing review coordinates", async (value, message) => {
    const response = await getProjectMoneyValidationResponse(
      "reviewProjectFinancingQuota",
      value
    );

    expect(response.errors).toEqual([message]);
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

  it("limits legacy affiliate mapping writes to project finance and exposes a read-only review report", () => {
    expect(
      Reflect.getMetadata(REQUIRED_POSITIONS_KEY, ProjectController.prototype.assignAffiliate)
    ).toBeUndefined();
    expect(
      Reflect.getMetadata(REQUIRED_PROJECT_ACTION_KEY, ProjectController.prototype.assignAffiliate)
    ).toBe("project.operating_profile.manage");
    expect(
      Reflect.getMetadata(REQUIRED_POSITIONS_KEY, ProjectController.prototype.affiliateMappingReport)
    ).toEqual(["chairman", "general_manager", "contract_director"]);
  });

  it("guards project overview with the management read policy so global positions can see every project", () => {
    expect(Reflect.getMetadata(REQUIRED_POSITIONS_KEY, ProjectController.prototype.operatingFundsOverview)).toEqual(
      PROJECT_OVERVIEW_READ_POSITION_KEYS
    );
    expect(
      Reflect.getMetadata(
        REQUIRED_POSITIONS_KEY,
        ProjectController.prototype.projectFinancingQuotaWorkbench
      )
    ).toEqual(PROJECT_OVERVIEW_READ_POSITION_KEYS);
  });

  it("adds contract staff only to the affiliate-company contract read route", () => {
    expect(
      Reflect.getMetadata(
        REQUIRED_POSITIONS_KEY,
        ProjectController.prototype.affiliateCompanyContractList
      )
    ).toEqual([...PROJECT_OVERVIEW_READ_POSITION_KEYS, "contract_staff"]);
    expect(
      Reflect.getMetadata(
        REQUIRED_POSITIONS_KEY,
        ProjectController.prototype.operatingFundsOverview
      )
    ).toEqual(PROJECT_OVERVIEW_READ_POSITION_KEYS);
    expect(
      Reflect.getMetadata(
        REQUIRED_POSITIONS_KEY,
        ProjectController.prototype.affiliateBusinessFacts
      )
    ).toEqual(PROJECT_OVERVIEW_READ_POSITION_KEYS);
  });

  it("guards project receipt recording with finance project role", () => {
    expect(Reflect.getMetadata("requiredProjectAction", ProjectController.prototype.recordReceipt)).toBe(
      "project.receipt.record"
    );
  });

  it("guards upstream fund fact recording and confirmation with finance project roles", () => {
    expect(
      Reflect.getMetadata(
        "requiredProjectAction",
        ProjectController.prototype.recordUpstreamFundFact
      )
    ).toBe("project.upstream_fund_fact.record");
    expect(
      Reflect.getMetadata(
        "requiredProjectAction",
        ProjectController.prototype.upstreamFundReferenceOptions
      )
    ).toBe("project.upstream_fund_fact.record");
    expect(
      Reflect.getMetadata(
        "requiredProjectAction",
        ProjectController.prototype.confirmUpstreamFundFact
      )
    ).toBe("project.upstream_fund_fact.confirm");
  });

  it("guards affiliate downstream facts with their recording and confirmation roles", () => {
    expect(
      Reflect.getMetadata(
        "requiredProjectAction",
        ProjectController.prototype.recordAffiliateContractFact
      )
    ).toBe("project.affiliate_contract_fact.record");
    expect(
      Reflect.getMetadata(
        "requiredProjectAction",
        ProjectController.prototype.confirmAffiliateContractFact
      )
    ).toBe("project.affiliate_contract_fact.confirm");
    expect(
      Reflect.getMetadata(
        "requiredProjectAction",
        ProjectController.prototype.recordAffiliateSettlementFact
      )
    ).toBe("project.affiliate_settlement_fact.record");
    expect(
      Reflect.getMetadata(
        "requiredProjectAction",
        ProjectController.prototype.confirmAffiliateSettlementFact
      )
    ).toBe("project.affiliate_settlement_fact.confirm");
    expect(
      Reflect.getMetadata(
        "requiredProjectAction",
        ProjectController.prototype.recordAffiliatePaymentFact
      )
    ).toBe("project.affiliate_payment_fact.record");
    expect(
      Reflect.getMetadata(
        "requiredProjectAction",
        ProjectController.prototype.confirmAffiliatePaymentFact
      )
    ).toBe("project.affiliate_payment_fact.confirm");
    expect(
      Reflect.getMetadata(
        "requiredProjectAction",
        ProjectController.prototype.supplementAffiliateBusinessEvidence
      )
    ).toBe("project.affiliate_business_fact.evidence_supplement");
    expect(
      Reflect.getMetadata(
        "requiredProjectAction",
        ProjectController.prototype.recordAffiliateCompanyContract
      )
    ).toBe("project.affiliate_company_contract.record");
    expect(
      Reflect.getMetadata(
        "requiredProjectAction",
        ProjectController.prototype.confirmAffiliateCompanyContract
      )
    ).toBe("project.affiliate_company_contract.confirm");
  });

  it("forwards affiliate-company offline contract reads and writes to the dedicated service", async () => {
    const projects = {};
    const affiliateBusiness = {};
    const affiliateCompanyContracts = {
      list: jest.fn(),
      record: jest.fn(),
      confirm: jest.fn()
    };
    const controller = new ProjectController(
      projects as never,
      affiliateBusiness as never,
      affiliateCompanyContracts as never
    );
    const user = { id: "contract-user-1" } as never;
    const body = {
      contractReference: "GL-2026-001",
      contractName: "项目挂靠管理协议",
      signedAt: "2026-07-20",
      rightsObligationsSummary: "双方权利义务摘要",
      companyEntityId: "company-1",
      fileId: "file-2",
      idempotencyKey: "a43073f9-9731-4d71-9498-b9727344dbd4"
    };
    const confirmation = {
      confirmationPassword: "current-password",
      confirmationActionId: "6dfbdece-803c-44c5-bf68-edbcf1529ce5"
    };

    await controller.affiliateCompanyContractList("project-1", user);
    await controller.recordAffiliateCompanyContract("project-1", user, body);
    await controller.confirmAffiliateCompanyContract(
      "project-1",
      "contract-1",
      user,
      confirmation
    );

    expect(affiliateCompanyContracts.list).toHaveBeenCalledWith(
      "project-1",
      "contract-user-1"
    );
    expect(affiliateCompanyContracts.record).toHaveBeenCalledWith(
      "project-1",
      "contract-user-1",
      body
    );
    expect(affiliateCompanyContracts.confirm).toHaveBeenCalledWith(
      "project-1",
      "contract-1",
      "contract-user-1",
      confirmation
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
    expect(
      Reflect.getMetadata(
        "requiredProjectAction",
        ProjectController.prototype.confirmUpstreamSettlement
      )
    ).toBe("project.upstream_settlement.confirm");
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

  it("guards project financing quota request, approval and termination with project roles", () => {
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
        (ProjectController.prototype as never as {
          projectFinancingQuotaReviewCapability: object;
        }).projectFinancingQuotaReviewCapability
      )
    ).toBe("project.financing_quota.approve");
    expect(
      Reflect.getMetadata(
        "requiredProjectAction",
        (ProjectController.prototype as never as { reviewProjectFinancingQuota: object })
          .reviewProjectFinancingQuota
      )
    ).toBe("project.financing_quota.approve");
    expect(
      Reflect.getMetadata(
        "requiredProjectAction",
        (ProjectController.prototype as never as {
          projectFinancingQuotaTerminationCapability: object;
        }).projectFinancingQuotaTerminationCapability
      )
    ).toBe("project.financing_quota.terminate");
    expect(
      Reflect.getMetadata(
        "requiredProjectAction",
        (ProjectController.prototype as never as { terminateProjectFinancingQuota: object })
          .terminateProjectFinancingQuota
      )
    ).toBe("project.financing_quota.terminate");
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

  it("forwards financing quota workbench project and authenticated user coordinates", async () => {
    const projects = { getProjectFinancingQuotaWorkbench: jest.fn() };
    const controller = new ProjectController(projects as never);

    await controller.projectFinancingQuotaWorkbench(
      "project-1",
      { id: "finance-1" } as never
    );

    expect(projects.getProjectFinancingQuotaWorkbench).toHaveBeenCalledWith(
      "project-1",
      "finance-1"
    );
  });

  it("forwards immutable coordinates for the financing quota review capability", async () => {
    const projects = {
      getProjectFinancingQuotaReviewCapability: jest.fn()
    };
    const controller = new ProjectController(projects as never);

    await controller.projectFinancingQuotaReviewCapability(
      "project-1",
      "quota-1",
      { id: "finance-director-1" } as never
    );

    expect(
      projects.getProjectFinancingQuotaReviewCapability
    ).toHaveBeenCalledWith(
      "project-1",
      "quota-1",
      "finance-director-1"
    );
  });

  it("forwards immutable coordinates for the financing quota termination capability", async () => {
    const projects = {
      getProjectFinancingQuotaTerminationCapability: jest.fn()
    };
    const controller = new ProjectController(projects as never);

    await controller.projectFinancingQuotaTerminationCapability(
      "project-1",
      "quota-1",
      { id: "finance-director-1" } as never
    );

    expect(
      projects.getProjectFinancingQuotaTerminationCapability
    ).toHaveBeenCalledWith(
      "project-1",
      "quota-1",
      "finance-director-1"
    );
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

  it("forwards upstream fund fact recording and confirmation with authenticated user id", async () => {
    const projects = {
      recordUpstreamFundFact: jest.fn(),
      confirmUpstreamFundFact: jest.fn(),
      getUpstreamFundReferenceOptions: jest.fn()
    };
    const controller = new ProjectController(projects as never);
    const recordBody = {
      factType: "affiliate_remittance_to_company" as const,
      basisType: "written" as const,
      occurredAt: "2026-07-02T00:00:00.000Z",
      amountCents: "100000",
      counterpartyName: "挂靠企业",
      evidenceFileId: "file-1",
      idempotencyKey: "9ae0147a-da7b-4dba-b378-e80f87efdc46"
    };
    const confirmBody = {
      confirmationPassword: "current-password",
      confirmationActionId: "6f9ac3b7-8c5e-4f98-8284-221ce7844a36"
    };

    await controller.recordUpstreamFundFact(
      "project-1",
      { id: "finance-1" } as never,
      recordBody
    );
    await controller.confirmUpstreamFundFact(
      "project-1",
      "fact-1",
      { id: "director-1" } as never,
      confirmBody
    );
    await controller.upstreamFundReferenceOptions("project-1");

    expect(projects.recordUpstreamFundFact).toHaveBeenCalledWith(
      "project-1",
      "finance-1",
      recordBody
    );
    expect(projects.confirmUpstreamFundFact).toHaveBeenCalledWith(
      "project-1",
      "fact-1",
      "director-1",
      confirmBody
    );
    expect(projects.getUpstreamFundReferenceOptions).toHaveBeenCalledWith(
      "project-1"
    );
  });

  it("retires the legacy one-step proxy payment writer", async () => {
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

    expect(() =>
      controller.recordProxyPayment("project-1", { id: "finance-1" } as never, body)
    ).toThrow(
      "旧施工企业代付一步式写入口已停用，请使用施工企业业务持续接管的合同、结算、付款事实链"
    );
    expect(projects.recordProxyPayment).not.toHaveBeenCalled();
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
      voucherFileId: "file-1"
    };

    await controller.recordUpstreamSettlement("project-1", { id: "budget-1" } as never, body);

    expect(projects.recordUpstreamSettlement).toHaveBeenCalledWith(
      "project-1",
      "budget-1",
      body
    );
  });

  it("forwards upstream settlement confirmation metadata and actor", async () => {
    const projects = { confirmUpstreamSettlement: jest.fn() };
    const controller = new ProjectController(projects as never);
    const body = { confirmationPassword: "current-password" };

    await controller.confirmUpstreamSettlement(
      "project-1",
      "upstream-1",
      { id: "budget-1" } as never,
      body
    );

    expect(projects.confirmUpstreamSettlement).toHaveBeenCalledWith(
      "project-1",
      "upstream-1",
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

  it("fails closed every new settlement exception quota request", () => {
    const projects = { requestSettlementExceptionQuota: jest.fn() };
    const controller = new ProjectController(projects as never);
    const body = {
      contractId: "contract-1",
      amountCents: "1000000",
      reason: "对上审定暂未覆盖本期必要结算",
      validUntil: "2099-07-02T00:00:00.000Z",
      attachmentFileId: "file-1"
    };

    expect(() => (controller as never as {
      requestSettlementExceptionQuota: (
        projectId: string,
        user: { id: string },
        body: SettlementExceptionQuotaRequestBody
      ) => Promise<unknown>;
    }).requestSettlementExceptionQuota(
      "project-1",
      { id: "project-manager-1" },
      body
    )).toThrow(GoneException);
    expect(projects.requestSettlementExceptionQuota).not.toHaveBeenCalled();
  });

  it("fails closed every settlement exception quota approval write", () => {
    const projects = { reviewSettlementExceptionQuota: jest.fn() };
    const controller = new ProjectController(projects as never);
    const body = {
      decision: "approve" as const,
      confirmationPassword: "current-password",
      comment: "同意"
    };

    expect(() => (controller as never as {
      reviewSettlementExceptionQuota: (
        projectId: string,
        quotaId: string,
        user: { id: string },
        body: SettlementExceptionQuotaReviewBody
      ) => Promise<unknown>;
    }).reviewSettlementExceptionQuota(
      "project-1",
      "quota-1",
      { id: "budget-director-1" },
      body
    )).toThrow(GoneException);
    expect(projects.reviewSettlementExceptionQuota).not.toHaveBeenCalled();
  });

  it("forwards project financing quota request payload with authenticated user id", async () => {
    const projects = { requestProjectFinancingQuota: jest.fn() };
    const controller = new ProjectController(projects as never);
    const body = {
      idempotencyKey: validFinancingQuotaIdempotencyKey,
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
      actionId: "22222222-2222-4222-8222-222222222222",
      expectedLifecycleToken: "a".repeat(64),
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

  it("forwards project financing quota termination receipt and actor", async () => {
    const projects = { terminateProjectFinancingQuota: jest.fn() };
    const controller = new ProjectController(projects as never);
    const body = {
      actionId: "33333333-3333-4333-8333-333333333333",
      expectedLifecycleToken: "a".repeat(64),
      reason: "项目已具备自有资金，不再允许新占用",
      confirmationPassword: "current-password"
    };

    await (controller as never as {
      terminateProjectFinancingQuota: (
        projectId: string,
        quotaId: string,
        user: { id: string },
        body: ProjectFinancingQuotaTerminationBody
      ) => Promise<unknown>;
    }).terminateProjectFinancingQuota(
      "project-1",
      "quota-1",
      { id: "finance-director-1" },
      body
    );

    expect(projects.terminateProjectFinancingQuota).toHaveBeenCalledWith(
      "project-1",
      "quota-1",
      "finance-director-1",
      body
    );
  });
});
