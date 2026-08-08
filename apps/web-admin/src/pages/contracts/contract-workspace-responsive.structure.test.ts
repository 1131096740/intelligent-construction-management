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
      ["./workbench/ContractDocumentCanvas.vue", "contract-document-canvas"]
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

  it("keeps aggregate save and preview feedback separate without reloading after every manual save", () => {
    const onSave = workbench.slice(
      workbench.indexOf("async function onSave()"),
      workbench.indexOf("async function prepareGovernanceMutation()")
    );
    const governance = workbench.slice(
      workbench.indexOf("async function prepareGovernanceMutation()"),
      workbench.indexOf("function requestSubmission()")
    );

    expect(workbench).toContain("contractDraftSaveStatusText");
    expect(workbench).toContain("formalSaveCompleted");
    expect(workbench).toContain("lastSavedAt");
    expect(workbench).toContain("saveReceiptText");
    expect(workbench).toContain("manualSaveMessage");
    expect(onSave).toContain("const wasFormallySaved = formalSaveCompleted.value");
    expect(onSave).toContain("contractDraftPreviewFeedbackText");
    expect(onSave).toContain("queuePreviewForCurrentRevision");
    expect(onSave).toContain('previewState: "failed"');
    expect(onSave).toContain("shouldReloadContractAfterManualSave");
    expect(onSave).not.toContain(
      "if (contractId.value) await loadExpectedWorkbench(contractId.value)"
    );
    expect(governance).toContain("await loadExpectedWorkbench(id)");

    const contractIdentityWatcher = workbench.slice(
      workbench.indexOf("watch(contractId"),
      workbench.indexOf("watch(() => route.query.versionId")
    );
    const versionIdentityWatcher = workbench.slice(
      workbench.indexOf("watch(() => route.query.versionId"),
      workbench.indexOf("watch(\n  () => [route.query.contractType")
    );
    expect(contractIdentityWatcher).toContain("clearManualSaveMessage()");
    expect(versionIdentityWatcher).toContain("clearManualSaveMessage()");
  });
});
