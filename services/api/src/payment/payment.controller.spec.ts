import "reflect-metadata";
import { BadRequestException } from "@nestjs/common";
import { IS_PUBLIC_KEY } from "../auth/decorators/public.decorator";
import { REQUIRED_POSITIONS_KEY } from "../auth/decorators/require-positions.decorator";
import { REQUIRED_PROJECT_ACTION_KEY } from "../auth/decorators/require-project-role.decorator";
import { createApiValidationPipe } from "../validation/api-validation";
import { PaymentController } from "./payment.controller";

type PaymentBodyMethod =
  | "create"
  | "reviewApproval"
  | "transferApproval"
  | "delegateApproval"
  | "recordExecution"
  | "recordFinance"
  | "recordPdfArchive"
  | "generatePdfArchive";

function paymentBodyMetatype(method: PaymentBodyMethod, bodyIndex: number) {
  const paramTypes = Reflect.getMetadata(
    "design:paramtypes",
    PaymentController.prototype,
    method
  ) as Array<new () => object> | undefined;
  expect(paramTypes).toBeDefined();
  const metatype = paramTypes?.[bodyIndex];
  expect(metatype).toBeDefined();
  expect(metatype).not.toBe(Object);
  return metatype as new () => object;
}

async function validatePaymentBody(
  method: PaymentBodyMethod,
  bodyIndex: number,
  value: unknown
) {
  return createApiValidationPipe().transform(value, {
    type: "body",
    metatype: paymentBodyMetatype(method, bodyIndex),
    data: undefined
  });
}

async function getPaymentValidationResponse(
  method: PaymentBodyMethod,
  bodyIndex: number,
  value: unknown
): Promise<Record<string, unknown>> {
  try {
    await validatePaymentBody(method, bodyIndex, value);
  } catch (error) {
    expect(error).toBeInstanceOf(BadRequestException);
    return (error as BadRequestException).getResponse() as Record<string, unknown>;
  }
  throw new Error("Expected payment body validation to reject the request");
}

const validPaymentCreateBody = {
  sourceType: "settlement",
  settlementId: "settlement-1",
  code: "FK-2026-001",
  requestedAmountCents: "10000"
};

