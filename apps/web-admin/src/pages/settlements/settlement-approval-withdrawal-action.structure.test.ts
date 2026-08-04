import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const detail = readFileSync(
  new URL("./SettlementDetailPage.vue", import.meta.url),
  "utf8"
);

describe("settlement approval withdrawal action structure", () => {
  it("uses a dedicated handler and canonical executor", () => {
    expect(detail).toContain("confirmSettlementWithdrawal");
    expect(detail).toContain("executeSettlementApprovalWithdrawalAction({");
    expect(detail).toContain("prepareSettlementApprovalWithdrawalAction({");
    expect(detail).not.toContain("withdrawSettlementApproval");
  });

  it("is dominated by one raw server capability and complete coordinates", () => {
    expect(detail).toContain(
      "settlementApprovalCapability.value?.availableActions.some("
    );
    expect(detail).toContain(
      "settlementApprovalCapability.value?.availableActions.filter("
    );
    expect(detail).not.toContain("settlementWithdrawalCapability");
    expect(detail).toContain(
      'action.key === "withdraw_approval" && action.enabled'
    );
    expect(detail).toContain("withdrawApprovalContext");
    expect(detail).toContain("lifecycleUpdatedAt");
    expect(detail).toContain("expectedSettlementUpdatedAt");
    expect(detail).toContain("expectedApprovalInstanceId");
    expect(detail).toContain("expectedNodeIndex");
    expect(detail).toContain("expectedApprovalUpdatedAt");
  });

  it("owns one submission and treats an ambiguous POST as unknown", () => {
    expect(detail).toContain("settlementWithdrawalInFlight");
    expect(detail).toContain("SettlementApprovalWithdrawalResultUnknownError");
    expect(detail).toContain("不要重复提交");
    expect(detail).toContain(
      "routeSettlementId() === context.routeSettlementId"
    );
  });

  it("keeps page networking behind API wrappers", () => {
    expect(detail).not.toMatch(/\bfetch\s*\(/u);
  });
});
