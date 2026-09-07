import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const page = readFileSync(
  resolve(__dirname, "GlobalInvoiceWorkbenchPage.vue"),
  "utf8"
);

describe("全局发票与清分分配工作台", () => {
  it("通过业务选择和私有附件上传完成录入，不要求用户输入内部编号", () => {
    expect(page).toContain("fetchGlobalInvoices");
    expect(page).toContain("fetchActiveCompanyEntities");
    expect(page).toContain("fetchClearingCases");
    expect(page).toContain("uploadPrivateFile");
    expect(page).toContain("<t-select v-model=\"invoiceForm.owningCompanyEntityId\"");
    expect(page).toContain("<t-upload");
    expect(page).not.toContain("我方公司主体编号");
    expect(page).not.toContain("私有附件编号");
    expect(page).not.toContain("全局发票编号");
    expect(page).not.toContain("清分案件编号");
  });

  it("通过 TDesign 二次确认提交敏感命令并携带后端确认与当前 revision", () => {
    expect(page).toContain("<t-dialog");
    expect(page).toContain("confirmVoid: true");
    expect(page).toContain("confirmRed: true");
    expect(page).toContain("confirmReissue: true");
    expect(page).toContain("confirmReversal: true");
    expect(page).toContain("confirmRepair: true");
    expect(page).toMatch(/expectedRevision:\s*selected[^,}\n]*\.revision/u);
    expect(page).toContain("fetchGlobalInvoiceEvidenceRepairImpacts");
    expect(page).toContain("resolveGlobalInvoiceEvidenceRepairImpact");
  });

  it("uses server capabilities, the shared route role helper and design tokens without local role duplication", () => {
    expect(page).toContain("fetchGlobalInvoiceCapabilities");
    expect(page).toContain("fetchClearingCapabilities");
    expect(page).not.toMatch(/roleKeys|finance_staff|finance_director/u);
    expect(page).toContain("var(--jg-");
    expect(page).not.toMatch(/max-width:\s*1200px|padding:\s*24px|gap:\s*16px|gap:\s*12px|minmax\(220px/u);
  });

  it("shows stale-revision recovery and derived evidence-repair state in business Chinese", () => {
    expect(page).toContain("发票版本已变化，请刷新后重试");
    expect(page).toContain("待修复");
    expect(page).toContain("已解决");
    expect(page).toContain("部分解决不会清除其他待修复事项");
  });
});
