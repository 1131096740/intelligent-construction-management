import { describe, expect, it } from "vitest";
import {
  paymentTaskRoute,
  selectSpotPaymentTaskCards,
  spotPaymentTaskPresentation,
  spotPaymentStatusSemantic,
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

  it("shares fail-closed labels, actionability and semantics across task surfaces", () => {
    expect(spotPaymentTaskPresentation({
      key: "complete_payment_draft", enabled: true, scope: "personal", priority: 300
    })).toEqual({ actionLabel: "填写", actionable: true, semantic: "required" });
    expect(spotPaymentTaskPresentation({
      key: "review_payment", enabled: true, scope: "personal", priority: 300
    })).toEqual({ actionLabel: "处理", actionable: true, semantic: "required" });
    expect(spotPaymentTaskPresentation({
      key: "record_execution", enabled: true, scope: "personal", priority: 300
    })).toEqual({ actionLabel: "处理", actionable: true, semantic: "required" });
    expect(spotPaymentTaskPresentation({
      key: "complete_payer", enabled: true, scope: "shared", priority: 200
    })).toEqual({ actionLabel: "处理", actionable: true, semantic: "progress" });
    expect(spotPaymentTaskPresentation({
      key: "record_refund", enabled: true, scope: "personal", priority: 400
    })).toEqual({ actionLabel: "处理", actionable: true, semantic: "danger" });
    expect(spotPaymentTaskPresentation({
      key: "view_only", enabled: true, scope: "personal", priority: 400
    })).toEqual({ actionLabel: "查看", actionable: true, semantic: "danger" });
    expect(spotPaymentTaskPresentation({
      key: "unknown_task", enabled: true, scope: "shared", priority: 400
    })).toEqual({ actionLabel: "查看", actionable: true, semantic: "neutral" });
    expect(spotPaymentTaskPresentation({
      key: "record_execution", enabled: false, scope: "personal", priority: 400
    })).toEqual({ actionLabel: "查看", actionable: false, semantic: "neutral" });
  });

  it("maps payment status independently from the current task", () => {
    expect(spotPaymentStatusSemantic("draft")).toBe("neutral");
    expect(spotPaymentStatusSemantic("approval_pending")).toBe("progress");
    expect(spotPaymentStatusSemantic("approved_pending_payment")).toBe("progress");
    expect(spotPaymentStatusSemantic("partially_paid")).toBe("progress");
    expect(spotPaymentStatusSemantic("paid")).toBe("success");
    expect(spotPaymentStatusSemantic("settled")).toBe("success");
    for (const status of ["returned", "rejected", "withdrawn", "voided", "invalidated"]) {
      expect(spotPaymentStatusSemantic(status)).toBe("danger");
    }
    expect(spotPaymentStatusSemantic("unknown_status")).toBe("neutral");
  });
});