describe("PaymentController authorization wiring", () => {
  it.each([
    ["settlement", { settlementId: "settlement-1" }],
    ["contract_advance", { contractVersionId: "contract-version-1" }],
    [
      "contract_due",
      {
        contractVersionId: "contract-version-1",
        paymentTermsVersionId: "payment-terms-version-1"
      }
    ]
  ] as const)("accepts a valid %s payment request through the controller runtime DTO", async (sourceType, source) => {
    const value = {
      ...validPaymentCreateBody,
      ...source,
      sourceType
    };
    const result = await validatePaymentBody("create", 0, value);

    expect(result).toEqual(value);
    expect(result).toBeInstanceOf(paymentBodyMetatype("create", 0));
  });

  it.each(["approve", "reject", "reject_previous", "return_to_applicant"] as const)(
    "accepts the %s approval decision through the controller runtime DTO",
    async (decision) => {
      const value = { decision, approvedAmountCents: "0", comment: "审批意见" };
      const result = await validatePaymentBody("reviewApproval", 2, value);

      expect(result).toEqual(value);
      expect(result).toBeInstanceOf(paymentBodyMetatype("reviewApproval", 2));
    }
  );

  it.each([
    ["transferApproval", { toUserId: "user-2" }],
    ["delegateApproval", { toUserId: "user-2" }],
    [
      "recordExecution",
      {
        amountCents: "10000",
        paidAt: "2026-07-11",
        voucherFileId: "file-1",
        confirmationPassword: "current-password"
      }
    ],
    [
      "recordFinance",
      {
        amountCents: "10000",
        occurredAt: "2026-07-11T10:00:00.000Z",
        confirmationPassword: "current-password"
      }
    ],
    ["recordPdfArchive", { fileId: "file-1", templateKey: "payment", departmentScope: "finance" }],
    ["generatePdfArchive", {}]
  ] as const)("accepts a valid %s body through its runtime DTO", async (method, value) => {
    const result = await validatePaymentBody(method, 2, value);

    expect(result).toEqual(value);
    expect(result).toBeInstanceOf(paymentBodyMetatype(method, 2));
  });

  it.each([100, -1, "-1", "1.2", "1e3", " 1", "01", ""])(
    "rejects a non-canonical requested amount: %p",
    async (requestedAmountCents) => {
      const response = await getPaymentValidationResponse("create", 0, {
        ...validPaymentCreateBody,
        requestedAmountCents
      });

      expect(response.errors).toEqual(expect.arrayContaining([expect.any(String)]));
    }
  );

  it("allows zero through the DTO so the existing service rule remains authoritative", async () => {
    const result = await validatePaymentBody("create", 0, {
      ...validPaymentCreateBody,
      requestedAmountCents: "0"
    });

    expect(result).toEqual({ ...validPaymentCreateBody, requestedAmountCents: "0" });
  });

  it("rejects unknown payment fields without exposing their values", async () => {
    const response = await getPaymentValidationResponse("create", 0, {
      ...validPaymentCreateBody,
      internalSecret: "TOP-SECRET"
    });

    expect(response.errors).toEqual(["internalSecret 不是允许提交的字段"]);
    expect(JSON.stringify(response)).not.toContain("TOP-SECRET");
  });

  it.each(["not-a-date", "2026-13-40"])("rejects an invalid execution date: %s", async (paidAt) => {
    const response = await getPaymentValidationResponse("recordExecution", 2, {
      amountCents: "10000",
      paidAt,
      voucherFileId: "file-1",
      confirmationPassword: "current-password"
    });

    expect(response.errors).toContain("付款日期格式不正确");
  });

  it.each([
    [
      "recordExecution",
      { amountCents: "100", paidAt: "2026-02-30", voucherFileId: "file-1", confirmationPassword: "pwd" },
      "付款日期格式不正确"
    ],
    [
      "recordFinance",
      { amountCents: "100", occurredAt: "2026-02-30", confirmationPassword: "pwd" },
      "入账日期格式不正确"
    ]
  ] as const)("rejects a non-existent calendar date for %s", async (method, value, message) => {
    const response = await getPaymentValidationResponse(method, 2, value);

    expect(response.errors).toContain(message);
  });

  it.each(["2026-07-11", "2026-07-11T10:00:00.000Z"])(
    "accepts a supported execution date: %s",
    async (paidAt) => {
      await expect(
        validatePaymentBody("recordExecution", 2, {
          amountCents: "10000",
          paidAt,
          voucherFileId: "file-1",
          confirmationPassword: "current-password"
        })
      ).resolves.toBeDefined();
    }
  );

  it.each([
    ["transferApproval", { toUserId: "" }],
    ["recordExecution", { amountCents: "100", paidAt: "2026-07-11", voucherFileId: "", confirmationPassword: "pwd" }],
    ["recordFinance", { amountCents: "100", occurredAt: "2026-07-11", confirmationPassword: "" }],
    ["recordPdfArchive", { fileId: "" }]
  ] as const)("rejects empty required fields for %s", async (method, value) => {
    const response = await getPaymentValidationResponse(method, 2, value);

    expect(response.errors).toEqual(expect.arrayContaining([expect.any(String)]));
  });

  it("rejects an unsupported payment source and approval decision", async () => {
    const sourceResponse = await getPaymentValidationResponse("create", 0, {
      ...validPaymentCreateBody,
      sourceType: "invoice"
    });
    const decisionResponse = await getPaymentValidationResponse("reviewApproval", 2, {
      decision: "skip"
    });

    expect(sourceResponse.errors).toContain("付款来源类型不正确");
    expect(decisionResponse.errors).toContain("审批决定不正确");
  });

  it("rejects an explicit null payment source instead of applying the service default", async () => {
    const response = await getPaymentValidationResponse("create", 0, {
      ...validPaymentCreateBody,
      sourceType: null
    });

    expect(response.errors).toContain("付款来源类型不正确");
  });

  it("allows an omitted payment source so the service keeps its settlement default", async () => {
    const value = {
      settlementId: "settlement-1",
      code: "FK-2026-001",
      requestedAmountCents: "10000"
    };
    const result = await validatePaymentBody("create", 0, value);

    expect(result).toEqual(value);
    expect((result as { sourceType?: string }).sourceType).toBeUndefined();
  });

  it("rejects whitespace-only payment business identifiers and passwords", async () => {
    const createResponse = await getPaymentValidationResponse("create", 0, {
      ...validPaymentCreateBody,
      code: "   ",
      settlementId: "   "
    });
    const assignResponse = await getPaymentValidationResponse("transferApproval", 2, {
      toUserId: "   "
    });
    const executionResponse = await getPaymentValidationResponse("recordExecution", 2, {
      amountCents: "100",
      paidAt: "2026-07-11",
      voucherFileId: "   ",
      confirmationPassword: "   "
    });

    expect(createResponse.errors).toEqual(expect.arrayContaining([expect.any(String)]));
    expect(assignResponse.errors).toEqual(expect.arrayContaining([expect.any(String)]));
    expect(executionResponse.errors).toEqual(expect.arrayContaining([expect.any(String)]));
  });

  it.each([
    [{ ...validPaymentCreateBody, code: "   " }, "付款单号不能为空白"],
    [{ ...validPaymentCreateBody, requestedAmountCents: 100 }, "付款申请金额格式不正确"],
    [{ ...validPaymentCreateBody, settlementId: null }, "结算单编号必须是文字"]
  ])("returns one precise payment field error for %p", async (value, message) => {
    const response = await getPaymentValidationResponse("create", 0, value);

    expect(response.errors).toEqual([message]);
  });

  it.each([
    { settlementId: null },
    { contractVersionId: "   " },
    { paymentTermsVersionId: "   " }
  ])("rejects an invalid optional payment association: %p", async (association) => {
    const response = await getPaymentValidationResponse("create", 0, {
      ...validPaymentCreateBody,
      ...association
    });

    expect(response.errors).toEqual(expect.arrayContaining([expect.any(String)]));
  });

  it.each([
    ["reviewApproval", { decision: "approve", comment: null }],
    ["recordPdfArchive", { fileId: "file-1", templateKey: null }],
    ["generatePdfArchive", { departmentScope: null }]
  ] as const)("rejects explicit null for optional text in %s", async (method, value) => {
    const response = await getPaymentValidationResponse(method, 2, value);

    expect(response.errors).toEqual(expect.arrayContaining([expect.any(String)]));
  });

  it("passes the transformed runtime DTO to the payment service exactly once", async () => {
    const payments = { create: jest.fn().mockResolvedValue({ id: "payment-1" }) };
    const controller = new PaymentController({} as never, payments as never, {} as never);
    const body = await validatePaymentBody("create", 0, validPaymentCreateBody);

    await controller.create(body as never, { id: "user-1" } as never);

    expect(payments.create).toHaveBeenCalledTimes(1);
    expect(payments.create).toHaveBeenCalledWith(body, "user-1");
  });

  it("is not publicly accessible (auth guard must run)", () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, PaymentController)).toBeFalsy();
  });

  it.each([
    ["create", "payment.create"],
    ["contractApplication", "payment.create"],
    ["reviewApproval", "payment.approve"],
    ["transferApproval", "payment.approve"],
    ["delegateApproval", "payment.approve"],
    ["recordExecution", "payment.execution"],
    ["recordFinance", "payment.finance_record"],
    ["recordPdfArchive", "payment.pdf_archive"],
    ["generatePdfArchive", "payment.pdf_archive"]
  ])("guards %s with the %s action", (method, action) => {
    const handler = (PaymentController.prototype as unknown as Record<string, object>)[method];

    expect(Reflect.getMetadata(REQUIRED_PROJECT_ACTION_KEY, handler)).toBe(action);
  });

  it.each([["withdrawApproval"], ["remindApproval"]])(
    "allows the approval applicant to %s without project approval action metadata",
    (method) => {
      const handler = (PaymentController.prototype as unknown as Record<string, object>)[method];

      expect(Reflect.getMetadata(REQUIRED_PROJECT_ACTION_KEY, handler)).toBeUndefined();
    }
  );

  it("guards the payment ledger with business positions", () => {
    expect(Reflect.getMetadata(REQUIRED_POSITIONS_KEY, PaymentController.prototype.list)).toEqual([
      "chairman",
      "general_manager",
      "project_manager",
      "contract_director",
      "contract_staff",
      "budget_director",
      "budget_staff",
      "finance_director",
      "finance_staff",
      "super_admin"
    ]);
  });

  it("forwards contract application preview requests to the payment read service", async () => {
    const paymentRead = {
      getContractApplication: jest.fn().mockResolvedValue({ contract: { contractVersionId: "contract-version-1" } })
    };
    const controller = new PaymentController(paymentRead as never, {} as never, {} as never);

    await expect(controller.contractApplication("contract-version-1")).resolves.toEqual({
      contract: { contractVersionId: "contract-version-1" }
    });
    expect(paymentRead.getContractApplication).toHaveBeenCalledWith("contract-version-1");
  });

  it("forwards visible project ids to payment detail reads", async () => {
    const paymentRead = { getDetail: jest.fn().mockResolvedValue({ id: "payment-1" }) };
    const projectVisibility = { visibleProjectIds: jest.fn().mockResolvedValue(["project-1"]) };
    const controller = new PaymentController(paymentRead as never, {} as never, projectVisibility as never);

    await controller.detail("FK-2026-011", { id: "user-1" } as never);

    expect(projectVisibility.visibleProjectIds).toHaveBeenCalledWith("user-1");
    expect(paymentRead.getDetail).toHaveBeenCalledWith("FK-2026-011", ["project-1"], "user-1");
  });
});
