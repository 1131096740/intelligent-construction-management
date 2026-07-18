import "reflect-metadata";
import { BadRequestException } from "@nestjs/common";
import { HISTORICAL_CONTRACT_TAKEOVER_READ_ROLE_KEYS } from "@jiangkong/shared-domain";
import { REQUIRED_POSITIONS_KEY } from "../auth/decorators/require-positions.decorator";
import { REQUIRED_PROJECT_ACTION_KEY } from "../auth/decorators/require-project-role.decorator";
import { createApiValidationPipe } from "../validation/api-validation";
import { ContractTakeoverController } from "./contract-takeover.controller";

type RuntimeDto = new () => object;

const takeoverBodyRoutes = [
  ["reviewImportBatch", 2],
  ["create", 1],
  ["precheckImport", 1],
  ["createDraftsFromImport", 1],
  ["previewExcelImport", 1],
  ["applyExcelImport", 1],
  ["updateDraft", 2],
  ["attachEvidence", 2],
  ["recordCorrection", 2],
  ["submitCompanyEntityCorrection", 2],
  ["reviewCompanyEntityCorrection", 3],
  ["createTaxFactRevision", 2],
  ["updateTaxFactRevision", 3],
  ["reviewTaxFactsByFinance", 3],
  ["confirmTaxFactsByContract", 3],
  ["confirm", 3],
  ["confirmChangeBaseline", 3]
] as const;

const validTakeover = {
  code: "HT-LS-001",
  name: "历史材料合同",
  counterparty: "历史供应商",
  amountCents: "100000000",
  signedAt: "2026-01-10",
  takeoverLevel: "C",
  lifecycleStatus: "disputed"
} as const;

const validImportRow = {
  rowNo: 1,
  code: "HT-LS-001",
  name: "历史材料合同",
  counterparty: "历史供应商",
  amountCents: "100000000",
  signedAt: "2026-01-10",
  takeoverLevel: "C",
  lifecycleStatus: "disputed",
  excelDynamicBusinessColumn: "保留原始列"
};

const validTakeoverRouteBodies = [
  [
    "reviewImportBatch",
    2,
    {
      status: "limited_accepted",
      reviewComment: "资料缺口已确认",
      acceptanceConclusion: "允许受限接管"
    }
  ],
  ["create", 1, validTakeover],
  ["precheckImport", 1, { rows: [validImportRow] }],
  ["previewExcelImport", 1, { fileId: "file-1" }],
  [
    "applyExcelImport",
    1,
    {
      fileId: "file-1",
      fileSha256: "sha256-value",
      importFingerprint: "fingerprint",
      takeoverCutoffDate: "2026-07-10",
      responsibleUserId: "director-1",
      reviewComment: "完成批次复核",
      acceptanceConclusion: "待主管确认后接管"
    }
  ],
  [
    "createDraftsFromImport",
    1,
    {
      rows: [validImportRow],
      takeoverCutoffDate: "2026-07-10",
      responsibleUserId: "director-1",
      reviewComment: "完成批次复核",
      acceptanceConclusion: "待主管确认后接管"
    }
  ],
  ["updateDraft", 2, validTakeover],
  ["attachEvidence", 2, { fileId: "file-1", purpose: "historical_contract_scan" }],
  [
    "recordCorrection",
    2,
    {
      correctionType: "evidence",
      reason: "补充历史凭证",
      responsibleUserId: "director-1",
      afterSummary: "已补齐历史付款凭证",
      attachmentFileId: "file-1",
      currentPassword: "current password"
    }
  ],
  [
    "submitCompanyEntityCorrection",
    2,
    {
      targetCompanyEntityId: "entity-2",
      reason: "原主体匹配错误",
      responsibleUserId: "contract-user",
      attachmentFileId: "file-1",
      currentPassword: "current password"
    }
  ],
  [
    "reviewCompanyEntityCorrection",
    3,
    {
      decision: "approve",
      currentPassword: "current password",
      comment: "主体资料核对无误"
    }
  ],
  [
    "createTaxFactRevision",
    2,
    {
      kind: "supplement",
      invoiceType: "vat_special",
      taxMode: "single_rate",
      defaultTaxRatePercent: "13",
      source: "business_finance_confirmation",
      confirmationExplanation: "合同部与财务部已核对原合同"
    }
  ],
  [
    "updateTaxFactRevision",
    3,
    {
      kind: "supplement",
      invoiceType: "vat_general",
      taxMode: "single_rate",
      defaultTaxRatePercent: "3",
      source: "contract_document",
      evidenceFileId: "file-1"
    }
  ],
  ["reviewTaxFactsByFinance", 3, { decision: "approve", comment: "税务事实一致" }],
  ["confirmTaxFactsByContract", 3, { decision: "approve", comment: "合同事实确认" }],
  ["confirm", 3, { confirmationPassword: "current password" }],
  ["confirmChangeBaseline", 3, {
    originalSignedAmountCents: "100000000",
    preTakeoverPositiveIncreaseCents: "5000000",
    currentPassword: "current password"
  }]
] as const;

