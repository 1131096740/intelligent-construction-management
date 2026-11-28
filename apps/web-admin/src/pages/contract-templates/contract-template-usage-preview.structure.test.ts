import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const listSource = fs.readFileSync(
  path.resolve(__dirname, "ContractTemplateListPage.vue"),
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

  // CON09 and task09 v2 create supersede the former forced business-template
  // bootstrap, query preselection and recommendation drawer contract. Real new
  // create UI covers project/type/relation and backend persistence. Word-template
  // selection and actual generated files remain a task09 closing gate after
  // formal task11 integration; they are not claimed by this source test.
});
