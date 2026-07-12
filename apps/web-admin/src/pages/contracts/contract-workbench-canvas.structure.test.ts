import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const pageSource = fs.readFileSync(
  path.resolve(__dirname, "ContractWorkbenchPage.vue"),
  "utf8"
);
const canvasSource = fs.readFileSync(
  path.resolve(__dirname, "workbench/ContractDocumentCanvas.vue"),
  "utf8"
);

describe("contract workbench document canvas structure", () => {
  it("uses a central document canvas and one TDesign business sidebar", () => {
    expect(pageSource).toContain("ContractDocumentCanvas");
    expect(pageSource).toContain("ContractNegotiationCanvas");
    expect(pageSource).toContain('class="document-canvas-slot"');
    expect(pageSource).toContain('class="business-sidebar"');
    expect(pageSource).toMatch(/<t-tabs\s+v-model="activeSection"/u);
    expect(pageSource).toContain(':value="section.key"');
    expect(pageSource).not.toContain('class="section-nav"');
  });

  it("keeps readiness visible and preserves all structured and document sections", () => {
    expect(pageSource).toMatch(
      /class="business-sidebar"[\s\S]*ContractReadinessPanel[\s\S]*<t-tabs/u
    );
    for (const component of [
      "ContractOverviewSection",
      "ContractBasicSection",
      "ContractPartySection",
      "ContractPricingSection",
      "ContractProfessionalFieldsSection",
      "ContractBillsSection",
      "ContractPaymentTermsSection",
      "ContractClausesSection",
      "ContractDocumentsSection"
    ]) {
      expect(pageSource).toContain(`<${component}`);
    }
  });

  it("does not invent an insecure embedded private-file path", () => {
    expect(canvasSource).toContain("通过右侧“文档”页签安全打开");
    expect(canvasSource).toMatch(/emit\(["']open-documents["']\)/u);
    expect(canvasSource).not.toContain("<iframe");
    expect(canvasSource).not.toContain("createPrivateFileDownloadTicket");
    expect(canvasSource).not.toContain("pdfFileId}`");
  });
});
