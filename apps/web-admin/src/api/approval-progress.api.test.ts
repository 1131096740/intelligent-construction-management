import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { fetchRelatedApprovals, remindApprovalBySms } from "./approval-progress.api";

beforeEach(() => { setActivePinia(createPinia()); });
afterEach(() => { vi.unstubAllGlobals(); });
const reminderToken = "a".repeat(64);
describe("统一审批进度接口", () => {
  it("权限或冷却拒绝显示中文业务原因", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ message: "刚刚已催办，请稍后再试" }), { status: 409 })));
    await expect(remindApprovalBySms("flow", "request", reminderToken)).rejects.toThrow("刚刚已催办，请稍后再试");
  });
  it("列表保留分页条件，催办复用调用方的幂等标识", async () => {
    const send = vi.fn<[RequestInfo | URL, RequestInit?], Promise<Response>>().mockImplementation(async () => new Response(JSON.stringify({ items: [], nextCursor: null })));
    vi.stubGlobal("fetch", send);
    await fetchRelatedApprovals({ cursor: "last", businessType: "expense_claim" });
    expect(send.mock.calls[0][0]).toBe("/api/approval-progress?cursor=last&businessType=expense_claim");
    await remindApprovalBySms("flow", "same-request", reminderToken);
    expect(JSON.parse(String((send.mock.calls[1] as unknown as [string, RequestInit])[1].body))).toEqual({ requestId: "same-request", reminderToken });
  });
  it("列表请求保留取消信号，离开页面后可中止分页扫描", async () => {
    const controller = new AbortController();
    const send = vi.fn<[RequestInfo | URL, RequestInit?], Promise<Response>>().mockImplementation(async () => new Response(JSON.stringify({ items: [], nextCursor: null })));
    vi.stubGlobal("fetch", send);
    await fetchRelatedApprovals({ cursor: "next-page" }, controller.signal);
    expect(send.mock.calls[0][1]?.signal).toBe(controller.signal);
  });

});
