import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const routes = readFileSync(new URL("../../routes/route-records.ts", import.meta.url), "utf8");
const listPage = readFileSync(new URL("./SettlementTemplateListPage.vue", import.meta.url), "utf8");
const editorPage = readFileSync(new URL("./SettlementTemplateEditorPage.vue", import.meta.url), "utf8");
const api = readFileSync(new URL("../../api/settlement-template.api.ts", import.meta.url), "utf8");
const coreApi = readFileSync(new URL("../../api/core-flow-read.api.ts", import.meta.url), "utf8");
const workbenchApi = readFileSync(new URL("../../api/settlement-workbench.api.ts", import.meta.url), "utf8");
const businessOptions = readFileSync(
  new URL("../contracts/contract-business-options.config.ts", import.meta.url),
  "utf8"
);

describe("settlement template governance structure", () => {
  it("guards list, new and editor routes with global governance positions", () => {
    expect(routes).toContain('path: "结算模板库"');
    expect(routes).toContain('path: "结算模板库/新建"');
    expect(routes).toContain('path: "结算模板库/:templateId"');
    expect(routes).toContain("requiredGlobalRoleKeys: settlementTemplateAdminRoleKeys");
    expect(routes).toContain('"contract_director"');
    expect(routes).toContain('"super_admin"');
    expect(editorPage).toContain("const isCreateMode = computed(() => !route.params.templateId)");
  });

  it("uses TDesign governance controls and presents reports without raw JSON or file identifiers", () => {
    expect(listPage).toContain("<t-table");
    expect(editorPage).toContain("<t-upload");
    expect(editorPage).toContain('theme="file-input"');
    expect(editorPage).toContain("inspectionReport.blockingErrors");
    expect(editorPage).not.toContain("<pre");
    expect(editorPage).not.toContain("JSON.stringify");
    expect(editorPage).not.toContain("xlsxFileId }}");
    expect(editorPage).not.toContain("previewXlsxFileId");
  });

  it("downloads previews only through an audited ticket helper", () => {
    expect(api).toContain("/download-ticket");
    expect(api).toContain("downloadReason");
    expect(api).toContain("await apiFetch(ticket.downloadUrl)");
    expect(editorPage).not.toContain(":href=");
    expect(editorPage).not.toContain("downloadUrl");
  });

  it("requires a template version at every settlement write boundary and removes amount-only creation", () => {
    expect(coreApi).toContain("settlementTemplateVersionId: string;");
    expect(coreApi).not.toContain("settlementTemplateVersionId?: string;");
    expect(workbenchApi).toContain("body: { fileId: string; settlementTemplateVersionId: string }");
    expect(workbenchApi).not.toContain("settlementTemplateVersionId?: string;");
    expect(businessOptions).not.toContain("buildSettlementCreatePayload");
    expect(businessOptions).not.toContain("amountYuan");
  });
});
