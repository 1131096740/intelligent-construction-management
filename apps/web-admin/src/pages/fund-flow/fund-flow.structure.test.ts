import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  fileURLToPath(new URL("./FundFlowPage.vue", import.meta.url)),
  "utf8"
);
const routes = readFileSync(
  fileURLToPath(new URL("../../routes/route-records.ts", import.meta.url)),
  "utf8"
);
const navigation = readFileSync(
  fileURLToPath(new URL("../../app/business-navigation.ts", import.meta.url)),
  "utf8"
);

describe("FND-23 fund flow page", () => {
  it("filters by project, company, date and type and shows running balance", () => {
    expect(source).toContain("资金流水");
    expect(source).toContain("选择项目");
    expect(source).toContain("资金主体");
    expect(source).toContain("开始日期");
    expect(source).toContain("结束日期");
    expect(source).toContain("全部类型");
    for (const label of ["到账", "付款", "转入", "转出", "退款"]) {
      expect(source).toContain(label);
    }
    expect(source).toContain("余额（元）");
    expect(source).toContain("balanceAfterCents");
    expect(source).toContain("查看原记录");
    expect(source).toContain("downloadFundFlowExport");
  });

  it("is registered as a dedicated route and navigation entry", () => {
    expect(routes).toContain('path: "资金流水"');
    expect(routes).toContain('import("../pages/fund-flow/FundFlowPage.vue")');
    expect(routes).toContain("fundFlowRoleKeys");
    expect(navigation).toContain('path: "/资金流水"');
  });
});
