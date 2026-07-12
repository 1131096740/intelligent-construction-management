import "reflect-metadata";
import { BadRequestException } from "@nestjs/common";
import { REQUIRED_POSITIONS_KEY } from "../auth/decorators/require-positions.decorator";
import { REQUIRED_PROJECT_ACTION_KEY } from "../auth/decorators/require-project-role.decorator";
import { createApiValidationPipe } from "../validation/api-validation";
import { ContractTemplateController } from "./contract-template.controller";

type RuntimeDto = new () => object;

const templateBodyRoutes = [
  ["createLayout", 0],
  ["updateLayoutDraftVersion", 1],
  ["queueLayoutPreview", 1],
  ["publishLayout", 1],
  ["createTemplate", 0],
  ["updateDraftVersion", 1],
  ["publishVersion", 1],
  ["createClause", 0],
  ["publishClauseVersion", 1],
  ["createBusinessScenario", 0],
  ["updateBusinessScenario", 1],
  ["createScenarioTemplateMapping", 1],
  ["updateScenarioTemplateMapping", 1]
] as const;

const validSchema = {
  fields: [
    {
      key: "contract_name",
      label: "合同名称",
      type: "text",
      required: true,
      defaultValue: { source: "project", fallback: null },
      options: [{ label: "选项A", value: "A" }],
      visibleWhen: { fieldKey: "enabled", operator: "eq", value: [true, "yes"] }
    }
  ],
  bills: [
    {
      key: "main_bill",
      name: "主清单",
      amountRole: "included",
      pricingMode: "tax_inclusive",
      quantityScale: 3,
      unitPriceScale: 2,
      columns: [{ key: "itemName", label: "项目名称", type: "text", required: true }]
    }
  ],
  clauses: [
    {
      key: "payment_terms",
      title: "付款条款",
      numberingMode: "automatic",
      required: true,
      content: { text: "归档后付款", blocks: [{ type: "paragraph" }] }
    }
  ],
  attachments: [
    { key: "signed_scan", name: "签章件", required: true, mustBeValid: true }
  ],
  validations: [
    {
      key: "payment_phrase",
      level: "block",
      targetClauseKey: "payment_terms",
      requiredPhrases: ["付款"],
      message: "付款条款缺少必要表述"
    }
  ]
};

const validPreviewSample = {
  contract: { code: "HT-001", dynamicContractField: "保留" },
  party: { supplier: { name: "供应商A" } },
  field: { custom_field: ["A", 1, true, null] },
  clause: { payment_terms: { text: "付款内容" } },
  bill: { main_bill: [{ itemName: "钢材", quantity: 2 }] },
  document: { generatedAt: "2026-07-11" }
};

const validTemplateBodies = [
  [
    "createLayout",
    0,
    {
      name: "材料合同版式",
      contractTypeKey: "material_purchase",
      docxFileId: "file-1",
      placeholderSchema: { bills: [{ key: "main_bill" }], dynamicPlaceholders: ["field.custom"] }
    }
  ],
  ["updateLayoutDraftVersion", 1, { expectedRevision: 2, docxFileId: "file-2" }],
  ["queueLayoutPreview", 1, validPreviewSample],
  ["publishLayout", 1, { changeSummary: "发布材料合同版式" }],
  [
    "createTemplate",
    0,
    {
      code: "TPL-MATERIAL",
      name: "材料采购合同模板",
      contractTypeKey: "material_purchase",
      schema: validSchema
    }
  ],
  ["updateDraftVersion", 1, { schema: validSchema, changeSummary: "补充付款条款" }],
  ["publishVersion", 1, { changeSummary: "发布业务模板" }],
  [
    "createClause",
    0,
    {
      code: "CLAUSE-PAYMENT",
      category: "payment",
      name: "标准付款条款",
      title: "付款约定",
      content: { text: "归档后付款", variables: { days: 30 } }
    }
  ],
  ["publishClauseVersion", 1, { changeSummary: "发布标准条款" }],
  [
    "createBusinessScenario",
    0,
    { code: "materials", name: "材料采购", description: "材料采购合同场景" }
  ],
  ["updateBusinessScenario", 1, { expectedRevision: 1, active: false }],
  [
    "createScenarioTemplateMapping",
    1,
    {
      expectedScenarioRevision: 1,
      businessTemplateVersionId: "template-version-1",
      reason: "用于材料采购合同",
      priority: 10
    }
  ],
  ["updateScenarioTemplateMapping", 1, { expectedRevision: 1, active: false }]
] as const;

