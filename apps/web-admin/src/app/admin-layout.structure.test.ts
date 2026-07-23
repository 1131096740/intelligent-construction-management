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
    expect(layoutSource).toContain("border-left: var(--jg-border-width-accent) solid var(--jg-brand)");
    expect(layoutSource).not.toContain("box-shadow:");
  });

  it("renders navigation groups as readable headings with separators", () => {
    expect(layoutSource).toContain("grid-template-columns: auto minmax(0, 1fr)");
    expect(layoutSource).toContain("font-size: var(--jg-font-body)");
    expect(layoutSource).toContain(".menu-group-label::after");
    expect(layoutSource).toContain("background: var(--jg-border)");
  });

  it("uses the authoritative work-item projection for capped navigation badges", () => {
    expect(layoutSource).toContain("fetchWorkItems");
    expect(layoutSource).toContain("navigationWorkItemBadgeCounts");
    expect(layoutSource).toContain(':max-count="99"');
    expect(layoutSource).toContain("workItemBadgeRequestId");
  });

  it("honors an explicit workbench menu target for non-prefix detail routes", () => {
    expect(layoutSource).toContain("route.meta.activeNavigationPath");
    expect(layoutSource).toContain(
      "items.some((item) => item.path === explicitPath)"
    );
  });

  it("uses the content area as the responsive container without an extreme page-width fallback", () => {
    expect(layoutSource).toContain("container-name: jg-content");
    expect(layoutSource).toContain("container-type: inline-size");
    expect(layoutSource).toContain("overflow-x: clip");
    expect(layoutSource).toContain("@media (max-width: 720px)");
    expect(layoutSource).toContain("min-width: 0");
    expect(layoutSource).not.toContain("min-width: var(--jg-layout-page-min-width-fallback)");
    expect(layoutSource).not.toMatch(/\.content\s*\{[^}]*overflow-x:\s*auto/gu);
  });
});
