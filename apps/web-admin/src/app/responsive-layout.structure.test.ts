import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

const tokens = source("./design-tokens.css");
const layout = source("./responsive-layout.css");
const main = source("../main.ts");

describe("responsive layout foundation", () => {
  it("loads responsive layout after the design tokens", () => {
    expect(main.indexOf('import "./app/design-tokens.css"')).toBeGreaterThan(-1);
    expect(main.indexOf('import "./app/responsive-layout.css"')).toBeGreaterThan(
      main.indexOf('import "./app/design-tokens.css"')
    );
  });

  it("defines semantic table and workspace widths as tokens", () => {
    expect(tokens).toContain("--jg-layout-page-min-width-fallback: 720px");
    expect(tokens).toContain("--jg-layout-ledger-table-min-width: 960px");
    expect(tokens).toContain("--jg-layout-workspace-min-width-standard: 1040px");
    expect(tokens).toContain("--jg-layout-workspace-min-width-wide: 1680px");
  });

  it("assigns horizontal scrolling to explicit table or workspace regions", () => {
    expect(layout).toContain(".jg-table-region .t-table__content");
    expect(layout).toContain(".jg-workspace-scroll");
    expect(layout).toContain("overscroll-behavior-inline: contain");
    expect(layout).not.toContain("100vw");
  });

  it("uses container-responsive shared business components", () => {
    for (const component of [
      "../components/BusinessPageHeader.vue",
      "../components/BusinessDetailHeader.vue",
      "../components/BusinessStatusSummary.vue",
      "../components/BusinessTableToolbar.vue"
    ]) {
      expect(source(component)).toContain("container-type: inline-size");
      expect(source(component)).toContain("@container");
    }
  });
});
