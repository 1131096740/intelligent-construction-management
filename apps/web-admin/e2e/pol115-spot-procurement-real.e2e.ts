import { expect, test, type Page } from "@playwright/test";

import { gotoWithSingleWebKitInternalErrorRetry } from "./support/playwright-navigation";

type Session = { user: unknown; tokens: { accessToken: string; refreshToken: string } };

async function useSession(page: Page, session: Session) {
  await page.evaluate((value) => localStorage.setItem("jiangkong-web-admin-auth", JSON.stringify(value)), {
    user: session.user, accessToken: session.tokens.accessToken, refreshToken: session.tokens.refreshToken
  });
  await page.reload();
}

test("零采申请退回修订后完成两级审批，桌面与390窄屏回读冻结版本", async ({ page, request, context }, testInfo) => {
  const applicant = JSON.parse(process.env.POL115_BROWSER_SESSION!) as Session;
  const director = JSON.parse(process.env.POL115_SPOT_DIRECTOR_SESSION!) as Session;
  const manager = JSON.parse(process.env.POL115_SPOT_MANAGER_SESSION!) as Session;
  const projectId = (JSON.parse(process.env.POL115_SPOT_PROJECT_IDS!) as Record<string, string>)[testInfo.project.name]!;
  const headers = { authorization: `Bearer ${applicant.tokens.accessToken}` };
  const label = testInfo.project.name;
  await gotoWithSingleWebKitInternalErrorRetry(page, "/login");
  await useSession(page, applicant);
  await gotoWithSingleWebKitInternalErrorRetry(page, "/零星采购工作台");
  await page.getByRole("button", { name: "新建采购申请", exact: true }).click();
  const createDialog = page.locator(".t-dialog").filter({ hasText: "新建零星/小额材料采购申请表" });
  await createDialog.getByPlaceholder("请选择项目").click();
  const projectName = `零采${testInfo.project.name}隔离项目`;
  const projectOption = page
    .locator(".t-select__dropdown:visible")
    .locator(".t-select-option")
    .filter({ hasText: new RegExp(` · ${projectName}$`, "u") });
  await expect(projectOption).toHaveCount(1);
  await projectOption.click();
  await expect(page.locator(".t-select__dropdown:visible")).toHaveCount(0);
  await createDialog.getByPlaceholder("如：工程部").fill("浏览器工程部");
  await createDialog.getByPlaceholder("如：杨帅").fill("浏览器申请人");
  const arrivalDateInput = createDialog.getByPlaceholder("请选择日期");
  await arrivalDateInput.click();
  const datePanel = page.locator(".t-date-picker__panel:visible");
  await expect(datePanel).toBeVisible();
  const monthController = datePanel.locator(".t-date-picker__header-controller-month");
  await expect(monthController.getByRole("textbox")).toHaveValue("9 月");
  await monthController.click();
  const octoberOption = datePanel
    .locator(".t-date-picker__header-controller-month-popup:visible")
    .locator(".t-select-option")
    .filter({ hasText: /^10 月$/u });
  await expect(octoberOption).toHaveCount(1);
  await octoberOption.click();
  await expect(monthController.getByRole("textbox")).toHaveValue("10 月");
  await datePanel
    .locator(".t-date-picker__cell:not(.t-date-picker__cell--additional)")
    .getByText("3", { exact: true })
    .click();
  await expect(arrivalDateInput).toHaveValue("2026-10-03");
  await createDialog.getByPlaceholder("说明现场为什么需要本次零星采购").fill(`浏览器旧版原因-${label}`);
  if (testInfo.project.name === "desktop") {
    const grid = createDialog.locator("revo-grid");
    await context.grantPermissions(["clipboard-read", "clipboard-write"], {
      origin: "http://127.0.0.1:4215"
    });
    await page.evaluate(async () => {
      await navigator.clipboard.writeText("砂子\t中砂\t吨\t2.50\t现场使用\n水泥\tP.O 42.5\t袋\t0.01\t补充用料");
    });
    await grid.locator('[data-rgrow="0"][data-rgcol="0"]').click();
    await page.keyboard.press("ControlOrMeta+V");
    for (const [column, value] of ["水泥", "P.O 42.5", "袋", "0.01", "补充用料"].entries()) {
      await expect(grid.locator(`[data-rgrow="1"][data-rgcol="${column}"]`)).toHaveText(value);
    }
  } else {
    const cards = createDialog.locator(".procurement-line-editor__cards");
    const first = cards.locator("article").first();
    await first.getByText("材料名称", { exact: true }).locator("..").locator("input").fill("砂子");
    await first.getByText("单位", { exact: true }).locator("..").locator("input").fill("吨");
    await first.getByText("数量（最多 2 位小数）", { exact: true }).locator("..").locator("input").fill("2.50");
    await createDialog.getByRole("button", { name: "添加材料", exact: true }).click();
    const second = cards.locator("article").nth(1);
    await second.getByText("材料名称", { exact: true }).locator("..").locator("input").fill("水泥");
    await second.getByText("单位", { exact: true }).locator("..").locator("input").fill("袋");
    await second.getByText("数量（最多 2 位小数）", { exact: true }).locator("..").locator("input").fill("0.01");
  }
  const created = page.waitForResponse((response) => response.url().endsWith("/spot-procurements") && response.request().method() === "POST");
  await createDialog.getByRole("button", { name: "保存草稿", exact: true }).click();
  const createdResponse = await created;
  expect(createdResponse.status(), await createdResponse.text()).toBe(201);
  const id = ((await createdResponse.json()) as { procurementId: string }).procurementId;
  await page.waitForURL((url) => decodeURIComponent(url.pathname) === `/零星采购/${id}`);
  const panelByHeading = (name: string) => page.locator("section.detail-panel").filter({
    has: page.getByRole("heading", { name, exact: true })
  });
  const processPanel = page.locator("section.detail-panel").filter({
    has: page.getByRole("heading", { name: "审批与动作", exact: true })
  });
  await page.locator(".t-tabs").getByText("材料与附件", { exact: true }).click();
  await expect(panelByHeading("材料明细").getByText("水泥", { exact: true })).toBeVisible();
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
  await gotoWithSingleWebKitInternalErrorRetry(page, "/login");
  await useSession(page, finance);
  await gotoWithSingleWebKitInternalErrorRetry(page, `/零星材料付款/${coordinates.paymentId}`);
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
  await gotoWithSingleWebKitInternalErrorRetry(page, `/零星材料付款/${coordinates.paymentId}`);
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
  await gotoWithSingleWebKitInternalErrorRetry(page, "/零星材料付款工作台");
  await gotoWithSingleWebKitInternalErrorRetry(page, `/零星材料付款/${coordinates.paymentId}`);
  await expect(page.locator(".payment-refund-receipt").getByText("¥200.00", { exact: true })).toBeVisible();
  const receiptRead = await request.get(`${process.env.POL115_API_URL}/spot-procurements/${coordinates.procurementId}/receipt`, { headers: { authorization: `Bearer ${finance.tokens.accessToken}` } });
  expect(receiptRead.status()).toBe(403);
  await expect(page.locator("body")).not.toContainText(coordinates.paymentId);
  expect(await page.locator(".spot-payment-detail").evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
});
