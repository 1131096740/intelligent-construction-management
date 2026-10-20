/* eslint-disable vue/one-component-per-file */
import { createSSRApp, defineComponent, h, type PropType } from "vue";
import { renderToString } from "vue/server-renderer";
import { describe, expect, it, vi } from "vitest";
import ContractEntryChoice from "./ContractEntryChoice.vue";
const push = vi.hoisted(() => vi.fn());
const auth = vi.hoisted(() => ({ user: { globalRoleKeys: ["chairman"] } }));
vi.mock("../auth/auth.store", () => ({ useAuthStore: () => auth }));
vi.mock("vue-router", () => ({ useRouter: () => ({ push }) }));

async function render(relationship: "inside" | "outside" | "upward", mode: "new" | "takeover", projectId = "project-selected") {
  const buttons: Array<{ text: string; disabled: boolean; click: () => void }> = [];
  let change: (value: string) => void = () => undefined;
  const onChange = vi.fn();
  const app = createSSRApp(ContractEntryChoice, { modelValue: relationship, mode, projectId, "onUpdate:modelValue": onChange });
  const container = defineComponent({ setup(_, { slots }) { return () => h("section", slots.default?.()); } });
  app.component("TCard", container); app.component("TSpace", container);
  app.component("TRadioGroup", defineComponent({
    props: { value: { type: String, required: true }, options: { type: Array as PropType<Array<{ label: string }>>, required: true } }, emits: ["change"],
    setup(props, { emit }) {
      change = value => emit("change", value);
      return () => h("div", props.options.map((option: { label: string }) => h("span", option.label)));
    }
  }));
  app.component("TButton", defineComponent({
    props: { disabled: Boolean }, emits: ["click"],
    setup(props, { slots, emit }) {
      return () => {
        const text = slots.default?.().map(node => String(node.children)).join("") ?? "";
        buttons.push({ text: text.trim(), disabled: Boolean(props.disabled), click: () => emit("click") });
        return h("button", text);
      };
    }
  }));
  return { html: await renderToString(app), buttons, change: (value: string) => change(value), onChange };
}
describe("新办与历史接管按签约双方选择办理", () => {
  it.each(["new", "takeover"] as const)("三类均可选择且解释对上不重复计算：%s", async mode => {
    const view = await render("upward", mode);
    for (const label of ["表内（我方签约）", "表外（施工企业签约）", "对上（施工企业—我方）"]) expect(view.html).toContain(label);
    expect(view.html).toContain("不加入下游合同额或重复增加项目收入、成本");
    view.change("outside"); expect(view.onChange).toHaveBeenCalledWith("outside");
    view.change("owner"); expect(view.onChange).toHaveBeenCalledTimes(1);
  });
  it.each(["outside", "upward"] as const)("进入已有专属流程且保留所选项目与历史来源：%s", async relationship => {
    push.mockClear();
    const view = await render(relationship, "takeover");
    view.buttons.find(button => button.text === "办理所选类别历史接管")!.click();
    expect(push).toHaveBeenCalledWith({ path: "/合同工作台", query: { projectId: "project-selected", ledgerSection: "contracts", contractHandling: relationship, entryMode: "takeover" } });
    expect(view.html).toContain("不能换一个类别再登记一次");
  });
  it("未选项目不能办理或跳入错误项目；表内继续原工作台", async () => {
    push.mockClear();
    const view = await render("outside", "new", "");
    expect(view.buttons.every(button => button.disabled)).toBe(true);
    view.buttons[0]!.click(); expect(push).not.toHaveBeenCalled();
    expect((await render("inside", "new")).buttons.map(button => button.text)).toEqual(["查看项目施工企业与参与公司"]);
  });
  it("合同岗位不展示无权访问的维护按钮，仍说明维护责任人", async () => {
    auth.user.globalRoleKeys = ["contract_staff"];
    try {
      const view = await render("inside", "new");
      expect(view.buttons).toHaveLength(0);
      expect(view.html).toContain("董事长或公司级综合部主管办理");
    } finally { auth.user.globalRoleKeys = ["chairman"]; }
  });
  it("维护链接直接定位所选项目设置", async () => {
    push.mockClear();
    const view = await render("inside", "new");
    view.buttons[0]!.click();
    expect(push).toHaveBeenCalledWith({ path: "/项目经营", query: { projectId: "project-selected", tab: "settings" } });
  });
});
