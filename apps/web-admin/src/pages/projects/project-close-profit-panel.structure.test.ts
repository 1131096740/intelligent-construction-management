import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const page = readFileSync(
  fileURLToPath(new URL("./ProjectOperatingOverviewPage.vue", import.meta.url)),
  "utf8"
);
const panel = readFileSync(
  fileURLToPath(new URL("./components/ProjectCloseProfitPanel.vue", import.meta.url)),
  "utf8"
);

describe("project close profit panel structure", () => {
  it("mounts one responsive workbench in the existing project operating page", () => {
    expect(page).toContain('label="项目收口与盈亏"');
    expect(page).toContain("<ProjectCloseProfitPanel");
    expect(page).toContain("fetchReconciledProjectCloseProfitWorkbenchWithCapability(projectId)");
    expect(panel).toContain("七阶段逐项确认");
    expect(panel).toContain("workbench.stages");
    expect(panel).toContain("workbench.currentDistribution.lines");
    expect(panel).toContain("workbench.temporaryDistributions");
    expect(panel).toContain("workbench.impacts");
    expect(panel).toContain("暂分利润");
    expect(panel).toContain("最终公司差额");
    expect(panel).toContain("需要重新确认");
    expect(panel).toContain("@media (max-width: 768px)");
  });

  it("uses only server-issued actions and the server projection fingerprint", () => {
    expect(panel).toContain("stage.availableActions");
    expect(panel).toContain('includes("create_temporary_distribution")');
    expect(panel).toContain("postTemporaryProfitDistribution");
    expect(panel).toContain("expectedProjectionFingerprint: props.workbench!.projection.fingerprint");
    expect(panel).not.toContain("roleKeys");
    expect(panel).not.toContain("sourceBusinessId");
  });
});
