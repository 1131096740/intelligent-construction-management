import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const detail = readFileSync(new URL("./ContractDetailPage.vue", import.meta.url), "utf8");
const ledger = readFileSync(new URL("./ContractListPage.vue", import.meta.url), "utf8");
const signedChanges = readFileSync(new URL("./SignedContractChanges.vue", import.meta.url), "utf8");
const workbench = readFileSync(new URL("./ContractWorkbenchPage.vue", import.meta.url), "utf8");
const draft = readFileSync(new URL("./workbench/use-contract-draft.ts", import.meta.url), "utf8");

describe("contract change Web closure", () => {
  it("opens one signed supplement workflow from the formal ledger and effective contract", () => {
    expect(ledger).toContain('@click="openDetail(row.id, undefined, true)"');
    expect(detail).toContain('<SignedContractChanges');
    expect(detail).toContain(':version-id="contractDetail.contractVersionId"');
    expect(detail).not.toContain("createContractChangeDraftWithCapability");
    expect(signedChanges).toContain("补充/变更");
    expect(signedChanges).toContain("提交合同部主管复核");
    expect(workbench).toContain("补充协议（历史）");
  });

  it("uses server capabilities separately for submitting and reviewing the current supplement", () => {
    expect(signedChanges).toContain("fetchSignedContractChanges(versionId)");
    expect(signedChanges).toContain("details?.canSubmit");
    expect(signedChanges).toContain("detail.value?.canReview");
    expect(signedChanges).toContain("reviewSignedContractChange(row.baseVersionId, row.id,");
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
    expect(workbench).toContain("const receipt = authoritySnapshot.value?.workbench;");
    const loadExistingSource = workbench.slice(
      workbench.indexOf("async function loadExisting()"),
      workbench.indexOf("function contractWorkbenchLoadContextCurrent")
    );
    const exactVersionMismatch = loadExistingSource.slice(
      loadExistingSource.indexOf(
        "message.includes(\"响应版本与请求版本不一致\")"
      ),
      loadExistingSource.indexOf(
        "errorMessage.value = formatUnknownApiError(error, \"工作台加载失败\")"
      )
    );
    expect(exactVersionMismatch).toContain("clearAuthoritySnapshot();");
    const loadExpectedWorkbenchSource = workbench.slice(
      workbench.indexOf("async function loadExpectedWorkbench"),
      workbench.indexOf("function returnToContractDetail()")
    );
    const authoritySnapshotMismatch = loadExpectedWorkbenchSource.slice(
      loadExpectedWorkbenchSource.indexOf("!snapshot ||"),
      loadExpectedWorkbenchSource.indexOf("throw new Error(exactVersionError.value)")
    );
    expect(authoritySnapshotMismatch).toContain(
      "snapshot.contractVersionId !== expectedVersionId"
    );
    expect(authoritySnapshotMismatch).toContain("clearAuthoritySnapshot();");
    expect(workbench).toContain("@click=\"returnToContractDetail\"");
    expect(workbench).toContain("v-if=\"workbench && !exactVersionError && isChangeVersion\"");
  });

  it("inherits amount limit and never resubmits immutable payment rules for a change", () => {
    expect(workbench).toContain("initializeDraft.amountLimitType.value");
    expect(draft).toContain("amountLimitType: initAmountLimitType.value");
    expect(draft).toContain("const paymentTerms = isChangeDraft");
    expect(draft).toContain('section !== "payment_terms"');
    expect(workbench).toContain(":disabled=\"editorDisabled || isChangeVersion\"");
  });

  it("shows structured archive replacement facts only for the current pending effect", () => {
    expect(detail).toContain("normalizedChangeVersions.value[0]");
    expect(detail).toContain("action.key === \"confirm_archive\" && action.enabled");
    expect(detail).toContain("version?.archiveEffect?.status === \"pending\"");
    expect(detail).toContain("合同变更归档生效确认");
    expect(detail).toContain("历史结算和付款继续引用原合同版本，不会被改写");
    expect(detail).toContain("archiveEffectText(version)");
  });

  it("shows original, changed and current values without converting four decimal input to cents", () => {
    expect(signedChanges).toContain("原合同金额");
    expect(signedChanges).toContain("当前合同金额");
    expect(signedChanges).toContain("变更后金额");
    expect(signedChanges).toContain("normalizeBusinessAmount(delta.value.trim(), { allowNegative: true })");
    expect(signedChanges).toContain("signedChangeBalanceWarning(detail.value, delta.value)");
    expect(signedChanges).toContain("balanceWarning.message");
    expect(signedChanges).toContain("submitSignedContractChange(details.baseVersionId, {");
    expect(signedChanges).toContain("...(paymentAgreementText ? { paymentAgreementText } : {})");
  });
});
