import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { toJgStatusTagView } from "./jg-status-tag.config";

function source(name: string) {
  return readFileSync(new URL(`./${name}.vue`, import.meta.url), "utf8");
}

function contractDetailSource() {
  return readFileSync(
    new URL("../pages/contracts/ContractDetailPage.vue", import.meta.url),
    "utf8"
  );
}

describe("Jg detail component compatibility layer", () => {
  it("normalizes an empty status label without changing its semantic tone", () => {
    expect(toJgStatusTagView("  ", "warning")).toEqual({
      label: "-",
      tone: "warning"
    });
  });

  it("keeps shared components constrained to their existing TDesign business adapters", () => {
    expect(source("JgPageHeader")).toContain("BusinessDetailHeader");
    expect(source("JgTaskCard")).toContain("BusinessActionPanel");
    expect(source("JgApprovalTimeline")).toContain("ApprovalTimeline");
    expect(source("JgAttachmentPanel")).toContain("EvidenceFileCards");
    expect(source("JgDetailTabs")).toContain("position: sticky");
    expect(source("JgDetailTabs")).toContain("overflow-x: auto");
    expect(source("JgStatusTag")).toContain("<t-tag");
  });

  it("uses every detail component in the contract detail page without changing its read APIs", () => {
    const source = contractDetailSource();
    for (const component of [
      "JgPageHeader",
      "JgTaskCard",
      "JgDetailTabs",
      "JgApprovalTimeline",
      "JgAttachmentPanel"
    ]) {
      expect(source).toContain(`<${component}`);
      expect(source).toContain(`import ${component}`);
    }
    expect(source).toContain("fetchContractDetail");
    expect(source).not.toContain("fetch(");
  });
});
