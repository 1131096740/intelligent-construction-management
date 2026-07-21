import "reflect-metadata";
import { BadRequestException } from "@nestjs/common";
import { CONTRACT_SETTLEMENT_LEDGER_EXPORT_ROLE_KEYS } from "@jiangkong/shared-domain";
import { IS_PUBLIC_KEY } from "../auth/decorators/public.decorator";
import { REQUIRED_POSITIONS_KEY } from "../auth/decorators/require-positions.decorator";
import { LEDGER_READ_POSITION_KEYS } from "../auth/ledger-read-positions";
import { REQUIRED_PROJECT_ACTION_KEY } from "../auth/decorators/require-project-role.decorator";
import { createApiValidationPipe } from "../validation/api-validation";
import { SettlementController } from "./settlement.controller";
import { SettlementDraftController } from "./settlement-draft.controller";

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
  settlementTemplateVersionId: "settlement-template-version-1",
  code: "JS-2026-001",
  periodLabel: "2026-07",
  settlementLines: [
    {
      sourceType: "manual_adjustment",
      name: "签认调整",
      amountCents: "1000000",
      reason: "本期现场签认"
    }
  ]
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
  it("保留结算领导自审原因和当前密码", async () => {
    const value = {
      decision: "approve",
      selfReviewReason: "项目紧急且由本人发起",
      confirmationPassword: "current-password"
    };

    await expect(validateSettlementBody("reviewApproval", 2, value)).resolves.toEqual(value);
  });

  it("按 Unicode code point 校验结算自审字段边界", async () => {
    const boundary = "❤️".repeat(250);
    await expect(
      validateSettlementBody("reviewApproval", 2, {
        decision: "approve",
        selfReviewReason: boundary,
        confirmationPassword: "❤️".repeat(128)
      })
    ).resolves.toBeDefined();

    const reasonResponse = await getSettlementValidationResponse("reviewApproval", 2, {
      decision: "approve",
      selfReviewReason: `${boundary}原`
    });
    expect(reasonResponse.errors).toContain("自审原因不能超过 500 个字符");

    const passwordResponse = await getSettlementValidationResponse("reviewApproval", 2, {
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
  ] as const)("拒绝结算自审字段 %s 的非法值", async (field, value, message) => {
    const response = await getSettlementValidationResponse("reviewApproval", 2, {
      decision: "approve",
      [field]: value
    });

    expect(response.errors).toContain(message);
  });

  it("拒绝结算审批未知字段且不回显当前密码", async () => {
    const response = await getSettlementValidationResponse("reviewApproval", 2, {
      decision: "approve",
      selfReviewReason: "业务紧急",
      confirmationPassword: "current-password",
      internalSecret: "TOP-SECRET"
    });

    expect(response.errors).toEqual(["internalSecret 不是允许提交的字段"]);
    expect(JSON.stringify(response)).not.toContain("current-password");
    expect(JSON.stringify(response)).not.toContain("TOP-SECRET");
  });
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

  it("rejects omitted or empty settlement lines before the service can run", async () => {
    const withoutLines: Record<string, unknown> = { ...validSettlementCreate };
    delete withoutLines.settlementLines;
    const omitted = await getSettlementValidationResponse("create", 0, withoutLines);
    const empty = await getSettlementValidationResponse("create", 0, {
      ...validSettlementCreate,
      settlementLines: []
    });

    expect(omitted.errors).toEqual([
      "请至少选择一条本期真实发生的合同清单项或填写一条人工调整"
    ]);
    expect(empty.errors).toEqual([
      "请至少选择一条本期真实发生的合同清单项或填写一条人工调整"
    ]);
  });

  it.each([
    [null, "请至少选择一条本期真实发生的合同清单项或填写一条人工调整"],
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

  it.each(["", "999999999999999999.99", "-999999999999999999.99", "1e3", 1e3])(
    "keeps a storable settlement quantity compatible: %p",
    async (quantity) => {
      await expect(
        validateSettlementBody("create", 0, {
          ...validSettlementCreate,
          settlementLines: [
            {
              sourceType: "manual_adjustment",
              name: "工程量兼容项",
              quantity,
              amountCents: "1",
              reason: "测试工程量边界"
            }
          ]
        })
      ).resolves.toBeDefined();
    }
  );

  it.each([
    null,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    "NaN",
    "Infinity",
    "-Infinity",
    "1e100",
    "0.001",
    "1000000000000000000",
    "-1000000000000000000",
    {}
  ])("rejects an unstorable settlement quantity before service execution: %p", async (quantity) => {
    const service = jest.fn();
    const response = await getSettlementValidationResponse(
      "create",
      0,
      {
        ...validSettlementCreate,
        settlementLines: [
          {
            sourceType: "manual_adjustment",
            name: "工程量越界项",
            quantity,
            amountCents: "1",
            reason: "测试工程量边界"
          }
        ]
      },
      service
    );

    expect(service).not.toHaveBeenCalled();
    expect(response.errors).toEqual([
      "本期结算数量最多保留 2 位小数，请修改后重试。"
    ]);
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

  it("guards settlement list and detail with the shared ledger read policy", () => {
    expect(Reflect.getMetadata(REQUIRED_POSITIONS_KEY, SettlementController.prototype.list)).toEqual(
      LEDGER_READ_POSITION_KEYS
    );
    expect(Reflect.getMetadata(REQUIRED_POSITIONS_KEY, SettlementController.prototype.detail)).toEqual(
      LEDGER_READ_POSITION_KEYS
    );
  });

  it("limits settlement ledger export to the approved contract, finance and comprehensive positions", () => {
    expect(
      Reflect.getMetadata(REQUIRED_POSITIONS_KEY, SettlementController.prototype.exportLedger)
    ).toEqual(CONTRACT_SETTLEMENT_LEDGER_EXPORT_ROLE_KEYS);
  });

  it("forwards visible project ids and the actor to settlement ledger export", async () => {
    const settlementRead = {
      exportLedger: jest.fn().mockResolvedValue({
        buffer: Buffer.from("xlsx"),
        fileName: "结算台账.xlsx"
      })
    };
    const projectVisibility = { visibleProjectIds: jest.fn().mockResolvedValue(["project-1"]) };
    const response = { set: jest.fn() };
    const controller = new SettlementController(
      settlementRead as never,
      {} as never,
      {} as never,
      projectVisibility as never,
      {} as never
    );

    await controller.exportLedger({ id: "user-1" } as never, response);

    expect(projectVisibility.visibleProjectIds).toHaveBeenCalledWith("user-1");
    expect(settlementRead.exportLedger).toHaveBeenCalledWith(["project-1"], "user-1");
    expect(response.set).toHaveBeenCalledWith(
      expect.objectContaining({
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      })
    );
  });

  it("forwards visible project ids to settlement detail reads", async () => {
    const settlementRead = { getDetail: jest.fn().mockResolvedValue({ id: "settlement-1" }) };
    const projectVisibility = { visibleProjectIds: jest.fn().mockResolvedValue(["project-1"]) };
    const controller = new SettlementController(
      settlementRead as never,
      {} as never,
      {} as never,
      projectVisibility as never,
      {} as never
    );

    await controller.detail("JS-2026-031", { id: "user-1" } as never);

    expect(projectVisibility.visibleProjectIds).toHaveBeenCalledWith("user-1");
    expect(settlementRead.getDetail).toHaveBeenCalledWith("JS-2026-031", ["project-1"], "user-1");
  });

  it("keeps POST /settlements compatible while delegating to the single submission service", async () => {
    const legacy = { create: jest.fn() };
    const submissions = {
      submit: jest.fn().mockResolvedValue({ id: "settlement-1" })
    };
    const controller = new SettlementController(
      {} as never,
      {} as never,
      legacy as never,
      {} as never,
      submissions as never
    );

    await expect(
      controller.create(validSettlementCreate as never, { id: "user-1" } as never)
    ).resolves.toEqual({ id: "settlement-1" });
    expect(submissions.submit).toHaveBeenCalledWith(
      validSettlementCreate,
      "user-1"
    );
    expect(legacy.create).not.toHaveBeenCalled();
  });

  it.each(["create", "list", "detail", "update", "abandon", "submit", "linkCounterpartySignedDocument"] as const)(
    "protects settlement draft %s with settlement.create",
    (method) => {
      expect(
        Reflect.getMetadata(
          REQUIRED_PROJECT_ACTION_KEY,
          SettlementDraftController.prototype[method]
        )
      ).toBe("settlement.create");
    }
  );

  it("uses a validated DTO for settlement draft abandonment", async () => {
    const paramTypes = Reflect.getMetadata(
      "design:paramtypes",
      SettlementDraftController.prototype,
      "abandon"
    ) as RuntimeDto[];
    const metatype = paramTypes[3];
    await expect(createApiValidationPipe().transform({
      expectedRevision: 2,
      action: "delete_pristine_draft"
    }, { type: "body", metatype, data: undefined })).resolves.toBeInstanceOf(metatype);
  });

  it("uses a validated dedicated DTO for the counterparty signed-document association", async () => {
    const paramTypes = Reflect.getMetadata(
      "design:paramtypes",
      SettlementDraftController.prototype,
      "linkCounterpartySignedDocument"
    ) as RuntimeDto[];
    const metatype = paramTypes[3];
    expect(metatype).toBeDefined();
    await expect(createApiValidationPipe().transform({
      expectedRevision: 3,
      frozenDocumentId: "frozen-1",
      uploadedFileId: "uploaded-1",
      declaration: {
        pageOrderMatchesFrozenDocument: true,
        counterpartySignedAndDated: true,
        everyPageStamped: true,
        crossPageSealCompleted: false
      }
    }, { type: "body", metatype, data: undefined })).resolves.toBeInstanceOf(metatype);
  });

  it("guards and forwards a pure-rendering signed-document regeneration", async () => {
    const signedDocuments = { generateFinal: jest.fn().mockResolvedValue({ id: "final-2" }) };
    const controller = new SettlementController(
      {} as never, {} as never, {} as never, {} as never, {} as never, signedDocuments as never
    );

    await expect(controller.regenerateSignedDocument(
      "settlement-1",
      { id: "director-1" } as never,
      { confirmPureRenderingIssue: true, reason: "签名位置修复", confirmationPassword: "secret" }
    )).resolves.toEqual({ id: "final-2" });
    expect(signedDocuments.generateFinal).toHaveBeenCalledWith(
      "settlement-1", "director-1", true, "签名位置修复", undefined, "secret"
    );
    expect(Reflect.getMetadata(
      REQUIRED_PROJECT_ACTION_KEY,
      SettlementController.prototype.regenerateSignedDocument
    )).toBe("settlement.archive.confirm");
  });

  it("rejects regeneration without an explicit pure-rendering confirmation", async () => {
    const controller = new SettlementController(
      {} as never, {} as never, {} as never, {} as never, {} as never, {} as never
    );
    expect(() => controller.regenerateSignedDocument(
      "settlement-1", { id: "director-1" } as never,
      { confirmPureRenderingIssue: false, reason: "事实变化", confirmationPassword: "secret" }
    )).toThrow("请确认仅修复渲染问题");
  });

  it("retries a missing or failed pending-generation claim without force regeneration", async () => {
    const signedDocuments = { generateFinal: jest.fn().mockResolvedValue({ id: "final-1" }) };
    const controller = new SettlementController(
      {} as never, {} as never, {} as never, {} as never, {} as never, signedDocuments as never
    );
    await controller.retrySignedDocumentGeneration("settlement-1", { id: "director-1" } as never);
    expect(signedDocuments.generateFinal).toHaveBeenCalledWith("settlement-1", "director-1", false);
    expect(Reflect.getMetadata(
      REQUIRED_PROJECT_ACTION_KEY,
      SettlementController.prototype.retrySignedDocumentGeneration
    )).toBe("settlement.archive.confirm");
  });
});
