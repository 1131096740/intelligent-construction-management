import { createSSRApp, defineComponent, h } from "vue";
import { renderToString } from "vue/server-renderer";
import { describe, expect, it } from "vitest";
import type { ExpenseClaimEntrySnapshotReadModel } from "../../../api/expense-claim.api";
import ExpenseClaimSubmissionHistory from "./ExpenseClaimSubmissionHistory.vue";

describe("ExpenseClaimSubmissionHistory", () => {
  it("按原分显示整数分报销，保留四位金额和旧快照的实际精度", async () => {
    const definitionSnapshot: ExpenseClaimEntrySnapshotReadModel["definitionSnapshot"] = {
      key: "expense_claim.reimbursement",
      entityType: "expense_claim",
      name: "费用报销",
      description: "",
      version: 1,
      rules: [],
      fields: [{
        key: "amountYuan", label: "费用金额", type: "money", description: "", example: "",
        scope: "line", unit: "元", precision: 4, required: true,
        permissions: { view: [], edit: [] },
        display: { formHint: "", gridColumn: "费用金额", mobilePriority: 1, readonlyText: "" },
        excel: { column: "费用金额", paste: "single", errorLocation: "cell" },
        bulk: { enabled: false, strategy: "append" }
      }]
    };
    const lines = [{ amountYuan: "0.0100" }, { amountYuan: "0.0050" }];
    const snapshots = [
      { id: "current", frozenAt: "2026-11-27T01:00:00.000Z", definitionSnapshot,
        valuesSnapshot: { numericProtocolVersion: 2, lines } },
      { id: "legacy", frozenAt: "2026-11-26T01:00:00.000Z", definitionSnapshot,
        valuesSnapshot: { lines: [{ amountYuan: "0.0100" }] } }
    ];
    const app = createSSRApp({ render: () => h(ExpenseClaimSubmissionHistory, { snapshots }) });
    app.component("t-card", defineComponent({
      setup: (_, { slots }) => () => h("article", slots.default?.())
    }));
    app.component("t-alert", defineComponent({ setup: () => () => null }));
    const html = await renderToString(app);

    expect(html).toContain("0.01 元");
    expect(html).toContain("0.0050 元");
    expect(html.match(/0\.0100 元/gu)).toHaveLength(1);
    expect(lines).toEqual([{ amountYuan: "0.0100" }, { amountYuan: "0.0050" }]);
  });
});
