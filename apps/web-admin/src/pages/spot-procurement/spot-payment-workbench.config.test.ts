import { describe, expect, it } from "vitest";
import {
  paymentTaskRoute,
  selectSpotPaymentTaskCards,
  spotPaymentLedgerGroups,
  spotPaymentWorkbenchViews
} from "./spot-payment-workbench.config";

describe("spot payment workbench configuration", () => {
  it("fixes the three workbench views and six ledger information groups", () => {
    expect(spotPaymentWorkbenchViews).toEqual([
      { value: "mine", label: "待我办理" },
      { value: "all", label: "全部申请" },
      { value: "closed", label: "已办结" }
    ]);
    expect(spotPaymentLedgerGroups.map((group) => group.label)).toEqual([
      "付款申请",
      "项目 / 商户",
      "金额",
      "当前状态",
      "当前任务",
      "操作"
    ]);
  });

  it("takes the first five server-ordered tasks without reprioritizing them", () => {
    const tasks = [
      { id: "shared-first", priority: 200 },
      { id: "personal-second", priority: 300 },
      { id: "blocking-third", priority: 400 },
      { id: "fourth", priority: 300 },
      { id: "fifth", priority: 300 },
      { id: "sixth", priority: 400 }
    ];

    expect(selectSpotPaymentTaskCards(tasks).map((task) => task.id)).toEqual([
      "shared-first",
      "personal-second",
      "blocking-third",
      "fourth",
      "fifth"
    ]);
    expect(tasks).toHaveLength(6);
  });

  it("maps only known server task keys to local actions", () => {
    expect(paymentTaskRoute("complete_payment_draft")).toBe("edit-draft");
    expect(paymentTaskRoute("review_payment")).toBe("review");
    expect(paymentTaskRoute("complete_payer")).toBe("payer");
    expect(paymentTaskRoute("record_execution")).toBe("execution");
    expect(paymentTaskRoute("record_refund")).toBe("refund");
    expect(paymentTaskRoute("view_only")).toBe("readonly");
    expect(paymentTaskRoute("https://example.com/unsafe")).toBe("readonly");
    expect(paymentTaskRoute("unknown_task")).toBe("readonly");
    expect(paymentTaskRoute("toString")).toBe("readonly");
    expect(paymentTaskRoute("constructor")).toBe("readonly");
    expect(paymentTaskRoute("__proto__")).toBe("readonly");
  });
});
