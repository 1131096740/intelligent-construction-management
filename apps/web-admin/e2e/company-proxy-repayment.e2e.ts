import { expect, test } from "@playwright/test";

test("按原代付往来申请且逐项目职责提交，拒绝不存在或冲突的原单链接", async ({ page }) => {
  const applicant = "comprehensive_director";
  const project = { id: "project", name: "验收项目" };
  const debtor = { id: "debtor", name: "验收甲公司" };
  const creditor = { id: "creditor", name: "验收乙公司" };
  const requests: Array<{ path: string; body: Record<string, unknown> }> = [];
  await page.addInitScript(role => {
    localStorage.setItem("jiangkong-web-admin-auth", JSON.stringify({
      accessToken: "synthetic", refreshToken: "synthetic", user: {
        id: "synthetic-user", name: "验收综合主管", phone: "13900000000",
        mustChangePassword: false, roleKeys: [role], globalRoleKeys: [role],
      },
    }));
  }, applicant);
  await page.route(url => url.pathname.startsWith("/api/"), async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    if (request.method() === "POST") {
      requests.push({ path, body: request.headers()["content-type"]?.includes("json") ? request.postDataJSON() : {} });
      return route.fulfill({ json: { id: "submitted" } });
    }
    if (path === "/api/company-transfers") {
      const original = url.searchParams.get("originalSource");
      return route.fulfill({ json: {
        projects: [project], companies: [debtor, creditor],
        canCreate: original === "inter_entity:relationship" || original === "operational:operational-payment",
        originalSourceFound: original === "inter_entity:relationship" || original === "inter_entity:exhausted" ||
          original === "operational:operational-payment",
        canDecide: true, originalProxies: [], originalLoans: [], balances: [], total: 1,
        legacyOptions: [{ approvalFlow: "proxy_repayment_parallel",
          id: "relationship", legacyType: "inter_entity", reference: "验收原债", sourceCompanyId: debtor.id,
          destinationCompanyId: creditor.id, sourceProjectId: project.id, destinationProjectId: project.id,
          remainingCents: "800", availableCents: "800",
        }, {
          id: "operational-payment", legacyType: "operational", reference: "实际付款验收",
          sourceCompanyId: debtor.id, destinationCompanyId: creditor.id, sourceProjectId: project.id,
          destinationProjectId: project.id, remainingCents: "800", availableCents: "800",
          approvalFlow: "proxy_repayment_parallel",
        }],
        rows: url.searchParams.has("transferId") && url.searchParams.get("transferId") !== "transfer" ? [] : [{ id: "transfer", code: "验收申请", kind: "repayment", kindLabel: "归还", status: "submitted",
          statusLabel: "待项目审批", sourceCompany: debtor.name, destinationCompany: creditor.name,
          sourceScope: project.name, destinationScope: project.name, originalReference: "验收原债", originalSource: "inter_entity:exhausted", sourceProjectId: project.id,
          amountCents: "400", sentCents: "0", receivedCents: "0", returnedCents: "0", inTransitCents: "400",
          approvalActions: [], events: [], canApprove: true, approvalFlow: "proxy_repayment_parallel",
          approvalDuties: [{ nodeIndex: 0, roleKeys: [applicant], requiresSelfPassword: true }],
        }],
      } });
    }
    return route.fulfill({ json: {} });
  });

  const route = "/公司互转台账?projectId=project";
  await page.goto(`${route}&originalInterEntityRelationshipId=missing`);
  await expect(page.getByText("原往来不存在或当前账号无权查看")).toBeVisible();
  await expect(page.locator(".t-drawer:visible")).toHaveCount(0);
  await page.goto(`${route}&originalInterEntityRelationshipId=relationship&originalInterEntityRelationshipId=missing`);
  await expect(page.getByText("原往来不存在或当前账号无权查看")).toBeVisible();
  await expect(page.locator(".t-drawer:visible")).toHaveCount(0);
  expect(requests).toEqual([]);

  await page.goto(`${route}&originalInterEntityRelationshipId=relationship`);
  const drawer = page.locator(".t-drawer:visible");
  const field = (label: string) => drawer.locator(".t-form__item").filter({ has: page.getByText(label, { exact: true }) });
  await expect(field("原借款或代付往来").locator("input")).toBeDisabled();
  await expect(field("转出公司").locator("input")).toHaveValue(debtor.name);
  await expect(field("转入公司").locator("input")).toHaveValue(creditor.name);
  await expect(drawer.getByRole("button", { name: "提交项目审批" })).toBeVisible();
  await expect(page.getByText("办理前核验银行账户和流水")).toHaveCount(0);
  await field("申请金额（元）").locator("input").fill("4.00");
  await field("当前登录密码").locator("input").fill("synthetic");
  await drawer.getByLabel("上传互转申请依据").setInputFiles({
    name: "合成依据.png", mimeType: "image/png", buffer: Buffer.from("synthetic"),
  });
  await drawer.getByRole("button", { name: "提交项目审批" }).click();
  await expect(drawer).toHaveCount(0);
  expect(requests.find(entry => entry.path === "/api/company-transfers")?.body).toMatchObject({
    originalInterEntityRelationshipId: "relationship", sourceCompanyId: debtor.id,
    destinationCompanyId: creditor.id, amountCents: "400",
  });

  await expect(page.getByRole("button", { name: "终审通过", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: /^同意（/ }).click();
  await field("当前登录密码").locator("input").fill("synthetic");
  await drawer.getByRole("button", { name: "同意本次审批" }).click();
  await expect(drawer.getByText("请填写自审原因并输入本人密码")).toBeVisible();
  expect(requests.some(entry => entry.path.endsWith("/decision"))).toBe(false);
  await field("本人审批原因（必填）").locator("textarea").fill("本次职责独立确认");
  await drawer.getByRole("button", { name: "同意本次审批" }).click();
  await expect(drawer).toHaveCount(0);
  expect(requests.find(entry => entry.path === "/api/company-transfers/transfer/decision")?.body).toMatchObject({
    action: "approve", nodeIndex: 0, comment: "本次职责独立确认",
  });

  await page.goto("/公司互转台账?transferId=transfer");
  await expect(page.getByText("验收申请 · 归还 · 待项目审批")).toBeVisible();
  await expect(drawer).toHaveCount(0);

  await page.getByRole("link", { name: "查看原往来归还记录" }).click();
  await expect(page).toHaveURL(/originalInterEntityRelationshipId=exhausted/);
  await expect(page.getByText("原往来归还记录")).toBeVisible();
  await expect(page.getByText("当前不可发起归还，已有记录仍可查看。")).toBeVisible();
  await expect(page.getByText("验收申请 · 归还 · 待项目审批")).toBeVisible();
  await expect(page.getByRole("button", { name: "申请归还该往来" })).toHaveCount(0);
  await expect(drawer).toHaveCount(0);

  await page.goto("/公司互转台账?transferId=unavailable");
  await expect(page.getByText("互转记录不存在或当前账号无权查看。")).toBeVisible();
  await expect(page.getByText("验收申请 · 归还 · 待项目审批")).toHaveCount(0);

  await page.goto(`${route}&originalOperationalPaymentId=operational-payment`);
  await expect(field("原借款或代付往来").locator("input")).toBeDisabled();
  await field("申请金额（元）").locator("input").fill("3.00");
  await drawer.getByLabel("上传互转申请依据").setInputFiles({
    name: "合成实付归还依据.png", mimeType: "image/png", buffer: Buffer.from("synthetic"),
  });
  await drawer.getByRole("button", { name: "提交项目审批" }).click();
  await expect(drawer).toHaveCount(0);
  expect(requests.filter(entry => entry.path === "/api/company-transfers").at(-1)?.body).toMatchObject({
    originalOperationalPaymentId: "operational-payment", sourceCompanyId: debtor.id,
    destinationCompanyId: creditor.id, amountCents: "300",
  });
});

