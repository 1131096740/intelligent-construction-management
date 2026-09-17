import { expect, test } from "@playwright/test";

type BrowserSession = { user: unknown; tokens: { accessToken: string; refreshToken: string } };

async function useSession(page: import("@playwright/test").Page, session: BrowserSession) {
  await page.evaluate((value) => localStorage.setItem("jiangkong-web-admin-auth", JSON.stringify(value)), {
    user: session.user, accessToken: session.tokens.accessToken, refreshToken: session.tokens.refreshToken
  });
  await page.reload();
}

test("财务员登记还款后由财务主管确认并更正，桌面和手机回读余额序列", async ({ page }, testInfo) => {
  const financeSession = JSON.parse(process.env.POL115_FINANCE_SESSION!) as BrowserSession;
  const financeDirectorSession = JSON.parse(process.env.POL115_FINANCE_DIRECTOR_SESSION!) as BrowserSession;
  const claimIds = JSON.parse(process.env.POL115_REPAYMENT_CLAIM_IDS!) as Record<string, string>;
  const claimId = claimIds[testInfo.project.name]!;
  const paymentMethod = `浏览器${testInfo.project.name}现金`;
  const password = process.env.POL115_ACCOUNT_PASSWORD!;
  await page.goto("/login");
  await page.evaluate((value) => localStorage.setItem("jiangkong-web-admin-auth", JSON.stringify(value)), {
    user: financeSession.user, accessToken: financeSession.tokens.accessToken, refreshToken: financeSession.tokens.refreshToken
  });
  await page.goto(`/费用与报销/${claimId}`);
  await page.getByText("资金结果", { exact: true }).click();
  await expect(page.getByText("当前借款余额").locator("..")).toContainText("¥0.01");

  await page.getByRole("button", { name: "登记员工还款", exact: true }).click();
  const repaymentDrawer = page.locator(".t-drawer").filter({ hasText: "登记员工还款" });
  await repaymentDrawer.getByPlaceholder("例如 1250").fill("1");
  await repaymentDrawer.getByPlaceholder("例如：银行转账").fill(paymentMethod);
  await repaymentDrawer.locator('input[type="file"]').setInputFiles({
    name: "浏览器还款凭证.png", mimeType: "image/png",
    buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=", "base64")
  });
  await repaymentDrawer.getByPlaceholder("用于确认本次资金事实").fill(password);
  await repaymentDrawer.getByRole("button", { name: "确认登记", exact: true }).click();
  const recordedResponse = page.waitForResponse((response) => response.url().endsWith(`/expense-claims/${claimId}/repayments`) && response.request().method() === "POST");
  await page.locator(".t-dialog").filter({ hasText: "确认登记借款资金事实" }).getByRole("button", { name: "确认写入", exact: true }).click();
  const recorded = await recordedResponse;
  expect(recorded.status(), await recorded.text()).toBe(201);
  const repaymentId = ((await recorded.json()) as { id: string }).id;
  const browserRow = page.locator(".expense-claim-detail__repayment-row").filter({ hasText: paymentMethod });
  await expect(browserRow).toContainText("待确认");
  await expect(page.getByText("当前借款余额").locator("..")).toContainText("¥0.01");

  await useSession(page, financeDirectorSession);
  await page.getByText("资金结果", { exact: true }).click();
  const directorRow = page.locator(".expense-claim-detail__repayment-row").filter({ hasText: paymentMethod });
  await directorRow.getByRole("button", { name: "确认入账", exact: true }).click();
  const confirmDialog = page.locator(".t-dialog").filter({ hasText: "确认员工还款" });
  await confirmDialog.getByPlaceholder("用于确认本次受控动作").fill(password);
  const confirmedResponse = page.waitForResponse((response) => response.url().endsWith(`/expense-claims/${claimId}/repayments/${repaymentId}/confirmation`) && response.request().method() === "POST");
  await confirmDialog.getByRole("button", { name: "确认入账", exact: true }).click();
  expect((await confirmedResponse).status()).toBe(201);
  await expect(directorRow).toContainText("已确认");
  await expect(page.getByText("当前借款余额").locator("..")).toContainText("¥0.00");

  await directorRow.getByRole("button", { name: "更正", exact: true }).click();
  const reversalDialog = page.locator(".t-dialog").filter({ hasText: "更正员工还款" });
  await reversalDialog.locator("textarea").fill("浏览器凭证金额录入错误");
  await reversalDialog.getByPlaceholder("用于确认本次受控动作").fill(password);
  const reversedResponse = page.waitForResponse((response) => response.url().endsWith(`/expense-claims/${claimId}/repayments/${repaymentId}/reversal`) && response.request().method() === "POST");
  await reversalDialog.getByRole("button", { name: "确认更正", exact: true }).click();
  expect((await reversedResponse).status()).toBe(201);
  await expect(directorRow).toContainText("已更正");
  await expect(page.getByText("当前借款余额").locator("..")).toContainText("¥0.01");
  await expect(page.locator("body")).not.toContainText(claimId);
  await expect(page.locator("body")).not.toContainText(repaymentId);
  expect(await page.locator(".expense-claim-detail").evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
});

test("桌面费用明细从粘贴事件批量录入两行并准确保存", async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "桌面表格粘贴接缝；手机卡片另有真实填写用例");
  const session = JSON.parse(process.env.POL115_BROWSER_SESSION!);
  await page.addInitScript((value) => localStorage.setItem("jiangkong-web-admin-auth", JSON.stringify(value)), {
    user: session.user, accessToken: session.tokens.accessToken, refreshToken: session.tokens.refreshToken
  });
  await page.goto("/费用与报销工作台");
  await page.getByRole("button", { name: "新建费用报销 / 借款", exact: true }).click();
  const drawer = page.locator(".t-drawer");
  await drawer.getByText("借款申请", { exact: true }).click();
  await drawer.getByText("费用报销", { exact: true }).click();
  await page.getByRole("button", { name: "下一步", exact: true }).click();
  const form = page.getByRole("region", { name: "费用申请单条业务表单" });
  await form.locator('[data-field="reason"] textarea').fill("两行粘贴报销");
  await form.locator('[data-field="requestedAmountYuan"] input').fill("0.03");
  await page.getByRole("button", { name: "添加费用行", exact: true }).click();
  const grid = page.locator("revo-grid");
  await grid.locator('[data-rgrow="0"][data-rgcol="0"]').click();
  await expect(grid.locator("revogr-clipboard")).toBeAttached();
  // Exercise the browser paste boundary without changing the user's OS clipboard.
  await page.evaluate(() => {
    const data = new DataTransfer();
    data.setData("text/plain", "办公费\t2026-09-17\t纸张\t1\t0.01\t发票\t\t第一行\n交通费\t2026-09-17\t公交\t1\t0.02\t发票\t\t第二行");
    document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  });
  await expect(grid.locator('[data-rgrow="0"][data-rgcol="0"]')).toHaveText("办公费");
  await expect(grid.locator('[data-rgrow="1"][data-rgcol="0"]')).toHaveText("交通费");
  await page.getByRole("button", { name: "下一步", exact: true }).click();
  await page.getByRole("button", { name: "下一步", exact: true }).click();
  const saved = page.waitForResponse((response) => response.url().endsWith("/expense-claims") && response.request().method() === "POST");
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  const response = await saved;
  expect(response.status()).toBe(201);
  const claim = await response.json();
  const detail = await request.get(`${process.env.POL115_API_URL}/expense-claims/${claim.id}`, { headers: { authorization: `Bearer ${session.tokens.accessToken}` } });
  expect(detail.ok()).toBe(true);
  expect(await detail.json()).toMatchObject({ status: "draft", requestedAmountCents: "3", lines: [{ purpose: "纸张", amountCents: "1" }, { purpose: "公交", amountCents: "2" }], entrySnapshots: [] });
});