function templateBodyMetatype(method: string, bodyIndex: number) {
  const paramTypes = Reflect.getMetadata(
    "design:paramtypes",
    ContractTemplateController.prototype,
    method
  ) as RuntimeDto[] | undefined;
  return paramTypes?.[bodyIndex];
}

async function validateTemplateBody(method: string, bodyIndex: number, value: unknown) {
  const metatype = templateBodyMetatype(method, bodyIndex);
  if (!metatype) throw new Error(`Missing body metatype for ContractTemplateController.${method}`);
  return createApiValidationPipe().transform(value, {
    type: "body",
    metatype,
    data: undefined
  });
}

async function getTemplateValidationResponse(
  method: string,
  bodyIndex: number,
  value: unknown,
  onValid?: (body: object) => unknown
) {
  try {
    const body = await validateTemplateBody(method, bodyIndex, value);
    await onValid?.(body);
  } catch (error) {
    expect(error).toBeInstanceOf(BadRequestException);
    return (error as BadRequestException).getResponse() as Record<string, unknown>;
  }
  throw new Error(`Expected ContractTemplateController.${method} validation to reject the request`);
}

describe("ContractTemplateController authorization wiring", () => {
  const governancePositions = ["contract_director", "super_admin"];
  const governedMethods = [
    "createLayout",
    "getLayoutTemplate",
    "updateLayoutDraftVersion",
    "inspectLayout",
    "queueLayoutPreview",
    "getLayoutPreview",
    "submitLayout",
    "publishLayout",
    "cloneLayout",
    "stopLayout",
    "revokeLayout",
    "getTemplate",
    "createTemplate",
    "updateDraftVersion",
    "cloneVersion",
    "submitVersion",
    "publishVersion",
    "stopVersion",
    "revokeVersion",
    "createClause",
    "submitClauseVersion",
    "publishClauseVersion",
    "listScenarioGovernance",
    "createBusinessScenario",
    "updateBusinessScenario",
    "createScenarioTemplateMapping",
    "updateScenarioTemplateMapping"
  ];

  it("delegates layout detail with the authenticated actor", async () => {
    const detail = { template: { id: "layout-template-1" }, versions: [] };
    const layouts = { getLayoutTemplate: jest.fn().mockResolvedValue(detail) };
    const controller = new ContractTemplateController({} as never, layouts as never, {} as never);

    await expect(
      controller.getLayoutTemplate("layout-template-1", { id: "staff-1" } as never)
    ).resolves.toBe(detail);
    expect(layouts.getLayoutTemplate).toHaveBeenCalledWith("layout-template-1", "staff-1");
  });

  it("delegates the existing template detail route to the read model service", async () => {
    const detail = { template: { id: "template-1" }, versions: [{ id: "version-1" }] };
    const templates = { getTemplate: jest.fn().mockResolvedValue(detail) };
    const controller = new ContractTemplateController(templates as never, {} as never, {} as never);

    await expect(controller.getTemplate("template-1")).resolves.toBe(detail);
    expect(templates.getTemplate).toHaveBeenCalledWith("template-1");
  });

  it.each(templateBodyRoutes)("exposes a runtime DTO for %s", (method, bodyIndex) => {
    const metatype = templateBodyMetatype(method, bodyIndex);

    expect(metatype).toBeDefined();
    expect(metatype).not.toBe(Object);
  });

  it.each(validTemplateBodies)(
    "transforms a valid %s body without stripping dynamic JSON keys",
    async (method, bodyIndex, value) => {
      const result = await validateTemplateBody(method, bodyIndex, value);
      const metatype = templateBodyMetatype(method, bodyIndex);

      expect(result).toBeInstanceOf(metatype);
      expect(result).toEqual(value);
    }
  );

  it.each(validTemplateBodies)(
    "rejects an unknown top-level %s field before service execution",
    async (method, bodyIndex, value) => {
      const service = jest.fn();
      const response = await getTemplateValidationResponse(
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

  it.each([null, [], "schema"])("rejects a non-object business schema: %p", async (schema) => {
    const response = await getTemplateValidationResponse("createTemplate", 0, {
      code: "TPL-1",
      name: "模板",
      contractTypeKey: "material_purchase",
      schema
    });

    expect(response.errors).toEqual(["业务模板结构必须是对象"]);
  });

  it.each(["fields", "bills", "clauses", "attachments", "validations"])(
    "requires schema array %s and rejects non-arrays",
    async (field) => {
      const missing = { ...validSchema } as Record<string, unknown>;
      delete missing[field];
      const invalid = { ...validSchema, [field]: {} };

      for (const schema of [missing, invalid]) {
        const response = await getTemplateValidationResponse("updateDraftVersion", 1, {
          schema
        });
        expect(response.errors).toEqual([`模板 ${field} 必须是数组`]);
      }
    }
  );

  it.each([
    ["fields", [123], "schema.fields[0] 填写不正确"],
    [
      "bills",
      [{ ...validSchema.bills[0], internalSecret: "TOP-SECRET" }],
      "schema.bills[0].internalSecret 不是允许提交的字段"
    ],
    ["bills", [{ ...validSchema.bills[0], columns: [123] }], "schema.bills[0].columns[0] 填写不正确"]
  ])("rejects invalid nested schema %s items", async (field, value, message) => {
    const response = await getTemplateValidationResponse("updateDraftVersion", 1, {
      schema: { ...validSchema, [field]: value }
    });

    expect(response.errors).toEqual([message]);
    expect(JSON.stringify(response)).not.toContain("TOP-SECRET");
  });

  it("keeps preview sampleData as the direct six-namespace body", async () => {
    const result = await validateTemplateBody("queueLayoutPreview", 1, validPreviewSample);

    expect(result).toEqual(validPreviewSample);
    expect(result).not.toHaveProperty("sampleData");
  });

  it.each([
    [null, "提交内容必须是对象"],
    [[], "提交内容必须是对象"],
    [{ unknownNamespace: {} }, "unknownNamespace 不是允许提交的字段"],
    [{ contract: null }, "预览命名空间 contract 必须是 JSON 对象"],
    [{ bill: [] }, "预览命名空间 bill 必须是 JSON 对象"]
  ])("rejects an invalid direct preview body: %p", async (value, message) => {
    const response = await getTemplateValidationResponse("queueLayoutPreview", 1, value);

    expect(response.errors).toEqual([message]);
  });

  it.each(["publishLayout", "publishVersion", "publishClauseVersion"])(
    "requires a non-blank publication summary for %s",
    async (method) => {
      const response = await getTemplateValidationResponse(method, 1, {
        changeSummary: "   "
      });

      expect(response.errors).toEqual(["请填写模板发布说明"]);
    }
  );

  it("rejects unsafe dynamic JSON without exposing submitted content", async () => {
    const cyclic: Record<string, unknown> = { secret: "TOP-SECRET" };
    cyclic.self = cyclic;
    const custom = Object.assign(Object.create({ unsafe: true }) as Record<string, unknown>, {
      secret: "TOP-SECRET"
    });

    for (const content of [cyclic, custom, { secret: "TOP-SECRET", value: 1n }, () => "TOP-SECRET"]) {
      const response = await getTemplateValidationResponse("createClause", 0, {
        code: "CLAUSE-1",
        category: "payment",
        name: "条款",
        title: "付款条款",
        content
      });

      expect(response.errors).toEqual(["提交内容包含不可保存的 JSON 数据"]);
      expect(JSON.stringify(response)).not.toContain("TOP-SECRET");
    }
  });

  it.each(governedMethods)("guards %s with template governance positions", (method) => {
    const handler = (ContractTemplateController.prototype as unknown as Record<string, object>)[method];

    expect(Reflect.getMetadata(REQUIRED_POSITIONS_KEY, handler)).toEqual(governancePositions);
  });

  it("keeps published template and layout reads open to authenticated users", () => {
    expect(Reflect.getMetadata(REQUIRED_POSITIONS_KEY, ContractTemplateController.prototype.listPublished)).toBeUndefined();
    expect(Reflect.getMetadata(REQUIRED_POSITIONS_KEY, ContractTemplateController.prototype.listPublishedLayouts)).toBeUndefined();
    expect(Reflect.getMetadata(REQUIRED_POSITIONS_KEY, ContractTemplateController.prototype.listPublishedClauses)).toBeUndefined();
  });

  it.each(["listAvailableScenarios", "recommendScenarioTemplates"])(
    "guards ordinary scenario read %s with project contract.create",
    (method) => {
      const handler = (ContractTemplateController.prototype as unknown as Record<string, object>)[method];
      expect(Reflect.getMetadata(REQUIRED_PROJECT_ACTION_KEY, handler)).toBe("contract.create");
    }
  );
});
