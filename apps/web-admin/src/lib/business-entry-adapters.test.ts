import { describe, expect, it } from "vitest";
import type {
  BusinessEntryDraftPayload,
  BusinessEntrySceneDefinition,
  BusinessEntryValidationResult
} from "@jiangkong/shared-domain";
import {
  businessEntryDraftFromForm,
  businessEntryDraftsFromGrid,
  businessEntryDraftsFromPaste,
  formatBusinessEntryReadonlyValue,
  locateBusinessEntryErrors,
  planBusinessEntryDraftImport
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

describe("business entry adapters", () => {
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
