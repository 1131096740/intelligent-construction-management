import { expect, test, type Locator } from "@playwright/test";

test.use({ trace: "retain-on-failure", screenshot: "only-on-failure" });

type Fixture = {
  viewport: string; kind: "incidental_expense" | "general_procurement" | "contract_takeover";
  id: string; path: string; rootPath: string;
  session: { user: unknown; tokens: { accessToken: string; refreshToken: string } };
};

test("本地三类草稿删除：取消保留、确认彻底删除且审计留存", async ({ page, request }, info) => {
  const api = process.env.POL115_API_URL!;
  const fixtures = (JSON.parse(process.env.POL115_DELETION_FIXTURES!) as Fixture[]).filter(item => item.viewport === info.project.name);
  expect(fixtures).toHaveLength(3);
  const press = async (button: Locator) => {
    if (info.project.name === "mobile") await button.tap();
    else await button.click();
  };
  await page.goto("/login");
  for (const fixture of fixtures) {
    await page.evaluate(({ session }) => localStorage.setItem("jiangkong-web-admin-auth", JSON.stringify({ user: session.user, accessToken: session.tokens.accessToken, refreshToken: session.tokens.refreshToken })), fixture);
    await page.goto(fixture.path);
    await page.reload();
    const remove = page.getByRole("button", { name: "删除草稿", exact: true });
    await expect(remove).toBeEnabled();
    await press(remove);
    const history = fixture.kind === "contract_takeover";
    if (history) {
      await press(page.locator(".t-dialog:visible").getByRole("button", { name: "取消", exact: true }));
    } else {
      await press(page.getByRole("button", { name: "保留草稿", exact: true }));
    }
    const headers = { authorization: `Bearer ${fixture.session.tokens.accessToken}` };
    expect((await request.get(`${api}${fixture.rootPath}/${fixture.id}`, { headers })).status()).toBe(200);
    // Reopen after a real refresh: cancellation must retain the server draft.
    await page.reload();
    await expect(remove).toBeEnabled();
    await press(remove);
    const deleted = page.waitForResponse(response => response.request().method() === "POST" && response.url().endsWith(`${fixture.rootPath}/${fixture.id}/${history ? "abandonment" : "draft-deletion"}`));
    const confirm = history ? page.locator(".t-dialog:visible").getByRole("button", { name: "确认删除草稿", exact: true }) : page.getByRole("button", { name: "确认删除", exact: true });
    await expect(confirm).toBeEnabled();
    if (history) {
      // Wait for the modal and its positioning wrapper to finish opening before touch.
      await confirm.evaluate(async element => {
        const animations = [];
        for (let parent: Element | null = element; parent; parent = parent.parentElement) animations.push(...parent.getAnimations());
        await Promise.all(animations.filter(animation => animation.effect?.getTiming().iterations !== Infinity).map(animation => animation.finished));
      });
    }
    await press(confirm);
    const response = await deleted;
    expect(response.status(), await response.text()).toBe(201);
    expect((await request.get(`${api}${fixture.rootPath}/${fixture.id}`, { headers })).status()).toBe(404);
    await expect(page.getByRole("button", { name: history ? "确认删除草稿" : "确认删除", exact: true })).toHaveCount(0);
  }
});
