/* eslint-disable vue/one-component-per-file */
import * as Vue from "vue";
import {createRenderer, defineComponent, h, nextTick} from "vue";
import {parse, compileScript} from "vue/compiler-sfc";
import {readFileSync} from "node:fs";
import ts from "typescript";
import {createPinia, setActivePinia} from "pinia";
import {afterEach, expect, it, vi} from "vitest";
import { fetchProjectRoster, fetchProjectCreateCapability, fetchProjectUpdateCapability, validateProjectCreation } from "../../../api/core-flow-read.api";
const api = { fetchProjectRoster, fetchProjectCreateCapability, fetchProjectUpdateCapability, validateProjectCreation };
import {useAuthStore} from "../../../auth/auth.store";
import * as errors from "../../../api/error-message";
import { fetchBusinessEntryDefinition, validateBusinessEntryDraft } from "../../../api/business-entry.api";
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

let dispose=()=>{};
afterEach(()=>{dispose();vi.unstubAllGlobals();});
it("项目人员实际显示当前经理与物资员，只跳统一人员岗位入口且不提供调入调出",async()=>{
 setActivePinia(createPinia());useAuthStore().$patch({accessToken:"synthetic-access"});
 vi.stubGlobal("fetch",async()=>new Response(JSON.stringify([{projectId:"p1",userId:"u1",name:"当前经理甲",projectPositionNames:["项目经理"]},{projectId:"p1",userId:"u2",name:"物资员乙",projectPositionNames:["物资员"]},{projectId:"p2",userId:"u3",name:"另一项目人员",projectPositionNames:["合同员"]}]),{status:200}));
 const page=compile("./ProjectPersonnelPanel.vue",{"../../../api/core-flow-read.api":api,"../../../api/error-message":errors});
 const root=node("root");const app=renderer.createApp(page,{projectId:"p1"});
 for(const [name,tag]of [["TCard","card"],["TAlert","alert"]])app.component(name,defineComponent({inheritAttrs:false,setup:(_p,{attrs,slots})=>()=>h(tag,attrs,slots.default?.())}));
 app.component("RouterLink",defineComponent({props:["to"],setup:(props,{slots})=>()=>h("a",{href:props.to},slots.default?.())}));
 app.mount(root);dispose=()=>app.unmount();await nextTick();await new Promise(resolve=>setTimeout(resolve,0));await nextTick();
 const all=(value:Node):Node[]=>[value,...value.children.flatMap(all)];const text=all(root).map(value=>value.text+String(value.props.message??"")).join("");
 expect(text).toContain("当前经理甲");expect(text).toContain("物资员乙");expect(text).not.toContain("另一项目人员");expect(text).not.toContain("调入人员");expect(text).not.toContain("调出项目");
 expect(all(root).find(value=>value.tag==="a")?.props.href).toEqual({path:"/员工管理",query:{view:"projects",projectId:"p1"}});
});

it("同名预检提示实际显示，仍可保存同名项目；现档选择控件可搜索且保留版本ID", async () => {
 setActivePinia(createPinia());useAuthStore().$patch({accessToken:"synthetic-access"});
 const adapters = await import("../../../lib/business-entry-adapters");
 const help = compile("../../../components/BusinessHelp.vue",{});
 const control = compile("../../../components/BusinessEntryFieldControl.vue",{"./BusinessHelp.vue":{default:help}});
 const form = compile("../../../components/BusinessEntryForm.vue",{"./BusinessEntryFieldControl.vue":{default:control},"../lib/business-entry-adapters":adapters});
 const page = compile("./ProjectCreateForm.vue",{"../../../components/BusinessEntryForm.vue":{default:form},"../../../api/core-flow-read.api":api,"../../../api/error-message":errors});
 const fields=[{key:"code",label:"项目编号"},{key:"name",label:"项目名称"}].map(field=>({...field,type:"text",required:true,display:{formHint:field.label},permissions:{view:["general_manager"],edit:["general_manager"]}}));
 vi.stubGlobal("fetch",async(input: string|URL|Request)=>new Response(JSON.stringify(String(input).endsWith("create-capability")?{availableActions:["create_project"],definition:{key:"project_create",name:"新增项目",entityType:"project",version:1,fields,rules:[]}}:{valid:true,values:{code:"P02",name:"同名项目"},errors:[],warnings:["已有同名项目，请核对项目编号；确认后仍可继续保存"]}),{status:200}));
 const root=node("root");const saved:unknown[]=[];const app=renderer.createApp(page,{saving:false,onSave:(value:unknown)=>saved.push(value)});
 for(const[name,tag]of[["TInput","input"],["TButton","button"]])app.component(name,defineComponent({inheritAttrs:false,setup:(_p,{attrs,slots})=>()=>h(tag,attrs,slots.default?.())}));
 app.mount(root);dispose=()=>app.unmount();const flush=async()=>{await nextTick();await new Promise(resolve=>setTimeout(resolve,0));await nextTick();};await flush();
 const all=(value:Node):Node[]=>[value,...value.children.flatMap(all)];
 for(const [key,value]of[["code","P02"],["name","同名项目"]]){(all(root).find(n=>n.props["data-field"]===key)?.props["onUpdate:modelValue"] as (v:string)=>void)(value);await nextTick();}
 await(all(root).find(n=>n.tag==="button")?.props.onClick as ()=>Promise<void>)();await flush();
 expect(all(root).map(n=>n.text).join("")).toContain("已有同名项目");expect(saved).toEqual([]);
 await(all(root).find(n=>n.tag==="button")?.props.onClick as ()=>Promise<void>)();await flush();
 expect(saved).toEqual([{code:"P02",name:"同名项目",definitionVersion:1}]);
 app.unmount();dispose=()=>{};
 const selectorRoot=node("root");const selectorApp=renderer.createApp(control,{field:{key:"businessPartyVersionId",label:"施工企业",type:"counterparty",display:{formHint:"搜索现有单位"}},modelValue:"party-version-1",options:[{label:"施工企业甲",value:"party-version-1"}]});
 selectorApp.component("TSelect",defineComponent({inheritAttrs:false,setup:(_p,{attrs})=>()=>h("select",attrs)}));
 selectorApp.mount(selectorRoot);dispose=()=>selectorApp.unmount();
 expect(all(selectorRoot).find(n=>n.tag==="select")?.props).toMatchObject({filterable:true,"model-value":"party-version-1",options:[{label:"施工企业甲",value:"party-version-1"}]});
});

