import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const layoutSource = readFileSync(
  fileURLToPath(new URL("./AdminLayout.vue", import.meta.url)),
  "utf8"
);

describe("admin navigation visual hierarchy", () => {
  it("keeps selected menu items inside the sidebar with a strong tokenized state", () => {
    expect(layoutSource).toContain(".menu :deep(.t-menu__item)");
    expect(layoutSource).toContain("max-width: calc(100% - var(--jg-space-lg))");
    expect(layoutSource).toContain("margin: 1px var(--jg-space-lg) 1px 0");
    expect(layoutSource).toContain("overflow-x: hidden");
    expect(layoutSource).toContain(".menu :deep(.t-menu__item.t-is-active)");
    expect(layoutSource).toContain("background: var(--jg-bg-brand-soft)");
    expect(layoutSource).toContain(
      "box-shadow: inset var(--jg-border-width-accent) 0 0 var(--jg-brand)"
    );
  });

  it("renders navigation groups as readable headings with separators", () => {
    expect(layoutSource).toContain("grid-template-columns: auto minmax(0, 1fr)");
    expect(layoutSource).toContain("font-size: var(--jg-font-body)");
    expect(layoutSource).toContain(".menu-group-label::after");
    expect(layoutSource).toContain("background: var(--jg-border)");
  });
});
