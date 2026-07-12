import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const contractPartySource = readFileSync(
  fileURLToPath(new URL("../pages/contracts/workbench/ContractPartySection.vue", import.meta.url)),
  "utf8"
);
const projectOperatingSource = readFileSync(
  fileURLToPath(new URL("../pages/projects/ProjectOperatingOverviewPage.vue", import.meta.url)),
  "utf8"
);

describe("business-facing Chinese fallbacks", () => {
  it("does not expose unknown unit or attachment codes", () => {
    expect(contractPartySource).toContain('ROLE_LABELS[roleKey] ?? "其他单位"');
    expect(contractPartySource).toContain('ATTACHMENT_LABELS[category] ?? "其他资料"');
    expect(contractPartySource).not.toContain("ROLE_LABELS[roleKey] ?? roleKey");
    expect(contractPartySource).not.toContain("ATTACHMENT_LABELS[category] ?? category");
  });

  it("does not expose unknown project expense status codes", () => {
    expect(projectOperatingSource).toContain('labels[status] ?? "状态待确认"');
    expect(projectOperatingSource).not.toContain("labels[status] ?? status");
  });
});
