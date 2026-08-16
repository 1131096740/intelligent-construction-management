/* eslint-disable vue/one-component-per-file */
import {
  createSSRApp,
  defineComponent,
  h,
  type PropType
} from "vue";
import { renderToString } from "vue/server-renderer";
import { describe, expect, it, vi } from "vitest";
import JgBusinessGridSelectEditor from "./JgBusinessGridSelectEditor.vue";

interface SelectHarness {
  filterable: boolean;
  modelValue: unknown;
  options: Array<{ label: string; value: string }>;
  update: (value: unknown) => void;
}

describe("JgBusinessGrid searchable select editor", () => {
  it("renders an opt-in searchable business selector and commits the selected value", async () => {
    const controls: SelectHarness[] = [];
    const save = vi.fn();
    const close = vi.fn();
    const app = createSSRApp(JgBusinessGridSelectEditor, {
      rowIndex: 0,
      model: { companyId: "我方一公司" },
      prop: "companyId",
      val: "我方一公司",
      column: {
        prop: "companyId",
        businessSelectOptions: [
          { label: "我方一公司", value: "company-internal-1" },
          { label: "我方二公司", value: "company-internal-2" }
        ]
      },
      save,
      close
    });
    app.component("TSelect", defineComponent({
      name: "TSelect",
      props: {
        filterable: { type: Boolean, default: false },
        modelValue: { type: null as unknown as PropType<unknown>, default: undefined },
        options: {
          type: Array as PropType<Array<{ label: string; value: string }>>,
          default: () => []
        }
      },
      emits: ["update:modelValue"],
      setup(props, { emit }) {
        controls.push({
          filterable: props.filterable,
          modelValue: props.modelValue,
          options: props.options,
          update: (value) => emit("update:modelValue", value)
        });
        return () => h("select");
      }
    }));

    await renderToString(app);

    expect(controls).toEqual([expect.objectContaining({
      filterable: true,
      modelValue: "company-internal-1",
      options: [
        { label: "我方一公司", value: "company-internal-1" },
        { label: "我方二公司", value: "company-internal-2" }
      ]
    })]);
    controls[0]!.update("company-internal-2");
    expect(save).toHaveBeenCalledWith("company-internal-2");
    expect(close).toHaveBeenCalledWith(true);
  });
});
