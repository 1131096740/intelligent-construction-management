import type { ContractClauseDefinition } from "@jiangkong/shared-domain";
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
});