it("项目改名先显示同名核对，继续保存前重读当前修改能力，失权时不提交",async()=>{
 setActivePinia(createPinia());useAuthStore().$patch({accessToken:"synthetic-access"});
 const adapters=await import("../../../lib/business-entry-adapters");
 const help=compile("../../../components/BusinessHelp.vue",{});
 const control=compile("../../../components/BusinessEntryFieldControl.vue",{"./BusinessHelp.vue":{default:help}});
 const form=compile("../../../components/BusinessEntryForm.vue",{"./BusinessEntryFieldControl.vue":{default:control},"../lib/business-entry-adapters":adapters});
 const page=compile("./ProjectRenameForm.vue",{"../../../components/BusinessEntryForm.vue":{default:form},"../../../api/core-flow-read.api":api,"../../../api/business-entry.api":{fetchBusinessEntryDefinition,validateBusinessEntryDraft},"../../../api/error-message":errors});
 let canUpdate=true;
 const definition={key:"project_rename",name:"项目名称",entityType:"project",version:1,fields:[{key:"name",label:"项目名称",type:"text",required:true,display:{formHint:"项目名称"},permissions:{view:["general_manager"],edit:["general_manager"]}}],rules:[]};
 vi.stubGlobal("fetch",async(input:string|URL|Request,options?:RequestInit)=>{
  const url=String(input);let value:unknown;
  if(url.includes("update-capability"))value={projectId:"p1",availableActions:canUpdate?["update_project"]:[]};
  else if(options?.method==="POST")value={valid:true,values:{name:"同名项目"},errors:[],warnings:url.includes("create-validation")?["已有同名项目，请核对项目编号；确认后仍可继续保存"]:[]};
  else value=definition;
  return new Response(JSON.stringify(value),{status:200});
 });
 const root=node("root");const saved:unknown[]=[];const app=renderer.createApp(page,{projectId:"p1",code:"P02",name:"旧项目",saving:false,onSave:(name:unknown)=>saved.push(name)});
 for(const[name,tag]of[["TInput","input"],["TButton","button"],["TSelect","select"],["TTextarea","textarea"],["TDatePicker","date"],["TPopup","popup"]])app.component(name,defineComponent({inheritAttrs:false,setup:(_p,{attrs,slots})=>()=>h(tag,attrs,slots.default?.())}));
 app.mount(root);dispose=()=>app.unmount();const flush=async()=>{await nextTick();await new Promise(resolve=>setTimeout(resolve,0));await nextTick();};await flush();
 const all=(value:Node):Node[]=>[value,...value.children.flatMap(all)];
 (all(root).find(n=>n.props["data-field"]==="name")?.props["onUpdate:modelValue"] as(v:string)=>void)("同名项目");await nextTick();
 const click=async()=>{await(all(root).find(n=>n.tag==="button")?.props.onClick as()=>Promise<void>)();await flush();};
 await click();expect(saved).toEqual([]);expect(all(root).map(n=>n.text).join("")).toContain("已有同名项目");
 canUpdate=false;await click();expect(saved).toEqual([]);expect(all(root).map(n=>n.text).join("")).toContain("不能修改项目名称");
 canUpdate=true;await click();expect(saved).toEqual(["同名项目"]);
});
