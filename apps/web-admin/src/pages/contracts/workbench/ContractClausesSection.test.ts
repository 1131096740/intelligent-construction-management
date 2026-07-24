/* eslint-disable vue/one-component-per-file */
import type { ContractClauseDefinition } from "@jiangkong/shared-domain";
import {
  createSSRApp,
  defineComponent,
  h,
  ref,
  type App,
  type PropType
} from "vue";
import { renderToString } from "vue/server-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";

import ContractClausesSection from "./ContractClausesSection.vue";
import type { ContractDraftModel } from "./use-contract-draft";

vi.mock("../../../api/contract-workbench.api", () => ({
  listPublishedStandardClauses: vi.fn().mockResolvedValue([])
}));

interface FieldControl {
  kind: "input" | "textarea" | "select";
  testId: string;
  value: unknown;
  disabled: boolean;
  update: (value: string) => void;
  change: (value: string) => void;
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("ContractClausesSection controlled inputs", () => {
  it("writes an unblurred title into the parent model and survives a section remount", async () => {
    const harness = clauseHarness();
    await harness.render();
    const otherClause = harness.model.value.clauses[1];

    control(harness, "input", 0).update("新付款标题");

    expect(harness.model.value.clauses[0]).toMatchObject({
      key: "payment",
      title: "新付款标题",
      content: { deviatedFromStandard: true }
    });
    expect(harness.model.value.clauses[1]).toBe(otherClause);
    expect(harness.dirtyCount.value).toBe(1);

    harness.visible.value = false;
    await harness.render();
    harness.visible.value = true;
    await harness.render();

    expect(controlByTestId(harness, "clause-title-payment").value).toBe(
      "新付款标题"
    );
  });

  it("updates paragraph, list item and table cell text on input with synchronized content.text", async () => {
    const harness = clauseHarness();
    await harness.render();

    control(harness, "textarea", 0).update("新段落");
    expect(paymentClause(harness).content).toMatchObject({
      text: "新段落\n第一步\n第二步\n甲 | 乙",
      deviatedFromStandard: true
    });

    await harness.render();
    controlByTestId(harness, "clause-list-payment-1").update(
      "更新步骤\n第二步"
    );
    expect(paymentClause(harness).content).toMatchObject({
      text: "新段落\n更新步骤\n第二步\n甲 | 乙",
      blocks: [
        { type: "paragraph", text: "新段落" },
        { type: "list", items: ["更新步骤", "第二步"] },
        { type: "table", rows: [["甲", "乙"]] }
      ],
      documentMeta: { owner: "合同部" },
      deviatedFromStandard: true
    });

    await harness.render();
    controlByTestId(harness, "clause-table-payment-2-0-0").update(
      "更新单元格"
    );
    expect(paymentClause(harness).content).toMatchObject({
      text: "新段落\n更新步骤\n第二步\n更新单元格 | 乙",
      blocks: [
        { type: "paragraph", text: "新段落" },
        { type: "list", items: ["更新步骤", "第二步"] },
        { type: "table", rows: [["更新单元格", "乙"]] }
      ],
      documentMeta: { owner: "合同部" },
      deviatedFromStandard: true
    });
    expect(harness.dirtyCount.value).toBe(3);
  });

  it("updates numbering from the select change event and keeps controlled fields disabled", async () => {
    const harness = clauseHarness();
    await harness.render();

    control(harness, "select", 0).change("fixed");

    expect(paymentClause(harness).numberingMode).toBe("fixed");
    expect(harness.dirtyCount.value).toBe(1);

    harness.disabled.value = true;
    await harness.render();

    for (const testId of [
      "clause-title-payment",
      "clause-numbering-payment",
      "clause-paragraph-payment-0",
      "clause-list-payment-1",
      "clause-table-payment-2-0-0"
    ]) {
      expect(controlByTestId(harness, testId).disabled).toBe(true);
    }
  });
});

function clauseHarness() {
  const model = ref(contractDraftModel());
  const visible = ref(true);
  const disabled = ref(false);
  const dirtyCount = ref(0);
  const controls: FieldControl[] = [];
  const ParentHarness = defineComponent({
    name: "ContractClausesParentHarness",
    setup() {
      return () =>
        visible.value
          ? h(ContractClausesSection, {
              model: model.value,
              disabled: disabled.value,
              onUpdate: (patch: Partial<ContractDraftModel>) => {
                model.value = { ...model.value, ...patch };
                dirtyCount.value += 1;
              }
            })
          : null;
    }
  });

  async function render() {
    controls.splice(0);
    const app = createSSRApp(ParentHarness);
    registerTDesignStubs(app, controls);
    await renderToString(app);
  }

  return { model, visible, disabled, dirtyCount, controls, render };
}

function registerTDesignStubs(app: App, controls: FieldControl[]) {
  app.component("TInput", controlledField("input", controls));
  app.component("TTextarea", controlledField("textarea", controls));
  app.component("TSelect", controlledField("select", controls));
  app.component(
    "TTag",
    defineComponent({
      name: "TTag",
      setup(_props, { slots }) {
        return () => h("span", slots.default?.());
      }
    })
  );
  app.component(
    "TButton",
    defineComponent({
      name: "TButton",
      setup(_props, { attrs, slots }) {
        return () => h("button", attrs, slots.default?.());
      }
    })
  );
}

function controlledField(
  kind: FieldControl["kind"],
  controls: FieldControl[]
) {
  return defineComponent({
    name: `Controlled${kind}`,
    inheritAttrs: false,
    props: {
      value: {
        type: [String, Number, Boolean] as PropType<string | number | boolean>,
        default: undefined
      },
      modelValue: {
        type: [String, Number, Boolean] as PropType<string | number | boolean>,
        default: undefined
      },
      disabled: { type: Boolean, default: false }
    },
    emits: ["update:modelValue", "change"],
    setup(props, { attrs, emit }) {
      controls.push({
        kind,
        testId: String(attrs["data-testid"] ?? ""),
        value: props.modelValue ?? props.value ?? "",
        disabled: props.disabled,
        update: (value) => emit("update:modelValue", value),
        change: (value) => emit("change", value)
      });
      return () => h(kind);
    }
  });
}

function control(
  harness: ReturnType<typeof clauseHarness>,
  kind: FieldControl["kind"],
  index: number
): FieldControl {
  const item = harness.controls.filter((candidate) => candidate.kind === kind)[index];
  if (!item) throw new Error(`未找到第 ${index + 1} 个 ${kind} 控件`);
  return item;
}

function controlByTestId(
  harness: ReturnType<typeof clauseHarness>,
  testId: string
): FieldControl {
  const item = harness.controls.find((candidate) => candidate.testId === testId);
  if (!item) throw new Error(`未找到测试控件 ${testId}`);
  return item;
}

function contractDraftModel(): ContractDraftModel {
  const standardContent = {
    text: "原段落\n第一步\n第二步\n甲 | 乙",
    blocks: [
      { type: "paragraph" as const, text: "原段落" },
      { type: "list" as const, items: ["第一步", "第二步"] },
      { type: "table" as const, rows: [["甲", "乙"]] }
    ]
  };
  return {
    contractName: "测试合同",
    companyEntityId: "",
    companyEntitySelection: null,
    pricingNature: "",
    amountSource: "",
    manualAmountCents: null,
    amountAdjustmentReason: "",
    paymentTermsOriginalText: "",
    paymentRatioBps: null,
    paymentDueDays: null,
    paymentRequiresInvoice: true,
    paymentAllowsInstallments: true,
    invoiceType: null,
    taxMode: "single_rate",
    defaultTaxRatePercent: null,
    fieldValues: {},
    partyValues: {},
    extraDraftData: {},
    clauses: [
      {
        key: "payment",
        title: "标准付款条款",
        numberingMode: "automatic",
        required: true,
        standardClauseVersionId: "standard-payment-v2",
        content: {
          ...standardContent,
          documentMeta: { owner: "合同部" },
          standardTitle: "标准付款条款",
          standardContent,
          standardClauseSourceName: "公司付款条款",
          standardClauseVersionNo: 2,
          deviatedFromStandard: false
        }
      },
      {
        key: "quality",
        title: "质量条款",
        numberingMode: "fixed",
        content: { text: "其他条款", blocks: [{ type: "paragraph", text: "其他条款" }] }
      }
    ]
  };
}

function paymentClause(harness: ReturnType<typeof clauseHarness>) {
  return harness.model.value.clauses[0] as ContractClauseDefinition & {
    content: Record<string, unknown>;
  };
}
