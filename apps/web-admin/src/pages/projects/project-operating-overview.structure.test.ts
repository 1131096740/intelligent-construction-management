import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  fileURLToPath(new URL("./ProjectOperatingOverviewPage.vue", import.meta.url)),
  "utf8"
);

describe("project operating overview structure", () => {
  it("keeps the default page on a read-only project overview and separates funds handling", () => {
    expect(source).toContain('label="项目概览"');
    expect(source).toContain('label="资金办理"');
    expect(source).toContain("canReadProjectExpenseLedger || canCreateProjectExpense");
    expect(source).toContain('v-model="activeTab"');
  });

  it("separates overview, expense-ledger and expense-create capabilities", () => {
    expect(source).toContain("canReadProjectOverview.value\n        ? fetchProjectOperatingOverview(projectId)");
    expect(source).toContain("canReadProjectExpenseLedger.value\n        ? fetchProjectExpenseRequests(projectId");
    expect(source).toContain("const canCreateProjectExpense = computed");
    expect(source).toContain('v-if="canCreateProjectExpense"');
    expect(source).toContain("auth.user?.globalRoleKeys.some");
  });

  it("retires the legacy one-step proxy payment form in favor of the governed fact chain", () => {
    expect(source).toContain('label="挂靠业务接管"');
    expect(source).toContain("<AffiliateCompanyContractPanel");
    expect(source).toContain("<AffiliateBusinessLedgerPanel");
    expect(source).not.toContain("recordProjectProxyPayment");
    expect(source).not.toContain("submitProxyPayment");
    expect(source).not.toContain("总包代付登记");
  });

  it("uses the existing TDesign project selector and maintenance disclosure", () => {
    expect(source).toContain("<t-select");
    expect(source).toContain("<t-collapse");
    expect(source).toContain("项目维护");
  });

  it("separates upstream owner payments, company remittances, deductions, and unresolved differences", () => {
    expect(source).toContain('value="owner_payment_to_affiliate"');
    expect(source).toContain('value="affiliate_remittance_to_company"');
    expect(source).toContain('value="affiliate_deduction"');
    expect(source).toContain('value="unreconciled_receipt_difference"');
    expect(source).toContain('value="written"');
    expect(source).toContain('value="oral"');
    expect(source).toContain("recordProjectUpstreamFundFact");
    expect(source).toContain("confirmProjectUpstreamFundFact");
    expect(source).toContain("<SensitiveActionDialog");
    expect(source).not.toContain("recordProjectReceipt");
    expect(source).not.toContain('value="owner_direct_payment"');
  });

  it("routes pilot projects away from the legacy spot-purchase create option", () => {
    expect(source).toContain("fetchSpotProcurementCapabilities");
    expect(source).toContain("visibleExpenseTypeOptions");
    expect(source).toContain('option.value !== "spot_purchase"');
    expect(source).toContain("spotCapability.enabled");
  });

  it("treats an unsubmitted expense form as local state and guards discarding it", () => {
    expect(source).toContain("useUnsavedChangesGuard");
    expect(source).toContain("expenseFormDirty");
    expect(source).toContain("放弃填写");
    expect(source).toContain("<SensitiveActionDialog");
    expect(source).toContain("不会创建、删除或修改任何后端业务记录");
    expect(source).not.toContain("deleteProjectExpense");
  });

  it("guards project and tab switches before replacing an unfinished expense form", () => {
    expect(source).toContain("const previousProjectId = loadedProjectId.value");
    expect(source).toContain("selectedProjectId.value = previousProjectId");
    expect(source).toContain("if (projectSwitching.value)");
    expect(source).toContain("projectSwitching.value = true");
    expect(source).toContain("await expenseLeaveGuard.requestClose()");
    expect(source).toContain("if (!confirmed) return");
    expect(source).toContain("async function handleOperatingTabChange");
    expect(source).toContain('@change="handleOperatingTabChange"');
  });

  it("never lets capability refresh silently clear a dirty legacy purchase form", () => {
    expect(source).toContain('expenseForm.value.expenseType === "spot_purchase" &&');
    expect(source).toContain("!expenseFormDirty.value");
    expect(source).toContain('expenseForm.value = createProjectExpenseForm("sporadic_payment")');
    expect(source).toContain("syncExpenseFormBaseline()");
  });

  it("separates formal and ended expense records without inventing a persisted draft view", () => {
    expect(source).toContain('value="formal_ledger"');
    expect(source).toContain('value="ended"');
    expect(source).toContain("项目支出提交即进入审批");
    expect(source).toContain("fetchProjectExpenseRequests(projectId, {");
    expect(source).toContain("<t-pagination");
    expect(source).toContain('@current-change="changeExpenseLedgerPage"');
    expect(source).toContain("projectExpenses.value?.statistics");
    expect(source).toContain("正式支出单");
    expect(source).toContain(
      "['approval_pending', 'approved_pending_payment', 'partially_paid'].includes"
    );
    expect(source).not.toContain('value="my_drafts"');
    expect(source).not.toContain('value="returned_for_revision"');
  });

  it("routes actual project-expense payment to governed detail instead of keeping a local execution form", () => {
    expect(source).toContain("openExpenseApprovalDetail(selectedExpenseRow)");
    expect(source).not.toContain("canRecordExpenseExecution");
    expect(source).not.toContain("submitExpenseExecution");
    expect(source).not.toContain("recordProjectExpenseExecution");
    expect(source).not.toContain("executionVoucherFile");
    expect(source).not.toContain("expenseExecutionVoucherInput");
  });
});
