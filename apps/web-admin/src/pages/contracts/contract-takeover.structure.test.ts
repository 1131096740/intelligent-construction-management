import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync(new URL("./ContractTakeoverPage.vue", import.meta.url), "utf8");
const taxPanel = readFileSync(
  new URL("./components/ContractTaxFactReviewPanel.vue", import.meta.url),
  "utf8"
);
const contractSidePanel = readFileSync(
  new URL("./components/ContractTakeoverContractSidePanel.vue", import.meta.url),
  "utf8"
);
const financeSidePanel = readFileSync(
  new URL("./components/ContractTakeoverFinanceSidePanel.vue", import.meta.url),
  "utf8"
);
const confirmationCard = readFileSync(
  new URL("./components/ContractTakeoverDualConfirmationCard.vue", import.meta.url),
  "utf8"
);
const correctionPanel = readFileSync(
  new URL("./components/ContractTakeoverCorrectionPanel.vue", import.meta.url),
  "utf8"
);

describe("historical takeover unsaved-change governance", () => {
  it("opens a dedicated ledger deep link without falling back to the first project", () => {
    expect(page).toContain("useRoute");
    expect(page).toContain("contractTakeoverRouteSelection(route.query)");
    expect(page).toContain("await selectTakeover(requestedTakeover)");
    expect(page).toContain("if (requestedSelection && !requestedProject)");
    expect(page).toContain("selectedProjectId.value = \"\"");
    expect(page).toContain("takeovers.value = []");
    expect(page).toContain("return");
    expect(page).toContain("takeoverSelectionRequestOwner.begin(projectId, takeover.id)");
    expect(page).toContain("if (!selectionRequestCurrent(true)) return");
    expect(page).toContain("requestGeneration === takeoverListRequestGeneration");
    expect(page).toContain("if (!requestCurrent()) return");
    expect(page).toContain("changeGeneration === projectChangeGeneration");
    expect(page).toContain("if (!changeCurrent()) return");
  });

  it("protects route, project, record and form-close transitions", () => {
    expect(page).toContain("useUnsavedChangesGuard");
    expect(page).toContain("takeoverLeaveGuard.requestClose()");
    expect(page).toContain('@change="changeProject"');
    expect(page).toContain("async function cancelEdit()");
    expect(page).toContain("放弃未保存的接管修改？");
  });

  it("includes unsaved tax-revision edits in the parent page guard", () => {
    expect(page).toContain('@dirty-change="taxFactDirty = $event"');
    expect(taxPanel).toContain('"dirty-change": [dirty: boolean]');
    expect(taxPanel).toContain('watch(isDirty, (dirty) => emit("dirty-change", dirty)');
    expect(taxPanel).toContain("已保留当前填写内容");
  });
});

describe("historical takeover review recovery", () => {
  it("removes the legacy confirmation dialog and keeps supplement return", () => {
    expect(page).not.toContain("confirmSelectedTakeover");
    expect(page).not.toContain('v-model:visible="confirmVisible"');
    expect(page).toContain('v-model="supplementReturnVisible"');
    expect(page).toContain("returnContractTakeoverForSupplement");
    expect(page).toContain("退回补充");
  });

  it("defaults new takeover responsibility to the signed-in initiator", () => {
    expect(page).toContain("takeoverResponsibleUserOptions");
    expect(page).toContain('responsibleUserId: auth.user?.id ?? ""');
  });

  it("gives finance a dedicated payment-voucher handoff without takeover editing authority", () => {
    expect(page).toContain("canUploadHistoricalPaymentVouchers");
    expect(page).toContain("attachHistoricalPaymentVoucher");
    expect(page).toContain("仅可补充付款凭证；不能编辑接管事实、提交复核或确认接管。");
    expect(page).toContain("请由接管责任人核对后重新提交复核");
  });
});

describe("historical takeover dual department workspace", () => {
  it("renders four focused panels on the same detail page", () => {
    expect(page).toContain("<ContractTakeoverContractSidePanel");
    expect(page).toContain("<ContractTakeoverFinanceSidePanel");
    expect(page).toContain("<ContractTakeoverDualConfirmationCard");
    expect(page).toContain("<ContractTakeoverCorrectionPanel");
    expect(contractSidePanel).toContain("合同侧修订");
    expect(financeSidePanel).toContain("财务侧修订");
    expect(confirmationCard).toContain("双部门确认");
    expect(correctionPanel).toContain("改前");
    expect(correctionPanel).toContain("差额");
    expect(correctionPanel).toContain("改后");
  });

  it("uses independent two-second autosave paths and preserves basis conflicts", () => {
    expect(page).toContain("scheduleContractSideSave");
    expect(page).toContain("scheduleFinanceSideSave");
    expect(page).toContain("2_000");
    expect(page).toContain("财务依据已过期");
    expect(page).toContain("已保留当前财务侧输入");
  });
});
