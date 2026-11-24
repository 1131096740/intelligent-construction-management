import { expect, test } from "@playwright/test";

const settlementId = process.env.POL114_REAL_SETTLEMENT_ID;
const phone = process.env.POL114_REAL_SETTLEMENT_PHONE;
const password = process.env.POL114_REAL_SETTLEMENT_PASSWORD;
const expectedLines = JSON.parse(process.env.POL114_REAL_SETTLEMENT_LINES ?? "[]") as Array<{
  name: string;
  amountYuan: string;
  quantity?: string;
}>;
const expectedAttachmentPurposes = JSON.parse(
  process.env.POL114_REAL_SETTLEMENT_ATTACHMENT_PURPOSES ?? "[]"
) as string[];

const signedId = process.env.POL114_SIGNED_SETTLEMENT_ID;

if (!signedId) test.describe("#114 real settlement exact financial history", () => {
  test.skip(
    !settlementId || !phone || !password || expectedLines.length === 0,
    "requires the disposable PG16 public HTTP fixture"
  );

  test("renders frozen line values and attachment purposes without technical ids", async ({ page }, testInfo) => {
    await page.setViewportSize(testInfo.project.name.includes("mobile")
      ? { width: 390, height: 844 }
      : { width: 1366, height: 768 });
    await page.goto("/login");
    await page.getByPlaceholder("请输入手机号").fill(phone!);
    await page.getByPlaceholder("请输入密码").fill(password!);
    await page.getByRole("button", { name: "登录" }).click();
    await expect.poll(() => decodeURI(new URL(page.url()).pathname)).toBe("/首页");

    const detailResponsePromise = page.waitForResponse((response) =>
      response.request().method() === "GET" &&
      new URL(response.url()).pathname === `/api/settlements/${encodeURIComponent(settlementId!)}`
    );
    await page.goto(`/结算管理/${encodeURIComponent(settlementId!)}`);
    const detailResponse = await detailResponsePromise;
    expect(detailResponse.ok()).toBeTruthy();
    const detail = await detailResponse.json() as {
      businessEntryHistory?: Array<{
        sceneKey: string;
        target: { entityId: string };
        values: Record<string, unknown>;
      }>;
    };
    const attachmentHistory = detail.businessEntryHistory?.filter(
      (snapshot) => snapshot.sceneKey === "settlement_line_attachment_purpose"
    ) ?? [];
    expect(attachmentHistory).toHaveLength(expectedAttachmentPurposes.length);
    expect(new Set(attachmentHistory.map((snapshot) => snapshot.values["purpose"])))
      .toEqual(new Set(expectedAttachmentPurposes));
    const lineHistory = detail.businessEntryHistory?.filter(
      (snapshot) => snapshot.sceneKey === "settlement_line"
    ) ?? [];
    expect(lineHistory).toHaveLength(expectedLines.length);
    expect(lineHistory.map((snapshot) => snapshot.values)).toEqual(expect.arrayContaining(
      expectedLines.map((line) => expect.objectContaining(line))
    ));

    const mobile = testInfo.project.name.includes("mobile");
    const regions = page.getByRole("region", {
      name: mobile ? "结算明细附件用途移动业务卡片" : "结算明细附件用途业务台账表格"
    });
    await expect(regions).toHaveCount(expectedAttachmentPurposes.length);
    for (let index = 0; index < expectedAttachmentPurposes.length; index += 1) {
      await expect(regions.nth(index)).toBeVisible();
    }
    for (const purpose of expectedAttachmentPurposes) {
      if (mobile) {
        await expect(regions.locator(`input[disabled][value="${purpose}"]`)).toBeVisible();
        await expect(regions.locator(`input[disabled][value="${purpose}"]`)).toHaveValue(purpose);
      } else {
        await expect(regions.getByRole("gridcell", { name: purpose, exact: true })).toBeVisible();
      }
    }
    const lineRegion = page.getByRole("region", {
      name: mobile ? "结算明细移动业务卡片" : "结算明细业务台账表格"
    });
    await expect(lineRegion).toHaveCount(expectedLines.length);
    for (let index = 0; index < expectedLines.length; index += 1) {
      await expect(lineRegion.nth(index)).toBeVisible();
    }
    for (const line of expectedLines) {
      for (const value of [line.name, line.amountYuan, ...(line.quantity === undefined ? [] : [line.quantity])]) {
        if (mobile) {
          await expect(lineRegion.locator(`input[disabled][value="${value}"]`)).toBeVisible();
          await expect(lineRegion.locator(`input[disabled][value="${value}"]`)).toHaveValue(value);
        } else {
          await expect(lineRegion.getByRole("gridcell", { name: value, exact: true })).toBeVisible();
        }
      }
    }
    const bodyText = await page.locator("body").innerText();
    for (const snapshot of attachmentHistory) expect(bodyText).not.toContain(snapshot.target.entityId);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  });
});

if (signedId) test("reads the confirmed signed settlement, original and cumulative amount", async ({ page }) => {
  const projectId = process.env.POL114_SIGNED_SETTLEMENT_PROJECT_ID!;
  const number = process.env.POL114_SIGNED_SETTLEMENT_NUMBER!;
  const amount = process.env.POL114_SIGNED_SETTLEMENT_AMOUNT!;
  const api = process.env.POL114_SIGNED_SETTLEMENT_API!;
  expect([projectId, phone, password, number, amount, api].every(Boolean)).toBeTruthy();
  const path = `/api/projects/${encodeURIComponent(projectId)}/signed-contract-settlements`;
  await page.route(url => url.pathname === path || url.pathname.startsWith(`${path}/`), async route => {
    const url = new URL(route.request().url());
    const response = await route.fetch({ url: new URL(url.pathname.slice(4) + url.search, api).href });
    await route.fulfill({ response });
  });
  await page.goto("/login");
  await page.getByPlaceholder("请输入手机号").fill(phone!);
  await page.getByPlaceholder("请输入密码").fill(password!);
  await page.getByRole("button", { name: "登录" }).click();
  await expect.poll(() => decodeURI(new URL(page.url()).pathname)).toBe("/首页");

  const rowsReceived = page.waitForResponse(response => response.request().method() === "GET" &&
    new URL(response.url()).pathname === path);
  await page.goto(`/结算工作台/已签登记?${new URLSearchParams({ projectId, settlementId: signedId })}`);
  const list = await rowsReceived;
  expect(list.ok()).toBeTruthy();
  expect(await list.json()).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: signedId, number, amountYuan: amount, state: "confirmed" })
  ]));
  await expect(page.getByRole("heading", { name: "已签结算登记" })).toBeVisible();
  await expect(page.getByText("已确认累计：150.0000 元", { exact: true })).toBeVisible();
  await expect(page.locator(`input[value="${number}"]`)).toHaveValue(number);
  await expect(page.getByText(`${number}.pdf`, { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "下载", exact: true })).toBeVisible();
  expect(await page.locator("body").innerText()).not.toContain(signedId);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
});
