import "reflect-metadata";
import { BadRequestException } from "@nestjs/common";
import { REQUIRED_POSITIONS_KEY } from "../auth/decorators/require-positions.decorator";
import { REQUIRED_PROJECT_ACTION_KEY } from "../auth/decorators/require-project-role.decorator";
import { createApiValidationPipe } from "../validation/api-validation";
import { ProjectExpenseController } from "./project-expense.controller";

type ExpenseBodyMethod =
  | "create"
  | "reviewApproval"
  | "createAttachmentDownloadTicket"
  | "createApprovalPdfDownloadTicket"
  | "voidRequest"
  | "recordExecution"
  | "recordPurchaseExecution"
  | "recordFinance"
  | "confirmPurchaseReceipt";

function expenseBodyMetatype(method: ExpenseBodyMethod) {
  const paramTypes = Reflect.getMetadata(
    "design:paramtypes",
    ProjectExpenseController.prototype,
    method
  ) as Array<new () => object> | undefined;
  expect(paramTypes).toBeDefined();
  const metatype = paramTypes?.[method === "create" ? 2 : 3];
  expect(metatype).toBeDefined();
  expect(metatype).not.toBe(Object);
  return metatype as new () => object;
}

async function validateExpenseBody(method: ExpenseBodyMethod, value: unknown) {
  return createApiValidationPipe().transform(value, {
    type: "body",
    metatype: expenseBodyMetatype(method),
    data: undefined
  });
}

async function getExpenseValidationResponse(
  method: ExpenseBodyMethod,
  value: unknown
): Promise<Record<string, unknown>> {
  try {
    await validateExpenseBody(method, value);
  } catch (error) {
    expect(error).toBeInstanceOf(BadRequestException);
    return (error as BadRequestException).getResponse() as Record<string, unknown>;
  }
  throw new Error("Expected project expense body validation to reject the request");
}

const validExpenseCreateBody = {
  code: "ZC-2026-001",
  expenseType: "sporadic_payment",
  expenseSubtype: "sporadic_material",
  paymentSubject: "建工智管",
  reason: "零星材料",
  requestedAmountCents: "10000",
  paymentMethod: "bank_transfer"
};

