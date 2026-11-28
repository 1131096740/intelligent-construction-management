import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  fileURLToPath(new URL("./HomePage.vue", import.meta.url)),
  "utf8"
);
const groups = readFileSync(
  fileURLToPath(new URL("./HomeActionGroups.vue", import.meta.url)),
  "utf8"
);
const projects = readFileSync(
  fileURLToPath(new URL("./HomeProjectSection.vue", import.meta.url)),
  "utf8"
);

describe("home page information architecture (UI-01/UI-02/UI-03)", () => {
  it("puts the personal todo list before projects and new-business entry", () => {
    const summary = source.indexOf("<BusinessStatusSummary");
    const actionGroups = source.indexOf("<HomeActionGroups");
    const workItems = source.indexOf("class=\"work-items-panel\"");
    const projectSection = source.indexOf("<HomeProjectSection");
    const launcher = source.indexOf("<BusinessLauncher");
    expect(summary).toBeGreaterThan(-1);
    expect(actionGroups).toBeGreaterThan(summary);
    expect(workItems).toBeGreaterThan(actionGroups);
    expect(projectSection).toBeGreaterThan(workItems);
    expect(launcher).toBeGreaterThan(projectSection);
    expect(source.indexOf("id=\"new-business\"")).toBeGreaterThan(projectSection);
  });

  it("shows a prominent new-business button and keeps list and form pages separate", () => {
    expect(source).toContain("新建业务");
    expect(source).toContain("startNewBusiness");
    expect(source).toContain("document.getElementById(\"new-business\")?.scrollIntoView");
    expect(source).not.toContain("<t-dialog");
  });

  it("renders action groups with counts, summaries and direct links", () => {
    expect(groups).toContain("home-action-group__count");
    expect(groups).toContain("group.countText");
    expect(groups).toContain("group.items");
    expect(groups).toContain("item.targetPath");
    expect(groups).toContain("查看全部");
    expect(groups).toContain("前往办理");
    expect(source).toContain(":groups=\"actionGroups\"");
    expect(source).toContain("@view-all=\"viewGroup\"");
    expect(source).toContain("filters.group = groupKey");
  });

  it("shows the project area with a project operations entry", () => {
    expect(source).toContain("<HomeProjectSection");
    expect(projects).toContain("我的项目");
    expect(projects).toContain("项目经营");
    expect(projects).toContain("project.code");
    expect(source).toContain("fetchProjects");
    expect(source).toContain("openProject");
  });

  it("keeps tab counts and writes queue and filters into the route query", () => {
    expect(source).toContain(":label=\"queue.tabLabel\"");
    expect(source).toContain("readHomeWorkItemQuery(route.query");
    expect(source).toContain("homeWorkItemQuery({");
    expect(source).toContain("router.replace({ path: route.path, query })");
    expect(source).toContain("filters.group");
  });

  it("keeps desktop table and mobile cards on the same data", () => {
    expect(source).toContain("<t-table");
    expect(source).toContain("<BusinessMobileCards");
    expect(source).toContain(":items=\"mobileRows\"");
    expect(source).toContain(":data=\"visibleRows\"");
  });
});
