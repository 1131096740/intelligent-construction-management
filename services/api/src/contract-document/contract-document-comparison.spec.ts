import { createHash } from "node:crypto";
import type { ContractDocxBlock, ContractDocxSnapshot } from "./contract-docx-extractor";
import {
  CONTRACT_DOCUMENT_COMPARISON_LIMITS,
  compareContractDocumentSnapshots
} from "./contract-document-comparison";

function snapshot(blocks: ContractDocxBlock[]): ContractDocxSnapshot {
  return {
    blocks,
    normalizedSha256: createHash("sha256").update(JSON.stringify(blocks)).digest("hex")
  };
}

function paragraphs(...texts: string[]) {
  return snapshot(
    texts.map((text, index) => ({
      kind: "paragraph" as const,
      path: `p:${String(index + 1).padStart(4, "0")}`,
      text
    }))
  );
}

describe("compareContractDocumentSnapshots", () => {
  it("aligns deterministic insertions, deletions and replacements without shifting unchanged anchors", () => {
    expect(compareContractDocumentSnapshots(paragraphs("甲", "乙"), paragraphs("甲", "新增", "乙")).differences)
      .toEqual([expect.objectContaining({ changeType: "insert", beforeText: null, afterText: "新增" })]);
    expect(compareContractDocumentSnapshots(paragraphs("甲", "删除", "乙"), paragraphs("甲", "乙")).differences)
      .toEqual([expect.objectContaining({ changeType: "delete", beforeText: "删除", afterText: null })]);
    expect(compareContractDocumentSnapshots(paragraphs("甲", "旧内容", "乙"), paragraphs("甲", "新内容", "乙")).differences)
      .toEqual([expect.objectContaining({ changeType: "replace", beforeText: "旧内容", afterText: "新内容" })]);
  });

  it("returns byte-for-byte stable differences across repeated runs", () => {
    const base = paragraphs("甲", "合同金额：100.00元", "乙");
    const revised = paragraphs("甲", "合同金额：120.50元", "乙");

    expect(compareContractDocumentSnapshots(base, revised)).toEqual(
      compareContractDocumentSnapshots(base, revised)
    );
  });

  it("creates candidates only for explicit money labels, valid dates and known clause titles", () => {
    const clauseSnapshot = [{ key: "payment", title: "付款条款", content: { text: "旧付款方式" } }];
    const result = compareContractDocumentSnapshots(
      paragraphs("合同金额：100元", "签订日期：2026年7月12日", "付款条款：旧付款方式", "备注：100"),
      paragraphs("合同金额：120.50元", "签订日期：2026-07-13", "付款条款：新付款方式", "备注：200"),
      clauseSnapshot
    );

    expect(result.differences.map((difference) => difference.candidate)).toEqual([
      expect.objectContaining({ kind: "amount", cents: "12050", label: "合同金额" }),
      expect.objectContaining({ kind: "date", isoDate: "2026-07-13", label: "签订日期" }),
      expect.objectContaining({ kind: "key_clause", clauseKey: "payment", title: "付款条款" }),
      null
    ]);
  });

  it("does not create candidates for ambiguous amounts, invalid dates or unknown clause-like text", () => {
    const result = compareContractDocumentSnapshots(
      paragraphs("参考数字：100", "签订日期：2026-02-28", "验收条款：旧内容"),
      paragraphs("参考数字：200", "签订日期：2026-02-30", "验收条款：新内容"),
      [{ key: "payment", title: "付款条款", content: { text: "付款" } }]
    );

    expect(result.differences.every((difference) => difference.candidate === null)).toBe(true);
  });

  it("fails closed when the difference count exceeds the comparison limit", () => {
    const base = paragraphs(
      ...Array.from(
        { length: CONTRACT_DOCUMENT_COMPARISON_LIMITS.maxDifferences + 1 },
        (_, index) => `删除-${index}`
      )
    );

    expect(() => compareContractDocumentSnapshots(base, paragraphs())).toThrow(
      "合同文档差异数量超过系统限制"
    );
  });
});
