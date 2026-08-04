import {
  createSSRApp,
  defineComponent,
  h,
  type App
} from "vue";
import { renderToString } from "vue/server-renderer";
import { describe, expect, it } from "vitest";
import type { ContractDraftPartyModel } from "../../../api/contract-workbench.api";
import ContractPartySection from "./ContractPartySection.vue";

/* eslint-disable vue/one-component-per-file */

const harness = {
  cancelDelete: undefined as (() => void) | undefined,
  confirmDelete: undefined as (() => void) | undefined,
  deleteParty: new Map<number, () => void>(),
  editParty: new Map<string, (value: string) => void>()
};

const parties: ContractDraftPartyModel[] = [
  {
    roleKey: "party_a",
    displayOrder: 0,
    snapshot: { name: "我方公司" }
  },
  {
    roleKey: "party_b",
    displayOrder: 1,
    snapshot: { name: "供应商", contactPhone: "13800000000" }
  }
];

describe("ContractPartySection", () => {
  it("allows draft party add, edit and delete through the local aggregate", async () => {
    const rendered = await renderPartySection(false);
    const { html, updates } = rendered;

    expect(html).toContain('data-party-field="name"');
    expect(html).toContain('data-party-index="1"');
    expect(html).toContain('data-action="delete-party"');
    expect(html).toContain("加入合同草稿");
    expect(html).toContain("删除合同主体");
    expect(html).toContain("只修改当前本地草稿");
    expect(html).not.toContain('type="password"');

    harness.editParty.get("1:name")?.("新供应商");
    expect(updates.at(-1)?.[1]?.snapshot["name"]).toBe("新供应商");

    harness.deleteParty.get(1)?.();
    harness.cancelDelete?.();
    expect(updates).toHaveLength(1);

    harness.deleteParty.get(1)?.();
    harness.confirmDelete?.();
    expect(updates.at(-1)).toHaveLength(1);
    expect(updates.at(-1)?.[0]?.roleKey).toBe("party_a");
  });

  it("makes every party mutation control read-only after submission", async () => {
    const { html, updates } = await renderPartySection(true);
    const existingNameControl = html.match(
      /<input[^>]*data-party-field="name"[^>]*data-party-index="1"[^>]*>/u
    )?.[0];
    const deleteButton = html.match(
      /<button[^>]*data-action="delete-party"[^>]*data-party-index="1"[^>]*>/u
    )?.[0];

    expect(existingNameControl).toContain("disabled");
    expect(deleteButton).toContain("disabled");

    harness.editParty.get("1:name")?.("不得写入");
    harness.deleteParty.get(1)?.();
    harness.confirmDelete?.();
    expect(updates).toHaveLength(0);
  });
});

async function renderPartySection(disabled: boolean) {
  harness.cancelDelete = undefined;
  harness.confirmDelete = undefined;
  harness.deleteParty.clear();
  harness.editParty.clear();
  const updates: ContractDraftPartyModel[][] = [];
  const app = createSSRApp(ContractPartySection, {
    parties,
    contractVersionId: "version-1",
    disabled,
    "onUpdate:parties": (next: ContractDraftPartyModel[]) => updates.push(next)
  });
  registerTDesignStubs(app);
  return {
    html: await renderToString(app),
    updates
  };
}

function registerTDesignStubs(app: App) {
  app.component("TTag", defineComponent({
    setup(_props, { slots }) {
      return () => h("span", slots.default?.());
    }
  }));
  app.component("TInput", defineComponent({
    inheritAttrs: false,
    props: {
      value: { type: String, default: "" },
      modelValue: { type: String, default: "" },
      disabled: { type: Boolean, default: false }
    },
    emits: ["change", "update:modelValue"],
    setup(props, { attrs, emit }) {
      const partyField = String(attrs["data-party-field"] ?? "");
      const partyIndex = String(attrs["data-party-index"] ?? "");
      if (partyField && partyIndex) {
        harness.editParty.set(
          `${partyIndex}:${partyField}`,
          (value) => emit("change", value)
        );
      }
      return () => h("input", {
        ...attrs,
        value: props.value || props.modelValue,
        disabled: props.disabled
      });
    }
  }));
  app.component("TSelect", defineComponent({
    inheritAttrs: false,
    props: {
      disabled: { type: Boolean, default: false }
    },
    setup(props, { attrs }) {
      return () => h("select", {
        ...attrs,
        disabled: props.disabled
      });
    }
  }));
  app.component("TButton", defineComponent({
    inheritAttrs: false,
    props: {
      disabled: { type: Boolean, default: false }
    },
    emits: ["click"],
    setup(props, { attrs, emit, slots }) {
      if (attrs["data-action"] === "delete-party") {
        harness.deleteParty.set(
          Number(attrs["data-party-index"]),
          () => emit("click")
        );
      }
      return () => h("button", {
        ...attrs,
        disabled: props.disabled
      }, slots.default?.());
    }
  }));
  app.component("TDialog", defineComponent({
    emits: ["confirm", "close"],
    setup(_props, { emit, slots }) {
      harness.confirmDelete = () => emit("confirm");
      harness.cancelDelete = () => emit("close");
      return () => h("section", [slots.default?.(), slots.footer?.()]);
    }
  }));
}
