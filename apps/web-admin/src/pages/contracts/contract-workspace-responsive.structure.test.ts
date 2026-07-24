import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), "utf8");

const workbench = read("./ContractWorkbenchPage.vue");
const takeover = read("./ContractTakeoverPage.vue");

describe("contract workspace responsive governance", () => {
  it("delegates the composite contract workbench scroll ownership to its active child workspace", () => {
    expect(workbench).toContain("jg-responsive-workspace");
    expect(workbench).toContain('data-jg-scroll-owner="child"');
    expect(workbench).toContain("@container jg-page (max-width: 1080px)");
    expect(workbench).toMatch(/\.workbench-shell\s*\{[^}]*min-width:\s*0;/su);
    expect(workbench).toMatch(
      /@container jg-page \(max-width: 620px\)[\s\S]*\.status-bar\s*\{[^}]*flex-direction:\s*column;/su
    );
    expect(workbench).toMatch(
      /@container jg-page \(max-width: 620px\)[\s\S]*\.status-left,[\s\S]*\.status-right\s*\{[^}]*width:\s*100%;/su
    );
    expect(workbench).toMatch(
      /@container jg-page \(max-width: 620px\)[\s\S]*\.status-bar\s*\{[^}]*justify-content:\s*flex-start;[^}]*gap:\s*var\(--jg-space-md\);/su
    );
    expect(workbench).toMatch(
      /@container jg-page \(max-width: 620px\)[\s\S]*\.status-left\s*\{[^}]*flex:\s*0 1 auto;/su
    );
    expect(workbench).not.toContain("@media (max-width: 1100px)");
  });

  it("keeps takeover cards static while each TDesign table owns its own horizontal scroll", () => {
    expect(takeover).toContain("jg-responsive-workspace");
    expect(takeover).toContain('data-jg-scroll-owner="child"');
    expect(takeover.match(/jg-table-region/g)?.length).toBeGreaterThanOrEqual(3);
    expect(takeover.match(/horizontal-scroll-affixed-bottom/g)?.length).toBeGreaterThanOrEqual(3);
    expect(takeover).not.toMatch(/:deep\(\.t-card__body\)\s*\{[^}]*overflow-x/su);
  });

  it("uses component-width queries for sidebar editors and document canvases", () => {
    const components = [
      ["./workbench/ContractPartySection.vue", "contract-party"],
      ["./workbench/ContractClausesSection.vue", "contract-clauses"],
      ["./workbench/ContractDocumentsSection.vue", "contract-documents"],
      ["./workbench/ContractDocumentCanvas.vue", "contract-document-canvas"],
      ["./workbench/ContractNegotiationCanvas.vue", "contract-negotiation"]
    ] as const;

    for (const [relative, container] of components) {
      const source = read(relative);
      expect(source).toContain(`container-name: ${container}`);
      expect(source).toContain(`@container ${container}`);
    }
  });

  it("keeps the bill and document canvas as explicit child scroll owners", () => {
    expect(read("./workbench/ContractBillFocusEditor.vue")).toContain("<ContractBillGrid");
    expect(read("./workbench/ContractBillGrid.vue")).toContain("<JgBusinessGrid");
    expect(read("./workbench/ContractDocumentCanvas.vue")).toContain(
      'class="canvas-stage jg-workspace-scroll"'
    );
  });
});
