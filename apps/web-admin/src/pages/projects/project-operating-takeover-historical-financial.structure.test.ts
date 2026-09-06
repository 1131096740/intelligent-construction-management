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
