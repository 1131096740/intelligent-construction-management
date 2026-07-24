import { describe, expect, it, vi } from "vitest";
import { navigateToApprovalWorkItem } from "./approval-center-navigation";

describe("approval center navigation", () => {
  it("preserves the complete server-provided work item target", () => {
    const push = vi.fn();

    navigateToApprovalWorkItem(
      { push },
      { targetPath: "/目标?tab=current#evidence" }
    );

    expect(push).toHaveBeenCalledOnce();
    expect(push).toHaveBeenCalledWith("/目标?tab=current#evidence");
  });
});
