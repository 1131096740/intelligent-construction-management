import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const listSource = fs.readFileSync(
  path.resolve(__dirname, "ContractTemplateListPage.vue"),
  "utf8"
);
const workbenchSource = fs.readFileSync(
  path.resolve(__dirname, "../contracts/ContractWorkbenchPage.vue"),
  "utf8"
);
const drawerSource = fs.readFileSync(
  path.resolve(__dirname, "../../components/ContractTemplateUsagePreviewDrawer.vue"),
  "utf8"
);

describe("published contract template usage preview structure", () => {
  it("uses one shared read-only TDesign drawer without layout or file flows", () => {
    expect(drawerSource).toContain("<t-drawer");
    expect(drawerSource).toContain("业务结构预览（非合同正文/版式 PDF）");
    expect(drawerSource).toContain("用此模板建合同");
    expect(drawerSource).not.toContain("previewPdfFileId");
    expect(drawerSource).not.toContain("listPublishedLayoutTemplates");
    expect(drawerSource).not.toContain("createPrivateFileDownloadTicket");
    expect(drawerSource).not.toContain("confirmationPassword");
  });

  it("reuses the preview in template use mode and routes with the exact template", () => {
    expect(listSource).toContain("ContractTemplateUsagePreviewDrawer");
    expect(listSource).toContain("预览模板内容");
    expect(listSource).toContain("normalizePublishedContractTemplates");
    expect(listSource).toContain("@use=\"useTemplate\"");
    expect(listSource).not.toContain("listPublishedLayoutTemplates");
  });

  it("previews only a selected latest published template in the creation wizard", () => {
    expect(workbenchSource).toContain("ContractTemplateUsagePreviewDrawer");
    expect(workbenchSource).toContain("预览所选模板");
    expect(workbenchSource).toContain("publishedTemplateForSelection");
    expect(workbenchSource).toContain("selectedTemplate");
    expect(workbenchSource).toContain(
      "() => [route.query.contractType, route.query.templateVersionId]"
    );
    expect(workbenchSource).toContain("initializeDraft.setContractTypeKey(contractTypeKey)");
    expect(workbenchSource).toContain(
      "initializeDraft.setBusinessTemplateVersionId(templateVersionId)"
    );
    expect(workbenchSource).not.toContain("listPublishedLayoutTemplates");
    expect(workbenchSource).not.toContain("createPrivateFileDownloadTicket");
    expect(workbenchSource).toContain("recommendContractScenarioTemplates");
    expect(workbenchSource).toContain("从模板库直接选择");
    expect(workbenchSource).not.toContain("listContractScenarioGovernance");
    expect(workbenchSource).not.toContain("createdByUserId");
    expect(workbenchSource).not.toContain("updatedByUserId");
    expect(workbenchSource).not.toContain("choice.priority");
  });
});
