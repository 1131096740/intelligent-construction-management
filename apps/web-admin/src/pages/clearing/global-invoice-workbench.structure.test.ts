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
});
