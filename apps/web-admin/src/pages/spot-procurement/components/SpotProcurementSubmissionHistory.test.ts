import { createSSRApp, h } from "vue";
import { renderToString } from "vue/server-renderer";
import { describe, expect, it } from "vitest";

import SpotProcurementSubmissionHistory from "./SpotProcurementSubmissionHistory.vue";

const field = (key: string, label: string, scope: "header" | "line") => ({
  key, label, scope, type: "text" as const, description: "", example: "", unit: "", precision: 0,
  required: true, permissions: { view: ["material_staff" as const], edit: ["material_staff" as const] },
  display: { formHint: "", gridColumn: label, mobilePriority: 1, readonlyText: "" },
  excel: { column: label, paste: "single" as const, errorLocation: "cell" as const },
  bulk: { enabled: true, maxRows: 100, strategy: "append" as const }
});

describe("SpotProcurementSubmissionHistory", () => {
  it("按冻结定义展示表头和明细且不泄露技术标识", async () => {
    const html = await renderToString(createSSRApp({
      render: () => h(SpotProcurementSubmissionHistory, {
        snapshots: [
          {
            sceneKey: "spot_procurement.application", versionNo: 1, lineNumber: null, revision: 1,
            definitionVersion: 1, frozenAt: "2026-09-17T08:00:00.000Z",
            definitionSnapshot: { key: "spot_procurement.application", entityType: "spot_procurement_version", name: "零采申请", description: "", version: 1, rules: [], fields: [field("reason", "采购原因", "header")] },
            valuesSnapshot: { reason: "现场补料" }
          },
          {
            sceneKey: "spot_procurement.application_line", versionNo: 1, lineNumber: 1, revision: 1,
            definitionVersion: 1, frozenAt: "2026-09-17T08:00:00.000Z",
            definitionSnapshot: { key: "spot_procurement.application_line", entityType: "spot_procurement_line", name: "零采明细", description: "", version: 1, rules: [], fields: [field("materialName", "材料名称", "line")] },
            valuesSnapshot: { materialName: "免烧砖" }
          }
        ]
      })
    }));

    expect(html).toContain("V1 申请表头");
    expect(html).toContain("材料明细第 1 行");
    expect(html).toContain("现场补料");
    expect(html).toContain("免烧砖");
    expect(html).not.toContain("spot_procurement.application");
    expect(html).not.toContain("spot_procurement_version");
  });
});
