import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const filterBar = readFileSync(new URL("./JgFilterBar.vue", import.meta.url), "utf8");
const actionBar = readFileSync(new URL("./JgActionBar.vue", import.meta.url), "utf8");

describe("stage 1 standard action and filter controls", () => {
  it("uses TDesign card composition and keeps filters/actions as caller-owned slots", () => {
    expect(filterBar).toContain("<t-card");
    expect(filterBar).toContain('<slot name="actions" />');
    expect(filterBar).toContain("<slot />");
  });
  it("keeps actions responsive without redefining buttons", () => {
    expect(actionBar).toContain("<slot />");
    expect(actionBar).toContain("@media (max-width: 720px)");
  });
});
