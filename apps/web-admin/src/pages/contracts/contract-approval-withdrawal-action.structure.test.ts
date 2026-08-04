import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const detail = readFileSync(
  new URL("./ContractDetailPage.vue", import.meta.url),
  "utf8"
);

describe("contract approval withdrawal action structure", () => {
  it("uses a dedicated handler and canonical executor", () => {
    expect(detail).toContain("confirmContractWithdrawal");
    expect(detail).toContain("executeContractApprovalWithdrawalAction({");
    expect(detail).toContain("prepareContractApprovalWithdrawalAction({");
    expect(detail).not.toContain("withdrawContractApproval");
  });

  it("is dominated by the raw server capability and complete coordinates", () => {
    expect(detail).toContain("contractReviewCapability.value");
    expect(detail).not.toContain("contractWithdrawalCapability");
    expect(detail).toContain('action.key === "withdraw_approval" && action.enabled');
    expect(detail).toContain("withdrawApprovalContext");
    expect(detail).toContain("expectedContractUpdatedAt");
    expect(detail).toContain("expectedApprovalInstanceId");
    expect(detail).toContain("expectedNodeIndex");
    expect(detail).toContain("expectedApprovalUpdatedAt");
  });

  it("owns one submission and treats an ambiguous POST as unknown", () => {
    expect(detail).toContain("contractWithdrawalInFlight");
    expect(detail).toContain("ContractApprovalWithdrawalResultUnknownError");
    expect(detail).toContain("不要重复提交");
    expect(detail).toContain("routeContractId() === context.routeContractId");
  });

  it("keeps page networking behind API wrappers", () => {
    expect(detail).not.toMatch(/\bfetch\s*\(/u);
  });
});
