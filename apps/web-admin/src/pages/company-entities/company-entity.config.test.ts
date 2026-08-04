import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  companyEntityActionLabel,
  companyEntityCapabilities,
  companyEntityDataStatusLabel,
  companyEntityFieldChanges,
  companyEntityRoleLabel,
  companyEntityWritableFields,
  createCompanyEntityRequestGate,
  createCompanyEntitySubmitGuard
} from "./company-entity.config";

const pageSource = readFileSync(new URL("./CompanyEntityListPage.vue", import.meta.url), "utf8");
const formSource = readFileSync(new URL("./components/CompanyEntityFormDrawer.vue", import.meta.url), "utf8");
const historySource = readFileSync(new URL("./components/CompanyEntityHistoryDrawer.vue", import.meta.url), "utf8");
const settingsSource = readFileSync(new URL("../settings/SettingsPage.vue", import.meta.url), "utf8");

describe("company entity ledger configuration", () => {
  it("derives capabilities from company-global roles only", () => {
    expect(companyEntityCapabilities(["comprehensive_director"])).toEqual({ canRead: true, canMaintain: true });
    expect(companyEntityCapabilities(["contract_staff"])).toEqual({ canRead: true, canMaintain: true });
    expect(companyEntityCapabilities(["contract_director"])).toEqual({ canRead: true, canMaintain: true });
    expect(companyEntityCapabilities(["finance_staff"])).toEqual({ canRead: true, canMaintain: false });
    expect(companyEntityCapabilities(["finance_director"])).toEqual({ canRead: true, canMaintain: false });
    expect(companyEntityCapabilities(["chairman"])).toEqual({ canRead: true, canMaintain: false });
    expect(companyEntityCapabilities(["general_manager"])).toEqual({ canRead: true, canMaintain: false });
    expect(companyEntityCapabilities(["super_admin"])).toEqual({ canRead: false, canMaintain: false });
    expect(companyEntityCapabilities([])).toEqual({ canRead: false, canMaintain: false });
  });

  it("limits the write model to the three approved facts", () => {
    expect(companyEntityWritableFields).toEqual([
      "name",
      "unifiedSocialCreditCode",
      "registeredAddress"
    ]);
    expect(formSource).toContain('label="公司全称"');
    expect(formSource).toContain('label="统一社会信用代码"');
    expect(formSource).toContain('label="注册地址"');
    expect(formSource).not.toMatch(/法定代表人|联系电话|银行账户|公章图片|营业执照附件|备注/);
  });

  it("provides Chinese action, role, status and adjacent-version change labels", () => {
    expect(companyEntityActionLabel("legacy_backfill")).toBe("历史资料建档");
    expect(companyEntityActionLabel("disable")).toBe("停用");
    expect(companyEntityRoleLabel("contract_director")).toBe("合同部主管");
    expect(companyEntityDataStatusLabel("legacy_incomplete")).toBe("资料待补全");
    expect(companyEntityFieldChanges(
      { name: "新公司", unifiedSocialCreditCode: "91350211M000100Y46", registeredAddress: null, isActive: false },
      { name: "旧公司", unifiedSocialCreditCode: "91350211M000100Y46", registeredAddress: "原地址", isActive: true }
    )).toEqual([
      { label: "公司全称", before: "旧公司", after: "新公司" },
      { label: "注册地址", before: "原地址", after: "未填写" },
      { label: "启停状态", before: "启用", after: "停用" }
    ]);
  });

  it("uses the governed responsive ledger and approved components", () => {
    expect(pageSource).toContain("jg-responsive-ledger");
    expect(pageSource).toContain("jg-table-region");
    expect(pageSource).toContain(':horizontal-scroll-affixed-bottom="true"');
    expect(pageSource).toContain('fixed: "right"');
    expect(pageSource).toContain("<BusinessPageHeader");
    expect(pageSource).toContain("<BusinessTableToolbar");
    expect(pageSource).toContain('appearance="plain"');
    expect(pageSource).toContain("<BusinessFeedback");
    expect(pageSource).toContain("上线准备期间暂为只读");
    expect(pageSource).not.toContain("<SensitiveActionDialog");
    expect(pageSource).not.toContain("<CompanyEntityFormDrawer");
    expect(pageSource).not.toMatch(/overflow-x\s*:|100vw|min-width\s*:\s*[89]\d{2}px|min-width\s*:\s*\d{4,}px/);
  });

  it("keeps only read and history actions during the stage D isolation", () => {
    expect(pageSource).toContain("查看历史");
    expect(pageSource).not.toMatch(/openCreate|openEdit|openStatus|confirmStatus/);
    expect(pageSource).not.toMatch(/\bcreateCompanyEntity\(|updateCompanyEntityStatus/);
    expect(pageSource).not.toContain("<t-link");
    expect(historySource).toContain("item.actorName");
    expect(historySource).toContain('title="暂无历史版本"');
    expect(historySource).not.toContain("actorUserId");
    expect(`${pageSource}${historySource}`).not.toMatch(/导出|exportCompany|回滚|删除/);
  });

  it("discards stale or invalidated request tokens across query and entity changes", () => {
    const gate = createCompanyEntityRequestGate();
    const first = gate.begin("inactive:旧查询");
    const second = gate.begin("active:新查询");
    const applied: string[] = [];

    if (gate.isCurrent(second, "active:新查询")) applied.push("新结果");
    if (gate.isCurrent(first, "inactive:旧查询")) applied.push("旧结果");

    expect(applied).toEqual(["新结果"]);
    expect(gate.isCurrent(first, "inactive:旧查询")).toBe(false);
    expect(gate.isCurrent(second, "active:新查询")).toBe(true);
    expect(gate.isCurrent(second, "inactive:界面已变更")).toBe(false);

    gate.invalidate();
    expect(gate.isCurrent(second, "active:新查询")).toBe(false);
  });

  it("allows only one submit until the active write releases its guard", () => {
    const guard = createCompanyEntitySubmitGuard();

    expect(guard.tryStart()).toBe(true);
    expect(guard.tryStart()).toBe(false);
    guard.finish();
    expect(guard.tryStart()).toBe(true);
    expect(formSource).toMatch(/async function save\(\) \{\n {2}if \(saving\.value\) return;/);
  });

  it("removes the obsolete settings entry while preserving account and signature settings", () => {
    expect(settingsSource).toContain('title="我的账号"');
    expect(settingsSource).toContain('title="个人签名"');
    expect(settingsSource).not.toContain('title="公司主体字典"');
    expect(settingsSource).not.toMatch(/companyEntities|entityForm|submitEntity|createCompanyEntity|fetchCompanyEntities/);
  });
});
