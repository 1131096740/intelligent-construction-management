import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const detail = readFileSync(new URL("./ContractDetailPage.vue", import.meta.url), "utf8");
const workbench = readFileSync(new URL("./ContractWorkbenchPage.vue", import.meta.url), "utf8");
const draft = readFileSync(new URL("./workbench/use-contract-draft.ts", import.meta.url), "utf8");

describe("contract change Web closure", () => {
  it("creates only after a fresh eligibility check and carries the expected version coordinate", () => {
    expect(detail).toContain("fetchContractChangeEligibility(capturedBaseVersionId)");
    expect(detail).toContain("latest.currentEffective?.id !== capturedBaseVersionId");
    expect(detail).toContain("created.baseVersionId !== capturedBaseVersionId");
    expect(detail).toContain("if (!submissionIsCurrent()) return");
    expect(detail).toContain("workbench?versionId=${created.id}");
  });

  it("renders backend route/history and fails closed around change policy", () => {
    expect(detail).toContain("contractChangeVersions");
    expect(detail).toContain("approvalRouteLabel(version.approvalRoute)");
    expect(workbench).toContain("contractChangePolicyView(workbench.value)");
    expect(workbench).toContain("当前后端未返回有效变更白名单");
    expect(workbench).toContain(":editable-keys=\"isChangeVersion ? changePolicy.editableFieldKeys : undefined\"");
    expect(workbench).toContain(":editable-keys=\"isChangeVersion ? changePolicy.editableClauseKeys : undefined\"");
  });

  it("fails visibly and clears the stale workbench on an exact-version mismatch", () => {
    expect(workbench).toContain("v-if=\"exactVersionError\"");
    expect(workbench).toContain("工作台返回的合同版本与刚创建的变更草稿不一致");
    expect(workbench).toContain("workbench.value = null");
    expect(workbench).toContain("@click=\"returnToContractDetail\"");
    expect(workbench).toContain("v-if=\"workbench && !exactVersionError && isChangeVersion\"");
  });

  it("inherits amount limit and never resubmits immutable payment rules for a change", () => {
    expect(workbench).toContain("initializeDraft.amountLimitType.value");
    expect(draft).toContain("amountLimitType: initAmountLimitType.value");
    expect(draft).toContain("...(!isChangeDraft");
    expect(workbench).toContain(":disabled=\"!editable || isChangeVersion\"");
  });

  it("shows structured archive replacement facts only for the current pending effect", () => {
    expect(detail).toContain("normalizedChangeVersions.value[0]");
    expect(detail).toContain("action.key === \"confirm_archive\" && action.enabled");
    expect(detail).toContain("version?.archiveEffect?.status === \"pending\"");
    expect(detail).toContain("合同变更归档生效确认");
    expect(detail).toContain("历史结算和付款继续引用原合同版本，不会被改写");
    expect(detail).toContain("archiveEffectText(version)");
  });
});