test("报销表格或移动卡片保存一分钱明细并经真实接口回读", async ({ page, request }) => {
  const session = JSON.parse(process.env.POL115_BROWSER_SESSION!);
  await page.addInitScript((value) => localStorage.setItem("jiangkong-web-admin-auth", JSON.stringify(value)), {
    user: session.user, accessToken: session.tokens.accessToken, refreshToken: session.tokens.refreshToken
  });
  await page.goto("/费用与报销工作台");
  await page.getByRole("button", { name: "新建费用报销 / 借款", exact: true }).click();
  const drawer = page.locator(".t-drawer");
  await drawer.getByText("借款申请", { exact: true }).click();
  await drawer.getByText("费用报销", { exact: true }).click();
  await page.getByRole("button", { name: "下一步", exact: true }).click();
  const form = page.getByRole("region", { name: "费用申请单条业务表单" });
  await form.locator('[data-field="reason"] textarea').fill("真实浏览器报销明细");
  await form.locator('[data-field="requestedAmountYuan"] input').fill("0.01");
  if (page.viewportSize()!.width < 768) {
    const cards = page.locator(".business-entry-mobile-cards");
    await expect(cards).toBeVisible();
    await cards.locator('[data-field="expenseCategory"] input').fill("办公费");
    await cards.locator('[data-field="purpose"] input, [data-field="purpose"] textarea').fill("购买文具");
    await cards.locator('[data-field="amountYuan"] input').fill("0.01");
    expect(await cards.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  } else {
    const grid = page.locator("revo-grid");
    for (const [column, value] of [[0, "办公费"], [2, "购买文具"], [4, "0.01"]] as const) {
      const cell = grid.locator(`[data-rgrow="0"][data-rgcol="${column}"]`);
      await cell.dblclick();
      const editor = grid.locator("revogr-edit input");
      await editor.fill(value);
      await editor.press("Enter");
      await expect(editor).toBeHidden();
      await expect(cell).toHaveText(value);
    }
  }
  await page.getByRole("button", { name: "下一步", exact: true }).click();
  await page.getByRole("button", { name: "下一步", exact: true }).click();
  const saved = page.waitForResponse((response) => response.url().endsWith("/expense-claims") && response.request().method() === "POST");
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  const response = await saved;
  expect(response.status()).toBe(201);
  const claim = await response.json();
  const detail = await request.get(`${process.env.POL115_API_URL}/expense-claims/${claim.id}`, { headers: { authorization: `Bearer ${session.tokens.accessToken}` } });
  expect(detail.ok()).toBe(true);
  expect(await detail.json()).toMatchObject({ status: "draft", requestedAmountCents: "1", reason: "真实浏览器报销明细", lines: [{ expenseCategory: "办公费", purpose: "购买文具", amountCents: "1" }], entrySnapshots: [] });
  await page.goto(`/费用与报销/${claim.id}`);
  const submitted = page.waitForResponse((result) => result.url().endsWith(`/expense-claims/${claim.id}/submission`) && result.request().method() === "POST");
  await page.getByRole("button", { name: "提交审批", exact: true }).click();
  await page.getByRole("button", { name: "确认提交", exact: true }).click();
  expect((await submitted).status()).toBe(201);
  await page.getByText("提交记录", { exact: true }).click();
  const history = page.getByRole("region", { name: "费用申请提交记录" });
  await expect(history.getByRole("region", { name: "费用明细第 1 项" }).getByText("办公费", { exact: true })).toBeVisible();
  await expect(history.getByRole("region", { name: "费用明细第 1 项" }).getByText("购买文具", { exact: true })).toBeVisible();
  await expect(history.getByRole("region", { name: "费用明细第 1 项" }).getByText("0.01 元", { exact: true })).toBeVisible();
  expect(await history.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
});

test("借款先保存草稿及附件，仅明确提交后冻结审批内容", async ({ page, request }) => {
  const session = JSON.parse(process.env.POL115_BROWSER_SESSION!);
  const api = process.env.POL115_API_URL!;
  await page.addInitScript((value) => localStorage.setItem("jiangkong-web-admin-auth", JSON.stringify(value)), {
    user: session.user, accessToken: session.tokens.accessToken, refreshToken: session.tokens.refreshToken
  });
  await page.goto("/费用与报销工作台");
  await page.getByRole("button", { name: "新建费用报销 / 借款", exact: true }).click();
  await page.locator(".t-drawer").getByText("借款申请", { exact: true }).click();
  await page.getByRole("button", { name: "下一步", exact: true }).click();
  const form = page.getByRole("region", { name: "费用申请单条业务表单" });
  await expect(form).toBeVisible();
  await form.locator('[data-field="reason"] textarea').fill("真实浏览器项目借款");
  await form.locator('[data-field="requestedAmountYuan"] input').fill("0.01");
  expect(await form.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.getByRole("button", { name: "下一步", exact: true }).click();
  const payeeForm = page.getByRole("region", { name: "费用收款单条业务表单" });
  await expect(payeeForm).toBeVisible();
  await payeeForm.locator('[data-field="payeeName"] input').fill("合成收款人");
  await payeeForm.locator('[data-field="payeeBankAccount"] input').fill("000012340001");
  await payeeForm.locator('[data-field="loanExpectedClearanceOn"] input').click();
  await page.locator(".t-date-picker__cell--now").click();
  await page.getByRole("button", { name: "下一步", exact: true }).click();
  const saved = page.waitForResponse((response) => response.url().endsWith("/expense-claims") && response.request().method() === "POST");
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  const response = await saved;
  expect(response.status()).toBe(201);
  const claim = await response.json();
  const detail = await request.get(`${api}/expense-claims/${claim.id}`, { headers: { authorization: `Bearer ${session.tokens.accessToken}` } });
  expect(detail.ok()).toBe(true);
  expect(await detail.json()).toMatchObject({ status: "draft", requestedAmountCents: "1", reason: "真实浏览器项目借款", payeeNameSnapshot: "合成收款人", payeeBankAccountSnapshot: "000012340001", entrySnapshots: [] });
  await page.goto(`/费用与报销/${claim.id}`);
  await page.getByText("附件与证据", { exact: true }).click();
  await page.locator('.expense-claim-detail__attachments input[type="file"]').setInputFiles({
    name: "合成费用凭证.png", mimeType: "image/png",
    buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=", "base64")
  });
  const uploaded = page.waitForResponse((response) => response.url().endsWith(`/expense-claims/${claim.id}/draft-attachment-file-uploads`) && response.request().method() === "POST");
  await page.getByRole("button", { name: "上传并绑定附件", exact: true }).click();
  const uploadResponse = await uploaded;
  expect(uploadResponse.status(), await uploadResponse.text()).toBe(201);
  const attachmentList = page.viewportSize()!.width < 768
    ? page.getByRole("region", { name: "费用附件列表" })
    : page.locator(".expense-claim-detail__attachments table");
  await expect(attachmentList.getByText("合成费用凭证.png", { exact: true })).toBeVisible();
  expect(await page.locator(".expense-claim-detail__attachment-panel").evaluate((element) => element.getBoundingClientRect().right <= window.innerWidth)).toBe(true);
  const withAttachment = await request.get(`${api}/expense-claims/${claim.id}`, { headers: { authorization: `Bearer ${session.tokens.accessToken}` } });
  expect(withAttachment.ok()).toBe(true);
  expect(await withAttachment.json()).toMatchObject({ status: "draft", attachments: [{ fileName: "合成费用凭证.png", category: "receipt_or_other" }], entrySnapshots: [] });
  const submitted = page.waitForResponse((result) => result.url().endsWith(`/expense-claims/${claim.id}/submission`) && result.request().method() === "POST");
  await page.getByRole("button", { name: "提交审批", exact: true }).click();
  await page.getByRole("button", { name: "确认提交", exact: true }).click();
  const submission = await submitted;
  expect(submission.status(), await submission.text()).toBe(201);
  await expect(attachmentList.getByText("审批快照已冻结", { exact: true })).toBeVisible();
  await expect(attachmentList.getByRole("button", { name: "移除", exact: true })).toHaveCount(0);
  const frozen = await request.get(`${api}/expense-claims/${claim.id}`, { headers: { authorization: `Bearer ${session.tokens.accessToken}` } });
  expect(frozen.ok()).toBe(true);
  const frozenDetail = await frozen.json();
  expect(frozenDetail).toMatchObject({ status: "approval_pending", requestedAmountCents: "1", attachments: [{ fileName: "合成费用凭证.png", stage: "approval_frozen" }] });
  expect(frozenDetail.entrySnapshots).toHaveLength(1);
  expect(frozenDetail.entrySnapshots[0]).toMatchObject({ valuesSnapshot: { reason: "真实浏览器项目借款", requestedAmountCents: "1", payeeBankAccount: "000012340001" } });
  await page.getByText("提交记录", { exact: true }).click();
  const history = page.getByRole("region", { name: "费用申请提交记录" });
  await expect(history.getByText("真实浏览器项目借款", { exact: true })).toBeVisible();
  await expect(history.getByText("000012340001", { exact: true })).toBeVisible();
  await expect(history.getByText("0.01 元", { exact: true })).toBeVisible();
  await expect(history).not.toContainText(frozenDetail.projectId);
  expect(await history.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.reload();
  await page.getByText("提交记录", { exact: true }).click();
  await expect(history.getByText("000012340001", { exact: true })).toBeVisible();
});