describe("ProjectExpenseController authorization wiring", () => {
  it("保留项目支出领导自审原因和当前密码", async () => {
    const value = {
      decision: "approve",
      selfReviewReason: "项目紧急且由本人发起",
      confirmationPassword: "current-password"
    };

    await expect(validateExpenseBody("reviewApproval", value)).resolves.toEqual(value);
  });

  it("按 Unicode code point 校验项目支出自审字段边界", async () => {
    const boundary = "❤️".repeat(250);
    await expect(
      validateExpenseBody("reviewApproval", {
        decision: "approve",
        selfReviewReason: boundary,
        confirmationPassword: "❤️".repeat(128)
      })
    ).resolves.toBeDefined();

    const reasonResponse = await getExpenseValidationResponse("reviewApproval", {
      decision: "approve",
      selfReviewReason: `${boundary}原`
    });
    expect(reasonResponse.errors).toContain("自审原因不能超过 500 个字符");

    const passwordResponse = await getExpenseValidationResponse("reviewApproval", {
      decision: "approve",
      confirmationPassword: `${"❤️".repeat(128)}密`
    });
    expect(passwordResponse.errors).toContain("当前密码格式不正确");
  });

  it.each([
    ["selfReviewReason", null, "自审原因必须是文字"],
    ["selfReviewReason", [], "自审原因必须是文字"],
    ["selfReviewReason", {}, "自审原因必须是文字"],
    ["selfReviewReason", 123, "自审原因必须是文字"],
    ["selfReviewReason", "原".repeat(501), "自审原因不能超过 500 个字符"],
    ["confirmationPassword", null, "当前密码必须是文字"],
    ["confirmationPassword", [], "当前密码必须是文字"],
    ["confirmationPassword", {}, "当前密码必须是文字"],
    ["confirmationPassword", 123, "当前密码必须是文字"],
    ["confirmationPassword", "密".repeat(257), "当前密码格式不正确"]
  ] as const)("拒绝项目支出自审字段 %s 的非法值", async (field, value, message) => {
    const response = await getExpenseValidationResponse("reviewApproval", {
      decision: "approve",
      [field]: value
    });

    expect(response.errors).toContain(message);
  });

  it("拒绝项目支出审批未知字段且不回显当前密码", async () => {
    const response = await getExpenseValidationResponse("reviewApproval", {
      decision: "approve",
      selfReviewReason: "业务紧急",
      confirmationPassword: "current-password",
      internalSecret: "TOP-SECRET"
    });

    expect(response.errors).toEqual(["internalSecret 不是允许提交的字段"]);
    expect(JSON.stringify(response)).not.toContain("current-password");
    expect(JSON.stringify(response)).not.toContain("TOP-SECRET");
  });
  const fundsOverviewPositions = [
    "chairman",
    "general_manager",
    "project_manager",
    "finance_director",
    "finance_staff",
    "material_director",
    "material_staff"
  ];

  it.each([
    "sporadic_payment",
    "loan_reserve",
    "comprehensive_expense",
    "reimbursement",
    "spot_purchase"
  ])("accepts the %s expense type through the controller runtime DTO", async (expenseType) => {
    const result = await validateExpenseBody("create", {
      ...validExpenseCreateBody,
      expenseType
    });

    expect(result).toBeInstanceOf(expenseBodyMetatype("create"));
  });

  it.each([
    "sporadic_material",
    "sporadic_machinery",
    "sporadic_labor",
    "temporary_service",
    "other_sporadic",
    "employee_loan",
    "owner_loan",
    "project_reserve",
    "travel",
    "entertainment",
    "reimbursement",
    "spot_material_purchase",
    "spot_tool_purchase",
    "spot_service_purchase",
    "spot_other_purchase"
  ])("accepts the %s subtype structurally and leaves type compatibility to the service", async (expenseSubtype) => {
    await expect(
      validateExpenseBody("create", { ...validExpenseCreateBody, expenseSubtype })
    ).resolves.toBeDefined();
  });

  it.each(["cash", "wechat", "alipay", "bank_transfer", "other"])(
    "accepts the %s payment method",
    async (paymentMethod) => {
      await expect(
        validateExpenseBody("create", { ...validExpenseCreateBody, paymentMethod })
      ).resolves.toBeDefined();
    }
  );

  it.each([
    ["reviewApproval", { decision: "approve", approvedAmountCents: "0", comment: "同意" }],
    [
      "createAttachmentDownloadTicket",
      { confirmationPassword: "current-password", downloadReason: "附件复核" }
    ],
    [
      "createApprovalPdfDownloadTicket",
      { confirmationPassword: "current-password", downloadReason: "审批单复核" }
    ],
    ["voidRequest", { reason: "重复申请" }],
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
      "recordPurchaseExecution",
      { executedAt: "2026-07-11T10:00:00.000Z", note: "已采购", confirmationPassword: "current-password" }
    ],
    [
      "recordFinance",
      { amountCents: "10000", occurredAt: "2026-07-11", confirmationPassword: "current-password" }
    ],
    ["confirmPurchaseReceipt", { confirmationPassword: "current-password", note: "数量无误" }]
  ] as const)("accepts a valid %s body through its runtime DTO", async (method, value) => {
    const result = await validateExpenseBody(method, value);

    expect(result).toEqual(value);
    expect(result).toBeInstanceOf(expenseBodyMetatype(method));
  });

  it.each([100, -1, "-1", "1.2", "1e3", " 1", "01", ""])(
    "rejects a non-canonical expense amount: %p",
    async (requestedAmountCents) => {
      const response = await getExpenseValidationResponse("create", {
        ...validExpenseCreateBody,
        requestedAmountCents
      });

      expect(response.errors).toEqual(expect.arrayContaining([expect.any(String)]));
    }
  );

  it("allows zero through the expense DTO and keeps the positive service rule", async () => {
    const result = await validateExpenseBody("create", {
      ...validExpenseCreateBody,
      requestedAmountCents: "0"
    });

    expect(result).toEqual({ ...validExpenseCreateBody, requestedAmountCents: "0" });
  });

  it("rejects unsupported expense enums", async () => {
    const typeResponse = await getExpenseValidationResponse("create", {
      ...validExpenseCreateBody,
      expenseType: "invoice"
    });
    const subtypeResponse = await getExpenseValidationResponse("create", {
      ...validExpenseCreateBody,
      expenseSubtype: "hotel"
    });
    const methodResponse = await getExpenseValidationResponse("create", {
      ...validExpenseCreateBody,
      paymentMethod: "credit_card"
    });

    expect(typeResponse.errors).toContain("费用类型不正确");
    expect(subtypeResponse.errors).toContain("费用子类不正确");
    expect(methodResponse.errors).toContain("付款方式不正确");
  });

  it("rejects unknown expense fields without exposing submitted values", async () => {
    const response = await getExpenseValidationResponse("create", {
      ...validExpenseCreateBody,
      internalSecret: "TOP-SECRET"
    });

    expect(response.errors).toEqual(["internalSecret 不是允许提交的字段"]);
    expect(JSON.stringify(response)).not.toContain("TOP-SECRET");
  });

  it("rejects whitespace-only expense identifiers and required text", async () => {
    const response = await getExpenseValidationResponse("create", {
      ...validExpenseCreateBody,
      code: "   ",
      paymentSubject: "   ",
      reason: "   "
    });

    expect(response.errors).toEqual(expect.arrayContaining([expect.any(String)]));
  });

  it.each([
    [{ ...validExpenseCreateBody, code: "   " }, "申请单号不能为空白"],
    [{ ...validExpenseCreateBody, requestedAmountCents: 100 }, "申请金额格式不正确"],
    [{ ...validExpenseCreateBody, attachmentFileId: null }, "附件编号必须是文字"]
  ])("returns one precise expense field error for %p", async (value, message) => {
    const response = await getExpenseValidationResponse("create", value);

    expect(response.errors).toEqual([message]);
  });

  it.each([
    { handlerUserId: null },
    { attachmentFileId: "   " }
  ])("rejects an invalid optional expense association: %p", async (association) => {
    const response = await getExpenseValidationResponse("create", {
      ...validExpenseCreateBody,
      ...association
    });

    expect(response.errors).toEqual(expect.arrayContaining([expect.any(String)]));
  });

  it.each([
    ["createAttachmentDownloadTicket", "   ", "下载".repeat(101)],
    ["createApprovalPdfDownloadTicket", "", "下载".repeat(101)]
  ] as const)("rejects blank password and overlong reason for %s", async (method, confirmationPassword, downloadReason) => {
    const response = await getExpenseValidationResponse(method, {
      confirmationPassword,
      downloadReason
    });

    expect(response.errors).toEqual(
      expect.arrayContaining(["请输入当前登录密码", "下载原因不能超过 200 个字"])
    );
  });

  it.each([
    ["recordExecution", { amountCents: "100", paidAt: "bad", voucherFileId: "", confirmationPassword: "" }],
    ["recordPurchaseExecution", { executedAt: "bad", confirmationPassword: "" }],
    ["recordFinance", { amountCents: "100", occurredAt: "bad", confirmationPassword: "" }],
    ["confirmPurchaseReceipt", { confirmationPassword: "" }],
    ["voidRequest", { reason: "" }]
  ] as const)("rejects invalid required fields for %s", async (method, value) => {
    const response = await getExpenseValidationResponse(method, value);

    expect(response.errors).toEqual(expect.arrayContaining([expect.any(String)]));
  });

  it.each([
    [
      "recordExecution",
      { amountCents: "100", paidAt: "2026-02-30", voucherFileId: "file-1", confirmationPassword: "pwd" },
      "付款日期格式不正确"
    ],
    [
      "recordPurchaseExecution",
      { executedAt: "2026-02-30", confirmationPassword: "pwd" },
      "采购执行日期格式不正确"
    ],
    [
      "recordFinance",
      { amountCents: "100", occurredAt: "2026-02-30", confirmationPassword: "pwd" },
      "入账日期格式不正确"
    ]
  ] as const)("rejects a non-existent calendar date for %s", async (method, value, message) => {
    const response = await getExpenseValidationResponse(method, value);

    expect(response.errors).toContain(message);
  });

  it.each([
    ["create", { ...validExpenseCreateBody, counterpartyName: null }],
    ["reviewApproval", { decision: "approve", comment: null }],
    ["recordPurchaseExecution", { executedAt: "2026-07-11", confirmationPassword: "pwd", note: null }],
    ["confirmPurchaseReceipt", { confirmationPassword: "pwd", note: null }]
  ] as const)("rejects explicit null for optional text in %s", async (method, value) => {
    const response = await getExpenseValidationResponse(method, value);

    expect(response.errors).toEqual(expect.arrayContaining([expect.any(String)]));
  });

  it("passes the transformed expense DTO to the service exactly once", async () => {
    const expenses = { create: jest.fn().mockResolvedValue({ id: "expense-1" }) };
    const controller = new ProjectExpenseController(expenses as never);
    const body = await validateExpenseBody("create", validExpenseCreateBody);

    await controller.create("project-1", { id: "user-1" } as never, body as never);

    expect(expenses.create).toHaveBeenCalledTimes(1);
    expect(expenses.create).toHaveBeenCalledWith("project-1", "user-1", body);
  });

  it("guards the expense request list with funds overview positions", () => {
    expect(Reflect.getMetadata(REQUIRED_POSITIONS_KEY, ProjectExpenseController.prototype.list)).toEqual(
      fundsOverviewPositions
    );
  });

  it.each([
    ["create", "project_expense.create"],
    ["reviewApproval", "project_expense.approve"],
    ["voidRequest", "project_expense.void"],
    ["recordPurchaseExecution", "project_expense.purchase_execute"],
    ["recordExecution", "project_expense.execution"],
    ["recordFinance", "project_expense.finance_record"],
    ["confirmPurchaseReceipt", "project_expense.receipt_confirm"]
  ])("guards %s with the %s action", (method, action) => {
    const handler = (ProjectExpenseController.prototype as unknown as Record<string, object>)[method];

    expect(Reflect.getMetadata(REQUIRED_PROJECT_ACTION_KEY, handler)).toBe(action);
  });

  it("keeps withdrawal applicant-scoped without project action metadata", () => {
    expect(
      Reflect.getMetadata(REQUIRED_PROJECT_ACTION_KEY, ProjectExpenseController.prototype.withdrawApproval)
    ).toBeUndefined();
  });

  it("keeps attachment ticket creation scoped by business file permission", () => {
    expect(
      Reflect.getMetadata(
        REQUIRED_PROJECT_ACTION_KEY,
        ProjectExpenseController.prototype.createAttachmentDownloadTicket
      )
    ).toBeUndefined();
    expect(
      Reflect.getMetadata(
        REQUIRED_PROJECT_ACTION_KEY,
        ProjectExpenseController.prototype.createApprovalPdfDownloadTicket
      )
    ).toBeUndefined();
  });

  it("forwards list requests to the service", async () => {
    const expenses = { list: jest.fn() };
    const controller = new ProjectExpenseController(expenses as never);

    await controller.list("project-1", { id: "user-1" } as never);

    expect(expenses.list).toHaveBeenCalledWith("project-1", "user-1");
  });

  it("forwards create requests with the authenticated user id", async () => {
    const expenses = { create: jest.fn() };
    const controller = new ProjectExpenseController(expenses as never);
    const body = {
      code: "ZC-2026-001",
      expenseType: "sporadic_payment" as const,
      expenseSubtype: "sporadic_material" as const,
      paymentSubject: "建工智管",
      reason: "零星材料",
      requestedAmountCents: "10000",
      paymentMethod: "bank_transfer" as const
    };

    await controller.create("project-1", { id: "user-1" } as never, body);

    expect(expenses.create).toHaveBeenCalledWith("project-1", "user-1", body);
  });

  it("forwards attachment download ticket requests with the authenticated user id", async () => {
    const expenses = { createAttachmentDownloadTicket: jest.fn() };
    const controller = new ProjectExpenseController(expenses as never);

    await controller.createAttachmentDownloadTicket(
      "project-1",
      "expense-1",
      { id: "user-1" } as never,
      { confirmationPassword: "current-password", downloadReason: "报销附件复核" }
    );

    expect(expenses.createAttachmentDownloadTicket).toHaveBeenCalledWith(
      "project-1",
      "expense-1",
      "user-1",
      "current-password",
      "报销附件复核"
    );
  });

  it("forwards approval PDF download ticket requests with the authenticated user id", async () => {
    const expenses = { createApprovalPdfDownloadTicket: jest.fn() };
    const controller = new ProjectExpenseController(expenses as never);

    await controller.createApprovalPdfDownloadTicket(
      "project-1",
      "expense-1",
      { id: "user-1" } as never,
      { confirmationPassword: "current-password", downloadReason: "审批单复核" }
    );

    expect(expenses.createApprovalPdfDownloadTicket).toHaveBeenCalledWith(
      "project-1",
      "expense-1",
      "user-1",
      "current-password",
      "审批单复核"
    );
  });

  it("forwards purchase execution requests with the authenticated user id", async () => {
    const expenses = { recordPurchaseExecution: jest.fn() };
    const controller = new ProjectExpenseController(expenses as never);
    const body = {
      executedAt: "2026-07-02T10:00:00.000Z",
      note: "已采购",
      confirmationPassword: "current-password"
    };

    await controller.recordPurchaseExecution(
      "project-1",
      "expense-1",
      { id: "user-1" } as never,
      body
    );

    expect(expenses.recordPurchaseExecution).toHaveBeenCalledWith(
      "project-1",
      "expense-1",
      "user-1",
      body
    );
  });

  it("forwards receipt confirmation requests with the authenticated user id", async () => {
    const expenses = { confirmPurchaseReceipt: jest.fn() };
    const controller = new ProjectExpenseController(expenses as never);
    const body = { confirmationPassword: "current-password", note: "数量无误" };

    await controller.confirmPurchaseReceipt(
      "project-1",
      "expense-1",
      { id: "user-1" } as never,
      body
    );

    expect(expenses.confirmPurchaseReceipt).toHaveBeenCalledWith(
      "project-1",
      "expense-1",
      "user-1",
      body
    );
  });
});
