import { expect, test } from "@playwright/test";

const settlementId = process.env.POL114_REAL_SETTLEMENT_ID;
const phone = process.env.POL114_REAL_SETTLEMENT_PHONE;
const password = process.env.POL114_REAL_SETTLEMENT_PASSWORD;

test.describe("#114 real settlement attachment purpose history", () => {
  test.skip(!settlementId || !phone || !password, "requires the disposable PG16 public HTTP fixture");

  test("renders both frozen attachment purposes without technical ids", async ({ page }, testInfo) => {
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
    expect(attachmentHistory).toHaveLength(2);
    expect(new Set(attachmentHistory.map((snapshot) => snapshot.values["purpose"])))
      .toEqual(new Set(["现场签证单", "计量凭证"]));

    const mobile = testInfo.project.name.includes("mobile");
    const regions = page.getByRole("region", {
      name: mobile ? "结算明细附件用途移动业务卡片" : "结算明细附件用途业务台账表格"
    });
    await expect(regions).toHaveCount(2);
    await expect(regions.nth(0)).toBeVisible();
    await expect(regions.nth(1)).toBeVisible();
    for (const purpose of ["现场签证单", "计量凭证"]) {
      if (mobile) {
        await expect(regions.locator(`input[disabled][value="${purpose}"]`)).toBeVisible();
        await expect(regions.locator(`input[disabled][value="${purpose}"]`)).toHaveValue(purpose);
      } else {
        await expect(regions.getByRole("gridcell", { name: purpose, exact: true })).toBeVisible();
      }
    }
    const bodyText = await page.locator("body").innerText();
    for (const snapshot of attachmentHistory) expect(bodyText).not.toContain(snapshot.target.entityId);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  });
});
