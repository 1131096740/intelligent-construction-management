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
    expect(page).toContain("月度工资承担工作台");
    expect(page).toContain("来源导入预览");
    expect(page).toContain("月度汇总详情");
    expect(api).toContain('"/wage-statements/workbench"');
    expect(api).toContain("/summary");
    expect(api).toContain("/import-preview");
    expect(api).toContain('"/wage-statements/approved-sources"');
    expect(api).toContain('"/wage-statements/drafts"');
    expect(api).toContain('"submit"');
    expect(api).toContain('"return"');
    expect(api).toContain('"confirm"');
  });

  it("binds every lifecycle write affordance to server-issued capability fields", () => {
    for (const capability of ["canSubmit", "canReturn", "canConfirm"]) {
      expect(page).toContain(`activeCapabilities.value.${capability}`);
      expect(api).toContain(capability);
    }
    expect(page).not.toContain("roleKeys");
    expect(page).not.toContain("canPerform(");
  });

  it("performs a fresh server capability read before each registered wage write", () => {
    expect(api).toContain('"/wage-statements/capabilities"');
    expect(page).toContain("fetchWageStatementCapabilities");
    for (const handler of [
      "createImportedDraftWithCapability",
      "submitWageStatementWithCapability",
      "returnWageStatementWithCapability",
      "confirmWageStatementWithCapability"
    ]) {
      expect(page).toContain(`async function ${handler}`);
    }
    expect(page).toContain("const capability = await fetchWageStatementCapabilities()");
    expect(page).toContain("capability.canPrepare");
    expect(page).toContain("capability.canSubmit");
    expect(page).toContain("capability.canReturn");
    expect(page).toContain("capability.canConfirm");
  });

  it("reuses a pending UUIDv4 command key after uncertain failures, but clears it after success or a known 4xx rejection", () => {
    expect(page).toContain("const pendingCommandKeys = new Map<string, string>();");
    expect(page).toContain("pendingCommandKeys.get(commandKey) ?? crypto.randomUUID()");
    expect(page).toContain("pendingCommandKeys.set(commandKey, idempotencyKey)");
    expect(page).toContain("pendingCommandKeys.delete(commandKey)");
    expect(page).toContain("error instanceof WageStatementApiError && error.status >= 400 && error.status < 500");
    expect(page).toContain("commandKeyFor(statementId, action, revision)");
    expect(page).toContain("commandKeyFor(statementId, \"return\", revision, reason)");
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

  it("keeps a selected external-approved file in memory only and exposes only an aggregate import preview", () => {
    expect(page).toContain("type=\"file\"");
    expect(page).toContain("accept=\"application/json\"");
    expect(page).toContain("FileReader");
    expect(page).toContain("创建工资承担草稿");
    expect(page).toContain("createApprovedWageSource");
    expect(page).toContain("createWageStatementDraft");
    expect(page).toContain("localImportCommand.value.sourceKey");
    expect(page).toContain("localImportCommand.value.draftKey");
    expect(page).toContain("canPrepare");
    expect(page).not.toContain("localStorage");
    expect(page).not.toContain("sessionStorage");
    expect(page).not.toContain("console.");
  });

  it("does not interpolate local imported person, money, or evidence fields into the template", () => {
    const template = page.slice(page.indexOf("<template>"));
    for (const forbidden of [
      "employeeName",
      "personName",
      "amountCents",
      "approvedAmount",
      "evidenceFileId",
      "sourceSnapshot",
      "employmentSnapshot",
      "approvedPersonLines"
    ]) {
      expect(template).not.toContain(forbidden);
    }
  });
});
