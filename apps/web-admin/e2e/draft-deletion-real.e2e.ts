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
    const history = fixture.kind === "contract_takeover";
    const remove = page.getByRole("button", { name: "删除草稿", exact: true });
    await expect(remove).toBeEnabled();
    const detailReads: string[] = [];
    const countDetailReads = (req: { method(): string; url(): string }) => {
      if (req.method() === "GET" && new URL(req.url()).pathname.endsWith(`${fixture.rootPath}/${fixture.id}`)) detailReads.push(req.url());
    };
    if (history) {
      // Observe only after the initial detail has rendered. A GET must not repair the mutation response.
      page.on("request", countDetailReads);
      const uploader = page.locator(".evidence-uploader");
      const input = uploader.locator('input[type="file"]');
      await input.setInputFiles({ name: "本次合成连续删除.pdf", mimeType: "application/pdf", buffer: Buffer.from(process.env.POL115_DELETION_PDF_BASE64!, "base64") });
      const uploadRoute = `**${fixture.rootPath}/files`;
      await page.route(uploadRoute, route => route.abort("failed"), { times: 1 });
      await press(uploader.getByRole("button", { name: "上传接管资料", exact: true }));
      const error = uploader.getByRole("alert");
      await expect(error).toContainText(/网络|连接|失败|重试/);
      expect(await input.evaluate((element: HTMLInputElement) => element.files?.[0]?.name)).toBe("本次合成连续删除.pdf");
      const retry = uploader.getByRole("button", { name: "重试上传", exact: true });
      await expect(retry).toBeEnabled();
      const errorBox = await error.boundingBox(); const buttonBox = await retry.boundingBox();
      expect(errorBox).not.toBeNull(); expect(buttonBox).not.toBeNull();
      expect(Math.abs(errorBox!.y - (buttonBox!.y + buttonBox!.height))).toBeLessThan(140);
      await page.screenshot({ path: info.outputPath("历史接管上传失败保留文件.png"), fullPage: true });
      const attached = page.waitForResponse(response => response.request().method() === "POST" && new URL(response.url()).pathname.endsWith(`${fixture.rootPath}/${fixture.id}/evidence-files`));
      await press(retry);
      const attachment = await attached;
      expect(attachment.status(), await attachment.text()).toBe(201);
      expect(await attachment.json()).toMatchObject({
        lifecycleKind: "pristine_draft", lifecycleBlockers: [],
        availableActions: [expect.objectContaining({ key: "delete_pristine_draft", enabled: true, disabledReason: null })]
      });
      await expect(uploader.getByRole("status")).toContainText("接管资料已上传并绑定到当前合同");
      await expect(page.getByText("未提供当前操作人", { exact: true })).toHaveCount(0);
      await expect(remove).toBeEnabled();
      expect(detailReads).toEqual([]);
      await page.screenshot({ path: info.outputPath("历史接管上传后不刷新可删除.png"), fullPage: true });
    }
    await press(remove);
    if (history) {
      await press(page.locator(".t-dialog:visible").getByRole("button", { name: "取消", exact: true }));
    } else {
      await press(page.getByRole("button", { name: "保留草稿", exact: true }));
    }
    const headers = { authorization: `Bearer ${fixture.session.tokens.accessToken}` };
    expect((await request.get(`${api}${fixture.rootPath}/${fixture.id}`, { headers })).status()).toBe(200);
    // History must keep using the immediate attachment response, including after cancellation.
    if (!history) await page.reload();
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
    if (history) {
      page.off("request", countDetailReads);
      expect(detailReads).toEqual([]);
    }
    expect((await request.get(`${api}${fixture.rootPath}/${fixture.id}`, { headers })).status()).toBe(404);
    await expect(page.getByRole("button", { name: history ? "确认删除草稿" : "确认删除", exact: true })).toHaveCount(0);
  }
});
