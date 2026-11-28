import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

test("维护页URL默认版式样张保留适宽翻页和关闭重开", async ({ page }, testInfo) => {
  const input = JSON.parse(process.env.TASK10_DEFAULT_PREVIEW_INPUT ?? "{}");
  await page.goto("/login?redirect=" + encodeURIComponent("/合同模板库"));
  await page.getByPlaceholder("请输入手机号").fill(input.account.phone);
  await page.getByPlaceholder("请输入密码").fill(input.account.password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("heading", { name: "合同模板库", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "维护合同模板", exact: true }).click();
  await expect(page.getByRole("heading", { name: "维护合同模板", exact: true })).toBeVisible();
  const record = page.locator(".t-card").filter({ has: page.getByText(input.templateName, { exact: true }) });
  await expect(record).toHaveCount(1);
  await record.getByRole("button", { name: "维护此版本", exact: true }).click();
  await expect(page.getByRole("heading", { name: "版式模板治理", exact: true })).toBeVisible();
  await expect(page.getByText("最新预览：生成成功", { exact: true })).toBeVisible();
  const fresh = [];
  for (const file of ["src/components/files/PrivatePdfActions.vue", "src/components/files/LayoutPdfPreview.vue", "src/pages/contract-templates/LayoutTemplateEditorPage.vue"]) {
    const response = await page.request.get("/" + file); expect(response.status()).toBe(200);
    const bytes = await response.body(); await writeFile(testInfo.outputPath(file.split("/").at(-1)! + ".served.js"), bytes);
    fresh.push({ file, diskSha256: sha(await readFile(resolve(file))), servedJavaScriptSha256: sha(bytes) });
  }
  await writeFile(testInfo.outputPath("public-source-freshness.json"), JSON.stringify(fresh, null, 2));
  const login = await page.request.post("/api/auth/login", { data: input.account }); expect(login.status()).toBe(201);
  const headers = { authorization: "Bearer " + (await login.json()).tokens.accessToken };
  const preview = await page.request.get(`/api/contract-layout-template-versions/${input.versionId}/preview-generation`, { headers }); expect(preview.status()).toBe(200);
  expect(await preview.json()).toMatchObject({ id: input.jobId, status: "succeeded", sourceRevision: 2, previewPdfFileId: input.pdfFileId });
  const templateWrites: string[] = [];
  page.on("request", request => {
    const url = new URL(request.url());
    if (["POST", "PATCH", "PUT", "DELETE"].includes(request.method()) && (url.pathname.startsWith("/api/contract-layout-template") || url.pathname === "/api/files")) templateWrites.push(request.method() + " " + url.pathname);
  });
  const observations: unknown[] = [];
  const paper = page.getByRole("region", { name: "版式样张 PDF 预览", exact: true });
  const previewDialog = page.locator(".t-dialog").filter({ hasText: "版式样张预览" });
  async function openPreview(reason: string) {
    await page.getByRole("button", { name: "预览样张", exact: true }).click();
    const authorization = page.locator(".t-dialog").filter({ hasText: "预览版式样张" }); await expect(authorization).toHaveCount(1); await expect(authorization).toBeVisible();
    await authorization.locator('input[type="password"]').fill(input.account.password);
    await authorization.getByPlaceholder("请填写原因，便于留痕审计", { exact: true }).fill(reason);
    const ticketPromise = page.waitForResponse(response => response.request().method() === "POST" && new URL(response.url()).pathname === `/api/files/${input.pdfFileId}/download-ticket`);
    const downloadPromise = page.waitForResponse(response => response.request().method() === "GET" && new URL(response.url()).pathname === `/api/files/${input.pdfFileId}/download`);
    await authorization.getByRole("button", { name: "确认预览", exact: true }).click();
    const ticket = await ticketPromise; expect(ticket.status()).toBe(201); expect(ticket.request().postDataJSON().accessMode).toBe("preview");
    const download = await downloadPromise; expect(download.status()).toBe(200); expect(download.headers()["content-type"]).toMatch(/^application\/pdf/u);
    await expect(previewDialog).toHaveCount(1); await expect(previewDialog).toBeVisible(); await expect(paper).toBeVisible();
    const url = await paper.getAttribute("data-pdf-source"); expect(url).toMatch(/^blob:/u);
    const blob = await page.evaluate(async source => {
      const response = await fetch(source!); const bytes = await response.arrayBuffer(); const digest = await crypto.subtle.digest("SHA-256", bytes);
      return { status: response.status, mime: response.headers.get("content-type"), size: bytes.byteLength, sha256: [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, "0")).join("") };
    }, url);
    expect(blob).toMatchObject({ status: 200, mime: "application/pdf", size: input.pdfBytes, sha256: input.pdfSha256 });
    await expect(paper.getByRole("img", { name: "版式样张第 1 页", exact: true })).toBeVisible();
    await expect(paper).toContainText("第 1 页 / 共 2 页");
    for (const name of ["放大", "缩小", "适宽"]) await expect(paper.getByRole("button", { name, exact: true })).toHaveCount(0);
    await expect(paper.getByRole("status", { name: "纸面缩放", exact: true })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "合同正文 PDF 预览", exact: true })).toHaveCount(0);
    const canvas = paper.getByRole("img", { name: "版式样张第 1 页", exact: true });
    await expect.poll(async () => canvas.evaluate(node => {
      const rect = node.getBoundingClientRect(), shell = node.closest(".pdf-canvas-shell");
      return rect.width > 0 && rect.height > 0 && Boolean(shell) && rect.width <= shell!.clientWidth + 1;
    })).toBe(true);
    const pixels = await canvas.evaluate(node => {
      if (!(node instanceof HTMLCanvasElement)) throw new Error("样张不是实际PDF画布");
      const context = node.getContext("2d"); if (!context) throw new Error("画布不可读");
      const data = context.getImageData(0, 0, node.width, node.height).data; let nonwhite = 0;
      for (let i = 0; i < data.length; i += 4) if (data[i + 3] && Math.min(data[i], data[i + 1], data[i + 2]) < 240) nonwhite++;
      return { nonwhite, width: node.width, height: node.height };
    }); expect(pixels.nonwhite).toBeGreaterThan(0);
    observations.push({ reason, blob, pixels });
  }
  await openPreview("核对默认版式样张第一页与翻页");
  await expect(paper.getByRole("button", { name: "上一页", exact: true })).toBeDisabled();
  await expect(paper.getByRole("button", { name: "下一页", exact: true })).toBeEnabled();
  await paper.getByText("查看本页文字", { exact: true }).click();
  await expect(paper.locator(".pdf-page-text")).toContainText("第一页核验标记");
  await paper.getByRole("button", { name: "下一页", exact: true }).click();
  await expect(paper.getByRole("img", { name: "版式样张第 2 页", exact: true })).toBeVisible();
  await expect(paper).toContainText("第 2 页 / 共 2 页");
  await expect(paper.locator(".pdf-page-text")).toContainText("第二页核验标记");
  await expect(paper.getByRole("button", { name: "下一页", exact: true })).toBeDisabled();
  await paper.getByRole("button", { name: "上一页", exact: true }).click();
  await expect(paper.getByRole("img", { name: "版式样张第 1 页", exact: true })).toBeVisible();
  await expect(paper.locator(".pdf-page-text")).toContainText("第一页核验标记");
  await paper.screenshot({ path: testInfo.outputPath("default-sample-first-page.png") });
  await previewDialog.locator(".t-dialog__close").click();
  await expect(previewDialog).not.toBeVisible(); await expect(paper).toHaveCount(0);
  await openPreview("关闭后重新核对同一默认版式样张");
  await previewDialog.locator(".t-dialog__close").click();
  await expect(paper).toHaveCount(0);
  expect(templateWrites).toEqual([]);
  const finalPreview = await page.request.get(`/api/contract-layout-template-versions/${input.versionId}/preview-generation`, { headers }); expect(finalPreview.status()).toBe(200);
  expect(await finalPreview.json()).toMatchObject({ id: input.jobId, status: "succeeded", sourceRevision: 2, previewPdfFileId: input.pdfFileId });
  const dimensions = await page.evaluate(() => ({ viewport: innerWidth, documentWidth: document.documentElement.scrollWidth })); expect(dimensions.documentWidth).toBeLessThanOrEqual(dimensions.viewport + 1);
  await writeFile(testInfo.outputPath("receipt.json"), JSON.stringify({ templateId: input.templateId, versionId: input.versionId, jobId: input.jobId, pdfFileId: input.pdfFileId, sourceSha256: input.sourceSha256, pdfSha256: input.pdfSha256, observations, templateWrites, dimensions, project: testInfo.project.name, scope: "real drafttemplate publicqueue/LO actual2page/privatefile/defaultURLonly preview/fit/pages/close-reopen; not publishedstaff/bodyA4/coldbody/fullfont/PG" }, null, 2));
});
