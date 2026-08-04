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
const coreFlowApiSource = readFileSync(
  new URL("../../api/core-flow-read.api.ts", import.meta.url),
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

describe("project financing quota F0/F1/F2 workbench", () => {
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
    expect(apiSource).toContain("financing-quotas/file-uploads");
    expect(apiSource).toContain("encodeURIComponent(projectId)");
    expect(apiSource).not.toContain('apiFetch("/files"');
    expect(apiSource).not.toContain('from "./core-flow-read.api"');
    expect(apiSource).not.toContain("globalRoleKeys");
  });

  it("shows F2 review controls only from the exact server-derived approval action", () => {
    expect(panelSource).toContain("row.reviewAction");
    expect(apiSource).toContain('action.key === "review_financing_quota"');
    expect(apiSource).toContain('action.requiredAction === "project.financing_quota.approve"');
    expect(apiSource).toContain("action.requiresPassword === true");
    expect(panelSource).toContain("selectedFinancingQuotaReviewAction");
    expect(panelSource).toContain(
      "freshCapability.reviewAction"
    );
    expect(panelSource).not.toContain("auth.user");
    expect(panelSource).not.toContain("globalRoleKeys");
  });

  it("uses a password-confirmed TDesign review dialog with an explicit independent self-review explanation", () => {
    const reviewDialogStart = panelSource.indexOf('v-if="reviewArmed');
    const reviewDialogSource = panelSource.slice(
      reviewDialogStart,
      panelSource.indexOf("</t-dialog>", reviewDialogStart)
    );

    expect(panelSource).toContain("确认通过垫资额度审批");
    expect(panelSource).toContain("确认驳回垫资额度审批");
    expect(panelSource).toContain("当前登录密码");
    expect(panelSource).toContain("本人独立复核说明");
    expect(panelSource).toContain("reviewContext.requiresSelfReviewConfirmation");
    expect(panelSource).toContain('@click="submitApproveReview"');
    expect(panelSource).toContain('@click="submitRejectReview"');
    expect(panelSource).toContain('decision: "approve"');
    expect(panelSource).toContain('decision: "reject"');
    expect(panelSource).not.toContain("fetch(");
    expect(reviewDialogSource).not.toContain('maxlength="500"');
    expect(panelSource).toContain("Array.from(comment).length > 500");
    expect(panelSource).toContain("Array.from(selfReviewReason).length > 500");
  });

  it("uses the dedicated fresh-preflight wrapper and removes the orphan core-flow review transport", () => {
    expect(panelSource).toContain("fetchProjectFinancingQuotaReviewCapability");
    expect(panelSource).toContain("executeProjectFinancingQuotaReviewAction");
    expect(apiSource).toContain("reviewProjectFinancingQuotaWithPreflight");
    expect(apiSource).not.toContain(
      "export function reviewProjectFinancingQuotaWithPreflight"
    );
    expect(apiSource).toContain("preflightVerified");
    expect(apiSource).toContain("expectedLifecycleToken");
    expect(apiSource).toContain("businessReceipt");
    expect(apiSource).toContain("reviewPromise");
    expect(coreFlowApiSource).not.toContain("reviewProjectFinancingQuota");
    expect(coreFlowApiSource).not.toContain("ReviewProjectFinancingQuotaPayload");
  });

  it("reads the F2 review capability from a direct strict single-target server request", () => {
    const reviewCapabilitySource = apiSource.slice(
      apiSource.indexOf(
        "export async function fetchProjectFinancingQuotaReviewCapability"
      ),
      apiSource.indexOf(
        "function reviewProjectFinancingQuotaWithPreflight"
      )
    );

    expect(reviewCapabilitySource).toContain("await apiFetch(");
    expect(reviewCapabilitySource).toContain("normalizedQuotaId");
    expect(reviewCapabilitySource).toContain(
      "/review-capability`"
    );
    expect(reviewCapabilitySource).toContain("response.clone().text()");
    expect(reviewCapabilitySource).toContain("isReviewCapabilityReadModel");
    expect(reviewCapabilitySource).not.toContain(
      "fetchProjectFinancingQuotaWorkbench(projectId)"
    );
  });

  it("freezes one F2 UUID attempt and isolates review callbacks on project switch or unmount", () => {
    expect(panelSource).toContain("actionId: crypto.randomUUID()");
    expect(panelSource).toContain("reviewContextIsCurrent");
    expect(panelSource).toContain("reviewExecutionState");
    expect(apiSource).toContain("if (state.promise) return state.promise");
    expect(panelSource).toContain("projectGeneration");
    expect(panelSource).toContain("onBeforeUnmount");
  });

  it("keeps the selected F2 capability readonly and out of escaping callbacks", () => {
    const scriptSource = panelSource.slice(panelSource.indexOf("<script setup"));
    expect(
      scriptSource.match(/selectedFinancingQuotaReviewAction\.value/gu)
    ).toHaveLength(2);
    expect(scriptSource).toContain(
      "selectedFinancingQuotaReviewAction.value =\n      freshCapability.reviewAction"
    );
    expect(scriptSource).toContain(
      "selectedFinancingQuotaReviewAction.value = null"
    );
  });

  it("registers F3 manual termination through the dedicated canonical executor", () => {
    const registration = pageActionRegistry.actions.find(
      (action) => action.id === "project-financing-quota.terminate"
    );

    expect(registration?.trigger).toEqual({
      element: "t-button",
      event: "click",
      handler: "submitTermination"
    });
    expect(registration?.capability).toEqual({
      kind: "detail_action",
      source: "selectedFinancingQuotaTerminationAction"
    });
    expect(registration?.wrappers).toEqual([{
      apiFile: "apps/web-admin/src/api/project-financing-quota.api.ts",
      name: "executeProjectFinancingQuotaTerminationAction"
    }]);
    expect(coreFlowApiSource).not.toContain("terminateProjectFinancingQuota");
    expect(coreFlowApiSource).not.toContain(
      "TerminateProjectFinancingQuotaPayload"
    );
  });

  it("uses a strict fresh F3 termination capability and a password-confirmed danger dialog", () => {
    expect(panelSource).toContain("row.terminateAction");
    expect(panelSource).toContain("fetchProjectFinancingQuotaTerminationCapability");
    expect(panelSource).toContain("executeProjectFinancingQuotaTerminationAction");
    expect(panelSource).toContain("selectedFinancingQuotaTerminationAction");
    expect(panelSource).toContain(
      'freshCapability.terminateAction.key !== "terminate_financing_quota"'
    );
    expect(panelSource).toContain(
      'freshCapability.terminateAction.kind !== "danger"'
    );
    expect(panelSource).toContain(
      'freshCapability.terminateAction.requiredAction !==\n        "project.financing_quota.terminate"'
    );
    expect(panelSource).not.toContain(
      "terminateActionEnabled(freshCapability.terminateAction)"
    );
    expect(panelSource).toContain("确认终止垫资额度");
    expect(panelSource).toContain("当前已占用");
    expect(panelSource).toContain("当前剩余额度");
    expect(panelSource).toContain(
      "不删除、不释放、不重排既有资金使用和冲正历史"
    );
    expect(panelSource).toContain("Array.from(reason).length > 500");
    expect(panelSource).not.toContain("auth.user");
    expect(panelSource).not.toContain("fetch(");

    const capabilitySource = apiSource.slice(
      apiSource.indexOf(
        "export async function fetchProjectFinancingQuotaTerminationCapability"
      ),
      apiSource.indexOf(
        "function terminateProjectFinancingQuotaWithPreflight"
      )
    );
    expect(capabilitySource).toContain("/termination-capability`");
    expect(capabilitySource).toContain("response.clone().text()");
    expect(capabilitySource).toContain("isTerminationCapabilityReadModel");
    expect(apiSource).not.toContain(
      "export function terminateProjectFinancingQuotaWithPreflight"
    );
    expect(apiSource).toContain("expectedLifecycleToken");
    expect(apiSource).toContain("terminationPromise");
    expect(apiSource).toContain("businessReceipt");
  });

  it("isolates F3 late work and accepts the changed terminated authority row without clearing usage history", () => {
    expect(panelSource).toContain("terminationContextIsCurrent");
    expect(panelSource).toContain("terminationExecutionState");
    expect(panelSource).toContain("projectGeneration");
    expect(panelSource).toContain("onBeforeUnmount");
    expect(apiSource).toContain('row.status !== "terminated"');
    expect(panelSource).toContain("usageGroups");
    expect(apiSource).not.toContain("row.usageGroups = []");
    expect(apiSource).toContain("if (state.promise) return state.promise");
  });
});
