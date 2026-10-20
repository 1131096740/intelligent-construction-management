/* eslint-disable vue/one-component-per-file */
import { createRenderer, defineComponent, h, nextTick, ref } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as Vue from "vue";
import { parse, compileScript } from "vue/compiler-sfc";
import ts from "typescript";
import { readFileSync } from "node:fs";

const pdf = { getDocument: vi.fn(), GlobalWorkerOptions: {} };
// Vitest's default SFC import is SSR-compiled; compile the real client setup/render for lifecycle events.
const { descriptor } = parse(readFileSync(new URL("./LayoutPdfPreview.vue", import.meta.url), "utf8"));
const client = compileScript(descriptor, { id: "layout-preview-lifecycle", inlineTemplate: true });
const compiled = ts.transpileModule(client.content.replaceAll("import.meta.url", JSON.stringify(import.meta.url)), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
}).outputText;
const exports = {} as { default: Vue.Component };
new Function("require", "exports", compiled)((name: string) => {
  if (name === "vue") return Vue;
  if (name === "pdfjs-dist") return pdf;
  throw new Error(`Unexpected preview dependency: ${name}`);
}, exports);
const LayoutPdfPreview = exports.default;

type Node = { tag: string; text: string; props: Record<string, unknown>; children: Node[]; parent: Node | null;
  clientWidth: number; style: Record<string, unknown>; width: number; height: number; getContext: () => object };
const node = (tag: string, text = ""): Node => ({ tag, text, props: {}, children: [], parent: null,
  clientWidth: 600, style: {}, width: 0, height: 0, getContext: () => ({}) });
const renderer = createRenderer<Node, Node>({
  createElement: node, createText: (text) => node("text", text), createComment: (text) => node("comment", text),
  insert: (child, parent) => { child.parent = parent; parent.children.push(child); },
  remove: (child) => { if (child.parent) child.parent.children = child.parent.children.filter((value) => value !== child); },
  setText: (target, text) => { target.text = text; }, setElementText: (target, text) => { target.text = text; },
  parentNode: (target) => target.parent, nextSibling: () => null,
  patchProp: (target, key, _previous, value) => { target.props[key] = value; }
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function documentFixture(delayText: boolean) {
  const text = deferred<{ items: Array<{ str: string }> }>();
  const rendering = deferred<void>();
  const task = { promise: rendering.promise, cancel: vi.fn(() => rendering.reject(new Error("RenderingCancelledException"))) };
  const page = { getViewport: () => ({ width: 600, height: 800 }),
    render: vi.fn(() => task), getTextContent: () => text.promise };
  const document = { numPages: 2, getPage: vi.fn().mockResolvedValue(page) };
  const loading = { promise: Promise.resolve(document), destroy: vi.fn().mockResolvedValue(undefined) };
  if (!delayText) { text.resolve({ items: [{ str: "新文件样张正文" }] }); rendering.resolve(); }
  return { text, task, page, loading };
}
const cleanup: Array<() => void> = [];
afterEach(() => { cleanup.splice(0).forEach((fn) => fn()); vi.unstubAllGlobals(); vi.resetAllMocks(); });
async function flush() { await nextTick(); await Promise.resolve(); await new Promise((resolve) => setTimeout(resolve, 0)); }

describe("样张预览关闭与文件切换", () => {
  it.each(["关闭", "切换"])("读取文字期间%s，取消渲染不得留下未处理拒绝", async (action) => {
    vi.stubGlobal("window", { devicePixelRatio: 1 });
    const first = documentFixture(true), second = documentFixture(false);
    pdf.getDocument.mockReturnValueOnce(first.loading as never).mockReturnValueOnce(second.loading as never);
    const url = ref("blob:first");
    const root = node("root");
    const app = renderer.createApp(defineComponent({ setup: () => () => h(LayoutPdfPreview, { url: url.value }) }));
    app.component("TButton", defineComponent({ setup: (_props, { slots }) => () => h("button", slots.default?.()) }));
    app.component("TAlert", defineComponent({ setup: () => () => h("aside") }));
    app.mount(root);
    let mounted = true;
    cleanup.push(() => { if (mounted) app.unmount(); });
    await vi.waitFor(() => expect(first.page.render).toHaveBeenCalledOnce());
    if (action === "关闭") { app.unmount(); mounted = false; }
    else url.value = "blob:second";
    await flush();
    expect(first.task.cancel).toHaveBeenCalled();
    expect(first.loading.destroy).toHaveBeenCalledOnce();
    first.text.resolve({ items: [{ str: "旧文件延迟文字" }] });
    await flush();
    if (action === "切换") {
      expect(second.page.render).toHaveBeenCalledOnce();
      const renderedText = (value: Node): string => value.text + value.children.map(renderedText).join("");
      expect(renderedText(root)).toContain("新文件样张正文");
      expect(renderedText(root)).not.toContain("旧文件延迟文字");
    }
  });
});
