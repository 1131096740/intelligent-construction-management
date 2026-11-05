/* eslint-disable vue/one-component-per-file */
import * as Vue from "vue";
import {createRenderer, defineComponent, h, nextTick} from "vue";
import {parse, compileScript} from "vue/compiler-sfc";
import {readFileSync} from "node:fs";
import ts from "typescript";
import {createPinia, setActivePinia} from "pinia";
import {afterEach, beforeEach, expect, it, vi} from "vitest";
import { listApprovalDelegations, fetchApprovalDelegationDutyOptions, fetchApprovalDelegationDutyCapability, fetchApprovalDelegationRevokeCapability, fetchApprovalDelegationUserOptions, createApprovalDelegation, revokeApprovalDelegation } from "../../api/core-flow-read.api";
const api = { listApprovalDelegations, fetchApprovalDelegationDutyOptions, fetchApprovalDelegationDutyCapability, fetchApprovalDelegationRevokeCapability, fetchApprovalDelegationUserOptions, createApprovalDelegation, revokeApprovalDelegation };
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
 for(const [name,tag] of [["TDialog","dialog"],["TInput","input"],["TDatePicker","date"],["TSelect","select"],["TButton","button"],["TAlert","alert"],["TCard","card"],["TTag","tag"]]) app.component(name,defineComponent({inheritAttrs:false,setup:(_p,{attrs,slots})=>()=>h(tag,attrs,[...(slots.default?.() ?? []),...(slots.footer?.() ?? [])])}));
 app.component("TTable",defineComponent({inheritAttrs:false,setup:(_p,{attrs,slots})=>()=>h("table",{},(attrs.columns as Array<{colKey:string}>).map(column=>h("column",{columnKey:column.colKey},(attrs.data as Array<unknown>).flatMap(row=>slots[column.colKey]?.({row})??[]))))}));
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
  if(url.includes("capability"))value={canDelegate:true,canRevoke:true,resourceId:"round-1:1",actionKey:"spot_procurement.approve",resourceType:"spot_procurement_approval_duty"};
  else if(url.includes("duty-options"))value=[{value:"round-1:1",label:"一号项目 · LXCG-001 · 项目经理",actionKey:"spot_procurement.approve",resourceType:"spot_procurement_approval_duty"}];
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

it("委托表实际按列渲染时仅有一个撤销入口，点击只提交一次撤销",async()=>{
 let revoked=false;const deletes:string[]=[];
 vi.stubGlobal("fetch",async(url:string,init?:RequestInit)=>{
  if(init?.method==="DELETE"){deletes.push(url);revoked=true;return new Response("{}",{status:200});}
  const value=url.includes("capability")?{canDelegate:true,canRevoke:true}:url.includes("duty-options")||url.includes("user-options")?[]:[{id:"delegation-1",fromUserId:"manager",toUserId:"delegate",fromUserName:"项目经理",toUserName:"临时接收人",enabled:!revoked,startsAt:"2026-11-01T00:00:00Z",endsAt:"2099-01-01T00:00:00Z",resourceType:"spot_procurement_approval_duty",scopeLabel:"项目一 · LXCG-1 · 项目经理"}];
  return new Response(JSON.stringify(value),{status:200});
 });
 const root=mount();await flush();
 expect(all(root).filter(n=>n.tag==="column"&&n.props.columnKey==="actions")).toHaveLength(1);
 const buttons=all(root).filter(n=>n.tag==="button"&&text(n).includes("撤销委托"));expect(buttons).toHaveLength(1);
 (buttons[0]!.props.onClick as()=>void)();await flush();
 expect(deletes).toHaveLength(1);
 expect(all(root).filter(n=>n.tag==="button"&&text(n).includes("撤销委托"))).toHaveLength(0);
});
it("服务端已撤回撤销能力时保留记录并禁止DELETE",async()=>{
 const deletes:string[]=[];
 vi.stubGlobal("fetch",async(url:string,init?:RequestInit)=>{
  if(init?.method==="DELETE")deletes.push(url);
  const value=url.includes("capability")?{canRevoke:false}:url.includes("duty-options")||url.includes("user-options")?[]:[{id:"delegation-1",fromUserId:"manager",toUserId:"delegate",enabled:true,startsAt:"2026-11-01T00:00:00Z",endsAt:"2099-01-01T00:00:00Z"}];
  return new Response(JSON.stringify(value),{status:200});
 });
 const root=mount();await flush();const button=all(root).find(n=>n.tag==="button"&&text(n).includes("撤销委托"))!;
 (button.props.onClick as()=>void)();await flush();expect(deletes).toEqual([]);expect(text(root)).toContain("当前无权撤销该委托");
});

