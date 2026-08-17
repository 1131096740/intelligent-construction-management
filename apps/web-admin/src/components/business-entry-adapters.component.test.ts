/* eslint-disable vue/one-component-per-file */
import {
  createSSRApp,
  defineComponent,
  h,
  type App,
  type Component,
  type PropType
} from "vue";
import { renderToString } from "vue/server-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  BusinessEntryDraftPayload,
  BusinessEntryFrozenSnapshot,
  BusinessEntrySceneDefinition
} from "@jiangkong/shared-domain";
import BusinessEntryForm from "./BusinessEntryForm.vue";
import BusinessEntryGrid from "./BusinessEntryGrid.vue";
import BusinessEntryImportChoice from "./BusinessEntryImportChoice.vue";
import BusinessEntryMobileCards from "./BusinessEntryMobileCards.vue";
import BusinessEntryReadonlySnapshot from "./BusinessEntryReadonlySnapshot.vue";

interface FieldControlHarness {
  disabled: boolean;
  fieldKey: string;
  modelValue: unknown;
  update: (value: unknown) => void;
}

const roles = ["finance_staff"] as const;
const fieldBase = {
  description: "业务字段",
  example: "示例",
  scope: "line" as const,
  unit: "",
  precision: 0,
  required: true,
  permissions: { view: roles, edit: roles },
  bulk: { enabled: true, maxRows: 10, strategy: "append" as const },
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
      key: "verified",
      label: "已经核实",
      type: "boolean",
      excel: { column: "已经核实", paste: "multi", errorLocation: "cell" }
    },
    {
      ...fieldBase,
      key: "businessNo",
      label: "业务整理编号",
      type: "text",
      visibleWhen: { fieldKey: "verified", operator: "eq", value: true },
      excel: { column: "业务整理编号", paste: "multi", errorLocation: "cell" }
    }
  ],
  rules: []
};
const target = { entityType: "operating_takeover_row", entityId: "project-1" };

afterEach(() => {
  vi.unstubAllGlobals();
});

async function renderComponent(
  component: Component,
  props: Record<string, unknown>,
  controls: FieldControlHarness[] = [],
  importChanges: Array<(value: unknown) => void> = []
) {
  const app = createSSRApp(component, props);
  registerTDesignStubs(app, controls, importChanges);
  return renderToString(app);
}

function registerTDesignStubs(
  app: App,
  controls: FieldControlHarness[],
  importChanges: Array<(value: unknown) => void>
) {
  const fieldControl = (name: string) => defineComponent({
    name,
    inheritAttrs: false,
    props: {
      modelValue: { type: null as unknown as PropType<unknown>, default: undefined },
      disabled: { type: Boolean, default: false },
      options: { type: Array, default: () => [] }
    },
    emits: ["update:modelValue"],
    setup(props, { attrs, emit }) {
      controls.push({
        disabled: props.disabled,
        fieldKey: String(attrs["data-field"] ?? ""),
        modelValue: props.modelValue,
        update: (value) => emit("update:modelValue", value)
      });
      return () => h("input", { "data-field": attrs["data-field"], disabled: props.disabled });
    }
  });
  app.component("TInput", fieldControl("TInput"));
  app.component("TTextarea", fieldControl("TTextarea"));
  app.component("TSelect", fieldControl("TSelect"));
  app.component("TDatePicker", fieldControl("TDatePicker"));
  app.component("TCard", defineComponent({
    name: "TCard",
    props: { title: { type: String, default: "" } },
    setup(props, { slots }) {
      return () => h("article", [h("h2", props.title), slots.default?.()]);
    }
  }));
  app.component("TAlert", defineComponent({
    name: "TAlert",
    props: { title: { type: String, default: "" } },
    setup(props) {
      return () => h("aside", props.title);
    }
  }));
  app.component("TRadioGroup", defineComponent({
    name: "TRadioGroup",
    emits: ["change"],
    setup(_props, { emit, slots }) {
      importChanges.push((value) => emit("change", value));
      return () => h("div", slots.default?.());
    }
  }));
  app.component("TRadio", defineComponent({
    name: "TRadio",
    setup(_props, { slots }) {
      return () => h("span", slots.default?.());
    }
  }));
}

