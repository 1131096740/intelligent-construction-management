import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const pageSource = readFileSync(
  new URL("./ProjectOperatingTakeoverPage.vue", import.meta.url),
  "utf8"
);
const apiSource = readFileSync(
  new URL("../../api/operating-takeover.api.ts", import.meta.url),
  "utf8"
);

describe("POL-224 historical payable and fund takeover page", () => {
  it("opens the generic operating takeover write workbench without opening the manifest workflow", () => {
    expect(pageSource).toContain("const POL_215_WRITE_UI_ENABLED = true;");
    expect(pageSource).toContain("页面录入 / 粘贴 / Excel 预检");
    expect(pageSource).toContain("生成整批草稿");
    expect(pageSource).toContain("财务确认");
    expect(pageSource).toContain("合同确认");
    expect(pageSource).toContain("激活批次");
    expect(pageSource).toContain("<BusinessEntryForm");
    expect(pageSource).not.toContain("粘贴 JSON 数组");
  });

  it("exposes the project-scoped manifest list through the API wrapper", () => {
    expect(apiSource).toContain("fetchHistoricalFinancialTakeoverBatches");
    expect(apiSource).toContain('path(projectId, "/historical-financial/manifests")');
    expect(apiSource).not.toContain('apiFetch("/projects/');
  });

  it("renders A/B/C and conflict counts with TDesign while keeping mutation controls closed", () => {
    expect(pageSource).toContain("历史应付与资金 manifest");
    expect(pageSource).toContain(":columns=\"financialBatchColumns\"");
    expect(pageSource).toContain("levelARows");
    expect(pageSource).toContain("levelBRows");
    expect(pageSource).toContain("gapRows");
    expect(pageSource).toContain("blockedRows");
    expect(pageSource).toContain("未在页面开放");
    expect(pageSource).not.toContain("prepareHistoricalFinancialTakeover");
    expect(pageSource).not.toContain("activateHistoricalFinancialTakeover");
  });
});