function takeoverBodyMetatype(method: string, bodyIndex: number) {
  const paramTypes = Reflect.getMetadata(
    "design:paramtypes",
    ContractTakeoverController.prototype,
    method
  ) as RuntimeDto[] | undefined;
  return paramTypes?.[bodyIndex];
}

async function validateTakeoverBody(method: string, bodyIndex: number, value: unknown) {
  const metatype = takeoverBodyMetatype(method, bodyIndex);
  if (!metatype) throw new Error(`Missing takeover body metatype for ${method}`);
  return createApiValidationPipe().transform(value, {
    type: "body",
    metatype,
    data: undefined
  });
}

async function getTakeoverValidationResponse(
  method: string,
  bodyIndex: number,
  value: unknown,
  onValid?: (body: object) => unknown
) {
  try {
    const body = await validateTakeoverBody(method, bodyIndex, value);
    await onValid?.(body);
  } catch (error) {
    expect(error).toBeInstanceOf(BadRequestException);
    return (error as BadRequestException).getResponse() as Record<string, unknown>;
  }
  throw new Error(`Expected ${method} validation to reject the request`);
}

describe("ContractTakeoverController", () => {
  function expectProjectAction(handler: object, action: string) {
    expect(Reflect.getMetadata(REQUIRED_PROJECT_ACTION_KEY, handler)).toBe(action);
  }

  it.each([
    ["list"],
    ["detail"],
    ["listTaxFactRevisions"],
    ["exportLedger"],
    ["exportDetail"]
  ] as const)("allows the approved read-only positions to use %s", (method) => {
    expect(
      Reflect.getMetadata(
        REQUIRED_POSITIONS_KEY,
        ContractTakeoverController.prototype[method]
      )
    ).toEqual(HISTORICAL_CONTRACT_TAKEOVER_READ_ROLE_KEYS);
  });

  it.each([
    ["createTaxFactRevision", "contract.tax_fact.supplement"],
    ["updateTaxFactRevision", "contract.tax_fact.supplement"],
    ["submitTaxFactFinanceReview", "contract.tax_fact.supplement"],
    ["reviewTaxFactsByFinance", "contract.tax_fact.finance_review"],
    ["confirmTaxFactsByContract", "contract.tax_fact.confirm"]
  ])("protects %s with %s", (method, action) => {
    expectProjectAction(
      ContractTakeoverController.prototype[
        method as keyof ContractTakeoverController
      ] as object,
      action
    );
  });

  it.each(takeoverBodyRoutes)("exposes a runtime DTO for %s", (method, bodyIndex) => {
    const metatype = takeoverBodyMetatype(method, bodyIndex);

    expect(metatype).toBeDefined();
    expect(metatype).not.toBe(Object);
  });

  it.each(validTakeoverRouteBodies)(
    "transforms a valid %s body into its runtime DTO",
    async (method, bodyIndex, value) => {
      const result = await validateTakeoverBody(method, bodyIndex, value);
      const metatype = takeoverBodyMetatype(method, bodyIndex);

      expect(result).toBeInstanceOf(metatype);
      expect(result).toEqual(value);
    }
  );

  it.each(validTakeoverRouteBodies)(
    "rejects an unknown top-level %s field before the service can run",
    async (method, bodyIndex, value) => {
      const service = jest.fn();
      const response = await getTakeoverValidationResponse(
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

  it("validates takeover creation through the reflected body metatype", async () => {
    const response = await getTakeoverValidationResponse("create", 1, {
      name: "历史合同",
      counterparty: "供应商"
    });

    expect(response.errors).toContain("请填写合同编号");
  });

  it("keeps takeover updates complete instead of treating them as partial patches", async () => {
    const response = await getTakeoverValidationResponse("updateDraft", 2, {
      name: "不完整更新"
    });

    expect(response.errors).toContain("请填写合同编号");
  });

  it.each([
    ["signedAt", "2026-02-30", "签订日期必须按 YYYY-MM-DD 填写且日期必须有效"],
    ["signedAt", "2026-01-10T00:00:00.000Z", "签订日期必须按 YYYY-MM-DD 填写且日期必须有效"],
    ["takeoverCutoffDate", "2026-02-30", "接管截止日必须按 YYYY-MM-DD 填写且日期必须有效"],
    ["takeoverCutoffDate", "2026-07-10T00:00:00.000Z", "接管截止日必须按 YYYY-MM-DD 填写且日期必须有效"]
  ])("rejects invalid date-only %s=%s", async (field, value, message) => {
    const response = await getTakeoverValidationResponse("create", 1, {
      ...validTakeover,
      [field]: value
    });

    expect(response.errors).toEqual([message]);
  });

  it.each([
    [null, "接管截止日必须是文字"],
    [123, "接管截止日必须是文字"],
    ["", "接管截止日不能为空白"],
    ["   ", "接管截止日不能为空白"],
    ["2026-02-30", "接管截止日必须按 YYYY-MM-DD 填写且日期必须有效"],
    ["2026-07-10T00:00:00.000Z", "接管截止日必须按 YYYY-MM-DD 填写且日期必须有效"]
  ])("returns one precise optional cutoff error for %p", async (value, message) => {
    for (const [method, body] of [
      ["create", { ...validTakeover, takeoverCutoffDate: value }],
      ["precheckImport", { rows: [validImportRow], takeoverCutoffDate: value }]
    ] as const) {
      const response = await getTakeoverValidationResponse(
        method,
        method === "create" ? 1 : 1,
        body
      );
      expect(response.errors).toEqual([message]);
    }
  });

  it.each(["amountCents", "historicalSettledCents", "historicalApprovalPendingPaymentCents", "historicalApprovedPendingPaymentCents", "historicalPaidCents", "historicalProxyPaidCents", "historicalAdvancePaidCents", "historicalAdvanceDeductedCents", "historicalRetentionWithheldCents", "historicalRetentionReleasedCents", "otherConfirmedOccupancyCents"])(
    "rejects a non-canonical takeover money field: %s",
    async (field) => {
      const response = await getTakeoverValidationResponse("create", 1, {
        ...validTakeover,
        [field]: "1.0"
      });

      expect(response.errors).toHaveLength(1);
      expect((response.errors as string[])[0]).toContain("必须按分填写为 0 或更大的整数");
    }
  );

  it.each(["amountCents", "historicalSettledCents", "historicalApprovalPendingPaymentCents", "historicalApprovedPendingPaymentCents", "historicalPaidCents", "historicalProxyPaidCents", "historicalAdvancePaidCents", "historicalAdvanceDeductedCents", "historicalRetentionWithheldCents", "historicalRetentionReleasedCents", "otherConfirmedOccupancyCents"])(
    "enforces the BIGINT storage boundary for takeover money field: %s",
    async (field) => {
      await expect(
        validateTakeoverBody("create", 1, {
          ...validTakeover,
          [field]: "9223372036854775807"
        })
      ).resolves.toBeDefined();

      const response = await getTakeoverValidationResponse("create", 1, {
        ...validTakeover,
        [field]: "9223372036854775808"
      });
      expect(response.errors).toEqual(["金额超出系统可保存范围"]);
    }
  );

  it.each([
    [{ takeoverLevel: "D" }, "接管等级请选择 A级、B级或C级"],
    [{ lifecycleStatus: "unknown" }, "履约状态不在系统支持范围内"]
  ])("rejects an invalid takeover enum: %p", async (patch, message) => {
    const response = await getTakeoverValidationResponse("create", 1, {
      ...validTakeover,
      ...patch
    });

    expect(response.errors).toEqual([message]);
  });

  it("requires review facts before accepting a limited import batch", async () => {
    const response = await getTakeoverValidationResponse("reviewImportBatch", 2, {
      status: "limited_accepted",
      reviewComment: "   "
    });

    expect(response.errors).toEqual(
      expect.arrayContaining([
        "请填写批次复核意见后再提交复核结果",
        "请填写批次验收结论后再提交复核结果"
      ])
    );
  });

  it("requires batch facts only when generating drafts, not during pure precheck", async () => {
    await expect(
      validateTakeoverBody("precheckImport", 1, { rows: [validImportRow] })
    ).resolves.toEqual({ rows: [validImportRow] });

    const response = await getTakeoverValidationResponse("createDraftsFromImport", 1, {
      rows: [validImportRow]
    });

    expect(response.errors).toEqual(
      expect.arrayContaining([
        "请填写接管截止日后再生成接管草稿",
        "请填写接管责任人后再生成接管草稿",
        "请填写批次复核意见后再生成接管草稿",
        "请填写批次验收结论后再生成接管草稿"
      ])
    );
  });

  it.each([
    ["attachEvidence", 2, { fileId: "file-1", purpose: "unknown" }, "接管资料类型不正确"],
    [
      "recordCorrection",
      2,
      {
        correctionType: "unknown",
        reason: "更正",
        responsibleUserId: "director-1",
        afterSummary: "更正后",
        attachmentFileId: "file-1",
        currentPassword: "password"
      },
      "更正类型不正确"
    ]
  ] as const)("rejects an invalid %s enum", async (method, bodyIndex, value, message) => {
    const response = await getTakeoverValidationResponse(method, bodyIndex, value);

    expect(response.errors).toEqual([message]);
  });

  it("rejects an invalid confirmation password without exposing it", async () => {
    const response = await getTakeoverValidationResponse("confirm", 3, {
      confirmationPassword: { secret: "TOP-SECRET" }
    });

    expect(response.errors).toEqual(["当前登录密码必须是文字"]);
    expect(JSON.stringify(response)).not.toContain("TOP-SECRET");
  });

  it("requires a current password before reviewing a company entity correction", async () => {
    const response = await getTakeoverValidationResponse(
      "reviewCompanyEntityCorrection",
      3,
      { decision: "reject", currentPassword: "", comment: "依据不足" }
    );

    expect(response.errors).toEqual(["请填写当前登录密码后再处理主体更正"]);
  });

  it("protects create and submit with contract staff project roles", () => {
    expectProjectAction(ContractTakeoverController.prototype.create, "contract.create");
    expectProjectAction(
      ContractTakeoverController.prototype.listCompanyEntityCandidates,
      "contract.create"
    );
    expectProjectAction(ContractTakeoverController.prototype.listImportBatches, "contract.create");
    expectProjectAction(ContractTakeoverController.prototype.updateDraft, "contract.create");
    expectProjectAction(ContractTakeoverController.prototype.precheckImport, "contract.create");
    expectProjectAction(ContractTakeoverController.prototype.createDraftsFromImport, "contract.create");
    expectProjectAction(ContractTakeoverController.prototype.exportImportTemplate, "contract.create");
    expectProjectAction(ContractTakeoverController.prototype.previewExcelImport, "contract.create");
    expectProjectAction(ContractTakeoverController.prototype.applyExcelImport, "contract.create");
    expectProjectAction(ContractTakeoverController.prototype.attachEvidence, "contract.create");
    expectProjectAction(
      ContractTakeoverController.prototype.submitCompanyEntityCorrection,
      "contract.create"
    );
    expectProjectAction(ContractTakeoverController.prototype.submitReview, "contract.submit");
  });

  it("does not reuse read-only access for any takeover write endpoint", () => {
    for (const method of [
      "create",
      "updateDraft",
      "previewExcelImport",
      "applyExcelImport",
      "attachEvidence",
      "recordCorrection",
      "submitCompanyEntityCorrection",
      "reviewCompanyEntityCorrection",
      "createTaxFactRevision",
      "updateTaxFactRevision",
      "submitTaxFactFinanceReview",
      "reviewTaxFactsByFinance",
      "confirmTaxFactsByContract",
      "submitReview",
      "confirm",
      "confirmChangeBaseline"
    ] as const) {
      expect(
        Reflect.getMetadata(
          REQUIRED_POSITIONS_KEY,
          ContractTakeoverController.prototype[method]
        )
      ).toBeUndefined();
    }
  });

  it("protects confirmation with contract archive confirmation role", () => {
    expectProjectAction(
      ContractTakeoverController.prototype.reviewImportBatch,
      "contract.archive.confirm"
    );
    expectProjectAction(
      ContractTakeoverController.prototype.confirm,
      "contract.archive.confirm"
    );
    expectProjectAction(
      ContractTakeoverController.prototype.recordCorrection,
      "contract.archive.confirm"
    );
    expectProjectAction(
      ContractTakeoverController.prototype.reviewCompanyEntityCorrection,
      "contract.archive.confirm"
    );
    expectProjectAction(
      ContractTakeoverController.prototype.confirmChangeBaseline,
      "contract.archive.confirm"
    );
  });
});
