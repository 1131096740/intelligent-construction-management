import { describe, expect, it } from "vitest";
import {
  hasOpenWorkbenchItems,
  hasWorkbenchPermissionData,
  toWorkbenchCards
} from "./home.config";
import type { WorkbenchSummaryReadModel } from "../../api/core-flow-read.api";

describe("home workbench card helpers", () => {
  const summary: WorkbenchSummaryReadModel = {
    generatedAt: "2026-07-03T10:00:00.000Z",
    visibleProjectCount: 1,
    cards: [
      {
        id: "contract_takeover_todo",
        title: "待接管合同",
        count: 3,
        description: "历史合同草稿或待补充资料，需要补录后提交复核。",
        targetPath: "/历史合同接管",
        actionText: "去接管",
        tone: "primary"
      },
      {
        id: "approved_pending_payment",
        title: "已批待付款",
        count: 1,
        description: "付款审批已通过，等待出纳登记实付和凭证。",
        targetPath: "/付款管理",
        actionText: "去付款",
        tone: "warning"
      }
    ]
  };

  it("renders Chinese card titles and counts from backend summary", () => {
    const cards = toWorkbenchCards(summary);

    expect(cards.map((card) => [card.title, card.countText, card.toneClass])).toEqual([
      ["待接管合同", "3", "tone-primary"],
      ["已批待付款", "1", "tone-warning"]
    ]);
    expect(hasOpenWorkbenchItems(cards)).toBe(true);
  });

  it("keeps backend jump links intact", () => {
    expect(toWorkbenchCards(summary).map((card) => card.targetPath)).toEqual([
      "/历史合同接管",
      "/付款管理"
    ]);
  });

  it("treats all-zero cards as a no-open-item state", () => {
    const cards = toWorkbenchCards({
      ...summary,
      cards: summary.cards.map((card) => ({ ...card, count: 0 }))
    });

    expect(hasWorkbenchPermissionData({ ...summary, cards })).toBe(true);
    expect(hasOpenWorkbenchItems(cards)).toBe(false);
  });

  it("treats empty card data as no visible business permission", () => {
    const emptySummary = { ...summary, cards: [] };

    expect(toWorkbenchCards(emptySummary)).toEqual([]);
    expect(hasWorkbenchPermissionData(emptySummary)).toBe(false);
  });
});
