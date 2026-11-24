import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const detail = readFileSync(new URL("./SettlementDetailPage.vue", import.meta.url), "utf8");

describe("historical settlement approval", () => {
  it("removes the serial approval controls and participant lookup", () => {
    expect(detail).not.toMatch(/review_approval|withdraw_approval|transfer_approval|delegate_approval/);
    expect(detail).not.toContain("fetchApprovalDelegationUserOptions");
  });

  it("keeps approved evidence and archive duties in the existing detail", () => {
    expect(detail).toContain("<ApprovalTimeline");
    expect(detail).toContain("<ApprovalProgressPanel");
    expect(detail).toContain("requestApprovalFormDownload");
    expect(detail).toContain("<DutySmsStatusPanel");
    expect(detail).toContain("confirmSettlementArchiveWithCapability");
  });
});
