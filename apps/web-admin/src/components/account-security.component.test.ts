/* eslint-disable vue/one-component-per-file */
import * as Vue from "vue";
import { createRenderer, defineComponent, h, nextTick } from "vue";
import { parse, compileScript } from "vue/compiler-sfc";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetEmployeePassword, generateRecoveryCode, fetchAccountOptions, sendAccountSms, sendPhoneChangeSms, sendAdminPhoneChangeSms, changeUserPhone } from "../api/employee-onboarding.api";
import { fetchOrganizationManagementCapabilities } from "../api/organization.api";
import * as errors from "../api/error-message";
import { useAuthStore } from "../auth/auth.store";

const accountApi = { resetEmployeePassword, generateRecoveryCode, fetchAccountOptions, sendAccountSms, sendPhoneChangeSms, sendAdminPhoneChangeSms, changeUserPhone };
const organizationApi = { fetchOrganizationManagementCapabilities };

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
const credential = compile("./AccountCredentialDialog.vue", {
  "../api/employee-onboarding.api": accountApi, "../api/organization.api": organizationApi, "../api/error-message": errors
});
const cleanup: Array<() => void> = [];
function mount(component: Vue.Component, props: Record<string, unknown> = {}) {
  const root = node("root"); const app = renderer.createApp(component, props);
  for (const [name, tag] of [["TDialog", "dialog"], ["TInput", "input"], ["TCheckbox", "checkbox"], ["TButton", "button"], ["TAlert", "alert"]]) {
    app.component(name, defineComponent({ inheritAttrs: false, setup: (_props, { attrs, slots }) => () => h(tag, attrs, slots.default?.()) }));
  }
  app.mount(root); cleanup.push(() => app.unmount()); return root;
}
function all(root: Node): Node[] { return [root, ...root.children.flatMap(all)]; }
function field(root: Node, placeholder: string) { return all(root).find(value => value.tag === "input" && value.props.placeholder === placeholder)!; }
function input(target: Node, value: unknown) { (target.props["onUpdate:modelValue"] as (value: unknown) => void)(value); }
async function submit(root: Node) { (all(root).find(value => value.tag === "form")!.props.onSubmit as (event: object) => void)({ preventDefault() {} }); await flush(); }
async function flush() { await nextTick(); await new Promise(resolve => setTimeout(resolve, 0)); await nextTick(); }
function text(root: Node): string { return all(root).map(value => value.text + String(value.props.message ?? "")).join(""); }

beforeEach(() => {
  setActivePinia(createPinia());
  useAuthStore().$patch({ accessToken: "synthetic-access", refreshToken: "synthetic-refresh", user: {
    id: "manager", name: "合成管理员", phone: "13800000002", roleKeys: ["chairman"], globalRoleKeys: ["chairman"], mustChangePassword: false
  } });
});
afterEach(() => { cleanup.splice(0).forEach(fn => fn()); vi.unstubAllGlobals(); });

describe("账号设置公开交互", () => {
  it("管理员重置成功显示强改提示，不展示或要求复制初始密码", async () => {
    vi.stubGlobal("fetch", async (url: string) => new Response(JSON.stringify(url.includes("management-capabilities") ? { canManageUsers: true } : { ok: true, mustChangePassword: true }), { status: 200 }));
    const root = mount(credential, { id: "employee", kind: "users", name: "合成员工" });
    input(all(root).find(value => value.tag === "checkbox")!, true);
    input(field(root, "请输入本人当前登录密码"), "synthetic-current-password");
    await submit(root);
    expect(text(root)).toContain("已恢复受控初始密码");
    expect(text(root)).toContain("首次登录必须修改");
    expect(text(root)).not.toContain("临时密码仅显示这一次");
    expect(all(root).filter(value => value.tag === "input")).toHaveLength(0);
  });
  it("有人员管理权限的管理员能从当前人员操作打开更换手机号", async () => {
    const actions = compile("../pages/organization/components/OrganizationPersonActions.vue", {});
    let requested = false;
    const root = mount(actions, { user: { id: "employee", status: "active" }, canManage: true, canManageRoles: false,
      canManagePersonnel: false, onPhone: () => { requested = true; } });
    const button = all(root).find(value => value.tag === "button" && text(value).includes("更换手机号"));
    expect(button).toBeDefined();
    (button!.props.onClick as () => void)(); await flush();
    expect(requested).toBe(true);
  });

  it("管理员获取新号验证码使用当前人员专属接口，短信关闭时明确拒绝", async () => {
    const requests: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => { requests.push(url); return new Response(JSON.stringify(url.includes("/options") ? { smsEnabled: true } : { ok: true, retryAfterSeconds: 60 }), { status: 200 }); });
    const smsField = compile("./SmsCodeField.vue", { "../api/employee-onboarding.api": accountApi, "../api/error-message": errors });
    const root = mount(smsField, { phone: "13900000001", purpose: "change_phone", modelValue: "", targetUserId: "employee" });
    (all(root).find(value => value.tag === "button")!.props.onClick as () => void)(); await flush();
    expect(requests).toContain("/api/account-security/users/employee/phone-change-sms");
    expect(requests).not.toContain("/api/account-security/phone-change-sms");
  });

  it("短信不可用时字段旁显示原因，不调用发送接口", async () => {
    const requests: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => { requests.push(url); return new Response(JSON.stringify({ smsEnabled: false }), { status: 200 }); });
    const smsField = compile("./SmsCodeField.vue", { "../api/employee-onboarding.api": accountApi, "../api/error-message": errors });
    const root = mount(smsField, { phone: "13900000001", purpose: "change_phone", modelValue: "" });
    (all(root).find(value => value.tag === "button")!.props.onClick as () => void)(); await flush();
    expect(text(root)).toContain("短信验证尚未开通");
    expect(requests).toEqual(["/api/account-security/options"]);
  });

  it("代办更换界面验证新号后提交本人确认，成功保留身份说明", async () => {
    const requests: Array<{ url: string; body?: Record<string, string> }> = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      requests.push({ url, body: init.body ? JSON.parse(String(init.body)) : undefined });
      return new Response(JSON.stringify(url.includes("management-capabilities") ? { canManageUsers: true, manageableUserIds: ["employee"] } : { ok: true }), { status: 200 });
    });
    const smsField = compile("./SmsCodeField.vue", { "../api/employee-onboarding.api": accountApi, "../api/error-message": errors });
    const dialog = compile("./AccountPhoneChangeDialog.vue", { "./SmsCodeField.vue": { default: smsField },
      "../api/employee-onboarding.api": accountApi, "../api/organization.api": organizationApi, "../api/error-message": errors });
    const root = mount(dialog, { id: "employee", name: "合成员工" });
    input(field(root, "请输入新的11位手机号"), "13900000001");
    input(field(root, "请输入6位验证码"), "000000");
    input(field(root, "请输入管理员本人当前密码"), "synthetic-current-password");
    await submit(root);
    expect(requests.find(value => value.url.endsWith("/users/employee/change-phone"))?.body).toEqual({ phone: "13900000001", code: "000000", confirmationPassword: "synthetic-current-password" });
    expect(text(root)).toContain("旧单和签字归属保持不变");
    expect(all(root).filter(value => value.tag === "input")).toHaveLength(0);
  });

});
