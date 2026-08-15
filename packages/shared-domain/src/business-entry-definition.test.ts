import { describe, expect, it } from "vitest";
import {
  createBusinessEntryDefinitionRegistry,
  type BusinessEntrySceneDefinition
} from "./business-entry-definition";

const profileDefinition: BusinessEntrySceneDefinition = {
  key: "project_operating_profile",
  entityType: "project",
  name: "项目经营档案",
  description: "维护项目经营账和历史接管的受控字段。",
  version: 1,
  fields: [
    {
      key: "operatingLedgerEffectiveDate",
      label: "经营账生效日",
      description: "项目经营账开始纳入正式事实的日期。",
      example: "2026-08-16",
      type: "date",
      scope: "header",
      unit: "日",
      precision: 0,
      required: false,
      permissions: { view: ["finance_staff"], edit: ["finance_staff"] },
      display: {
        formHint: "填写项目经营账开始纳入正式事实的日期",
        gridColumn: "经营账生效日",
        mobilePriority: 1,
        readonlyText: "以项目经营账生效日为准"
      },
      excel: { column: "经营账生效日", paste: "single", errorLocation: "cell" },
      bulk: { enabled: true, maxRows: 1, strategy: "replace" }
    },
    {
      key: "takeoverStatus",
      label: "经营接管状态",
      description: "项目历史经营资料的接管状态。",
      example: "正在接管",
      type: "single_select",
      scope: "header",
      unit: "",
      precision: 0,
      required: true,
      options: [
        { value: "operating_with_takeover", label: "正式使用、历史接管中" },
        { value: "takeover_completed", label: "经营接管完成" }
      ],
      permissions: { view: ["finance_staff"], edit: ["finance_staff"] },
      display: {
        formHint: "选择受控的经营接管状态",
        gridColumn: "经营接管状态",
        mobilePriority: 1,
        readonlyText: "提交后按冻结快照展示"
      },
      excel: { column: "经营接管状态", paste: "single", errorLocation: "cell" },
      bulk: { enabled: true, maxRows: 1, strategy: "replace" }
    }
  ],
  rules: []
};

