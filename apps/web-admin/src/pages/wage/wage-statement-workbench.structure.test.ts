import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const page = readFileSync(new URL("./WageStatementWorkbenchPage.vue", import.meta.url), "utf8");
const api = readFileSync(new URL("../../api/wage-statement.api.ts", import.meta.url), "utf8");
const routes = readFileSync(new URL("../../routes/route-records.ts", import.meta.url), "utf8");

describe("工资承担工作台非敏感入口", () => {
  it("keeps exactly one monthly entry and provides aggregate detail plus source preview", () => {
    expect(routes).toContain('path: "/工资承担工作台"');
    expect(routes).toContain('path: "工资承担工作台"');
    expect(routes).toContain('import("../pages/wage/WageStatementWorkbenchPage.vue")');
    expect(page).toContain('title="历史工资承担"');
    expect(page).toContain("来源导入预览");
    expect(page).toContain("月度汇总详情");
    expect(api).toContain("/wage-statements/workbench?page=");
    expect(page).toContain("<t-pagination");
    expect(page).toContain('@current-change="changePage"');
    expect(api).toContain("/summary");
    expect(api).toContain("/import-preview");
  });

  it("does not render person names, money, attachments, or raw sensitive payloads", () => {
    const template = page.slice(page.indexOf("<template>"));
    for (const forbidden of [
      "employeeName",
      "personName",
      "amountCents",
      "approvedAmount",
      "附件",
      "evidenceFileId",
      "sourceSnapshot",
      "employmentSnapshot"
    ]) {
      expect(template).not.toContain(forbidden);
      expect(api).not.toContain(forbidden);
    }
  });
});
