import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const pageSource = readFileSync(
  new URL("./ProjectOperatingOverviewPage.vue", import.meta.url),
  "utf8"
);
const panelSource = readFileSync(
  new URL("./components/ProjectFinancingQuotaPanel.vue", import.meta.url),
  "utf8"
);
const apiSource = readFileSync(
  new URL("../../api/project-financing-quota.api.ts", import.meta.url),
  "utf8"
);
const pageActionRegistry = JSON.parse(
  readFileSync(
    resolve(
      __dirname,
      "../../../../../docs/product/manifests/web-page-actions.registry.json"
    ),
    "utf8"
  )
) as {
  actions: Array<{
    id: string;
    trigger: { element: string; event: string; handler: string };
    capability: { kind: string; source: string; key?: string };
    wrappers: Array<{ apiFile: string; name: string }>;
  }>;
};

describe("project financing quota F0/F1 workbench", () => {
  it("loads the project-scoped read model and mounts the dedicated panel", () => {
    expect(pageSource).toContain("fetchProjectFinancingQuotaWorkbench");
    expect(pageSource).toContain("<ProjectFinancingQuotaPanel");
    expect(pageSource).toContain(":workbench=\"financingQuotaWorkbench\"");
    expect(pageSource).toContain("createProjectOverviewRequestOwner");
    expect(pageSource).toContain("overviewRequestOwner.begin()");
    expect(pageSource).toContain("overviewRequestOwner.isCurrent(requestOwner)");
  });

  it("shows the fixed funding order and immutable usage facts without client role inference", () => {
    expect(panelSource).toContain("自有资金优先");
    expect(panelSource).toContain("垫资额度补足");
    expect(panelSource).toContain("usageGroups");
    expect(panelSource).not.toContain("auth.user");
    expect(panelSource).not.toContain("fetch(");
  });

  it("renders the backend status label without overriding rejected or terminated history", () => {
    expect(panelSource).toContain("{{ row.statusLabel }}");
    expect(panelSource).not.toContain('row.isExpired ? "已过期" : row.statusLabel');
    expect(panelSource).toContain('status === "approved" && isExpired');
  });

  it("labels every canonical funding-allocation business type", () => {
    expect(panelSource).toContain('project_expense_request: "项目支出"');
    expect(panelSource).toContain('spot_procurement_payment: "零星采购付款"');
    expect(panelSource).toContain('expense_claim: "费用报销 / 借款"');
    expect(panelSource).toContain('incidental_expense: "零星费用"');
  });

  it("shows immutable termination facts instead of falling back to the approver", () => {
    expect(apiSource).toContain("terminatedByName: string | null");
    expect(panelSource).toContain("row.status === 'terminated'");
    expect(panelSource).toContain("终止人：");
    expect(panelSource).toContain("终止时间：");
    expect(panelSource).toContain("终止原因：");
  });

  it("shows the request trigger solely from the exact enabled server action requiring a file", () => {
    expect(panelSource).toContain("workbench.requestAction");
    expect(panelSource).toContain('action.key === "request_financing_quota"');
    expect(panelSource).toContain("action.enabled");
    expect(panelSource).toContain("action.requiresFile === true");
    expect(panelSource).not.toContain("auth.user");
    expect(panelSource).not.toContain("globalRoleKeys");
  });

  it("uses a standard TDesign dialog with yuan amount, reason, optional validity and one required file", () => {
    expect(panelSource).toContain("<t-dialog");
    expect(panelSource).toContain("申请金额（元）");
    expect(panelSource).toContain("申请事由");
    expect(panelSource).toContain("有效期（选填）");
    expect(panelSource).toContain("<t-upload");
    expect(panelSource).toContain(':auto-upload="false"');
    expect(panelSource).toContain(':multiple="false"');
    expect(panelSource).toContain(':max="1"');
    expect(panelSource).not.toContain("SensitiveActionDialog");
  });

  it("freezes a UUID attempt and invalidates late work on project switch or unmount", () => {
    expect(panelSource).toContain("crypto.randomUUID()");
    expect(panelSource).toContain("projectGeneration");
    expect(panelSource).toContain("onBeforeUnmount");
    expect(panelSource).toContain("requestContextIsCurrent");
    expect(panelSource).toContain("requestProjectFinancingQuotaWithUpload");
    expect(panelSource).toContain("createProjectFinancingQuotaRequestAttemptState");
    expect(panelSource).toContain("fetchProjectFinancingQuotaRequestCapability");
  });

  it("publishes only the authoritative refreshed workbench back to the owning page", () => {
    expect(pageSource).toContain(':project-id="selectedProjectId"');
    expect(pageSource).toContain('@updated="handleFinancingQuotaUpdated"');
    expect(pageSource).toContain("function handleFinancingQuotaUpdated");
    expect(pageSource).toContain("nextWorkbench.project.id !== selectedProjectId.value");
  });

  it("registers only the actual F1 request action against the composite wrapper", () => {
    const registration = pageActionRegistry.actions.find(
      (action) => action.id === "project-financing-quota.request"
    );

    expect(registration?.trigger).toEqual({
      element: "t-dialog",
      event: "confirm",
      handler: "submitRequest"
    });
    expect(registration?.capability).toEqual({
      kind: "detail_action",
      source: "selectedFinancingQuotaRequestAction"
    });
    expect(registration?.wrappers).toEqual([{
      apiFile: "apps/web-admin/src/api/project-financing-quota.api.ts",
      name: "requestProjectFinancingQuotaWithUpload"
    }]);
    expect(apiSource).toContain("uploadProjectFinancingQuotaAttachment");
    expect(apiSource).toContain('apiFetch("/files"');
    expect(apiSource).not.toContain('from "./core-flow-read.api"');
    expect(apiSource).not.toContain("globalRoleKeys");
  });
});