describe("business entry definition registry", () => {
  it("validates a registered draft and freezes its definition version", () => {
    const registry = createBusinessEntryDefinitionRegistry([profileDefinition]);

    const result = registry.validateDraft(
      {
        sceneKey: "project_operating_profile",
        definitionVersion: 1,
        target: { entityType: "project", entityId: "project-1" },
        values: {
          operatingLedgerEffectiveDate: "2026-08-16",
          takeoverStatus: "operating_with_takeover"
        }
      },
      ["finance_staff"]
    );

    expect(result).toEqual({
      valid: true,
      sceneKey: "project_operating_profile",
      definitionVersion: 1,
      values: {
        operatingLedgerEffectiveDate: "2026-08-16",
        takeoverStatus: "operating_with_takeover"
      },
      errors: []
    });

    expect(
      registry.validateDraft(
        {
          sceneKey: "project_operating_profile",
          definitionVersion: 1,
          target: { entityType: "project", entityId: "project-1" },
          values: { operatingLedgerEffectiveDate: "2026-08-16" }
        },
        ["finance_staff"]
      ).errors
    ).toContainEqual(expect.objectContaining({ code: "required_field", fieldKey: "takeoverStatus" }));

    const snapshot = registry.freezeSubmissionSnapshot(
      {
        sceneKey: "project_operating_profile",
        definitionVersion: 1,
        target: { entityType: "project", entityId: "project-1" },
        values: result.values
      },
      ["finance_staff"],
      { frozenAt: "2026-08-16T10:00:00.000Z" }
    );

    expect(snapshot.sceneKey).toBe("project_operating_profile");
    expect(snapshot.definitionVersion).toBe(1);
    expect(snapshot.frozenAt).toBe("2026-08-16T10:00:00.000Z");
    expect(snapshot.target).toEqual({ entityType: "project", entityId: "project-1" });
    expect(snapshot.values).toEqual(result.values);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.values)).toBe(true);
    expect(Object.isFrozen(registry.getSceneDefinition("project_operating_profile"))).toBe(true);
  });

  it("requires the current version and enforces readonly import, sensitive access, and format rules", () => {
    const registry = createBusinessEntryDefinitionRegistry([
      {
        ...profileDefinition,
        key: "controlled_import",
        fields: [
          ...profileDefinition.fields,
          {
            key: "sensitiveCode",
            label: "敏感编码",
            description: "仅授权岗位可见的受控编码。",
            example: "JG-001",
            type: "text",
            scope: "header",
            unit: "",
            precision: 0,
            required: false,
            readOnly: true,
            format: { pattern: "^JG-[0-9]{3}$" },
            permissions: {
              view: ["finance_staff", "finance_director"],
              edit: ["finance_staff", "finance_director"],
              import: ["finance_staff", "finance_director"],
              sensitive: ["finance_director"]
            },
            display: {
              formHint: "填写三位数字敏感编码",
              gridColumn: "敏感编码",
              mobilePriority: 2,
              readonlyText: "敏感编码已冻结"
            },
            excel: { column: "敏感编码", paste: "single", errorLocation: "cell" },
            bulk: { enabled: false, strategy: "replace" }
          }
        ]
      }
    ]);

    expect(
      registry.validateDraft(
        { sceneKey: "controlled_import", values: {} },
        ["finance_staff"],
        "edit"
      ).errors
    ).toContainEqual(expect.objectContaining({ code: "definition_version_required" }));

    expect(
      registry.validateDraft(
        {
          sceneKey: "controlled_import",
          definitionVersion: 1,
          values: { sensitiveCode: "JG-001" }
        },
        ["finance_director"],
        "import"
      ).errors
    ).toContainEqual(expect.objectContaining({ code: "read_only_field" }));

    const hidden = registry.getSceneDefinitionForRoles("controlled_import", ["finance_staff"]);
    expect(hidden.fields.map((field) => field.key)).not.toContain("sensitiveCode");

    const invalidFormat = registry.validateDraft(
      {
        sceneKey: "controlled_import",
        definitionVersion: 1,
        values: { sensitiveCode: "bad" }
      },
      ["finance_director"],
      "view"
    );
    expect(invalidFormat.errors).toContainEqual(
      expect.objectContaining({ code: "invalid_format", fieldKey: "sensitiveCode" })
    );

    const invalidDate = registry.validateDraft(
      {
        sceneKey: "controlled_import",
        definitionVersion: 1,
        values: { operatingLedgerEffectiveDate: "2026-02-31" }
      },
      ["finance_staff"],
      "view"
    );
    expect(invalidDate.errors).toContainEqual(
      expect.objectContaining({ code: "invalid_type", fieldKey: "operatingLedgerEffectiveDate" })
    );
  });

  it("fails closed for an unknown scene, unknown field, and stale definition", () => {
    const registry = createBusinessEntryDefinitionRegistry([profileDefinition]);

    expect(
      registry.validateDraft(
        { sceneKey: "not_registered", values: { arbitrary: "value" } },
        ["finance_staff"]
      )
    ).toMatchObject({
      valid: false,
      errors: [{ code: "unknown_scene" }]
    });

    const result = registry.validateDraft(
      {
        sceneKey: "project_operating_profile",
        definitionVersion: 2,
        values: { arbitrary: "value" }
      },
      ["finance_staff"]
    );

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
        expect.arrayContaining([
        expect.objectContaining({ code: "unknown_field", fieldKey: "arbitrary" }),
        expect.objectContaining({ code: "stale_definition_version" })
      ])
    );
  });

  it("enforces controlled options, cross-field rules, and field permissions", () => {
    const registry = createBusinessEntryDefinitionRegistry([
      {
        ...profileDefinition,
        key: "takeover_confirmation",
        fields: [
          ...profileDefinition.fields,
          {
            key: "takeoverCompletedDate",
            label: "经营接管完成日",
            description: "历史经营资料完成专业确认的日期。",
            example: "2026-08-16",
            type: "date",
            scope: "header",
            unit: "日",
            precision: 0,
            required: false,
            permissions: { view: ["finance_staff"], edit: ["finance_staff"] },
            display: {
              formHint: "填写完成日期",
              gridColumn: "经营接管完成日",
              mobilePriority: 1,
              readonlyText: "以冻结快照为准"
            },
            excel: { column: "经营接管完成日", paste: "single", errorLocation: "cell" },
            bulk: { enabled: true, maxRows: 1, strategy: "replace" }
          }
        ],
        rules: [
          {
            key: "completed_requires_date",
            kind: "required_if",
            when: {
              fieldKey: "takeoverStatus",
              operator: "eq",
              value: "takeover_completed"
            },
            fieldKey: "takeoverCompletedDate",
            message: "接管完成时必须填写经营接管完成日"
          }
        ]
      }
    ]);

    const incomplete = registry.validateDraft(
      {
        sceneKey: "takeover_confirmation",
        values: { takeoverStatus: "takeover_completed" }
      },
      ["finance_staff"]
    );
    expect(incomplete.errors).toContainEqual(
      expect.objectContaining({
        code: "invalid_rule",
        fieldKey: "takeoverCompletedDate",
        ruleKey: "completed_requires_date"
      })
    );

    const invalidOption = registry.validateDraft(
      {
        sceneKey: "takeover_confirmation",
        values: { takeoverStatus: "user_defined_status" }
      },
      ["finance_staff"]
    );
    expect(invalidOption.errors).toContainEqual(
      expect.objectContaining({ code: "invalid_option", fieldKey: "takeoverStatus" })
    );

    const forbidden = registry.validateDraft(
      {
        sceneKey: "takeover_confirmation",
        values: { takeoverStatus: "takeover_completed" }
      },
      ["project_manager"]
    );
    expect(forbidden.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "permission_denied", fieldKey: "takeoverStatus" })
      ])
    );
  });

  it("treats an explicitly empty permission list as deny-all", () => {
    const registry = createBusinessEntryDefinitionRegistry([
      {
        ...profileDefinition,
        key: "restricted_scene",
        fields: profileDefinition.fields.map((field) => ({
          ...field,
          permissions: { view: [], edit: [] }
        }))
      }
    ]);

    const result = registry.validateDraft(
      { sceneKey: "restricted_scene", values: {} },
      ["finance_staff"]
    );

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "permission_denied" })
      ])
    );
  });

  it("does not require hidden or unauthorized fields and rejects empty required multi-select values", () => {
    const registry = createBusinessEntryDefinitionRegistry([
      {
        ...profileDefinition,
        key: "conditional_fields",
        fields: [
          {
            ...profileDefinition.fields[0],
            key: "hiddenRequired",
            label: "条件必填字段",
            required: true,
            visibleWhen: {
              fieldKey: "takeoverStatus",
              operator: "eq",
              value: "takeover_completed"
            }
          },
          {
            ...profileDefinition.fields[0],
            key: "restrictedOptional",
            label: "受限可选字段",
            permissions: { view: ["finance_director"], edit: ["finance_director"] }
          },
          {
            ...profileDefinition.fields[0],
            key: "multiValue",
            label: "多选字段",
            type: "multi_select",
            required: true,
            options: [{ value: "a", label: "选项 A" }]
          },
          ...profileDefinition.fields.slice(1)
        ]
      }
    ]);

    const result = registry.validateDraft(
      {
        sceneKey: "conditional_fields",
        definitionVersion: 1,
        target: { entityType: "project", entityId: "project-1" },
        values: { takeoverStatus: "operating_with_takeover", multiValue: [] }
      },
      ["finance_staff"]
    );

    expect(result.errors).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "required_field", fieldKey: "hiddenRequired" }),
        expect.objectContaining({ code: "permission_denied", fieldKey: "restrictedOptional" })
      ])
    );
    expect(result.errors).toContainEqual(
      expect.objectContaining({ code: "required_field", fieldKey: "multiValue" })
    );
  });
});
