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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  listPublishedStandardClauses,
  type PublishedStandardClause
} from "../../../api/contract-workbench.api";
import * as contractBillEditor from "./contract-bill-editor";
import ContractClausesSection from "./ContractClausesSection.vue";
import type { ContractDraftModel } from "./use-contract-draft";

vi.mock("../../../api/contract-workbench.api", () => ({
  listPublishedStandardClauses: vi.fn().mockResolvedValue([])
}));

interface FieldControl {
  kind: "input" | "textarea" | "select";
  testId: string;
  value: unknown;
  options: Array<{ label: string; value: string }>;
  disabled: boolean;
  update: (value: string) => void;
  change: (value: string) => void;
}

beforeEach(() => {
  vi.mocked(listPublishedStandardClauses).mockResolvedValue(
    publishedStandardClauses()
  );
});

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

  it("normalizes the current clause document only once for each block text input", async () => {
    const normalizeDocument = vi.spyOn(
      contractBillEditor,
      "normalizeClauseDocument"
    );
    const harness = clauseHarness();
    await harness.render();
    normalizeDocument.mockClear();

    control(harness, "textarea", 0).update("单次规范化");

    expect(normalizeDocument).toHaveBeenCalledTimes(1);
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
      "clause-standard-payment",
      "clause-paragraph-payment-0",
      "clause-list-payment-1",
      "clause-table-payment-2-0-0"
    ]) {
      expect(controlByTestId(harness, testId).disabled).toBe(true);
    }
  });

  it("restores saved standard source ids and removes the second insert action", async () => {
    const harness = clauseHarness();
    const html = await harness.render();
    const paymentStandardSelect = controlByTestId(
      harness,
      "clause-standard-payment"
    );

    expect(paymentStandardSelect.value).toBe("standard-payment-v2");
    expect(paymentStandardSelect.options).toEqual([
      { label: "公司付款条款 v4", value: "standard-payment-v4" },
      { label: "公司质量验收条款 v3", value: "standard-quality-v3" },
      { label: "公司付款条款 v2", value: "standard-payment-v2" }
    ]);
    expect(
      paymentStandardSelect.options.filter(
        (option) => option.value === "standard-payment-v4"
      )
    ).toHaveLength(1);
    expect(controlByTestId(harness, "clause-standard-quality").value).toBe("");
    expect(html).not.toContain("插入标准条款");
    expect(html).toContain("当前标题和正文将被覆盖");
    expect(listPublishedStandardClauses).toHaveBeenCalledTimes(1);
  });

  it("uses a readable historical label when saved source metadata is incomplete", async () => {
    const model = contractDraftModel();
    model.clauses[0] = {
      ...model.clauses[0],
      title: "旧版付款约定",
      standardClauseVersionId: "legacy-standard-version-id",
      content: {
        text: "旧版付款正文",
        blocks: [{ type: "paragraph", text: "旧版付款正文" }],
        deviatedFromStandard: false
      }
    };
    const harness = clauseHarness(model);
    await harness.render();

    const options = controlByTestId(
      harness,
      "clause-standard-payment"
    ).options;
    expect(options).toContainEqual({
      label: "旧版付款约定（历史版本）",
      value: "legacy-standard-version-id"
    });
    expect(options.map((option) => option.label)).not.toContain(
      "legacy-standard-version-id"
    );
  });

  it("does not write the model for a missing standard source", async () => {
    const harness = clauseHarness();
    await harness.render();
    const before = JSON.parse(JSON.stringify(harness.model.value)) as ContractDraftModel;

    controlByTestId(harness, "clause-standard-payment").change("missing-source");

    expect(harness.model.value).toEqual(before);
    expect(harness.dirtyCount.value).toBe(0);
  });
});

function clauseHarness(initialModel = contractDraftModel()) {
  const model = ref(initialModel);
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
    return renderToString(app);
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
  app.component(
    "TDialog",
    defineComponent({
      name: "TDialog",
      setup(_props, { slots }) {
        return () => h("section", [slots.default?.(), slots.footer?.()]);
      }
    })
  );
  app.component(
    "TAlert",
    defineComponent({
      name: "TAlert",
      props: {
        message: { type: String, default: "" }
      },
      setup(props) {
        return () => h("div", props.message);
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
      options: {
        type: Array as PropType<Array<{ label: string; value: string }>>,
        default: () => []
      },
      disabled: { type: Boolean, default: false }
    },
    emits: ["update:modelValue", "change"],
    setup(props, { attrs, emit }) {
      controls.push({
        kind,
        testId: String(attrs["data-testid"] ?? ""),
        value: props.modelValue ?? props.value ?? "",
        options: props.options,
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
    estimatedAmountCents: null,
    amountAdjustmentReason: "",
    paymentTermsOriginalText: "",
    paymentRatioBps: null,
    paymentDueDays: null,
    paymentRequiresInvoice: true,
    paymentAllowsEarlyPayment: false,
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

function publishedStandardClauses(): PublishedStandardClause[] {
  return [
    {
      standardClauseVersionId: "standard-payment-v4",
      versionId: "standard-payment-v4",
      versionNo: 4,
      title: "付款条款（新版）",
      content: {
        text: "新版付款正文",
        blocks: [{ type: "paragraph", text: "新版付款正文" }]
      },
      clauseId: "standard-payment",
      code: "PAYMENT",
      name: "公司付款条款",
      category: "付款"
    },
    {
      standardClauseVersionId: "standard-payment-v4",
      versionId: "standard-payment-v4-duplicate",
      versionNo: 4,
      title: "付款条款（重复）",
      content: {
        text: "重复来源不应显示",
        blocks: [{ type: "paragraph", text: "重复来源不应显示" }]
      },
      clauseId: "standard-payment",
      code: "PAYMENT",
      name: "重复付款条款",
      category: "付款"
    },
    {
      standardClauseVersionId: "standard-quality-v3",
      versionId: "standard-quality-v3",
      versionNo: 3,
      title: "质量验收条款",
      content: {
        text: "质量验收标准正文",
        blocks: [{ type: "paragraph", text: "质量验收标准正文" }]
      },
      clauseId: "standard-quality",
      code: "QUALITY",
      name: "公司质量验收条款",
      category: "质量"
    }
  ];
}
