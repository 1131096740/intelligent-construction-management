import "reflect-metadata";
import { BadRequestException } from "@nestjs/common";
import { IS_PUBLIC_KEY } from "../auth/decorators/public.decorator";
import { REQUIRED_POSITIONS_KEY } from "../auth/decorators/require-positions.decorator";
import { REQUIRED_PROJECT_ACTION_KEY } from "../auth/decorators/require-project-role.decorator";
import { createApiValidationPipe } from "../validation/api-validation";
import { SettlementController } from "./settlement.controller";

type RuntimeDto = new () => object;

const settlementBodyRoutes = [
  ["create", 0],
  ["reviewApproval", 2],
  ["transferApproval", 2],
  ["delegateApproval", 2],
  ["uploadArchiveFile", 2],
  ["confirmArchiveFile", 2],
  ["generatePdfArchive", 2],
  ["downloadLatestApprovalPdf", 2]
] as const;

const validSettlementCreate = {
  contractVersionId: "contract-version-1",
  code: "JS-2026-001",
  periodLabel: "2026-07",
  amountCents: "1000000"
};

const validSettlementBodies = [
  ["create", 0, validSettlementCreate],
  ["reviewApproval", 2, { decision: "approve" }],
  ["transferApproval", 2, { toUserId: "user-2" }],
  ["delegateApproval", 2, { toUserId: "user-2" }],
  ["uploadArchiveFile", 2, { fileId: "file-1" }],
  [
    "confirmArchiveFile",
    2,
    { archiveFileId: "archive-file-1", confirmationPassword: "current-password" }
  ],
  ["generatePdfArchive", 2, {}],
  [
    "downloadLatestApprovalPdf",
    2,
    { confirmationPassword: "current-password", downloadReason: "结算审批复核" }
  ]
] as const;

function settlementBodyMetatype(method: string, bodyIndex: number) {
  const paramTypes = Reflect.getMetadata(
    "design:paramtypes",
    SettlementController.prototype,
    method
  ) as RuntimeDto[] | undefined;
  return paramTypes?.[bodyIndex];
}

async function validateSettlementBody(method: string, bodyIndex: number, value: unknown) {
  const metatype = settlementBodyMetatype(method, bodyIndex);
  if (!metatype) throw new Error(`Missing body metatype for SettlementController.${method}`);
  return createApiValidationPipe().transform(value, {
    type: "body",
    metatype,
    data: undefined
  });
}

async function getSettlementValidationResponse(
  method: string,
  bodyIndex: number,
  value: unknown,
  onValid?: (body: object) => unknown
) {
  try {
    const body = await validateSettlementBody(method, bodyIndex, value);
    await onValid?.(body);
  } catch (error) {
    expect(error).toBeInstanceOf(BadRequestException);
    return (error as BadRequestException).getResponse() as Record<string, unknown>;
  }
  throw new Error(`Expected SettlementController.${method} validation to reject the request`);
}

