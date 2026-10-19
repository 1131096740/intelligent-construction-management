import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
const layout = source("./AdminLayout.vue");
const navigation = source("../components/BusinessNavigation.vue");

describe("admin navigation accessibility and responsive boundary", () => {
  it("shares the same complete role-filtered navigation between sidebar and mobile drawer", () => {
    expect(layout.match(/:groups="adminNavigationGroups"/g)).toHaveLength(2);
    expect(layout).toContain("visibleAdminNavigationGroups(auth.user?.roleKeys, auth.user?.globalRoleKeys)");
    expect(navigation).toContain('v-for="group in groups"');
    expect(navigation).toContain('v-for="item in group.items"');
    expect(navigation).toContain(":aria-current=");
    expect(navigation).toContain("<h2>");
  });

  it("uses backend work items and rejects outdated badge responses", () => {
    expect(layout).toContain("fetchWorkItems");
    expect(layout).toContain("navigationWorkItemBadgeCounts");
    expect(layout).toContain("requestId === workItemBadgeRequestId");
    expect(navigation).toContain(':max-count="99"');
  });

  it("honors an explicit workbench target and provides keyboard navigation", () => {
    expect(layout).toContain("route.meta.activeNavigationPath");
    expect(layout).toContain("items.value.some((item) => item.path === explicitPath)");
    expect(layout).toContain('href="#main-content"');
    expect(layout).toContain('id="main-content"');
    expect(layout).toContain('aria-label="打开全部业务"');
  });

  it("keeps mobile scroll and persistent navigation in separate regions", () => {
    expect(layout).toContain("container-name: jg-content");
    expect(layout).toContain("container-type: inline-size");
    expect(layout).toContain("overflow-x: clip");
    expect(layout).toContain("@media (max-width: 720px)");
    expect(layout).toContain("height: var(--jg-visible-height, 100dvh)");
    expect(layout).toContain("overflow-y: auto");
    expect(layout).toContain('html[data-keyboard="open"]');
    expect(layout).not.toContain("min-width: var(--jg-layout-page-min-width-fallback)");
  });
});
