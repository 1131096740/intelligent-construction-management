import { expect, type Page } from "@playwright/test";
import type { ApprovalProgress } from "../../src/api/approval-progress.api";

export async function mockApprovalProgress(
  page: Page,
  businesses: Array<{ businessType: string; businessId: string; pending?: boolean }>
) {
  await page.route(/\/api\/approval-progress(?:\?|$)/u, async (route) => {
    const request = route.request();
    const query = new URL(request.url()).searchParams;
    expect(request.method()).toBe("GET");
    expect([...query.keys()].sort()).toEqual(["businessId", "businessType"]);
    const business = businesses.find(item =>
      item.businessType === query.get("businessType") && item.businessId === query.get("businessId")
    );
    expect(business, "审批进度请求必须匹配当前场景单据").toBeDefined();
    if (!business) return route.fulfill({ status: 404, json: { message: "未配置的审批进度夹具" } });
    const reviewer = { id: "progress-reviewer", name: "E2E 审批人" };
    const flow: ApprovalProgress = {
      id: `approval-${business.businessId}`,
      businessType: business.businessType,
      businessId: business.businessId,
      title: "E2E 审批进度",
      businessCode: business.businessId,
      projectName: "E2E 项目",
      applicant: { id: "progress-applicant", name: "E2E 发起人" },
      status: business.pending ? "pending" : "approved",
      createdAt: "2026-07-31T07:00:00.000Z",
      currentNodeIndex: 0,
      currentNodeName: business.pending ? "审批节点" : "流程已结束",
      nodes: [{ name: "审批节点", mode: "或签", status: business.pending ? "处理中" : "已通过", participants: [reviewer], pending: business.pending ? [reviewer] : [], legacyRoster: false }],
      pendingRecipients: business.pending ? [reviewer] : [],
      reminderToken: "a".repeat(64),
      canRemind: false,
      reminderUnavailableReason: business.pending ? "本场景不发送短信" : "流程已结束",
      nextRemindAt: null,
      history: [],
      reminders: []
    };
    await route.fulfill({ json: { items: [flow], nextCursor: null } });
  });
}

export async function expectApprovalProgressLoaded(page: Page) {
  const panel = page.getByRole("region", { name: "完整审批进度", exact: true });
  await expect(panel.getByRole("heading", { name: /^E2E 审批进度 · /u })).toBeVisible();
  await expect(panel.locator(".approval-progress__nodes")).toContainText("E2E 审批人");
  await expect(panel.locator(".t-alert")).toHaveCount(0);
  await expect(panel.getByRole("button", { name: "短信催办", exact: true })).toBeDisabled();
}
