import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  BusinessEntryDraftPayload,
  BusinessEntrySceneDefinition,
  BusinessEntryValidationResult
} from "@jiangkong/shared-domain";
import {
  businessEntryDraftFromForm,
  businessEntryDraftsFromGrid,
  businessEntryDraftsFromPaste,
  formatBusinessEntryEditableValue,
  formatBusinessEntryReadonlyValue,
  locateBusinessEntryErrors,
  planBusinessEntryDraftImport,
  visibleBusinessEntryFields,
  visibleBusinessEntryValues
} from "./business-entry-adapters";

const roles = ["finance_staff"] as const;
const fieldBase = {
  description: "业务字段",
  example: "示例",
  scope: "line" as const,
  unit: "",
  precision: 0,
  required: true,
  permissions: { view: roles, edit: roles },
  bulk: { enabled: true, strategy: "append" as const },
  display: {
    formHint: "请填写",
    gridColumn: "业务字段",
    mobilePriority: 1,
    readonlyText: "按提交快照展示"
  }
};

const definition: BusinessEntrySceneDefinition = {
  key: "expense_line",
  entityType: "operating_takeover_row",
  name: "费用明细",
  description: "费用明细录入",
  version: 3,
  fields: [
    {
      ...fieldBase,
      key: "businessNo",
      label: "业务整理编号",
      type: "text",
      excel: { column: "业务整理编号", paste: "multi", errorLocation: "cell" }
    },
    {
      ...fieldBase,
      key: "amountYuan",
      label: "金额",
      type: "money",
      unit: "元",
      precision: 2,
      excel: { column: "金额（元）", paste: "multi", errorLocation: "cell" }
    },
    {
      ...fieldBase,
      key: "status",
      label: "办理状态",
      type: "single_select",
      options: [
        { value: "pending", label: "待办理" },
        { value: "completed", label: "已完成" }
      ],
      excel: { column: "办理状态", paste: "multi", errorLocation: "cell" }
    },
    {
      ...fieldBase,
      key: "verified",
      label: "已经核实",
      type: "boolean",
      excel: { column: "已经核实", paste: "multi", errorLocation: "cell" }
    }
  ],
  rules: [
    {
      key: "amount_after_no",
      kind: "greater_than_or_equal",
      leftFieldKey: "amountYuan",
      rightFieldKey: "businessNo",
      message: "金额填写有误"
    }
  ]
};

