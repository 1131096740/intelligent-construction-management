import type { ContractClauseDefinition } from "@jiangkong/shared-domain";
import { reactive, ref } from "vue";
import { describe, expect, it } from "vitest";

import type { PublishedStandardClause } from "../../../api/contract-workbench.api";
import { clauseDocumentText, normalizeClauseDocument } from "./contract-bill-editor";
import {
  applyPublishedStandardClause,
  standardClauseMeta,
  withClauseDeviation
} from "./contract-clause-editing";

function clause(content: unknown = ""): ContractClauseDefinition {
  return {
    key: "payment",
    title: "付款条款",
    numberingMode: "automatic",
    required: true,
    content
  };
}

function published(content: unknown): PublishedStandardClause {
  return {
    standardClauseVersionId: "standard-clause-version-2",
    versionId: "version-2",
    versionNo: 2,
    title: "标准付款条款",
    content,
    clauseId: "standard-clause-payment",
    code: "PAYMENT_STANDARD",
    name: "公司付款条款",
    category: "payment"
  };
}

describe("contract clause standard source editing", () => {
  it("copies a published standard clause into an empty contract clause", () => {
    const source = published({
      text: "进度款按月支付。",
      blocks: [
        { type: "paragraph", text: "进度款按月支付。", bold: true },
        { type: "list", items: ["提交结算资料", "审核通过"] }
      ],
      documentMeta: { author: "法务部" }
    });

    const result = applyPublishedStandardClause(clause(), source);

    expect(result).toMatchObject({
      key: "payment",
      required: true,
      standardClauseVersionId: source.standardClauseVersionId,
      title: source.title,
      content: {
        standardTitle: source.title,
        standardContent: source.content,
        standardClauseSourceName: source.name,
        standardClauseVersionNo: source.versionNo,
        deviatedFromStandard: false,
        documentMeta: { author: "法务部" }
      }
    });
    expect(clauseDocumentText(normalizeClauseDocument(result.content))).toBe(
      "进度款按月支付。\n提交结算资料\n审核通过"
    );
  });

  it("recomputes deviation from normalized title and document text", () => {
    const source = published({
      text: "进度款按月支付。",
      blocks: [{ type: "paragraph", text: "进度款按月支付。" }]
    });
    const applied = applyPublishedStandardClause(clause(), source);

    const renamed = withClauseDeviation(applied, { title: "修改标题" });
    expect(renamed.content).toMatchObject({ deviatedFromStandard: true });

    const edited = withClauseDeviation(applied, {
      content: {
        text: "进度款改为季度支付。",
        blocks: [{ type: "paragraph", text: "进度款改为季度支付。" }]
      }
    });
    expect(edited.content).toMatchObject({ deviatedFromStandard: true });

    const restored = withClauseDeviation(edited, {
      title: source.title,
      content: source.content
    });
    expect(restored.content).toMatchObject({ deviatedFromStandard: false });
  });

  it("deeply snapshots the published source without mutating either input", () => {
    const sourceContent = {
      text: "原始正文",
      blocks: [{ type: "table" as const, rows: [["A", "B"]] }]
    };
    const source = published(sourceContent);
    const originalClause = clause({ text: "", blocks: [] });

    const result = applyPublishedStandardClause(originalClause, source);
    sourceContent.blocks[0].rows[0][0] = "被修改";

    expect(result.content).toMatchObject({
      blocks: [{ type: "table", rows: [["A", "B"]] }],
      standardContent: {
        blocks: [{ type: "table", rows: [["A", "B"]] }]
      }
    });
    expect(originalClause).toEqual(clause({ text: "", blocks: [] }));
  });

  it("does not invent deviation metadata when there is no standard snapshot", () => {
    const original = clause({
      text: "自定义正文",
      blocks: [{ type: "paragraph", text: "自定义正文", italic: true }],
      documentMeta: { source: "manual" }
    });

    const result = withClauseDeviation(original, { title: "自定义标题" });

    expect(result).toEqual({ ...original, title: "自定义标题" });
    expect(standardClauseMeta(result.content)).toEqual({});
    expect(original.title).toBe("付款条款");
  });

  it("preserves document structure and non-standard metadata while editing", () => {
    const source = published({
      text: "标准正文",
      blocks: [{ type: "paragraph", text: "标准正文" }]
    });
    const applied = applyPublishedStandardClause(clause(), source);
    const content = {
      ...(applied.content as Record<string, unknown>),
      blocks: [{ type: "paragraph", text: "修改正文", bold: true }],
      editorMeta: { cursor: 3 }
    };

    const result = withClauseDeviation(applied, { content });

    expect(result.content).toMatchObject({
      blocks: [{ type: "paragraph", text: "修改正文", bold: true }],
      editorMeta: { cursor: 3 },
      standardClauseSourceName: source.name,
      standardClauseVersionNo: source.versionNo,
      deviatedFromStandard: true
    });
  });

  it("copies Vue reactive standard sources and clauses without DataCloneError", () => {
    const source = reactive(
      published({
        text: "响应式标准正文",
        blocks: [{ type: "paragraph", text: "响应式标准正文" }],
        documentMeta: { owner: "合同部" }
      })
    );
    const clauseRef = ref(clause({ text: "", blocks: [] }));

    const applied = applyPublishedStandardClause(clauseRef.value, source);
    const reactiveClause = reactive(applied);
    const edited = withClauseDeviation(reactiveClause, {
      content: {
        ...(reactiveClause.content as Record<string, unknown>),
        text: "响应式修改正文",
        blocks: [{ type: "paragraph", text: "响应式修改正文" }]
      }
    });

    expect(edited.content).toMatchObject({
      text: "响应式修改正文",
      standardContent: {
        text: "响应式标准正文",
        documentMeta: { owner: "合同部" }
      },
      deviatedFromStandard: true
    });
  });

  it.each([
    {
      name: "string",
      content: "字符串正文",
      expectedText: "字符串正文",
      expectedBlocks: [{ type: "paragraph", text: "字符串正文" }]
    },
    {
      name: "null",
      content: null,
      expectedText: "",
      expectedBlocks: [{ type: "paragraph", text: "" }]
    },
    {
      name: "text-only document",
      content: { text: "仅文本正文", documentMeta: { legacy: true } },
      expectedText: "仅文本正文",
      expectedBlocks: [{ type: "paragraph", text: "仅文本正文" }]
    },
    {
      name: "text with empty blocks",
      content: { text: "空块时保留正文", blocks: [] },
      expectedText: "空块时保留正文",
      expectedBlocks: [{ type: "paragraph", text: "空块时保留正文" }]
    },
    {
      name: "blocks-only document",
      content: {
        blocks: [
          { type: "paragraph", text: "第一段", italic: true },
          { type: "list", items: ["第二项", "第三项"] },
          { type: "table", rows: [["甲", "乙"], ["丙", "丁"]] }
        ]
      },
      expectedText: "第一段\n第二项\n第三项\n甲 | 乙\n丙 | 丁",
      expectedBlocks: [
        { type: "paragraph", text: "第一段", italic: true },
        { type: "list", items: ["第二项", "第三项"] },
        { type: "table", rows: [["甲", "乙"], ["丙", "丁"]] }
      ]
    },
    {
      name: "empty and malformed blocks",
      content: {
        text: "畸形块回退正文",
        blocks: [
          null,
          {},
          { type: "paragraph" },
          { type: "list", items: ["有效项", 1] },
          { type: "table", rows: [["有效格", null]] }
        ]
      },
      expectedText: "畸形块回退正文",
      expectedBlocks: [{ type: "paragraph", text: "畸形块回退正文" }]
    },
    {
      name: "valid empty block",
      content: { blocks: [{ type: "paragraph", text: "" }] },
      expectedText: "",
      expectedBlocks: [{ type: "paragraph", text: "" }]
    }
  ])("normalizes $name without losing supported document structure", ({
    content,
    expectedText,
    expectedBlocks
  }) => {
    const result = applyPublishedStandardClause(clause(), published(content));
    const record = result.content as Record<string, unknown>;

    expect(record["text"]).toBe(expectedText);
    expect(record["blocks"]).toEqual(expectedBlocks);
    expect(clauseDocumentText(normalizeClauseDocument(result.content))).toBe(expectedText);
    expect(expectedText).not.toContain("paragraph");
    expect(expectedText).not.toContain("list");
    expect(expectedText).not.toContain("table");
  });

  it.each([
    {
      name: "legacy string array",
      content: ["第一段", "第二段"],
      expectedText: "第一段\n第二段"
    },
    {
      name: "legacy object without text",
      content: {
        paragraphs: [
          "对象第一段",
          { value: 2, enabled: true, type: "paragraph" }
        ]
      },
      expectedText: "对象第一段\n2\ntrue"
    },
    {
      name: "nested finite numbers and booleans",
      content: [1, true, { nested: [2.5, false, "末段"] }],
      expectedText: "1\ntrue\n2.5\nfalse\n末段"
    }
  ])("preserves deterministic recursive text for $name", ({ content, expectedText }) => {
    const result = applyPublishedStandardClause(clause(), published(content));
    const document = normalizeClauseDocument(result.content);

    expect(document).toEqual({
      text: expectedText,
      blocks: [{ type: "paragraph", text: expectedText }]
    });
    expect(clauseDocumentText(document)).toBe(expectedText);
    expect(expectedText).not.toContain("paragraph");
  });

  it.each([
    {
      name: "valid paragraph followed by malformed list",
      content: {
        blocks: [
          { type: "paragraph", text: "保留段" },
          { type: "list", items: ["畸形清单仍保留文本", 2] }
        ]
      },
      expectedText: "保留段\n畸形清单仍保留文本\n2"
    },
    {
      name: "valid list followed by malformed table",
      content: {
        blocks: [
          { type: "list", items: ["清单一", "清单二"] },
          { type: "table", rows: [["表格后续", null]] }
        ]
      },
      expectedText: "清单一\n清单二\n表格后续"
    }
  ])("falls back as a whole for $name", ({ content, expectedText }) => {
    const result = applyPublishedStandardClause(clause(), published(content));
    const document = normalizeClauseDocument(result.content);

    expect(document).toEqual({
      text: expectedText,
      blocks: [{ type: "paragraph", text: expectedText }]
    });
  });

  it("removes old standard metadata before snapshotting and remains flat on repeat apply", () => {
    const oldEnvelope = {
      text: "标准正文",
      blocks: [{ type: "paragraph", text: "标准正文" }],
      documentMeta: { owner: "合同部" },
      standardTitle: "旧标题",
      standardContent: {
        text: "旧正文",
        blocks: [{ type: "paragraph", text: "旧正文" }],
        standardContent: { text: "更旧正文" }
      },
      standardClauseSourceName: "旧来源",
      standardClauseVersionNo: 1,
      deviatedFromStandard: true
    };

    const first = applyPublishedStandardClause(clause(), published(oldEnvelope));
    const repeated = applyPublishedStandardClause(
      clause(),
      published(first.content)
    );
    const meta = standardClauseMeta(repeated.content);

    expect(meta.standardContent).toEqual({
      text: "标准正文",
      blocks: [{ type: "paragraph", text: "标准正文" }],
      documentMeta: { owner: "合同部" }
    });
    expect(meta.standardContent).not.toHaveProperty("standardTitle");
    expect(meta.standardContent).not.toHaveProperty("standardContent");
    expect(repeated.content).toMatchObject({
      standardTitle: "标准付款条款",
      standardClauseSourceName: "公司付款条款",
      standardClauseVersionNo: 2,
      deviatedFromStandard: false
    });
  });

  it.each([
    {
      name: "cyclic content",
      content: (() => {
        const value: Record<string, unknown> = { text: "循环" };
        value["self"] = value;
        return value;
      })()
    },
    { name: "BigInt content", content: { text: "正文", unsupported: 1n } },
    { name: "root undefined", content: undefined },
    { name: "nested undefined", content: { text: "正文", unsupported: undefined } },
    { name: "function", content: { text: "正文", unsupported: () => "值" } },
    { name: "symbol", content: { text: "正文", unsupported: Symbol("值") } },
    { name: "NaN", content: { text: "正文", unsupported: Number.NaN } },
    { name: "Infinity", content: { text: "正文", unsupported: Number.POSITIVE_INFINITY } },
    {
      name: "sparse array",
      content: (() => {
        const value = ["第一段"];
        value.length = 2;
        return value;
      })()
    },
    { name: "non-plain serializable object", content: new Date("2026-07-25T00:00:00Z") }
  ])("rejects $name with a stable JSON contract error", ({ content }) => {
    expect(() => applyPublishedStandardClause(clause(), published(content))).toThrowError(
      new TypeError("条款内容必须是可序列化的 JSON 数据")
    );
  });

  it.each([
    { name: "null", content: null },
    { name: "string", content: "正文" },
    { name: "boolean", content: true },
    { name: "finite number", content: 2.5 },
    { name: "dense array", content: ["第一段", null, 2, false] },
    { name: "plain object", content: { text: "正文", nested: { enabled: true } } },
    {
      name: "reactive plain array",
      content: reactive([{ text: "第一段" }, { enabled: true }])
    }
  ])("accepts valid JSON content: $name", ({ content }) => {
    expect(() => applyPublishedStandardClause(clause(), published(content))).not.toThrow();
  });
});