describe("SettlementController authorization wiring", () => {
  it.each(settlementBodyRoutes)("exposes a runtime DTO for %s", (method, bodyIndex) => {
    const metatype = settlementBodyMetatype(method, bodyIndex);

    expect(metatype).toBeDefined();
    expect(metatype).not.toBe(Object);
  });

  it.each(validSettlementBodies)(
    "transforms a valid %s body into its runtime DTO",
    async (method, bodyIndex, value) => {
      const result = await validateSettlementBody(method, bodyIndex, value);
      const metatype = settlementBodyMetatype(method, bodyIndex);

      expect(result).toBeInstanceOf(metatype);
      expect(result).toEqual(value);
    }
  );

  it.each(validSettlementBodies)(
    "rejects an unknown %s field before the service can run",
    async (method, bodyIndex, value) => {
      const service = jest.fn();
      const response = await getSettlementValidationResponse(
        method,
        bodyIndex,
        { ...value, internalSecret: "TOP-SECRET" },
        service
      );

      expect(service).not.toHaveBeenCalled();
      expect(response.errors).toEqual(["internalSecret 不是允许提交的字段"]);
      expect(JSON.stringify(response)).not.toContain("TOP-SECRET");
    }
  );

  it("keeps omitted and explicitly empty settlement lines compatible", async () => {
    await expect(validateSettlementBody("create", 0, validSettlementCreate)).resolves.toBeDefined();
    await expect(
      validateSettlementBody("create", 0, { ...validSettlementCreate, settlementLines: [] })
    ).resolves.toBeDefined();
  });

  it.each([
    [null, "结算明细必须是数组"],
    ["lines", "结算明细必须是数组"],
    [{}, "结算明细必须是数组"],
    [[123], "settlementLines[0] 填写不正确"]
  ])("rejects one invalid settlement-lines container: %p", async (settlementLines, message) => {
    const response = await getSettlementValidationResponse("create", 0, {
      ...validSettlementCreate,
      settlementLines
    });

    expect(response.errors).toEqual([message]);
  });

  it("rejects unknown nested settlement-line fields without exposing values", async () => {
    const response = await getSettlementValidationResponse("create", 0, {
      ...validSettlementCreate,
      settlementLines: [
        {
          sourceType: "manual_adjustment",
          name: "本期扣款",
          amountCents: "-100",
          reason: "现场签认",
          internalSecret: "TOP-SECRET"
        }
      ]
    });

    expect(response.errors).toEqual([
      "settlementLines[0].internalSecret 不是允许提交的字段"
    ]);
    expect(JSON.stringify(response)).not.toContain("TOP-SECRET");
  });

  it("accepts signed line bounds, quantity union forms and PostgreSQL Int sort order", async () => {
    const value = {
      ...validSettlementCreate,
      settlementLines: [
        {
          sourceType: "manual_adjustment",
          name: "扣款",
          quantity: "1.25",
          unitPriceCents: "9223372036854775807",
          amountCents: "-9223372036854775808",
          reason: "现场签认",
          sortOrder: -2147483648
        },
        {
          sourceType: "manual_adjustment",
          name: "补差",
          quantity: 2.5,
          amountCents: "9223372036854775807",
          reason: "补充确认",
          sortOrder: 2147483647
        }
      ]
    };

    await expect(validateSettlementBody("create", 0, value)).resolves.toEqual(value);
  });

  it("lets the service enforce the contract-bill-row positive business condition", async () => {
    const value = {
      ...validSettlementCreate,
      settlementLines: [
        {
          sourceType: "contract_bill_row",
          contractBillRowId: "bill-row-1",
          amountCents: "-1"
        }
      ]
    };

    await expect(validateSettlementBody("create", 0, value)).resolves.toEqual(value);
  });

  it.each([
    [{ settlementLines: [{ sourceType: "unknown", amountCents: "1" }] }, "结算明细来源类型不正确"],
    [{ amountCents: 100 }, "结算金额格式不正确"],
    [{ amountCents: "9223372036854775808" }, "金额超出系统可保存范围"],
    [
      { settlementLines: [{ sourceType: "manual_adjustment", amountCents: "9223372036854775808" }] },
      "结算明细金额超出系统可保存范围"
    ],
    [
      { settlementLines: [{ sourceType: "manual_adjustment", amountCents: "-9223372036854775809" }] },
      "结算明细金额超出系统可保存范围"
    ],
    [
      { settlementLines: [{ sourceType: "manual_adjustment", amountCents: "1", unitPriceCents: "-1" }] },
      "结算明细单价必须按分填写为 0 或更大的整数"
    ],
    [
      { settlementLines: [{ sourceType: "manual_adjustment", amountCents: "1", sortOrder: 2147483648 }] },
      "结算明细排序超出系统可保存范围"
    ]
  ])("rejects one invalid settlement scalar: %p", async (patch, message) => {
    const response = await getSettlementValidationResponse("create", 0, {
      ...validSettlementCreate,
      ...patch
    });

    expect(response.errors).toEqual([message]);
  });

  it.each([
    [{}, ["结算审批单下载密码必填", "结算审批单下载原因必填"]],
    [
      { confirmationPassword: "current-password", downloadReason: "   " },
      ["结算审批单下载原因不能为空白"]
    ],
    [
      { confirmationPassword: "current-password", downloadReason: "复".repeat(201) },
      ["结算审批单下载原因不能超过 200 个字"]
    ]
  ])("validates approval PDF download facts: %p", async (value, errors) => {
    const response = await getSettlementValidationResponse(
      "downloadLatestApprovalPdf",
      2,
      value
    );

    expect(response.errors).toEqual(errors);
  });

  it.each([
    ["reviewApproval", { decision: "unknown" }, "结算审批决定不正确"],
    ["transferApproval", { toUserId: "   " }, "请选择接收人"],
    ["delegateApproval", { toUserId: 123 }, "接收人编号必须是文字"],
    ["uploadArchiveFile", { fileId: "   " }, "请选择结算归档文件"],
    [
      "confirmArchiveFile",
      { archiveFileId: "archive-file-1", confirmationPassword: { secret: "TOP-SECRET" } },
      "当前登录密码必须是文字"
    ],
    ["generatePdfArchive", { templateKey: 123 }, "模板标识必须是文字"]
  ] as const)("rejects one invalid %s field before service execution", async (method, value, message) => {
    const service = jest.fn();
    const response = await getSettlementValidationResponse(method, 2, value, service);

    expect(service).not.toHaveBeenCalled();
    expect(response.errors).toEqual([message]);
    expect(JSON.stringify(response)).not.toContain("TOP-SECRET");
  });

  it("is not publicly accessible (auth guard must run)", () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, SettlementController)).toBeFalsy();
  });

  it.each([
    ["create", "settlement.create"],
    ["reviewApproval", "settlement.approve"],
    ["transferApproval", "settlement.approve"],
    ["delegateApproval", "settlement.approve"],
    ["uploadArchiveFile", "settlement.archive.upload"],
    ["confirmArchiveFile", "settlement.archive.confirm"],
    ["generatePdfArchive", "settlement.archive.upload"],
    ["downloadDraftExcel", "settlement.archive.upload"],
    ["downloadAttachmentTemplate", "settlement.archive.upload"]
  ])("guards %s with the %s action", (method, action) => {
    const handler = (SettlementController.prototype as unknown as Record<string, object>)[method];

    expect(Reflect.getMetadata(REQUIRED_PROJECT_ACTION_KEY, handler)).toBe(action);
  });

  it.each([["withdrawApproval"], ["remindApproval"], ["downloadLatestApprovalPdf"]])(
    "allows the approval applicant to %s without project approval action metadata",
    (method) => {
      const handler = (SettlementController.prototype as unknown as Record<string, object>)[method];

      expect(Reflect.getMetadata(REQUIRED_PROJECT_ACTION_KEY, handler)).toBeUndefined();
    }
  );

  it("guards the settlement ledger with business positions", () => {
    expect(Reflect.getMetadata(REQUIRED_POSITIONS_KEY, SettlementController.prototype.list)).toEqual([
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

  it("forwards visible project ids to settlement detail reads", async () => {
    const settlementRead = { getDetail: jest.fn().mockResolvedValue({ id: "settlement-1" }) };
    const projectVisibility = { visibleProjectIds: jest.fn().mockResolvedValue(["project-1"]) };
    const controller = new SettlementController(
      settlementRead as never,
      {} as never,
      {} as never,
      projectVisibility as never
    );

    await controller.detail("JS-2026-031", { id: "user-1" } as never);

    expect(projectVisibility.visibleProjectIds).toHaveBeenCalledWith("user-1");
    expect(settlementRead.getDetail).toHaveBeenCalledWith("JS-2026-031", ["project-1"], "user-1");
  });
});