it("从实际资金职责选项提交精确资金委托而不误提交为零星申请",async()=>{
 const posted: unknown[]=[];
 vi.stubGlobal("fetch",async(url:string,init?:RequestInit)=>{
  let value:unknown=[];
  if(url.includes("capability"))value={canDelegate:true,canRevoke:true,resourceId:"fund-round-1:0",actionKey:"fund_account.balance.review",resourceType:"fund_account_balance_review_duty"};
  else if(url.includes("duty-options"))value=[{value:"fund-round-1:0",label:"甲公司 · 余额核对更正 · 财务主管复核",actionKey:"fund_account.balance.review",resourceType:"fund_account_balance_review_duty"}];
  else if(url.includes("user-options"))value=[{id:"delegate",name:"临时接收人"}];
  else if(init?.method==="POST"){posted.push(JSON.parse(String(init.body)));value={id:"delegation-1"};}
  return new Response(JSON.stringify(value),{status:200});
 });
 const root=mount();await flush();
 const open=all(root).find(n=>n.tag==="button"&&text(n).includes("新建临时委托"));expect(open).toBeDefined();
 (open!.props.onClick as ()=>void)();await flush();
 const select=(placeholder:string,value:string)=>{const control=all(root).find(n=>n.tag==="select"&&n.props.placeholder===placeholder)!;(control.props["onUpdate:modelValue"] as (v:string)=>void)(value); (control.props.onChange as ((v:string)=>void)|undefined)?.(value);};
 select("选择待审批职责","fund-round-1:0");await flush();expect(all(root).find(n=>n.tag==="select"&&n.props.placeholder==="选择受托人")!.props.options).toEqual([{value:"delegate",label:"临时接收人"}]);select("选择受托人","delegate");
 for(const [i,date]of all(root).filter(n=>n.tag==="date").entries())(date.props["onUpdate:modelValue"] as (v:string)=>void)(i?"2099-01-02 10:00":"2099-01-01 10:00");
 await nextTick();(all(root).find(n=>n.tag==="button"&&text(n).includes("确认委托"))!.props.onClick as ()=>void)();await flush();
 expect(posted).toEqual([{toUserId:"delegate",startsAt:"2099-01-01T02:00:00.000Z",endsAt:"2099-01-02T02:00:00.000Z",actionKey:"fund_account.balance.review",resourceType:"fund_account_balance_review_duty",resourceId:"fund-round-1:0"}]);
 expect(text(root)).toContain("委托已保存");
});

it.each(["missing", "unknown", "changed"])("资金委托对%s职责选项失败关闭，等待权限回执时不偷换目标", async kind => {
 const posted:unknown[]=[];let resolveCapability:((value:Response)=>void)|undefined;
 vi.stubGlobal("fetch",async(url:string,init?:RequestInit)=>{
  if(init?.method==="POST"){posted.push(JSON.parse(String(init.body)));return new Response("{}",{status:200});}
  if(url.includes("duty-options"))return new Response(JSON.stringify(kind==="missing"?[]:[{value:"fund-round-1:0",label:"甲公司余额核对",actionKey:kind==="unknown"?"unknown.action":"fund_account.balance.review",resourceType:"fund_account_balance_review_duty"}]),{status:200});
  if(url.includes("user-options"))return new Response(JSON.stringify([{id:"delegate",name:"临时接收人"},{id:"another",name:"另一同事"}]),{status:200});
  if(url.includes("duty-capability")&&kind==="changed")return new Promise<Response>(resolve=>{resolveCapability=resolve;});
  return new Response("[]",{status:200});
 });
 const root=mount();await flush();(all(root).find(n=>n.tag==="button"&&text(n).includes("新建临时委托"))!.props.onClick as()=>void)();await flush();
 const select=(placeholder:string,value:string)=>{const control=all(root).find(n=>n.tag==="select"&&n.props.placeholder===placeholder)!;(control.props["onUpdate:modelValue"] as(v:string)=>void)(value);(control.props.onChange as((v:string)=>void)|undefined)?.(value);};
 select("选择待审批职责","fund-round-1:0");await flush();select("选择受托人","delegate");
 for(const [i,date]of all(root).filter(n=>n.tag==="date").entries())(date.props["onUpdate:modelValue"] as(v:string)=>void)(i?"2099-01-02 10:00":"2099-01-01 10:00");
 await nextTick();(all(root).find(n=>n.tag==="button"&&text(n).includes("确认委托"))!.props.onClick as()=>void)();await flush();
 if(kind==="changed"){expect(resolveCapability).toBeDefined();select("选择受托人","another");resolveCapability!(new Response(JSON.stringify({canDelegate:true,resourceId:"fund-round-1:0",actionKey:"fund_account.balance.review",resourceType:"fund_account_balance_review_duty"}),{status:200}));await flush();}
 expect(posted).toEqual([]);expect(text(root)).toMatch(/重选|变化/);
});
