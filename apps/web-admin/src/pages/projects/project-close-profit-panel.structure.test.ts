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
    expect(panel).toContain("visibleDistribution.lines");
    expect(panel).toContain("workbench.temporaryDistributions");
    expect(panel).toContain("workbench.impacts");
    expect(panel).toContain("暂分利润");
    expect(panel).toContain("最终公司差额");
    expect(panel).toContain("需要重新确认");
    expect(panel).toContain("预计待清算费用");
    expect(panel).toContain("查看统一经营投影事实");
    expect(panel).toContain("workbench.history.stageVersions");
    expect(panel).toContain("workbench.history.profitConfirmations");
    expect(panel).toContain("workbench.history.distributions");
    expect(panel).toContain("visibleDistribution");
    expect(panel).toContain("props.workbench?.currentDistribution ?? props.workbench?.history.distributions[0]");
    expect(panel).toContain("双专业确认");
    expect(panel).toContain("确认主体已留存于审计记录");
    expect(panel).toContain("basisText(");
    expect(panel).toContain("@media (max-width: 768px)");
  });

  it("uses only server-issued actions and the server projection fingerprint", () => {
    expect(panel).toContain("stage.availableActions");
    expect(panel).toContain('includes("create_temporary_distribution")');
    expect(panel).toContain("postTemporaryProfitDistribution");
    expect(panel).toContain("submitProjectFinalProfit");
    expect(panel).toContain("submitProjectProfitDistribution");
    expect(panel).toContain('includes("submit_final_profit")');
    expect(panel).toContain('includes("submit_distribution")');
    expect(panel).toContain("confirmationBody(submissionId)");
    expect(panel).toContain("高管只能确认该冻结版本");
    expect(panel).toContain('v-if="canSubmitDistribution"');
    expect(panel).toContain(':data="visibleDistribution.lines"');
    expect(panel).toContain("expectedProjectionFingerprint: props.workbench!.projection.fingerprint");
    expect(panel).not.toContain("roleKeys");
    expect(panel).not.toContain("sourceBusinessId");
    expect(panel).toContain("projection?.view.operating.confirmedIncomeCents");
    expect(panel).toContain("projection?.view.operating.confirmedCostCents");
    expect(panel).not.toContain("fetchProjectOperatingOverview");
  });
});