const target = { entityType: "operating_takeover_row", entityId: "project-1" };
const expected: BusinessEntryDraftPayload = {
  sceneKey: "expense_line",
  definitionVersion: 3,
  target,
  values: {
    businessNo: "整理-001",
    amountYuan: "100.50",
    status: "pending",
    verified: true
  }
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("business entry adapters", () => {
  it("keeps local date-only values on the selected Shanghai calendar day", () => {
    vi.stubEnv("TZ", "Asia/Shanghai");
    const dateDefinition: BusinessEntrySceneDefinition = {
      ...definition,
      fields: [{
        ...fieldBase,
        key: "occurredOn",
        label: "发生日期",
        type: "date",
        excel: { column: "发生日期", paste: "multi", errorLocation: "cell" }
      }]
    };

    expect(businessEntryDraftFromForm(dateDefinition, target, {
      occurredOn: new Date(2026, 7, 16)
    }).values).toEqual({ occurredOn: "2026-08-16" });
  });

  it("normalizes finite numbers consistently and leaves invalid input for backend validation", () => {
    const numberDefinition: BusinessEntrySceneDefinition = {
      ...definition,
      fields: [{
        ...fieldBase,
        key: "quantity",
        label: "数量",
        type: "number",
        precision: 2,
        excel: { column: "数量", paste: "multi", errorLocation: "cell" }
      }]
    };

    expect(businessEntryDraftFromForm(numberDefinition, target, { quantity: " 12.5 " }).values)
      .toEqual({ quantity: 12.5 });
    expect(businessEntryDraftsFromGrid(numberDefinition, target, [{ quantity: "12.5" }])[0]?.values)
      .toEqual({ quantity: 12.5 });
    expect(businessEntryDraftsFromPaste(numberDefinition, target, "12.5")[0]?.values)
      .toEqual({ quantity: 12.5 });
    expect(businessEntryDraftFromForm(numberDefinition, target, { quantity: "不是数字" }).values)
      .toEqual({ quantity: "不是数字" });
  });

  it("removes values hidden through a multi-level visibleWhen chain", () => {
    const chainedDefinition: BusinessEntrySceneDefinition = {
      ...definition,
      fields: [
        {
          ...fieldBase,
          key: "enabled",
          label: "启用附加信息",
          type: "boolean",
          excel: { column: "启用附加信息", paste: "multi", errorLocation: "cell" }
        },
        {
          ...fieldBase,
          key: "confirmed",
          label: "已经确认",
          type: "boolean",
          visibleWhen: { fieldKey: "enabled", operator: "eq", value: true },
          excel: { column: "已经确认", paste: "multi", errorLocation: "cell" }
        },
        {
          ...fieldBase,
          key: "confirmationNote",
          label: "确认说明",
          type: "text",
          visibleWhen: { fieldKey: "confirmed", operator: "eq", value: true },
          excel: { column: "确认说明", paste: "multi", errorLocation: "cell" }
        }
      ]
    };

    expect(visibleBusinessEntryValues(chainedDefinition, {
      enabled: false,
      confirmed: true,
      confirmationNote: "旧说明"
    })).toEqual({ enabled: false });
  });

  it("enforces the strictest definition bulk limit for grid and paste input", () => {
    const limitedDefinition: BusinessEntrySceneDefinition = {
      ...definition,
      fields: definition.fields.slice(0, 2).map((field, index) => ({
        ...field,
        bulk: { ...field.bulk, maxRows: index === 0 ? 3 : 2 }
      }))
    };
    const rows = [
      { businessNo: "整理-001", amountYuan: "1" },
      { businessNo: "整理-002", amountYuan: "2" },
      { businessNo: "整理-003", amountYuan: "3" }
    ];

    expect(() => businessEntryDraftsFromGrid(limitedDefinition, target, rows))
      .toThrow("批量录入最多允许 2 条业务数据");
    expect(() => businessEntryDraftsFromPaste(
      limitedDefinition,
      target,
      "整理-001\t1\n整理-002\t2\n整理-003\t3"
    )).toThrow("批量录入最多允许 2 条业务数据");

    const singleOnlyDefinition: BusinessEntrySceneDefinition = {
      ...limitedDefinition,
      fields: limitedDefinition.fields.map((field, index) => index === 0
        ? { ...field, bulk: { ...field.bulk, enabled: false } }
        : field)
    };
    expect(() => businessEntryDraftsFromGrid(singleOnlyDefinition, target, rows.slice(0, 2)))
      .toThrow("当前业务字段只能逐条录入");
    expect(businessEntryDraftsFromPaste(singleOnlyDefinition, target, "整理-001\t1"))
      .toHaveLength(1);
  });

  it("uses business labels in the grid and converts edited labels back to option values", () => {
    const companyField = {
      ...fieldBase,
      key: "companyId",
      label: "我方公司",
      type: "company" as const,
      excel: { column: "我方公司", paste: "multi" as const, errorLocation: "cell" as const }
    };
    const optionDefinition: BusinessEntrySceneDefinition = {
      ...definition,
      fields: [companyField, definition.fields[2]!]
    };
    const optionsByField = {
      companyId: [{ label: "我方一公司", value: "company-internal-1" }]
    };

    expect(formatBusinessEntryEditableValue(
      companyField,
      "company-internal-1",
      optionsByField.companyId
    )).toBe("我方一公司");
    expect(formatBusinessEntryEditableValue(
      companyField,
      "unknown-internal-id",
      optionsByField.companyId
    )).toBe("未识别的业务对象");
    expect(formatBusinessEntryEditableValue(definition.fields[2]!, "pending"))
      .toBe("待办理");
    expect(formatBusinessEntryEditableValue(definition.fields[2]!, "unknown_status"))
      .toBe("未识别的业务选项");
    expect(businessEntryDraftsFromGrid(optionDefinition, target, [{
      companyId: "我方一公司",
      status: "待办理"
    }], optionsByField)[0]?.values).toEqual({
      companyId: "company-internal-1",
      status: "pending"
    });
  });

  it("derives visible fields from visibleWhen and current draft values", () => {
    const conditionalDefinition: BusinessEntrySceneDefinition = {
      ...definition,
      fields: [
        definition.fields[3]!,
        {
          ...definition.fields[0]!,
          visibleWhen: { fieldKey: "verified", operator: "eq", value: true }
        }
      ]
    };

    expect(visibleBusinessEntryFields(conditionalDefinition, { verified: false })
      .map((field) => field.key)).toEqual(["verified"]);
    expect(visibleBusinessEntryFields(conditionalDefinition, { verified: true })
      .map((field) => field.key)).toEqual(["verified", "businessNo"]);
  });

  it("produces the same DraftPayload from form, grid, and pasted Chinese values", () => {
    expect(businessEntryDraftFromForm(definition, target, {
      businessNo: "整理-001",
      amountYuan: " 100.50 ",
      status: "pending",
      verified: true
    })).toEqual(expected);

    expect(businessEntryDraftsFromGrid(definition, target, [{
      businessNo: "整理-001",
      amountYuan: "100.50",
      status: "待办理",
      verified: "是"
    }])).toEqual([expected]);

    expect(businessEntryDraftsFromPaste(
      definition,
      target,
      "整理-001\t100.50\t待办理\t是"
    )).toEqual([expected]);
  });

  it("maps field and cross-field errors back to a concrete grid cell", () => {
    const result: BusinessEntryValidationResult = {
      valid: false,
      sceneKey: definition.key,
      definitionVersion: definition.version,
      values: expected.values,
      errors: [
        { code: "required_field", fieldKey: "status", message: "请填写办理状态" },
        { code: "invalid_rule", ruleKey: "amount_after_no", message: "金额填写有误" }
      ]
    };

    expect(locateBusinessEntryErrors(definition, result, 2)).toEqual([
      { rowIndex: 2, fieldKey: "status", column: "办理状态", message: "请填写办理状态" },
      { rowIndex: 2, fieldKey: "amountYuan", column: "金额（元）", message: "金额填写有误" }
    ]);
  });

  it("requires an explicit new-or-append choice and blocks exact duplicates on append", () => {
    expect(() => planBusinessEntryDraftImport([expected], [expected], undefined)).toThrow(
      "请选择新建草稿或追加到当前草稿"
    );
    expect(planBusinessEntryDraftImport([expected], [expected], "append")).toMatchObject({
      blocked: true,
      duplicateIncomingRows: [0],
      drafts: [expected]
    });

    const second = {
      ...expected,
      values: { ...expected.values, businessNo: "整理-002" }
    };
    expect(planBusinessEntryDraftImport([expected], [second], "append")).toEqual({
      blocked: false,
      duplicateIncomingRows: [],
      drafts: [expected, second]
    });
    expect(planBusinessEntryDraftImport([expected], [second], "new").drafts).toEqual([second]);
  });

  it("renders frozen values with Chinese options and yuan instead of internal values", () => {
    expect(formatBusinessEntryReadonlyValue(definition.fields[1]!, "100.50")).toBe("100.50 元");
    expect(formatBusinessEntryReadonlyValue(definition.fields[2]!, "pending")).toBe("待办理");
    expect(formatBusinessEntryReadonlyValue(definition.fields[3]!, false)).toBe("否");
  });
});
