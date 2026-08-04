import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const detail = readFileSync(
  new URL("./ContractDetailPage.vue", import.meta.url),
  "utf8"
);

describe("contract approval review action", () => {
  it("opens approve and reject only from the raw server review capability", () => {
    expect(detail).toContain("contractReviewCapability.value");
    expect(detail).toContain('action.key === "review_approval" && action.enabled');
    expect(detail).toContain("captureContractReviewContext");
    expect(detail).toContain("reviewApprovalContext");
    expect(detail).toContain("expectedContractUpdatedAt");
    expect(detail).toContain("expectedApprovalInstanceId");
    expect(detail).toContain("expectedNodeIndex");
    expect(detail).toContain("expectedApprovalUpdatedAt");
  });

  it("uses fixed approve and reject handlers through the canonical executor", () => {
    expect(detail).toContain("executeContractApprovalReviewAction({");
    expect(detail).toContain("prepareContractApprovalReviewAction({");
    expect(detail).toContain("confirmContractReviewApprove");
    expect(detail).toContain("confirmContractReviewReject");
    expect(detail).not.toContain("reviewContractApproval(");
  });

  it("owns one in-flight submission and invalidates stale route or unmount work", () => {
    expect(detail).toContain("contractReviewInFlight");
    expect(detail).toContain("contractReviewSubmissionToken");
    expect(detail).toContain("routeContractId() === context.routeContractId");
    expect(detail).toContain("clearContractActionTransientState();");
  });

  it("does not repeat an unknown POST and requires an authoritative reread", () => {
    expect(detail).toContain("ContractApprovalReviewResultUnknownError");
    expect(detail).toContain("不要重复提交");
    expect(detail).toContain("reloadContractDetail()");
  });

  it("keeps page networking behind API wrappers", () => {
    expect(detail).not.toMatch(/\bfetch\s*\(/u);
  });
});
