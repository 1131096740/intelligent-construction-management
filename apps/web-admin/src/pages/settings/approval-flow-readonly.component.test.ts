/* eslint-disable vue/one-component-per-file */
import * as Vue from "vue";
import {createRenderer, defineComponent, h, nextTick} from "vue";
import {parse, compileScript} from "vue/compiler-sfc";
import {readFileSync} from "node:fs";
import ts from "typescript";
import {createPinia, setActivePinia} from "pinia";
import {afterEach, expect, it, vi} from "vitest";
import { fetchApprovalRuleAssignments } from "../../api/core-flow-read.api";
const api = { fetchApprovalRuleAssignments };
import {useAuthStore} from "../../auth/auth.store";
import * as config from "./approval-flow-readonly.config";
import * as errorMessage from "../../api/error-message";
type Node = { tag: string; text: string; props: Record<string, unknown>; children: Node[]; parent: Node | null };
const node = (tag: string, text = ""): Node => ({ tag, text, props: {}, children: [], parent: null });
const renderer = createRenderer<Node, Node>({
  createElement: node, createText: text => node("text", text), createComment: text => node("comment", text),
  insert: (child, parent) => { child.parent = parent; parent.children.push(child); },
  remove: child => { if (child.parent) child.parent.children = child.parent.children.filter(value => value !== child); },
  setText: (target, text) => { target.text = text; }, setElementText: (target, text) => { target.text = text; },
  parentNode: target => target.parent, nextSibling: () => null,
  patchProp: (target, key, _old, value) => { target.props[key] = value; }
});
function compile(file: string, dependencies: Record<string, unknown>): Vue.Component {
  // Real client template/lifecycle, same public rendering seam as the PDF tests.
  const { descriptor } = parse(readFileSync(new URL(file, import.meta.url), "utf8"));
  const client = compileScript(descriptor, { id: file, inlineTemplate: true });
  const compiled = ts.transpileModule(client.content, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const exports = {} as { default: Vue.Component };
  new Function("require", "exports", compiled)((name: string) => {
    if (name === "vue") return Vue;
    if (Object.hasOwn(dependencies, name)) return dependencies[name];
    throw new Error(`Unexpected component dependency: ${name}`);
  }, exports);
  return exports.default;
}

const page=compile("./ApprovalFlowReadonlyPanel.vue",{"./approval-flow-readonly.config":config,"../../api/core-flow-read.api":api,"../../api/error-message":errorMessage});
let dispose=()=>{};
afterEach(()=>{dispose();vi.unstubAllGlobals();});
it("固定规则实际渲染当前人员与缺岗，并明确零采并联和未迁入机制",async()=>{
 setActivePinia(createPinia());useAuthStore().$patch({accessToken:"synthetic-access"});
 vi.stubGlobal("fetch",async()=>new Response(JSON.stringify({projects:[{id:"p1",name:"一号项目"}],projectId:"p1",roles:[{roleKey:"project_manager",people:[{id:"manager",name:"当前经理甲"}],missing:false},{roleKey:"material_director",people:[],missing:true}]}),{status:200}));
 const root=node("root");const app=renderer.createApp(page);
 for(const [name,tag]of [["TCard","card"],["TSelect","select"],["TAlert","alert"]])app.component(name,defineComponent({inheritAttrs:false,setup:(_p,{attrs,slots})=>()=>h(tag,attrs,slots.default?.())}));
 app.mount(root);dispose=()=>app.unmount();await nextTick();await new Promise(resolve=>setTimeout(resolve,0));await nextTick();
 const all=(value:Node):Node[]=>[value,...value.children.flatMap(all)];const text=all(root).map(value=>value.text+String(value.props.message??"")).join("");
 expect(text).toContain("当前经理甲");expect(text).toContain("待配置");expect(text).toContain("同时待办");expect(text).toContain("现行冻结流程");expect(text).not.toContain("物资部主管、项目经理依次审批");
 expect(all(root).some(value=>value.tag==="button"&&value.text.includes("新增节点"))).toBe(false);
});
