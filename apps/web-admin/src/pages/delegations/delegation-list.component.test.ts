/* eslint-disable vue/one-component-per-file */
import * as Vue from "vue";
import {createRenderer, defineComponent, h, nextTick} from "vue";
import {parse, compileScript} from "vue/compiler-sfc";
import {readFileSync} from "node:fs";
import ts from "typescript";
import {createPinia, setActivePinia} from "pinia";
import {afterEach, beforeEach, expect, it, vi} from "vitest";
import * as api from "../../api/core-flow-read.api";
import {useAuthStore} from "../../auth/auth.store";
import * as config from "./delegation-list.config";
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

const page = compile("./DelegationListPage.vue", {"../../api/core-flow-read.api": api, "../../auth/auth.store": {useAuthStore}, "./delegation-list.config": config});
const cleanup: Array<() => void> = [];
function mount() {
 const root=node("root");const app=renderer.createApp(page);
 for(const [name,tag] of [["TDialog","dialog"],["TInput","input"],["TDatePicker","date"],["TSelect","select"],["TButton","button"],["TAlert","alert"],["TCard","card"],["TTable","table"],["TTag","tag"]]) app.component(name,defineComponent({inheritAttrs:false,setup:(_p,{attrs,slots})=>()=>h(tag,attrs,[...(slots.default?.() ?? []),...(slots.footer?.() ?? [])])}));
 app.mount(root);cleanup.push(()=>app.unmount());return root;
}
function all(root:Node):Node[]{return [root,...root.children.flatMap(all)];}
function text(root:Node):string{return all(root).map(value=>value.text+String(value.props.message??"")).join("");}
async function flush(){await nextTick();await new Promise(resolve=>setTimeout(resolve,0));await nextTick();}
beforeEach(()=>{setActivePinia(createPinia());useAuthStore().$patch({accessToken:"synthetic-access",refreshToken:"synthetic-refresh",user:{id:"manager",name:"项目经理",phone:"13800000001",roleKeys:["project_manager"],globalRoleKeys:[],mustChangePassword:false}});});
afterEach(()=>{cleanup.splice(0).forEach(fn=>fn());vi.unstubAllGlobals();});
it("从委托台账选择具体职责、受托人及期限后只提交该范围",async()=>{
 const posted: unknown[]=[];
 vi.stubGlobal("fetch",async(url:string,init?:RequestInit)=>{
  let value:unknown=[];
  if(url.includes("duty-options"))value=[{value:"round-1:1",label:"一号项目 · LXCG-001 · 项目经理"}];
  else if(url.includes("user-options"))value=[{id:"delegate",name:"临时接收人"}];
  else if(init?.method==="POST"){posted.push(JSON.parse(String(init.body)));value={id:"delegation-1"};}
  return new Response(JSON.stringify(value),{status:200});
 });
 const root=mount();await flush();
 const open=all(root).find(n=>n.tag==="button"&&text(n).includes("新建临时委托"));expect(open).toBeDefined();
 (open!.props.onClick as ()=>void)();await flush();
 const select=(placeholder:string,value:string)=>{const control=all(root).find(n=>n.tag==="select"&&n.props.placeholder===placeholder)!;(control.props["onUpdate:modelValue"] as (v:string)=>void)(value); (control.props.onChange as ((v:string)=>void)|undefined)?.(value);};
 select("选择待审批职责","round-1:1");await flush();expect(all(root).find(n=>n.tag==="select"&&n.props.placeholder==="选择受托人")!.props.options).toEqual([{value:"delegate",label:"临时接收人"}]);select("选择受托人","delegate");
 for(const [i,date]of all(root).filter(n=>n.tag==="date").entries())(date.props["onUpdate:modelValue"] as (v:string)=>void)(i?"2099-01-02 10:00":"2099-01-01 10:00");
 await nextTick();(all(root).find(n=>n.tag==="button"&&text(n).includes("确认委托"))!.props.onClick as ()=>void)();await flush();
 expect(posted).toEqual([{toUserId:"delegate",startsAt:"2099-01-01T02:00:00.000Z",endsAt:"2099-01-02T02:00:00.000Z",actionKey:"spot_procurement.approve",resourceType:"spot_procurement_approval_duty",resourceId:"round-1:1"}]);
 expect(text(root)).toContain("委托已保存");
});
