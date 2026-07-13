import "reflect-metadata";
import { BadRequestException } from "@nestjs/common";
import { PATH_METADATA } from "@nestjs/common/constants";
import { IS_PUBLIC_KEY } from "../auth/decorators/public.decorator";
import { REQUIRED_POSITIONS_KEY } from "../auth/decorators/require-positions.decorator";
import { LEDGER_READ_POSITION_KEYS } from "../auth/ledger-read-positions";
import { REQUIRED_PROJECT_ACTION_KEY } from "../auth/decorators/require-project-role.decorator";
import { createApiValidationPipe } from "../validation/api-validation";
import {
  ContractController,
  ContractNumberRuleController
} from "./contract.controller";

type RuntimeDto = new () => object;

const contractBodyRoutes = [
  ["contract.create", ContractController, "create", 0],
  ["contract.createChangeDraft", ContractController, "createChangeDraft", 1],
  ["contract.submitApproval", ContractController, "submitApproval", 2],
  ["contract.reviewApproval", ContractController, "reviewApproval", 2],
  ["contract.transferApproval", ContractController, "transferApproval", 2],
  ["contract.delegateApproval", ContractController, "delegateApproval", 2],
  ["contract.uploadArchiveFile", ContractController, "uploadArchiveFile", 2],
  ["contract.confirmArchiveFile", ContractController, "confirmArchiveFile", 2],
  ["contract.generatePdfArchive", ContractController, "generatePdfArchive", 2],
  ["numberRule.create", ContractNumberRuleController, "create", 1],
  ["numberRule.update", ContractNumberRuleController, "update", 2]
] as const;

const validPaymentStage = {
  name: "当期结算款",
  stageType: "progress",
  basis: "current_settlement",
  ratioBps: 8_000,
  fixedAmountCents: "100",
  triggerAnchor: "settlement_effective",
  triggerEvent: "结算归档确认生效",
  dueDays: 30,
  advanceDeductionMode: "none",
  advanceDeductionRatioBps: 0,
  advanceDeductionStartRatioBps: 10_000,
  requiresInvoice: true,
  allowsEarlyPayment: false,
  allowsInstallments: true,
  retentionBps: 300,
  originalText: "结算归档确认后 30 天内付款"
} as const;

const validContractDraft = {
  projectId: "project-1",
  contractTypeKey: "material_purchase",
  businessTemplateVersionId: "template-version-1"
};

const validContractRouteBodies = [
  ["contract.create", ContractController, "create", 0, validContractDraft],
  ["contract.createChangeDraft", ContractController, "createChangeDraft", 1, {
    changeType: "supplement",
    changeReason: "补充工程量",
    changeDirection: "increase",
    changeAmountCents: "100"
  }],
  ["contract.submitApproval", ContractController, "submitApproval", 2, { numberRuleId: "rule-1" }],
  ["contract.reviewApproval", ContractController, "reviewApproval", 2, { decision: "approve" }],
  ["contract.transferApproval", ContractController, "transferApproval", 2, { toUserId: "user-2" }],
  ["contract.delegateApproval", ContractController, "delegateApproval", 2, { toUserId: "user-2" }],
  ["contract.uploadArchiveFile", ContractController, "uploadArchiveFile", 2, { fileId: "file-1" }],
  [
    "contract.confirmArchiveFile",
    ContractController,
    "confirmArchiveFile",
    2,
    { archiveFileId: "archive-1", confirmationPassword: "current password" }
  ],
  ["contract.generatePdfArchive", ContractController, "generatePdfArchive", 2, {}],
  [
    "numberRule.create",
    ContractNumberRuleController,
    "create",
    1,
    { name: "默认规则", pattern: "HT-{sequence}", sequenceWidth: 4 }
  ],
  ["numberRule.update", ContractNumberRuleController, "update", 2, { projectId: null }]
] as const;

function contractBodyMetatype(
  controller: typeof ContractController | typeof ContractNumberRuleController,
  method: string,
  bodyIndex: number
) {
  const paramTypes = Reflect.getMetadata(
    "design:paramtypes",
    controller.prototype,
    method
  ) as RuntimeDto[] | undefined;
  return paramTypes?.[bodyIndex];
}

async function validateContractBody(
  controller: typeof ContractController | typeof ContractNumberRuleController,
  method: string,
  bodyIndex: number,
  value: unknown
) {
  const metatype = contractBodyMetatype(controller, method, bodyIndex);
  if (!metatype) throw new Error(`Missing body metatype for ${controller.name}.${method}`);
  return createApiValidationPipe().transform(value, {
    type: "body",
    metatype,
    data: undefined
  });
}

