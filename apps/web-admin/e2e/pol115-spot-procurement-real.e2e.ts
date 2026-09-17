import { expect, test, type Page } from "@playwright/test";

type Session = { user: unknown; tokens: { accessToken: string; refreshToken: string } };

async function useSession(page: Page, session: Session) {
  await page.evaluate((value) => localStorage.setItem("jiangkong-web-admin-auth", JSON.stringify(value)), {
    user: session.user, accessToken: session.tokens.accessToken, refreshToken: session.tokens.refreshToken
  });
  await page.reload();
}

test("零采申请退回修订后完成两级审批，桌面与390窄屏回读冻结版本", async ({ page, request }, testInfo) => {
  const applicant = JSON.parse(process.env.POL115_BROWSER_SESSION!) as Session;
  const director = JSON.parse(process.env.POL115_SPOT_DIRECTOR_SESSION!) as Session;
  const manager = JSON.parse(process.env.POL115_SPOT_MANAGER_SESSION!) as Session;
  const projectId = (JSON.parse(process.env.POL115_SPOT_PROJECT_IDS!) as Record<string, string>)[testInfo.project.name]!;
  const headers = { authorization: `Bearer ${applicant.tokens.accessToken}` };
  const label = testInfo.project.name;
  const upload = await request.post(`${process.env.POL115_API_URL}/spot-procurements/projects/${projectId}/draft-file-uploads`, {
    headers, multipart: { file: { name: `浏览器报价-${label}.png`, mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=", "base64") } }
  });
  expect(upload.status(), await upload.text()).toBe(201);
  const fileId = ((await upload.json()) as { id: string }).id;
  const created = await request.post(`${process.env.POL115_API_URL}/spot-procurements`, { headers, data: {
    projectId, applicationDepartment: "浏览器工程部", applicationName: "浏览器申请人", requestedArrivalAt: "2026-10-03",
    reason: `浏览器旧版原因-${label}`, lines: [{ materialName: "砂子", specification: "中砂", unit: "吨", quantity: "2", note: "现场使用" }],
    attachments: [{ fileId, category: "merchant_quote" }]
  } });
  expect(created.status(), await created.text()).toBe(201);
  const id = ((await created.json()) as { procurementId: string }).procurementId;
  expect(id).toEqual(expect.any(String));

  await page.goto("/login");
  await useSession(page, applicant);
  await page.goto(`/零星采购/${id}`);
  const panelByHeading = (name: string) => page.locator("section.detail-panel").filter({
    has: page.getByRole("heading", { name, exact: true })
  });
  const processPanel = page.locator("section.detail-panel").filter({
    has: page.getByRole("heading", { name: "审批与动作", exact: true })
  });
  await page.locator(".t-tabs").getByText("材料与附件", { exact: true }).click();
  await expect(panelByHeading("材料明细").getByText(`浏览器报价-${label}.png`, { exact: true })).toBeVisible();
  await page.locator(".t-tabs").getByText("审批与动作", { exact: true }).click();
  const initialSubmission = page.waitForResponse((response) => response.url().endsWith(`/spot-procurements/${id}/submission`) && response.request().method() === "POST");
  await processPanel.getByRole("button", { name: "提交采购审批", exact: true }).click();
  expect((await initialSubmission).status()).toBe(201);
  await expect(page.getByText("零星材料采购申请已提交审批。", { exact: true })).toBeVisible();

  await useSession(page, director);
  await page.locator(".t-tabs").getByText("审批与动作", { exact: true }).click();
  await processPanel.getByRole("button", { name: "退回申请人", exact: true }).click();
  const returnDialog = page.locator(".t-dialog").filter({ hasText: "退回采购申请人" });
  await returnDialog.locator("textarea").fill("请补充具体施工区域");
  const returned = page.waitForResponse((response) => response.url().endsWith(`/spot-procurements/${id}/approval`) && response.request().method() === "POST");
  await returnDialog.getByRole("button", { name: "确认退回", exact: true }).click();
  expect((await returned).status()).toBe(201);
  await expect(page.getByText("采购申请已退回，并已生成新的修改草稿。", { exact: true })).toBeVisible();
  await expect(returnDialog).toBeHidden();

  await useSession(page, applicant);
  await page.locator(".t-tabs").getByText("审批与动作", { exact: true }).click();
  await processPanel.getByRole("button", { name: "编辑采购草稿", exact: true }).click();
  const editDialog = page.locator(".t-dialog").filter({ hasText: "编辑零星材料采购草稿" });
  await editDialog.locator("label").filter({ hasText: "物资用途及采购原因" }).locator("textarea").fill(`浏览器新版原因-${label}`);
  const saved = page.waitForResponse((response) => response.url().endsWith(`/spot-procurements/${id}/draft`) && response.request().method() === "PATCH");
  await editDialog.getByRole("button", { name: "保存草稿", exact: true }).click();
  expect((await saved).status()).toBe(200);
  await expect(editDialog).toBeHidden();
  await page.locator(".t-tabs").getByText("采购申请", { exact: true }).click();
  const overviewPanel = panelByHeading("零星/小额材料采购申请表");
  await expect(overviewPanel.locator(".detail-grid").getByText(`浏览器新版原因-${label}`, { exact: true })).toBeVisible();
  const versionList = overviewPanel.locator(".version-list");
  const versionTwo = versionList.getByRole("row").filter({ hasText: "V2" });
  const versionOne = versionList.getByRole("row").filter({ hasText: "V1" });
  await expect(versionTwo.getByText(`浏览器新版原因-${label}`, { exact: true })).toBeVisible();
  await expect(versionOne.getByText(`浏览器旧版原因-${label}`, { exact: true })).toBeVisible();
  await page.locator(".t-tabs").getByText("审批与动作", { exact: true }).click();
  const resubmission = page.waitForResponse((response) => response.url().endsWith(`/spot-procurements/${id}/submission`) && response.request().method() === "POST");
  await processPanel.getByRole("button", { name: "提交采购审批", exact: true }).click();
  expect((await resubmission).status()).toBe(201);
  await expect(page.getByText("零星材料采购申请已提交审批。", { exact: true })).toBeVisible();

  for (const [session, node] of [[director, "物资主管审批"], [manager, "项目经理审批"]] as const) {
    await useSession(page, session);
    await page.locator(".t-tabs").getByText("审批与动作", { exact: true }).click();
    await expect(page.locator(".business-detail-header__facts").getByText(node, { exact: true })).toBeVisible();
    await processPanel.getByRole("button", { name: "审批通过", exact: true }).click();
    const dialog = page.locator(".t-dialog").filter({ hasText: "确认通过采购审批" });
    const approved = page.waitForResponse((response) => response.url().endsWith(`/spot-procurements/${id}/approval`) && response.request().method() === "POST");
    await dialog.getByRole("button", { name: "确认通过", exact: true }).click();
    expect((await approved).status()).toBe(201);
    await expect(page.getByText("采购审批已通过。", { exact: true })).toBeVisible();
    await expect(dialog).toBeHidden();
  }

  await expect(page.locator(".business-detail-header").getByText("采购已批，办理中", { exact: true })).toBeVisible();
  await page.locator(".t-tabs").getByText("采购申请", { exact: true }).click();
  await expect(overviewPanel.locator(".detail-grid").getByText(`浏览器新版原因-${label}`, { exact: true })).toBeVisible();
  await expect(page.locator("body")).not.toContainText(id);
  expect(await page.locator(".spot-procurement-detail").evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
});

test("付款详情登记退款并回读，桌面与390窄屏保持隔离", async ({ page, request }, testInfo) => {
  const finance = JSON.parse(process.env.POL115_SPOT_REFUND_SESSION!) as Session;
  const coordinates = (JSON.parse(process.env.POL115_SPOT_REFUND_COORDINATES!) as Record<string, { procurementId: string; paymentId: string }>)[testInfo.project.name]!;
  await page.goto("/login");
  await useSession(page, finance);
  await page.goto(`/零星材料付款/${coordinates.paymentId}`);
  const form = page.locator(".payment-refund-form");
  await expect(form.getByText("待退款整笔差额", { exact: true })).toBeVisible();
  await expect(form.getByText("¥200.00", { exact: true })).toBeVisible();
  let releaseCapability!: () => void;
  const capabilityReleased = new Promise<void>((resolve) => { releaseCapability = resolve; });
  let delayCapability = true;
  let refundMutations = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && (request.url().includes("refund-voucher-file-uploads") || request.url().endsWith(`/spot-procurements/${coordinates.procurementId}/refunds`))) {
      refundMutations += 1;
    }
  });
  await page.route(`**/spot-procurement-payments/${coordinates.paymentId}`, async (route) => {
    if (delayCapability && route.request().method() === "GET") {
      delayCapability = false;
      await capabilityReleased;
    }
    await route.continue();
  });
  await form.locator('input[type="file"]').setInputFiles({ name: `${testInfo.project.name}-退款.png`, mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=", "base64") });
  await form.getByRole("button", { name: "确认登记退款", exact: true }).click();
  await page.getByRole("button", { name: "确定", exact: true }).click();
  await expect.poll(() => delayCapability, { timeout: 10_000, message: "退款提交未发起精确付款能力读取" }).toBe(false);
  const leavePayment = page.waitForURL((url) => decodeURIComponent(url.pathname) === "/零星材料付款工作台");
  await page.getByRole("button", { name: "返回工作台", exact: true }).click();
  await leavePayment;
  await expect(page.getByRole("heading", { name: "零星材料付款工作台", exact: true })).toBeVisible();
  const capabilityResponse = page.waitForResponse((response) =>
    response.request().method() === "GET" &&
    response.url().endsWith(`/spot-procurement-payments/${coordinates.paymentId}`)
  );
  releaseCapability();
  expect((await capabilityResponse).status()).toBe(200);
  await page.waitForLoadState("networkidle");
  await expect(page.locator(".payment-refund-receipt")).toHaveCount(0);
  await expect(page.getByText("退款到账事实和凭证已登记", { exact: true })).toHaveCount(0);
  expect(refundMutations).toBe(0);
  await page.unroute(`**/spot-procurement-payments/${coordinates.paymentId}`);
  await page.goto(`/零星材料付款/${coordinates.paymentId}`);
  const retryForm = page.locator(".payment-refund-form");
  await expect(retryForm.getByText("待退款整笔差额", { exact: true })).toBeVisible();
  await retryForm.locator('input[type="file"]').setInputFiles({ name: `${testInfo.project.name}-退款.png`, mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=", "base64") });
  const refundResponse = page.waitForResponse((response) => response.url().endsWith(`/spot-procurements/${coordinates.procurementId}/refunds`) && response.request().method() === "POST");
  await retryForm.getByRole("button", { name: "确认登记退款", exact: true }).click();
  await page.getByRole("button", { name: "确定", exact: true }).click();
  expect((await refundResponse).status()).toBe(201);
  const receipt = page.locator(".payment-refund-receipt");
  await expect(receipt.getByText("¥200.00", { exact: true })).toBeVisible();
  await expect(receipt.getByText("已办结", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.locator(".payment-refund-receipt").getByText("¥200.00", { exact: true })).toBeVisible();
  await page.goto("/零星材料付款工作台");
  await page.goto(`/零星材料付款/${coordinates.paymentId}`);
  await expect(page.locator(".payment-refund-receipt").getByText("¥200.00", { exact: true })).toBeVisible();
  const receiptRead = await request.get(`${process.env.POL115_API_URL}/spot-procurements/${coordinates.procurementId}/receipt`, { headers: { authorization: `Bearer ${finance.tokens.accessToken}` } });
  expect(receiptRead.status()).toBe(403);
  await expect(page.locator("body")).not.toContainText(coordinates.paymentId);
  expect(await page.locator(".spot-payment-detail").evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
});