describe("business entry adapter components", () => {
  it("renders and emits a form using only fields visible for the current values", async () => {
    const controls: FieldControlHarness[] = [];
    const updates: BusinessEntryDraftPayload[] = [];
    const draft: BusinessEntryDraftPayload = {
      sceneKey: definition.key,
      definitionVersion: definition.version,
      target,
      values: { verified: false, businessNo: "整理-001" }
    };
    await renderComponent(BusinessEntryForm, {
      definition,
      modelValue: draft,
      "onUpdate:modelValue": (value: BusinessEntryDraftPayload) => updates.push(value)
    }, controls);

    expect(controls.map((control) => control.fieldKey)).toEqual(["verified"]);
    controls[0]!.update(true);
    expect(updates[0]?.values).toMatchObject({ verified: true, businessNo: "整理-001" });
    expect(BusinessEntryForm.emits).toContain("update:modelValue");
  });

  it("removes a form value when its visibleWhen condition becomes false", async () => {
    const controls: FieldControlHarness[] = [];
    const updates: BusinessEntryDraftPayload[] = [];
    await renderComponent(BusinessEntryForm, {
      definition,
      modelValue: {
        sceneKey: definition.key,
        definitionVersion: definition.version,
        target,
        values: { verified: true, businessNo: "整理-001" }
      },
      "onUpdate:modelValue": (value: BusinessEntryDraftPayload) => updates.push(value)
    }, controls);

    expect(controls.map((control) => control.fieldKey)).toEqual(["verified", "businessNo"]);
    controls[0]!.update(false);
    expect(updates[0]?.values).toEqual({ verified: false });
  });

  it("renders mobile cards using per-row visible fields", async () => {
    const controls: FieldControlHarness[] = [];
    await renderComponent(BusinessEntryMobileCards, {
      definition,
      modelValue: [{
        sceneKey: definition.key,
        definitionVersion: definition.version,
        target,
        values: { verified: false, businessNo: "整理-001" }
      }]
    }, controls);

    expect(controls.map((control) => control.fieldKey)).toEqual(["verified"]);
    expect(BusinessEntryMobileCards.props).toHaveProperty("definition");
  });

  it("removes a mobile-card value when its visibleWhen condition becomes false", async () => {
    const controls: FieldControlHarness[] = [];
    const updates: BusinessEntryDraftPayload[][] = [];
    await renderComponent(BusinessEntryMobileCards, {
      definition,
      modelValue: [{
        sceneKey: definition.key,
        definitionVersion: definition.version,
        target,
        values: { verified: true, businessNo: "整理-001" }
      }],
      "onUpdate:modelValue": (value: BusinessEntryDraftPayload[]) => updates.push(value)
    }, controls);

    controls[0]!.update(false);
    expect(updates[0]?.[0]?.values).toEqual({ verified: false });
  });

  it("locks the real mobile-card controls when any draft uses a stale definition", async () => {
    vi.stubGlobal("window", {
      matchMedia: () => ({
        matches: true,
        addEventListener: () => undefined,
        removeEventListener: () => undefined
      })
    });
    const controls: FieldControlHarness[] = [];
    await renderComponent(BusinessEntryGrid, {
      definition,
      modelValue: [{
        sceneKey: definition.key,
        definitionVersion: definition.version - 1,
        target,
        values: { verified: false }
      }]
    }, controls);

    expect(controls).toHaveLength(1);
    expect(controls[0]?.disabled).toBe(true);
  });

  it("renders frozen labels and emits only an explicit import choice", async () => {
    const snapshot: BusinessEntryFrozenSnapshot = {
      sceneKey: definition.key,
      target,
      revision: 1,
      definitionVersion: definition.version,
      definition: {
        ...definition,
        fields: [{
          ...fieldBase,
          key: "status",
          label: "办理状态",
          type: "single_select",
          options: [{ value: "pending", label: "待办理" }],
          excel: { column: "办理状态", paste: "multi", errorLocation: "cell" }
        }]
      },
      values: { status: "pending" },
      frozenAt: "2026-08-16T00:00:00.000Z"
    };
    const html = await renderComponent(BusinessEntryReadonlySnapshot, {
      submittedRecord: snapshot
    });
    expect(html).toContain("待办理");
    expect(html).not.toContain("pending");

    const choices: string[] = [];
    const importChanges: Array<(value: unknown) => void> = [];
    const choiceHtml = await renderComponent(BusinessEntryImportChoice, {
      currentRowCount: 1,
      "onUpdate:modelValue": (value: string) => choices.push(value)
    }, [], importChanges);
    expect(choiceHtml).toContain("新建草稿");
    expect(choiceHtml).toContain("追加到当前草稿");
    importChanges[0]?.("append");
    expect(choices).toEqual(["append"]);
    expect(BusinessEntryImportChoice.emits).toContain("update:modelValue");
  });
});