async function getContractValidationResponse(
  controller: typeof ContractController | typeof ContractNumberRuleController,
  method: string,
  bodyIndex: number,
  value: unknown,
  onValid?: (body: object) => unknown
) {
  try {
    const body = await validateContractBody(controller, method, bodyIndex, value);
    await onValid?.(body);
  } catch (error) {
    expect(error).toBeInstanceOf(BadRequestException);
    return (error as BadRequestException).getResponse() as Record<string, unknown>;
  }
  throw new Error(`Expected ${controller.name}.${method} validation to reject the request`);
}

describe("ContractController authorization wiring", () => {
  it.each(contractBodyRoutes)(
    "exposes a runtime DTO for %s",
    (_label, controller, method, bodyIndex) => {
      const metatype = contractBodyMetatype(controller, method, bodyIndex);

      expect(metatype).toBeDefined();
      expect(metatype).not.toBe(Object);
    }
  );

  it.each(validContractRouteBodies)(
    "transforms a valid %s body into its runtime DTO",
    async (_label, controller, method, bodyIndex, value) => {
      const result = await validateContractBody(controller, method, bodyIndex, value);
      const metatype = contractBodyMetatype(controller, method, bodyIndex);

      expect(result).toBeInstanceOf(metatype);
      expect(result).toEqual(value);
    }
  );

  it("保留合同领导自审原因和当前密码", async () => {
    const value = {
      decision: "approve",
      selfReviewReason: "项目紧急且由本人发起",
      confirmationPassword: "current-password"
    };

    await expect(validateContractBody(ContractController, "reviewApproval", 2, value)).resolves.toEqual(value);
  });

  it("按 Unicode code point 校验合同自审字段边界", async () => {
    const boundary = "❤️".repeat(250);
    await expect(
      validateContractBody(ContractController, "reviewApproval", 2, {
        decision: "approve",
        selfReviewReason: boundary,
        confirmationPassword: "❤️".repeat(128)
      })
    ).resolves.toBeDefined();

    const reasonResponse = await getContractValidationResponse(
      ContractController,
      "reviewApproval",
      2,
      { decision: "approve", selfReviewReason: `${boundary}原` }
    );
    expect(reasonResponse.errors).toContain("自审原因不能超过 500 个字符");

    const passwordResponse = await getContractValidationResponse(
      ContractController,
      "reviewApproval",
      2,
      { decision: "approve", confirmationPassword: `${"❤️".repeat(128)}密` }
    );
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
  ] as const)("拒绝合同自审字段 %s 的非法值", async (field, value, message) => {
    const response = await getContractValidationResponse(
      ContractController,
      "reviewApproval",
      2,
      { decision: "approve", [field]: value }
    );

    expect(response.errors).toContain(message);
    expect(JSON.stringify(response)).not.toContain("current-password");
  });

  it("拒绝合同审批未知字段且不回显当前密码", async () => {
    const response = await getContractValidationResponse(
      ContractController,
      "reviewApproval",
      2,
      {
        decision: "approve",
        selfReviewReason: "业务紧急",
        confirmationPassword: "current-password",
        internalSecret: "TOP-SECRET"
      }
    );

    expect(response.errors).toEqual(["internalSecret 不是允许提交的字段"]);
    expect(JSON.stringify(response)).not.toContain("current-password");
    expect(JSON.stringify(response)).not.toContain("TOP-SECRET");
  });

  it.each(validContractRouteBodies)(
    "rejects unknown %s fields before the service can run",
    async (_label, controller, method, bodyIndex, value) => {
      const service = jest.fn();
      const response = await getContractValidationResponse(
        controller,
        method,
        bodyIndex,
        {
          ...value,
          internalSecret: "TOP-SECRET"
        },
        service
      );

      expect(service).not.toHaveBeenCalled();
      expect(response.errors).toEqual(["internalSecret 不是允许提交的字段"]);
      expect(JSON.stringify(response)).not.toContain("TOP-SECRET");
    }
  );

  it("validates a contract draft through the reflected body metatype", async () => {
    const response = await getContractValidationResponse(
      ContractController,
      "create",
      0,
      {
        contractTypeKey: "material_purchase",
        businessTemplateVersionId: "template-version-1"
      }
    );

    expect(response.errors).toEqual(["项目编号不能为空"]);
  });

  it("keeps omitted payment stages compatible and transforms valid nested stages", async () => {
    const omitted = await validateContractBody(
      ContractController,
      "create",
      0,
      validContractDraft
    );
    const nested = await validateContractBody(ContractController, "create", 0, {
      ...validContractDraft,
      paymentStages: [validPaymentStage]
    });

    expect(omitted).toEqual(validContractDraft);
    expect((omitted as { paymentStages?: unknown }).paymentStages).toBeUndefined();
    expect((nested as { paymentStages: object[] }).paymentStages[0].constructor).not.toBe(Object);
    expect(nested).toEqual({ ...validContractDraft, paymentStages: [validPaymentStage] });
  });

  it.each([
    [[], "付款阶段至少要填写一条"],
    [null, "付款阶段必须是数组"],
    ["stages", "付款阶段必须是数组"],
    [{}, "付款阶段必须是数组"],
    [[123], "paymentStages[0] 填写不正确"]
  ])("rejects an invalid payment stage container: %p", async (paymentStages, message) => {
    const response = await getContractValidationResponse(ContractController, "create", 0, {
      ...validContractDraft,
      paymentStages
    });

    expect(response.errors).toEqual([message]);
  });

  it("rejects unknown nested payment stage fields without exposing their values", async () => {
    const response = await getContractValidationResponse(ContractController, "create", 0, {
      ...validContractDraft,
      paymentStages: [{ ...validPaymentStage, internalSecret: "TOP-SECRET" }]
    });

    expect(response.errors).toEqual([
      "paymentStages[0].internalSecret 不是允许提交的字段"
    ]);
    expect(JSON.stringify(response)).not.toContain("TOP-SECRET");
  });

  it.each([
    [{ stageType: "unsupported" }, "付款阶段类型不正确"],
    [{ basis: "unsupported" }, "付款依据不正确"],
    [{ triggerAnchor: "unsupported" }, "付款触发节点不正确"],
    [{ advanceDeductionMode: "unsupported" }, "预付款扣回方式不正确"]
  ])("rejects an invalid payment stage enum: %p", async (patch, message) => {
    const response = await getContractValidationResponse(ContractController, "create", 0, {
      ...validContractDraft,
      paymentStages: [{ ...validPaymentStage, ...patch }]
    });

    expect(response.errors).toContain(message);
  });

  it.each([
    [{ ratioBps: 10_001 }, "付款比例必须在 0 到 10000 之间"],
    [{ advanceDeductionRatioBps: -1 }, "预付款扣回比例必须在 0 到 10000 之间"],
    [{ advanceDeductionStartRatioBps: 10_001 }, "预付款起扣比例必须在 0 到 10000 之间"],
    [{ retentionBps: -1 }, "质保金比例必须在 0 到 10000 之间"],
    [{ dueDays: -1 }, "付款期限必须在 0 到 2147483647 天之间"],
    [{ fixedAmountCents: 100 }, "固定金额格式不正确"],
    [{ requiresInvoice: "true" }, "是否要求发票必须是布尔值"]
  ])("rejects an invalid payment stage scalar: %p", async (patch, message) => {
    const response = await getContractValidationResponse(ContractController, "create", 0, {
      ...validContractDraft,
      paymentStages: [{ ...validPaymentStage, ...patch }]
    });

    expect(response.errors).toEqual([message]);
  });

  it.each([
    ["ratioBps", 10_000, "付款比例必须是整数", "付款比例必须在 0 到 10000 之间"],
    [
      "advanceDeductionRatioBps",
      10_000,
      "预付款扣回比例必须是整数",
      "预付款扣回比例必须在 0 到 10000 之间"
    ],
    [
      "advanceDeductionStartRatioBps",
      10_000,
      "预付款起扣比例必须是整数",
      "预付款起扣比例必须在 0 到 10000 之间"
    ],
    ["retentionBps", 10_000, "质保金比例必须是整数", "质保金比例必须在 0 到 10000 之间"],
    [
      "dueDays",
      2_147_483_647,
      "付款期限必须是整数天",
      "付款期限必须在 0 到 2147483647 天之间"
    ]
  ] as const)(
    "enforces one precise integer boundary for payment-stage %s",
    async (field, max, typeMessage, rangeMessage) => {
      await expect(
        validateContractBody(ContractController, "create", 0, {
          ...validContractDraft,
          paymentStages: [{ ...validPaymentStage, [field]: max }]
        })
      ).resolves.toBeDefined();

      for (const [value, message] of [
        [max + 1, rangeMessage],
        [1e100, typeMessage],
        ["1", typeMessage],
        [null, typeMessage]
      ] as const) {
        const response = await getContractValidationResponse(ContractController, "create", 0, {
          ...validContractDraft,
          paymentStages: [{ ...validPaymentStage, [field]: value }]
        });
        expect(response.errors).toEqual([message]);
      }
    }
  );

  it("enforces the BIGINT storage boundary for a fixed payment amount", async () => {
    await expect(
      validateContractBody(ContractController, "create", 0, {
        ...validContractDraft,
        paymentStages: [{ ...validPaymentStage, fixedAmountCents: "9223372036854775807" }]
      })
    ).resolves.toBeDefined();

    const response = await getContractValidationResponse(ContractController, "create", 0, {
      ...validContractDraft,
      paymentStages: [{ ...validPaymentStage, fixedAmountCents: "9223372036854775808" }]
    });
    expect(response.errors).toEqual(["金额超出系统可保存范围"]);
  });

  it("preserves contract number override text for the existing service parser", async () => {
    const value = {
      numberRuleId: " rule-1 ",
      formalCodeOverride: " HT-001 ",
      overrideReason: " 历史编号衔接 "
    };
    const result = await validateContractBody(
      ContractController,
      "submitApproval",
      2,
      value
    );

    expect(result).toEqual(value);
  });

  it("allows null numbering scopes and an empty update for service-level handling", async () => {
    const createResult = await validateContractBody(
      ContractNumberRuleController,
      "create",
      1,
      {
        name: "默认规则",
        pattern: "HT-{sequence}",
        sequenceWidth: 4,
        companyEntityId: null,
        projectId: null,
        contractTypeKey: null
      }
    );
    const updateResult = await validateContractBody(
      ContractNumberRuleController,
      "update",
      2,
      {}
    );

    expect(createResult).toEqual({
      name: "默认规则",
      pattern: "HT-{sequence}",
      sequenceWidth: 4,
      companyEntityId: null,
      projectId: null,
      contractTypeKey: null
    });
    expect(updateResult).toEqual({});
  });

  it.each([
    ["create", 1, { name: "规则", pattern: "HT-{sequence}", sequenceWidth: "4" }, "编号流水号位数必须是整数"],
    ["update", 2, { projectId: "   " }, "项目编号不能为空白"]
  ] as const)(
    "rejects an invalid contract number rule %s body",
    async (method, bodyIndex, value, message) => {
      const response = await getContractValidationResponse(
        ContractNumberRuleController,
        method,
        bodyIndex,
        value
      );

      expect(response.errors).toContain(message);
    }
  );

  it.each([
    [12, undefined],
    [13, "编号流水号位数必须在 1 到 12 之间"],
    [1e100, "编号流水号位数必须是整数"],
    ["4", "编号流水号位数必须是整数"],
    [null, "编号流水号位数必须是整数"]
  ] as const)("enforces one precise sequence-width boundary for %p", async (value, message) => {
    const body = { name: "规则", pattern: "HT-{sequence}", sequenceWidth: value };
    if (!message) {
      await expect(
        validateContractBody(ContractNumberRuleController, "create", 1, body)
      ).resolves.toBeDefined();
      return;
    }
    const response = await getContractValidationResponse(
      ContractNumberRuleController,
      "create",
      1,
      body
    );
    expect(response.errors).toEqual([message]);
  });

  it.each([
    ["reviewApproval", { decision: "unsupported" }, "合同审批决定不正确"],
    ["transferApproval", { toUserId: "   " }, "请选择接收人"],
    ["uploadArchiveFile", { fileId: "   " }, "合同归档文件不能为空白"],
    ["generatePdfArchive", { templateKey: 123 }, "模板标识必须是文字"],
    ["submitApproval", { numberRuleId: "rule-1", formalCodeOverride: null }, "正式合同编号必须是文字"]
  ] as const)("rejects an invalid %s field with one precise error", async (method, value, message) => {
    const response = await getContractValidationResponse(
      ContractController,
      method,
      2,
      value
    );

    expect(response.errors).toEqual([message]);
  });

  it("rejects an invalid archive password without exposing submitted content", async () => {
    const response = await getContractValidationResponse(
      ContractController,
      "confirmArchiveFile",
      2,
      {
        archiveFileId: "archive-1",
        confirmationPassword: { secret: "TOP-SECRET" }
      }
    );

    expect(response.errors).toEqual(["当前登录密码必须是文字"]);
    expect(JSON.stringify(response)).not.toContain("TOP-SECRET");
  });

  it("is not publicly accessible (auth guard must run)", () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, ContractController)).toBeFalsy();
  });

  it("ContractNumberRuleController is not publicly accessible (auth guard must run)", () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, ContractNumberRuleController)).toBeFalsy();
  });

  it.each([
    ["create", "contract.create"],
    ["createChangeDraft", "contract.create"],
    ["changeEligibility", "contract.create"],
    ["settlementCreateOptions", "settlement.create"],
    ["paymentCreateOptions", "payment.create"],
    ["submitApproval", "contract.submit"],
    ["checkReadiness", "contract.submit"],
    ["reviewApproval", "contract.approve"],
    ["transferApproval", "contract.approve"],
    ["delegateApproval", "contract.approve"],
    ["approveSeal", "contract.seal"],
    ["uploadArchiveFile", "contract.archive.upload"],
    ["confirmArchiveFile", "contract.archive.confirm"],
    ["generatePdfArchive", "contract.archive.upload"]
  ])("guards %s with the %s action", (method, action) => {
    const handler = (ContractController.prototype as unknown as Record<string, object>)[method];

    expect(Reflect.getMetadata(REQUIRED_PROJECT_ACTION_KEY, handler as object)).toBe(action);
  });

  it.each(["createChangeDraft", "changeEligibility"])(
    "keeps %s on the PermissionGuard contractVersionId route coordinate",
    (method) => {
      const handler = (ContractController.prototype as unknown as Record<string, object>)[method];
      expect(Reflect.getMetadata(PATH_METADATA, handler)).toContain(":contractVersionId");
      expect(Reflect.getMetadata(PATH_METADATA, handler)).not.toContain(":effectiveVersionId");
    }
  );

  it.each([["withdrawApproval"], ["remindApproval"]])(
    "allows the approval applicant to %s without project approval action metadata",
    (method) => {
      const handler = (ContractController.prototype as unknown as Record<string, object>)[method];

      expect(Reflect.getMetadata(REQUIRED_PROJECT_ACTION_KEY, handler as object)).toBeUndefined();
    }
  );

  it("guards contract list and detail with the shared ledger read policy", () => {
    const handler = ContractController.prototype.list;

    expect(Reflect.getMetadata(REQUIRED_POSITIONS_KEY, handler)).toEqual(LEDGER_READ_POSITION_KEYS);
    expect(Reflect.getMetadata(REQUIRED_POSITIONS_KEY, ContractController.prototype.detail)).toEqual(
      LEDGER_READ_POSITION_KEYS
    );
  });

  it("forwards the required numbering body on approval submission", async () => {
    const contracts = { submitApproval: jest.fn() };
    const controller = new ContractController(
      contracts as never,
      {} as never,
      {} as never,
      {} as never
    );

    controller.submitApproval(
      "version-1",
      { id: "owner-1" } as never,
      { numberRuleId: "rule-1" }
    );

    expect(contracts.submitApproval).toHaveBeenCalledWith(
      "version-1",
      "owner-1",
      { numberRuleId: "rule-1" }
    );
  });

  it("forwards visible project ids to contract detail reads", async () => {
    const contractRead = { getDetail: jest.fn().mockResolvedValue({ id: "contract-1" }) };
    const projectVisibility = { visibleProjectIds: jest.fn().mockResolvedValue(["project-1"]) };
    const controller = new ContractController(
      {} as never,
      contractRead as never,
      {} as never,
      projectVisibility as never
    );

    await controller.detail("HT-2026-009", { id: "user-1" } as never);

    expect(projectVisibility.visibleProjectIds).toHaveBeenCalledWith("user-1");
    expect(contractRead.getDetail).toHaveBeenCalledWith("HT-2026-009", ["project-1"], "user-1");
  });

  it("forwards number-rule maintenance bodies to runtime-validating service methods", () => {
    const numbering = {
      create: jest.fn(),
      update: jest.fn(),
      stop: jest.fn()
    };
    const controller = new ContractNumberRuleController(numbering as never);
    const user = { id: "director-1" } as never;

    controller.create(user, {
      name: "规则",
      pattern: "HT-{sequence}",
      sequenceWidth: 4
    });
    controller.update("rule-1", user, { pattern: "HT-{sequence}" });
    controller.stop("rule-1", user);

    expect(numbering.create).toHaveBeenCalledWith("director-1", {
      name: "规则",
      pattern: "HT-{sequence}",
      sequenceWidth: 4
    });
    expect(numbering.update).toHaveBeenCalledWith(
      "rule-1",
      "director-1",
      { pattern: "HT-{sequence}" }
    );
    expect(numbering.stop).toHaveBeenCalledWith("rule-1", "director-1");
  });
});
