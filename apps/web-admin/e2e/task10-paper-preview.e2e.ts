import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

test("已保存当前草稿在适宽编辑与真实A4纸面缩放之间切换", async ({ page }, testInfo) => {
  const input = JSON.parse(process.env.TASK10_BODY_BROWSER_INPUT ?? "{}");
  const target = "/合同工作台/" + input.draft.contract.id + "?versionId=" + input.draft.version.id;
  await page.goto("/login?redirect=" + encodeURIComponent(target));
  await page.getByPlaceholder("请输入手机号").fill(input.staff.phone);
  await page.getByPlaceholder("请输入密码").fill(input.staff.password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.getByText("合同正文", { exact: true }).click();
  const editor = page.getByRole("region", { name: "完整合同正文", exact: true });
  await expect(editor).toBeVisible();
  await expect(editor.getByRole("button", { name: "保存正文", exact: true })).toBeEnabled();
  const freshness = [];
  for (const file of ["src/pages/contracts/ContractWorkbenchPage.vue", "src/pages/contracts/workbench/ContractBodyEditor.vue", "src/pages/contracts/workbench/ContractBodyFlow.vue", "src/pages/contracts/workbench/use-contract-draft.ts", "src/components/files/LayoutPdfPreview.vue", "src/components/files/PrivatePdfActions.vue"]) {
    const response = await page.request.get("/" + file); expect(response.status()).toBe(200);
    const bytes = await response.body(); await writeFile(testInfo.outputPath(file.split("/").at(-1)! + ".served.js"), bytes);
    freshness.push({ file, diskSha256: sha(await readFile(resolve(file))), servedJavaScriptSha256: sha(bytes) });
  }
  await writeFile(testInfo.outputPath("public-source-freshness.json"), JSON.stringify(freshness, null, 2));
  const login = await page.request.post("/api/auth/login", { data: input.staff }); expect(login.status()).toBe(201);
  const headers = { authorization: "Bearer " + (await login.json()).tokens.accessToken, "x-contract-numeric-protocol": "2" };
  const base = "/api/contract-drafts/" + input.draft.version.id;
  const wbResponse = await page.request.get(base + "/workbench", { headers }); expect(wbResponse.status()).toBe(200); const wb = await wbResponse.json();
  const bodyResponse = await page.request.get(base + "/document-body", { headers }); expect(bodyResponse.status()).toBe(200); const body = await bodyResponse.json();
  expect(body).toMatchObject({ sourceSha256: input.sourceSha256, layoutTemplateVersionId: input.layoutId, documentContentRevision: input.contentRevision, draftRevision: wb.version.draftRevision });
  expect(wb.version.documentContentFingerprint).toBe(input.contentFingerprint); expect(wb.version.amountYuan).toBe("6.5000"); expect(wb.contract.code).toBeNull();
  const listResponse = await page.request.get("/api/contract-workbench/" + input.draft.version.id + "/documents", { headers }); expect(listResponse.status()).toBe(200);
  const job = (await listResponse.json()).find((row: { id: string }) => row.id === input.generationId);
  expect(job).toMatchObject({ status: "success", purpose: "draft", layoutTemplateVersionId: input.layoutId, documentContentRevision: input.contentRevision, documentContentFingerprint: input.contentFingerprint, pdfFileId: input.pdfFileId });
  const capability = await page.request.get("/api/files/" + input.pdfFileId + "/download-ticket-capability", { headers }); expect(capability.status()).toBe(200);
  expect(await capability.json()).toMatchObject({ action: { key: "create_private_file_download_ticket", enabled: true } });
  const ordinaryNumber = body.blocks.findIndex((block: { id: string }) => block.id === input.ordinaryId) + 1;
  const ordinary = editor.getByRole("textbox", { name: "编辑普通条款" + ordinaryNumber, exact: true });
  await expect(ordinary).toHaveValue(input.manualText); await expect(ordinary).toBeEditable(); await ordinary.focus(); await expect(ordinary).toBeFocused();
  const editGeometry = await ordinary.evaluate(node => ({ fontSize: Number.parseFloat(getComputedStyle(node).fontSize), height: node.getBoundingClientRect().height }));
  expect(editGeometry.fontSize).toBeGreaterThanOrEqual(16); expect(editGeometry.height).toBeGreaterThanOrEqual(40);
  // Added ordinary clause is an editable textarea; assert through its public value.
  const additionNumber = body.blocks.findIndex((block: { id: string }) => block.id === "added:" + input.additionId) + 1;
  await expect(editor.getByRole("textbox", { name: "编辑普通条款" + additionNumber, exact: true })).toHaveValue("补充条款1：纸面核对新增约定。");
  const beforeTables = editor.getByRole("region", { name: "合同正文表格", exact: true }); await expect(beforeTables).toHaveCount(2);
  const beforeAmount = beforeTables.nth(0).getByRole("table").getByRole("row").nth(1).getByRole("cell").nth(7); await expect(beforeAmount).toHaveText("6.5000"); await expect(beforeAmount.getByRole("textbox")).toHaveCount(0);
  const business: Array<{ method: string; path: string }> = [];
  page.on("request", request => {
    const path = new URL(request.url()).pathname;
    if ((request.method() === "PUT" && path === "/api/contract-drafts/" + input.draft.version.id) || (request.method() === "POST" && path === "/api/contract-drafts/" + input.draft.version.id + "/preview-generation")) business.push({ method: request.method(), path });
  });
  await writeFile(testInfo.outputPath("public-hot-ready-prerequisites.json"), JSON.stringify({ source: input.sourceSha256, generationId: job.id, contentRevision: job.documentContentRevision, contentFingerprint: job.documentContentFingerprint, pdfFileId: job.pdfFileId, expectedPdfSha256: input.pdfSha256, pageCount: input.pageCount, editGeometry }, null, 2));
  // First functional RED: only after actual same-content PDF and editable-source controls.
  const paperButton = editor.getByRole("button", { name: "A4纸面检查", exact: true }); await expect(paperButton).toBeVisible(); await expect(paperButton).toBeEnabled();
  await paperButton.click();
  // Proposed contract-preview labels; preserve existing password/reason/capability semantics.
  const authorization = page.getByRole("dialog", { name: "预览合同正文", exact: true }); await expect(authorization).toBeVisible();
  await authorization.locator('input[type="password"]').fill(input.staff.password);
  await authorization.getByPlaceholder("请填写原因，便于留痕审计", { exact: true }).fill("核对当前合同草稿A4纸面与缩放");
  const ticketPromise = page.waitForResponse(response => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/files/" + input.pdfFileId + "/download-ticket");
  const pdfPromise = page.waitForResponse(response => response.request().method() === "GET" && new URL(response.url()).pathname === "/api/files/" + input.pdfFileId + "/download");
  await authorization.getByRole("button", { name: "确认预览", exact: true }).click();
  const ticket = await ticketPromise; expect(ticket.status()).toBe(201); expect(ticket.request().postDataJSON().accessMode).toBe("preview");
  const pdf = await pdfPromise; expect(pdf.status()).toBe(200); expect(pdf.headers()["content-type"]).toMatch(/^application\/pdf/u);
  // Preserve the real response observation without treating Chromium's PDF CDP body as the viewer's bytes.
  const cdpDownloadedPdfBytes = (await pdf.body()).length;
  const paper = page.getByRole("region", { name: "合同正文 PDF 预览", exact: true }); await expect(paper).toBeVisible();
  const blobUrl = await paper.getAttribute("data-pdf-source"); expect(blobUrl).toMatch(/^blob:/u);
  const viewerPdf = await page.evaluate(async (url) => {
    const response = await fetch(url!);
    const bytes = await response.arrayBuffer();
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return { status: response.status, mime: response.headers.get("content-type") ?? "", size: bytes.byteLength,
      sha256: [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, "0")).join("") };
  }, blobUrl);
  // This exact owned file was saved by the wrapper from the original public authorized PDF download.
  const preparedPdf = await readFile(resolve(process.env.TASK10_BODY_BROWSER_OUTPUT!, "..", "actual.pdf"));
  await writeFile(testInfo.outputPath("actual-viewer-pdf-observation.json"), JSON.stringify({ pdfFileId: input.pdfFileId, expectedPdfSha256: input.pdfSha256, preparedPdfBytes: preparedPdf.length, cdpDownloadedPdfBytes, viewerPdf }, null, 2));
  expect(sha(preparedPdf)).toBe(input.pdfSha256); expect(preparedPdf.length).toBeGreaterThan(0); expect(preparedPdf.length).toBeLessThanOrEqual(100_000_000);
  expect(viewerPdf.status).toBe(200); expect(viewerPdf.mime).toMatch(/^application\/pdf/u); expect(viewerPdf.size).toBe(preparedPdf.length);
  const downloadedPdfSha256 = viewerPdf.sha256; expect(downloadedPdfSha256).toBe(input.pdfSha256);
  const canvas = paper.getByRole("img", { name: "合同正文第 1 页", exact: true }); await expect(canvas).toBeVisible();
  await expect(paper).toContainText("共 " + input.pageCount + " 页");
  const pixels = await canvas.evaluate(node => {
    if (!(node instanceof HTMLCanvasElement)) throw new Error("不是 PDF 画布");
    const ctx = node.getContext("2d"); if (!ctx) throw new Error("画布不可读");
    const data = ctx.getImageData(0, 0, node.width, node.height).data; let nonwhite = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i + 3] && Math.min(data[i], data[i + 1], data[i + 2]) < 240) nonwhite++;
    return { nonwhite, pixelWidth: node.width, pixelHeight: node.height };
  }); expect(pixels.nonwhite).toBeGreaterThan(0);
  await paper.getByText("查看本页文字", { exact: true }).click();
  const text = (await paper.locator(".pdf-page-text").innerText()).replace(/\s/gu, ""); expect(text).toContain("上游新建当前合同名称"); expect(text).toContain("草稿");
  const percentage = paper.getByRole("status", { name: "纸面缩放", exact: true });
  const percent = async () => { const match = (await percentage.innerText()).match(/(\d+(?:\.\d+)?)%/u); expect(match).not.toBeNull(); return Number(match![1]); };
  const geometry = () => canvas.evaluate(node => { const rect = node.getBoundingClientRect(); return { width: rect.width, height: rect.height }; });
  const firstPercent = await percent(); const firstSize = await geometry(); expect(firstPercent).toBeGreaterThan(0);
  await paper.getByRole("button", { name: "放大", exact: true }).click();
  await expect.poll(percent).toBeGreaterThan(firstPercent); const largerPercent = await percent();
  await expect.poll(async () => (await geometry()).width).toBeGreaterThan(firstSize.width); const larger = await geometry();
  expect(Math.abs(larger.width - firstSize.width * largerPercent / firstPercent)).toBeLessThanOrEqual(2); expect(Math.abs(larger.height - firstSize.height * largerPercent / firstPercent)).toBeLessThanOrEqual(2);
  await paper.getByRole("button", { name: "缩小", exact: true }).click(); await expect.poll(percent).toBeLessThan(largerPercent);
  await expect.poll(async () => (await geometry()).width).toBeLessThan(larger.width);
  await paper.getByRole("button", { name: "适宽", exact: true }).click();
  await expect.poll(async () => {
    const size = await geometry();
    const shellWidth = await paper.locator(".pdf-canvas-shell").evaluate(node => node.clientWidth);
    return size.width > 0 && size.height > 0 && shellWidth > 0 && size.width <= shellWidth + 1 && Math.abs(size.width / size.height - 595.3 / 841.9) < 0.01;
  }).toBe(true);
  const fitted = await geometry();
  const dimensions = await page.evaluate(() => ({ viewport: innerWidth, documentWidth: document.documentElement.scrollWidth })); expect(dimensions.documentWidth).toBeLessThanOrEqual(dimensions.viewport + 1);
  await paper.screenshot({ path: testInfo.outputPath("paper-fitted-region.png") });
  await editor.getByRole("button", { name: "适宽编辑", exact: true }).click();
  await expect(ordinary).toHaveValue(input.manualText); await expect(ordinary).toBeEditable(); await ordinary.focus(); await expect(ordinary).toBeFocused();
  const returnedFont = await ordinary.evaluate(node => Number.parseFloat(getComputedStyle(node).fontSize)); expect(returnedFont).toBeGreaterThanOrEqual(16);
  await expect(editor.getByRole("textbox", { name: "编辑普通条款" + additionNumber, exact: true })).toHaveValue("补充条款1：纸面核对新增约定。");
  const tables = editor.getByRole("region", { name: "合同正文表格", exact: true }); await expect(tables).toHaveCount(2); await expect(tables.nth(0).getByRole("table").getByRole("row").nth(1).getByRole("cell").nth(7)).toHaveText("6.5000"); expect(business).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("paper-round-trip.png"), fullPage: true });
  await writeFile(testInfo.outputPath("receipt.json"), JSON.stringify({ source: input.sourceSha256, generationId: job.id, pdfSha256: input.pdfSha256, downloadedPdfSha256, cdpDownloadedPdfBytes, viewerPdfBytes: viewerPdf.size, viewerPdfMime: viewerPdf.mime, contentRevision: input.contentRevision, contentFingerprint: input.contentFingerprint, firstPercent, largerPercent, firstSize, larger, fitted, pixels, dimensions, business, project: testInfo.project.name, scope: `hotready${testInfo.project.name} ${dimensions.viewport}px readonlypaper/zoom/sameactualprivatePDF; notcold/dirty/fullfont/signing` }, null, 2));
});
