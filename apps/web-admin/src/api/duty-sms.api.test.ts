import { describe, expect, it, vi } from "vitest";
import { apiFetch } from "./api-fetch";
import { fetchDutySms, retryDutySms } from "./duty-sms.api";

vi.mock("./api-fetch", () => ({ apiFetch: vi.fn() }));
const transport = vi.mocked(apiFetch);

describe("待办短信重试接口", () => {
  it.each([["approval-progress", "round/1"], ["expense-claims", "claim/1"], ["spot-procurement-payments", "payment/1"], ["payment-executions", "registered/1"], ["payments", "payment/1"], ["fund-account-transfers", "transfer/1"], ["contract-bank-verifications", "bank/1"], ["contract-economic-reviews", "economic/1"], ["contract-proxy-executions", "proxy/1"], ["upward-contract-amount-revisions", "amount/1"], ["upward-receipt-matches", "receipt/1"]] as const)(
    "状态读取与重试使用同一授权业务资源和明确失败标识：%s", async (domain, businessId) => {
    transport.mockClear();
    const failed = { attemptId: "a".repeat(64), status: "failed", canRetry: true };
    transport.mockResolvedValueOnce(Response.json({ notice: failed }));
    transport.mockResolvedValueOnce(Response.json({ attemptId: "b".repeat(64), status: "queued", canRetry: false }));
    await expect(fetchDutySms(domain, businessId)).resolves.toEqual(failed);
    await expect(retryDutySms(domain, businessId, failed.attemptId)).resolves.toMatchObject({ status: "queued", canRetry: false });
    const statusPath = `/${domain}/${encodeURIComponent(businessId)}${domain === "payments" ? "/approval" : ""}/duty-sms`;
    expect(transport.mock.calls[0][0]).toBe(statusPath);
    expect(transport.mock.calls[1]).toEqual([`${statusPath}/retry`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ attemptId: failed.attemptId })
    }]);
  });

  it("报销审批入队记录按轮次和职责隔离，退回修改仅使用轮次", async () => {
    transport.mockClear();
    await expect(fetchDutySms("expense-claim-approvals", "claim/id", "0")).rejects.toThrow("当前费用审批轮次无法确认");
    expect(transport).not.toHaveBeenCalled();
    transport.mockResolvedValueOnce(Response.json({ notice: null }));
    transport.mockResolvedValueOnce(Response.json({ attemptId: "next", status: "queued", canRetry: false }));
    transport.mockResolvedValueOnce(Response.json({ notice: null }));
    await fetchDutySms("expense-claim-approvals", "claim/id", "0", "round/1");
    await retryDutySms("expense-claim-approvals", "claim/id", "original", "round/1", "0");
    await fetchDutySms("expense-claim-approvals", "claim/id", undefined, "round/2");
    const path = "/expense-claims/claim%2Fid/approval-duty-sms";
    expect(transport.mock.calls[0]).toEqual([`${path}?approvalInstanceId=round%2F1&approvalDutyIndex=0`]);
    expect(transport.mock.calls[1]).toEqual([`${path}/retry?approvalInstanceId=round%2F1&approvalDutyIndex=0`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ attemptId: "original" })
    }]);
    expect(transport.mock.calls[2]).toEqual([`${path}?approvalInstanceId=round%2F2`]);
  });

  it("余额复核重试保留原短信及准确轮次，缺少轮次不发请求", async () => {
    transport.mockClear();
    transport.mockResolvedValueOnce(Response.json({ attemptId: "retry", status: "queued", canRetry: false }));
    await expect(retryDutySms("fund-accounts/registrations", "balance/1", "original")).rejects.toThrow("当前余额复核轮次无法确认");
    expect(transport).not.toHaveBeenCalled();
    await retryDutySms("fund-accounts/registrations", "balance/1", "original", "round-1");
    expect(transport).toHaveBeenCalledWith("/fund-accounts/registrations/balance%2F1/review/duty-sms/retry", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ attemptId: "original", expectedApprovalInstanceId: "round-1" })
    });
  });

  it("本金归还同人兼岗时状态和重试仍使用原职责坐标", async () => {
    transport.mockClear();
    transport.mockResolvedValueOnce(Response.json({ notice: null }));
    transport.mockResolvedValueOnce(Response.json({ status: "queued" }));
    await fetchDutySms("fund-accounts/principal-returns", "return/id", "review-2");
    await retryDutySms("fund-accounts/principal-returns", "return/id", "original", undefined, "review-2");
    const path = "/fund-accounts/principal-returns/applications/return%2Fid/duty-sms/review-2";
    expect(transport.mock.calls[0][0]).toEqual(path);
    expect(transport.mock.calls[1]).toEqual([`${path}/retry`, {
      method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({attemptId: "original"}),
    }]);
    await expect(fetchDutySms("fund-accounts/principal-returns", "return/id", "review-4")).rejects.toThrow("当前归还申请职责无法确认");
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it("保留拒绝原因，非结构化错误回退到中文", async () => {
    transport.mockResolvedValueOnce(Response.json({ message: "仅确认发送失败的短信可以重试" }, { status: 409 }));
    transport.mockResolvedValueOnce(new Response("unrecognized", { status: 503 }));
    await expect(retryDutySms("settlements", "settlement", "original")).rejects.toThrow("仅确认发送失败的短信可以重试");
    await expect(retryDutySms("settlements", "settlement", "original")).rejects.toThrow("重试申请未能确认");
  });
});