test("原债更正沿用出款流水，恢复原申请后由财务主管复核", async ({ page }) => {
  const path = "/api/company-transfers/transfer/events/settled-out/original-debt-corrections";
  let canReadCorrections = false;
  let correctionReads = 0;
  let requested: { targetOriginalSource: string; reason: string; idempotencyKey: string } | undefined;
  let confirmed = false;
  let requests = 0;
  await page.addInitScript(() => {
    localStorage.setItem("jiangkong-web-admin-auth", JSON.stringify({
      accessToken: "synthetic", refreshToken: "synthetic",
      user: { id: "reviewer", name: "验收财务主管", phone: "13900000000", mustChangePassword: false,
        roleKeys: ["finance_director"], globalRoleKeys: ["finance_director"] },
    }));
  });
  await page.route(url => url.pathname.startsWith("/api/"), async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === "/api/company-transfers/transfer") {
      return route.fulfill({ json: { id: "transfer", code: "归还验收单", kind: "repayment", kindLabel: "归还", statusLabel: "执行完成",
          sourceCompany: "验收甲公司", destinationCompany: "验收乙公司", originalReference: "原债甲",
          amountCents: "400", sentCents: "400", receivedCents: "400", returnedCents: "0", inTransitCents: "0",
          approvalFlow: "proxy_repayment_parallel", canReadOriginalDebtCorrections: canReadCorrections, approvalActions: [], events: [
            { id: "settled-out", kind: "outgoing", amountCents: "400", occurredAt: "2026-07-24T00:00:00Z" },
            { id: "settled-in", kind: "incoming", amountCents: "400", occurredAt: "2026-07-25T00:00:00Z" },
          ],
      } });
    }
    if (url.pathname === path && request.method() === "GET") {
      correctionReads++;
      return route.fulfill({ json: {
        canRequest: !requested, canConfirm: !!requested && !confirmed,
        originalSource: "inter_entity:original", originalReference: "原债甲",
        candidates: requested ? [] : [{ originalSource: "operational:right-origin", reference: "原债乙", availableCents: "400" }],
        corrections: requested ? [{ id: "correction", targetOriginalSource: requested.targetOriginalSource,
          targetReference: "原债乙", reason: requested.reason, status: confirmed ? "confirmed" : "pending", requiresSelfReview: true,
          requestedAt: "2026-07-26T00:00:00Z", confirmedAt: confirmed ? "2026-07-27T00:00:00Z" : null }] : [],
        result: requested && url.searchParams.get("idempotencyKey") === requested.idempotencyKey
          ? { id: "correction", status: confirmed ? "confirmed" : "pending" } : undefined,
      } });
    }
    if (url.pathname === path && request.method() === "POST") {
      requests++;
      requested = request.postDataJSON();
      return route.abort("failed");
    }
    if (url.pathname === `${path}/correction/confirm` && request.method() === "POST") {
      expect(request.postDataJSON()).toMatchObject({ confirmationPassword: "synthetic-password", selfReviewReason: "本人复核已核实原债" });
      confirmed = true;
      return route.fulfill({ json: { id: "correction", status: "confirmed" } });
    }
    return route.fulfill({ json: {} });
  });
  await page.goto("/公司互转台账?transferId=transfer&correctionEventId=settled-out");
  const open = page.getByRole("button", { name: "查看归还原债与更正" });
  await expect(page.getByText("归还验收单 · 归还 · 执行完成")).toBeVisible();
  await expect(open).toHaveCount(0);
  expect(correctionReads).toBe(0);
  canReadCorrections = true;
  await page.reload();
  await expect(open).toHaveCount(1);
  const drawer = page.locator(".t-drawer:visible");
  const field = (label: string) => drawer.locator(".t-form__item").filter({ has: page.getByText(label, { exact: true }) });
  await expect(drawer.getByText("登记时归还的原债 原债甲")).toBeVisible();
  await expect(drawer.getByText("归还金额 ¥4.00", { exact: false })).toBeVisible();
  await expect(drawer.getByText("银行账号", { exact: false })).toHaveCount(0);
  await field("正确的原债").locator("input").click();
  await page.getByText("原债乙 · 可用 ¥4.00").click();
  await field("更正原因").locator("textarea").fill("本笔归还关联原债有误");
  await drawer.getByRole("button", { name: "提交原债更正申请" }).click();
  await expect(drawer.getByText("待财务主管复核 · 原债乙")).toBeVisible();
  expect(requested).toEqual({
    targetOriginalSource: "operational:right-origin", reason: "本笔归还关联原债有误", idempotencyKey: expect.any(String),
  });
  expect(requests).toBe(1);
  await field("当前登录密码").locator("input").fill("synthetic-password");
  await drawer.getByRole("button", { name: "确认更正", exact: true }).click();
  await expect(drawer.getByText("请填写本人复核原因和当前登录密码")).toBeVisible();
  await field("本人复核原因").locator("textarea").fill("本人复核已核实原债");
  await drawer.getByRole("button", { name: "确认更正", exact: true }).click();
  await expect(drawer.getByText("已更正 · 原债乙")).toBeVisible();
  await expect(drawer.getByText("登记时归还的原债 原债甲")).toBeVisible();
  await expect(drawer.getByRole("button", { name: "确认更正", exact: true })).toHaveCount(0);
});
