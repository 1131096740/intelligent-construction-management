import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
interface ReadyDocument {
  id: string; status: string; purpose: string; layoutTemplateVersionId: string; pdfFileId: string; docxFileId: string;
  documentContentRevision: number; documentContentFingerprint: string;
  inputSnapshot: { bodyDocument: { sourceSha256: string; pdfEngine: string; runtimeLockSha256: string }; inspection: { pageCount: number; runtime: { exportedPdfSha256: string } } };
}
interface ExpectedPair {
  generationId: string; pdfFileId: string; docxFileId: string; purpose: string; layoutTemplateVersionId: string; sourceSha256: string;
  contentRevision: number; contentFingerprint: string; pdfBytes: number; pdfSha256: string; docxBytes: number; docxSha256: string; pageCount: number; legalSigningAcceptance: boolean;
}

test("手机无PDF的已保存当前正文经真实用户生成一次草稿纸面", async ({ page }, testInfo) => {
  const input = JSON.parse(process.env.TASK10_COLD_BROWSER_INPUT ?? "{}");
  const target = "/合同工作台/" + input.draft.contract.id + "?versionId=" + input.draft.version.id;
  await page.goto("/login?redirect=" + encodeURIComponent(target));
  await page.getByPlaceholder("请输入手机号").fill(input.staff.phone);
  await page.getByPlaceholder("请输入密码").fill(input.staff.password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.getByText("合同正文", { exact: true }).click();
  const editor = page.getByRole("region", { name: "完整合同正文", exact: true }); await expect(editor).toBeVisible();
  await expect(editor.getByRole("button", { name: "保存正文", exact: true })).toBeEnabled();
  const freshness = [];
  for (const file of ["src/pages/contracts/ContractWorkbenchPage.vue", "src/pages/contracts/workbench/ContractBodyEditor.vue", "src/pages/contracts/workbench/ContractBodyPaperPreview.vue", "src/pages/contracts/workbench/ContractBodyFlow.vue", "src/pages/contracts/workbench/use-contract-draft.ts", "src/components/files/LayoutPdfPreview.vue", "src/components/files/PrivatePdfActions.vue"]) {
    const response = await page.request.get("/" + file); expect(response.status()).toBe(200); const bytes = await response.body();
    await writeFile(testInfo.outputPath(file.split("/").at(-1)! + ".served.js"), bytes);
    freshness.push({ file, diskSha256: sha(await readFile(resolve(file))), servedJavaScriptSha256: sha(bytes) });
  }
  await writeFile(testInfo.outputPath("public-source-freshness.json"), JSON.stringify(freshness, null, 2));
  const login = await page.request.post("/api/auth/login", { data: input.staff }); expect(login.status()).toBe(201);
  const headers = { authorization: "Bearer " + (await login.json()).tokens.accessToken, "x-contract-numeric-protocol": "2" };
  const base = "/api/contract-drafts/" + input.draft.version.id;
  const documentsPath = "/api/contract-workbench/" + input.draft.version.id + "/documents";
  const wbResponse = await page.request.get(base + "/workbench", { headers }); expect(wbResponse.status()).toBe(200); const wb = await wbResponse.json();
  const bodyResponse = await page.request.get(base + "/document-body", { headers }); expect(bodyResponse.status()).toBe(200); const body = await bodyResponse.json();
  expect(body).toMatchObject({ sourceSha256: input.sourceSha256, layoutTemplateVersionId: input.layoutId, documentContentRevision: input.contentRevision, draftRevision: wb.version.draftRevision });
  expect(wb.version.documentContentFingerprint).toBe(input.contentFingerprint); expect(wb.version.amountYuan).toBe("6.5000"); expect(wb.contract.code).toBeNull();
  expect(wb.draftOperationAvailableActions).toContain("queue_contract_draft_preview");
  const empty = await page.request.get(documentsPath, { headers }); expect(empty.status()).toBe(200); expect(await empty.json()).toEqual([]);
  const ordinaryNumber = body.blocks.findIndex((block: { id: string }) => block.id === input.ordinaryId) + 1;
  const additionNumber = body.blocks.findIndex((block: { id: string }) => block.id === "added:" + input.additionId) + 1;
  expect(ordinaryNumber).toBeGreaterThan(0); expect(additionNumber).toBeGreaterThan(0);
  const ordinary = editor.getByRole("textbox", { name: "编辑普通条款" + ordinaryNumber, exact: true });
  await expect(ordinary).toHaveValue(input.manualText); await expect(ordinary).toBeEditable(); await ordinary.focus(); await expect(ordinary).toBeFocused();
  const geometry = await ordinary.evaluate(node => ({ font: Number.parseFloat(getComputedStyle(node).fontSize), height: node.getBoundingClientRect().height }));
  expect(geometry.font).toBeGreaterThanOrEqual(16); expect(geometry.height).toBeGreaterThanOrEqual(40);
  await expect(editor.getByRole("textbox", { name: "编辑普通条款" + additionNumber, exact: true })).toHaveValue("补充条款1：冷生成保留新增约定。");
  const tables = editor.getByRole("region", { name: "合同正文表格", exact: true }); await expect(tables).toHaveCount(2);
  const amount = tables.nth(0).getByRole("table").getByRole("row").nth(1).getByRole("cell").nth(7);
  await expect(amount).toHaveText("6.5000"); await expect(amount.getByRole("textbox")).toHaveCount(0);
  const writes: Array<{ method: string; path: string }> = [];
  const queues: Array<{ sourceRevision: unknown }> = [];
  page.on("request", request => {
    const path = new URL(request.url()).pathname;
    if (request.method() === "PUT" && path === base) writes.push({ method: request.method(), path });
    if (request.method() === "POST" && path === base + "/preview-generation") queues.push({ sourceRevision: request.postDataJSON().sourceRevision });
  });
  const paperButton = editor.getByRole("button", { name: "A4纸面检查", exact: true }); await expect(paperButton).toBeEnabled(); await paperButton.click();
  await expect(editor.getByText("当前已保存正文还没有可查看的草稿 PDF。", { exact: true })).toBeVisible();
  const freshResponse = await page.request.get(base + "/workbench", { headers }); expect(freshResponse.status()).toBe(200); const fresh = await freshResponse.json();
  expect(fresh.version.id).toBe(input.draft.version.id); expect(fresh.version.draftRevision).toBe(wb.version.draftRevision);
  expect(fresh.version.documentContentRevision).toBe(input.contentRevision); expect(fresh.version.documentContentFingerprint).toBe(input.contentFingerprint);
  expect(fresh.draftOperationAvailableActions).toContain("queue_contract_draft_preview"); expect(writes).toEqual([]); expect(queues).toEqual([]);
  await writeFile(testInfo.outputPath("public-cold-ready-prerequisites.json"), JSON.stringify({ sourceSha256: input.sourceSha256, layoutId: input.layoutId,
    versionId: input.draft.version.id, draftRevision: fresh.version.draftRevision, contentRevision: input.contentRevision, contentFingerprint: input.contentFingerprint,
    documents: [], generationAction: "queue_contract_draft_preview", generationActionPresent: true, geometry, writes, queues }, null, 2));
  // First product RED: no current PDF, saved editable source and actual fresh generation grant all established.
  const generate = editor.getByRole("button", { name: "生成当前草稿PDF", exact: true }); await expect(generate).toBeVisible(); await expect(generate).toBeEnabled();
  const queuedResponse = page.waitForResponse(response => response.request().method() === "POST" && new URL(response.url()).pathname === base + "/preview-generation");
  await generate.click();
  const queued = await queuedResponse; expect(queued.status()).toBe(201); expect(queued.request().postDataJSON()).toEqual({ sourceRevision: fresh.version.draftRevision });
  const queue = await queued.json(); expect(typeof queue.generationId).toBe("string"); expect(queue.generationId.length).toBeGreaterThan(0);
  expect(queue).toMatchObject({ status: "queued", sourceRevision: fresh.version.draftRevision, documentContentRevision: input.contentRevision, documentContentFingerprint: input.contentFingerprint });
  expect(queues).toEqual([{ sourceRevision: fresh.version.draftRevision }]); expect(writes).toEqual([]);
  let ready: ReadyDocument | undefined;
  await expect.poll(async () => {
    const response = await page.request.get(documentsPath, { headers }); expect(response.status()).toBe(200); const rows = await response.json() as ReadyDocument[];
    expect(rows).toHaveLength(1); ready = rows.find(row => row.id === queue.generationId);
    if (ready?.status === "failed") throw new Error("真实当前草稿文书生成失败");
    return ready?.status;
  }).toBe("success");
  expect(ready).toMatchObject({ id: queue.generationId, status: "success", purpose: "draft", layoutTemplateVersionId: input.layoutId,
    documentContentRevision: input.contentRevision, documentContentFingerprint: input.contentFingerprint,
    inputSnapshot: { bodyDocument: { sourceSha256: input.sourceSha256, pdfEngine: "docx4j-17.3.5", runtimeLockSha256: "6c7d6a82ea477f30f41bd5e1ccc9eab0dee4ed05d9901fee911e5d9ad14e1128" } } });
  let expected: ExpectedPair | null = null;
  await expect.poll(async () => {
    let text: string;
    try { text = await readFile(resolve(process.env.TASK10_COLD_BROWSER_OUTPUT!, "..", "expected-public-pair.json"), "utf8"); }
    catch (cause) { if ((cause as NodeJS.ErrnoException).code === "ENOENT") return false; throw cause; }
    expected = JSON.parse(text) as ExpectedPair;
    expect(expected).toMatchObject({ generationId: queue.generationId, pdfFileId: ready!.pdfFileId, docxFileId: ready!.docxFileId, purpose: "draft",
      layoutTemplateVersionId: input.layoutId, sourceSha256: input.sourceSha256, contentRevision: input.contentRevision, contentFingerprint: input.contentFingerprint, legalSigningAcceptance: false });
    return true;
  }).toBe(true);
  if (!expected) throw new Error("缺少真实公开双格式文件核验记录");
  const actualPair = expected as ExpectedPair;
  const preparedPdf = await readFile(resolve(process.env.TASK10_COLD_BROWSER_OUTPUT!, "..", "actual.pdf"));
  expect(sha(preparedPdf)).toBe(actualPair.pdfSha256); expect(actualPair.pdfSha256).toBe(ready!.inputSnapshot.inspection.runtime.exportedPdfSha256);
  expect(preparedPdf.length).toBe(actualPair.pdfBytes); expect(actualPair.pdfBytes).toBeGreaterThan(0); expect(actualPair.pdfBytes).toBeLessThanOrEqual(100_000_000);
  const fileCap = await page.request.get("/api/files/" + actualPair.pdfFileId + "/download-ticket-capability", { headers }); expect(fileCap.status()).toBe(200);
  expect(await fileCap.json()).toMatchObject({ action: { key: "create_private_file_download_ticket", enabled: true } });
  const authorization = page.getByRole("dialog", { name: "预览合同正文", exact: true }); await expect(authorization).toBeVisible();
  await authorization.locator('input[type="password"]').fill(input.staff.password);
  await authorization.getByPlaceholder("请填写原因，便于留痕审计", { exact: true }).fill("核对用户首次生成的当前草稿纸面");
  const ticketPromise = page.waitForResponse(response => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/files/" + actualPair.pdfFileId + "/download-ticket");
  const pdfPromise = page.waitForResponse(response => response.request().method() === "GET" && new URL(response.url()).pathname === "/api/files/" + actualPair.pdfFileId + "/download");
  await authorization.getByRole("button", { name: "确认预览", exact: true }).click();
  const ticket = await ticketPromise; expect(ticket.status()).toBe(201); expect(ticket.request().postDataJSON().accessMode).toBe("preview");
  const pdf = await pdfPromise; expect(pdf.status()).toBe(200); expect(pdf.headers()["content-type"]).toMatch(/^application\/pdf/u);
  const cdpBytes = (await pdf.body()).length;
  const paper = page.getByRole("region", { name: "合同正文 PDF 预览", exact: true }); await expect(paper).toBeVisible();
  const blobUrl = await paper.getAttribute("data-pdf-source"); expect(blobUrl).toMatch(/^blob:/u);
  const viewer = await page.evaluate(async url => { const response = await fetch(url!); const bytes = await response.arrayBuffer(); const hash = await crypto.subtle.digest("SHA-256", bytes);
    return { status: response.status, mime: response.headers.get("content-type") ?? "", size: bytes.byteLength, sha256: [...new Uint8Array(hash)].map(value => value.toString(16).padStart(2, "0")).join("") }; }, blobUrl);
  expect(viewer.status).toBe(200); expect(viewer.mime).toMatch(/^application\/pdf/u); expect(viewer.size).toBe(actualPair.pdfBytes); expect(viewer.sha256).toBe(actualPair.pdfSha256);
  const canvas = paper.getByRole("img", { name: "合同正文第 1 页", exact: true }); await expect(canvas).toBeVisible(); await expect(paper).toContainText("共 " + actualPair.pageCount + " 页");
  const pixels = await canvas.evaluate(node => { if (!(node instanceof HTMLCanvasElement)) throw new Error("不是 PDF 画布"); const ctx = node.getContext("2d"); if (!ctx) throw new Error("画布不可读");
    const data = ctx.getImageData(0, 0, node.width, node.height).data; let nonwhite = 0; for (let i = 0; i < data.length; i += 4) if (data[i + 3] && Math.min(data[i], data[i + 1], data[i + 2]) < 240) nonwhite++; return nonwhite; }); expect(pixels).toBeGreaterThan(0);
  await paper.getByText("查看本页文字", { exact: true }).click(); const pageText = (await paper.locator(".pdf-page-text").innerText()).replace(/\s/gu, ""); expect(pageText).toContain("上游新建当前合同名称"); expect(pageText).toContain("草稿");
  // Public DOM only. This readonly diagnostic does not change CSS or assert occlusion from a screenshot.
  const observeGeometry = async (label: string) => {
    const observation = await paper.evaluate((node, stage) => {
      const rect = (element: Element) => {
        const box = element.getBoundingClientRect(); const style = getComputedStyle(element);
        return { tag: element.tagName, role: element.getAttribute("role"), x: box.x, y: box.y, width: box.width, height: box.height,
          clientWidth: element.clientWidth, clientHeight: element.clientHeight, scrollWidth: element.scrollWidth,
          scrollHeight: element.scrollHeight, scrollTop: element.scrollTop, scrollLeft: element.scrollLeft,
          position: style.position, top: style.top, zIndex: style.zIndex, overflowX: style.overflowX, overflowY: style.overflowY,
          fontSize: style.fontSize };
      };
      const selectors = [".status-bar", ".mobile-pane-switch", ".body-editor-toolbar", ".pdf-controls", ".pdf-canvas-shell"];
      const measured = selectors.map(selector => { const target = selector.startsWith(".pdf-") ? node.querySelector(selector) : document.querySelector(selector);
        return { selector, present: Boolean(target), geometry: target ? rect(target) : null }; });
      const ancestors = []; let parent: Element | null = node;
      while (parent) { ancestors.push({ ...rect(parent), declaredOwner: parent.getAttribute("data-jg-scroll-owner") }); parent = parent.parentElement; }
      const fit = [...node.querySelectorAll("button")].find(button => button.textContent?.trim() === "适宽");
      const fitBox = fit?.getBoundingClientRect();
      const points = fitBox ? [[fitBox.x + fitBox.width / 2, fitBox.y + fitBox.height / 2], [fitBox.x + 2, fitBox.y + 2]] : [];
      const hits = points.map(([x, y]) => { const hit = document.elementFromPoint(x, y);
        return { x, y, withinLayoutViewport: x >= 0 && y >= 0 && x < innerWidth && y < innerHeight,
          hitTargetOrDescendant: Boolean(fit && hit && (hit === fit || fit.contains(hit))),
          stack: document.elementsFromPoint(x, y).slice(0, 5).map(element => ({ tag: element.tagName, role: element.getAttribute("role"),
            targetOrDescendant: Boolean(fit && (element === fit || fit.contains(element))),
            knownButtonLabel: element.closest("button")?.textContent?.trim().slice(0, 24) ?? null })) }; });
      const visual = visualViewport;
      return { stage, atMs: Date.now(), measured, ancestors, fitPresent: Boolean(fit), fitGeometry: fit ? rect(fit) : null, hits,
        viewport: { width: innerWidth, height: innerHeight, scrollX, scrollY, dpr: devicePixelRatio,
          visual: visual ? { width: visual.width, height: visual.height, offsetLeft: visual.offsetLeft, offsetTop: visual.offsetTop, scale: visual.scale } : null },
        scrollingElement: document.scrollingElement ? rect(document.scrollingElement) : null,
        hitCoordinateQualification: !visual || visual.scale === 1 ? "layout CSS coordinates; inspect measured layers" : "scale differs; raw coordinates retained, occlusion correlation UNPROVEN" };
    }, label);
    await writeFile(testInfo.outputPath(label + ".json"), JSON.stringify(observation, null, 2));
    return observation;
  };
  const beforeScroll = await observeGeometry("mobile-paper-before-normal-scroll");
  await page.screenshot({ path: testInfo.outputPath("mobile-paper-before-normal-scroll.png") });
  // First UI RED target: after the unchanged page-text action, the fit button center must already be unobstructed.
  expect(beforeScroll.hits[0]?.withinLayoutViewport).toBe(true);
  expect(beforeScroll.hits[0]?.hitTargetOrDescendant, "手机纸面适宽按钮中心应直接命中按钮，不应被浮动栏遮挡").toBe(true);
  // Real user fit control with original actionability/expect budget. Observation does not waive a blocked control.
  await paper.getByRole("button", { name: "适宽", exact: true }).click();
  await expect.poll(async () => {
    const box = await canvas.boundingBox(); const shellWidth = await paper.locator(".pdf-canvas-shell").evaluate(node => node.clientWidth);
    return Boolean(box && box.width > 0 && box.height > 0 && shellWidth > 0 && box.width <= shellWidth + 1 && Math.abs(box.width / box.height - 595.3 / 841.9) < 0.01);
  }).toBe(true);
  const fitted = await canvas.boundingBox(); expect(fitted).not.toBeNull();
  const afterFit = await observeGeometry("mobile-paper-after-fit");
  await page.screenshot({ path: testInfo.outputPath("mobile-paper-after-fit.png") });
  await writeFile(testInfo.outputPath("mobile-readonly-sticky-qualification.json"), JSON.stringify({ centerHitQualified: true,
    beforeStage: beforeScroll.stage, afterStage: afterFit.stage, fitted,
    scope: "one public post-page-text state: unobstructed fit-center and normal user click without hardware-keyboard scroll; no general accessibility verdict; test performs no DOM/CSS injection" }, null, 2));
  await editor.getByRole("button", { name: "适宽编辑", exact: true }).click(); await expect(ordinary).toHaveValue(input.manualText); await expect(ordinary).toBeEditable(); await ordinary.focus(); await expect(ordinary).toBeFocused();
  expect(await ordinary.evaluate(node => Number.parseFloat(getComputedStyle(node).fontSize))).toBeGreaterThanOrEqual(16);
  await expect(editor.getByRole("textbox", { name: "编辑普通条款" + additionNumber, exact: true })).toHaveValue("补充条款1：冷生成保留新增约定。");
  await expect(tables).toHaveCount(2); await expect(amount).toHaveText("6.5000"); await expect(amount.getByRole("textbox")).toHaveCount(0);
  const finalWbResponse = await page.request.get(base + "/workbench", { headers }); expect(finalWbResponse.status()).toBe(200); const finalWb = await finalWbResponse.json();
  expect(finalWb.version.documentContentRevision).toBe(input.contentRevision); expect(finalWb.version.documentContentFingerprint).toBe(input.contentFingerprint); expect(finalWb.version.amountYuan).toBe("6.5000"); expect(finalWb.contract.code).toBeNull();
  expect(writes).toEqual([]); expect(queues).toEqual([{ sourceRevision: fresh.version.draftRevision }]);
  const dimensions = await page.evaluate(() => ({ viewport: innerWidth, width: document.documentElement.scrollWidth })); expect(dimensions.width).toBeLessThanOrEqual(dimensions.viewport + 1);
  await page.screenshot({ path: testInfo.outputPath("cold-paper-return-edit.png"), fullPage: true });
  await writeFile(testInfo.outputPath("receipt.json"), JSON.stringify({ expected: actualPair, viewer, cdpBytes, queues, writes, pixels, dimensions, geometry, sourceSha256: input.sourceSha256,
    project: testInfo.project.name, fitted, scope: "onecoldcurrentmobileactualPDF/explicitUIonequeue/actualpublicworker/fit/backeditor; notdirty/newrevision/fullfont/signing; sticky measurements are diagnostic not an accessibility verdict" }, null, 2));
});
