import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { createHash } from "node:crypto";
const fixtures = JSON.parse(process.env.LAYOUT_PREVIEW_FIXTURES ?? "[]") as Array<{ templateId: string; name: string; sha: string }>;
test("四类版式真实预览、下载及 V1 历史只读回读", async ({ page }, testInfo) => {
  expect(fixtures).toHaveLength(4);
  await page.goto("/login");
  await page.getByPlaceholder("请输入手机号").fill(process.env.LAYOUT_PREVIEW_PHONE!);
  await page.getByPlaceholder("请输入密码").fill(process.env.LAYOUT_PREVIEW_PASSWORD!);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect.poll(() => decodeURI(new URL(page.url()).pathname)).toBe("/首页");
  for (const fixture of fixtures) {
    await page.goto(`/合同模板库/版式/${fixture.templateId}`);
    await expect(page.getByRole("heading", { name: fixture.name, exact: true })).toBeVisible();
    const v2 = page.locator("tbody tr").filter({ hasText: "V2" });
    await expect(v2).toBeVisible();
    for (const mode of ["preview", "download"] as const) {
      await v2.getByRole("button", { name: mode === "preview" ? "预览样张" : "下载样张", exact: true }).click();
      const dialog = page.locator(".t-dialog").filter({ hasText: mode === "preview" ? "预览版式样张" : "下载版式样张" });
      await expect(dialog).toBeVisible();
      await expect(dialog).toHaveCSS("opacity", "1");
      await expect(dialog).toHaveCSS("transform", "none");
      await dialog.locator('input[type="password"]').fill(process.env.LAYOUT_PREVIEW_PASSWORD!);
      await dialog.getByPlaceholder("请填写原因，便于留痕审计").fill("隔离浏览器样张验收");
      const content = page.waitForResponse(response => response.request().method() === "GET" &&
        /\/api\/files\/[^/]+\/download$/.test(new URL(response.url()).pathname));
      const download = mode === "download" ? page.waitForEvent("download") : null;
      await dialog.getByRole("button", { name: mode === "preview" ? "确认预览" : "确认下载", exact: true }).click();
      const response = await content;
      expect(response.status()).toBe(200);
      expect(new URL(response.url()).searchParams.get("accessMode")).toBe(mode);
      expect(response.headers()["content-disposition"]).toMatch(mode === "preview" ? /^inline/ : /^attachment/);
      await expect(dialog).toBeHidden();
      if (mode === "preview") {
        const preview = page.locator(".t-dialog").filter({ hasText: "版式样张预览" });
        const frame = preview.getByTitle("版式样张 PDF 预览");
        await expect(frame).toBeVisible();
        const blobUrl = await frame.getAttribute("src");
        const blobSha = await page.evaluate(async (url) => {
          const bytes = await (await fetch(url!)).arrayBuffer();
          const hash = await crypto.subtle.digest("SHA-256", bytes);
          return [...new Uint8Array(hash)].map(value => value.toString(16).padStart(2, "0")).join("");
        }, blobUrl);
        expect(blobSha).toBe(fixture.sha);
        await page.screenshot({ path: testInfo.outputPath(`${fixture.templateId.split("-").slice(0, 2).join("-")}-preview.png`) });
        await preview.locator(".t-dialog__close").click();
        await expect(preview).toBeHidden();
      } else {
        const saved = await download!;
        expect(saved.suggestedFilename()).toMatch(/\.pdf$/);
        expect(await saved.failure()).toBeNull();
        expect(createHash("sha256").update(readFileSync((await saved.path())!)).digest("hex")).toBe(fixture.sha);
      }
    }
    await expect(page.locator("tbody tr").filter({ hasText: "V1" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});
