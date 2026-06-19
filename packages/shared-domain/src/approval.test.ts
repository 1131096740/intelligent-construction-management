import { describe, expect, it } from "vitest";
import { APPROVAL_ACTIONS, APPROVAL_NODE_MODES } from "./approval";

describe("approval domain constants", () => {
  it("supports unanimous and either-or approval modes", () => {
    expect(APPROVAL_NODE_MODES).toEqual(["all", "any"]);
  });

  it("includes archive confirmation actions for contract department confirmation", () => {
    expect(APPROVAL_ACTIONS).toContain("archive_confirm");
    expect(APPROVAL_ACTIONS).toContain("archive_reject");
  });
});
