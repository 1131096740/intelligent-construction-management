import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test, type Request } from "@playwright/test";

const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
interface SaveObservation {
  ordinal: number; startedMs: number; endedMs?: number; saveKind: unknown; expectedRevision: unknown;
  idempotencyKeySha256: string | null; carriesChangedOrdinary: boolean; status?: number; transportFailed?: boolean;
  ack?: { serverRevision: unknown; documentContentRevision: unknown; documentContentFingerprint: unknown; invalidationStatus: unknown };
}

test("正文实际保存产生新口径时旧PDF冻结失效且不自动再生成", async ({ page }, testInfo) => {
  const input = JSON.parse(process.env.TASK10_BODY_BROWSER_INPUT ?? "{}");
  const target = "/合同工作台/" + input.draft.contract.id + "?versionId=" + input.draft.version.id;
  await page.goto("/login?redirect=" + encodeURIComponent(target));
  await page.getByPlaceholder("请输入手机号").fill(input.staff.phone);
  await page.getByPlaceholder("请输入密码").fill(input.staff.password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.getByText("合同正文", { exact: true }).click();
  const editor = page.getByRole("region", { name: "完整合同正文", exact: true });
  await expect(editor).toBeVisible();
  const saveBodyButton = editor.getByRole("button", { name: "保存正文", exact: true });
  await expect(saveBodyButton).toBeEnabled();
  const freshness = [];
  for (const file of ["src/pages/contracts/ContractWorkbenchPage.vue", "src/pages/contracts/workbench/ContractBodyEditor.vue", "src/pages/contracts/workbench/ContractBodyFlow.vue", "src/pages/contracts/workbench/ContractBodyPaperPreview.vue", "src/pages/contracts/workbench/use-contract-draft.ts", "src/components/files/LayoutPdfPreview.vue", "src/components/files/PrivatePdfActions.vue"]) {
    const response = await page.request.get("/" + file); expect(response.status()).toBe(200);
    const bytes = await response.body(); await writeFile(testInfo.outputPath(file.split("/").at(-1)! + ".served.js"), bytes);
    freshness.push({ file, diskSha256: sha(await readFile(resolve(file))), servedJavaScriptSha256: sha(bytes) });
  }
  await writeFile(testInfo.outputPath("public-source-freshness.json"), JSON.stringify(freshness, null, 2));
  const login = await page.request.post("/api/auth/login", { data: input.staff }); expect(login.status()).toBe(201);
  const headers = { authorization: "Bearer " + (await login.json()).tokens.accessToken, "x-contract-numeric-protocol": "2" };
  const base = "/api/contract-drafts/" + input.draft.version.id;
  const documentsPath = "/api/contract-workbench/" + input.draft.version.id + "/documents";
  const readState = async () => {
    const wbResponse = await page.request.get(base + "/workbench", { headers }); expect(wbResponse.status()).toBe(200);
    const bodyResponse = await page.request.get(base + "/document-body", { headers }); expect(bodyResponse.status()).toBe(200);
    const docsResponse = await page.request.get(documentsPath, { headers }); expect(docsResponse.status()).toBe(200);
    return { wb: await wbResponse.json(), body: await bodyResponse.json(), documents: await docsResponse.json() };
  };
  const initial = await readState(); const { wb, body } = initial;
  expect(body).toMatchObject({ contractVersionId: input.draft.version.id, sourceSha256: input.sourceSha256,
    layoutTemplateVersionId: input.layoutId, documentContentRevision: input.contentRevision, draftRevision: input.oldDraftRevision });
  expect(wb.version).toMatchObject({ draftRevision: input.oldDraftRevision, documentContentRevision: input.contentRevision,
    documentContentFingerprint: input.contentFingerprint, amountYuan: "6.5000", layoutTemplateVersionId: input.layoutId });
  expect(wb.contract.code).toBeNull(); expect(initial.documents).toHaveLength(1);
  const oldJob = initial.documents[0];
  expect(oldJob).toMatchObject({ id: input.generationId, status: "success", purpose: "draft", layoutTemplateVersionId: input.layoutId,
    documentContentRevision: input.contentRevision, documentContentFingerprint: input.contentFingerprint, pdfFileId: input.pdfFileId,
    inputSnapshot: { documentContentRevision: input.contentRevision, documentContentFingerprint: input.contentFingerprint,
      bodyDocument: { sourceSha256: input.sourceSha256, layoutTemplateVersionId: input.layoutId } } });
  expect(oldJob.inputSnapshot.bodyDocument.editPlan).toEqual(wb.draft.documentBody);
  const ordinaryNumber = body.blocks.findIndex((block: { id: string }) => block.id === input.ordinaryId) + 1;
  const additionNumber = body.blocks.findIndex((block: { id: string }) => block.id === "added:" + input.additionId) + 1;
  expect(ordinaryNumber).toBeGreaterThan(0); expect(additionNumber).toBeGreaterThan(0);
  const ordinary = editor.getByRole("textbox", { name: "编辑普通条款" + ordinaryNumber, exact: true });
  const addition = editor.getByRole("textbox", { name: "编辑普通条款" + additionNumber, exact: true });
  await expect(ordinary).toHaveValue(input.manualText); await expect(ordinary).toBeEditable();
  await expect(addition).toHaveValue("补充条款1：纸面核对新增约定。");
  const tables = editor.getByRole("region", { name: "合同正文表格", exact: true });
  await expect(tables).toHaveCount(2);
  const amount = tables.nth(0).getByRole("table").getByRole("row").nth(1).getByRole("cell").nth(7);
  await expect(amount).toHaveText("6.5000"); await expect(amount.getByRole("textbox")).toHaveCount(0);

  const newText = input.manualText + "保存新修订仅供当前正文核对。";
  const saves: SaveObservation[] = [];
  const pendingObservers: Promise<void>[] = [];
  const requestIndices = new Map<Request, number>();
  const observerErrors: string[] = [];
  const queues: Array<{ method: string; path: string; startedMs: number }> = [];
  page.on("request", request => {
    const path = new URL(request.url()).pathname;
    if (request.method() === "POST" && path === base + "/preview-generation") queues.push({ method: "POST", path, startedMs: Date.now() });
    if (request.method() !== "PUT" || path !== base) return;
    try {
      const payload = request.postDataJSON();
      const edits = payload?.draft?.draftData?.documentBody?.edits;
      const index = saves.length; requestIndices.set(request, index);
      saves.push({ ordinal: index + 1, startedMs: Date.now(), saveKind: payload?.saveKind,
        expectedRevision: payload?.expectedRevision, idempotencyKeySha256: typeof payload?.idempotencyKey === "string" ? sha(Buffer.from(payload.idempotencyKey)) : null,
        carriesChangedOrdinary: Array.isArray(edits) && edits.some((edit: { positionId: string; text: string }) => edit.positionId === input.ordinaryId && edit.text === newText) });
    } catch { observerErrors.push("真实保存请求不是可观察的JSON，未存原请求或凭据"); }
  });
  page.on("response", response => {
    const index = requestIndices.get(response.request()); if (index === undefined) return;
    pendingObservers.push((async () => {
      const row = saves[index]; row.status = response.status(); row.endedMs = Date.now();
      if (response.status() === 200) {
        const ack = await response.json();
        row.ack = { serverRevision: ack.serverRevision, documentContentRevision: ack.documentContentRevision,
          documentContentFingerprint: ack.documentContentFingerprint, invalidationStatus: ack.invalidation?.status };
      }
    })().catch(() => { observerErrors.push("真实保存回执读取失败，未将失败作通过"); }));
  });
  page.on("requestfailed", request => {
    const index = requestIndices.get(request); if (index === undefined) return;
    saves[index].transportFailed = true; saves[index].endedMs = Date.now();
  });
  try {
    const paperButton = editor.getByRole("button", { name: "A4纸面检查", exact: true });
    await expect(paperButton).toBeEnabled(); await paperButton.click();
    const authorization = page.getByRole("dialog", { name: "预览合同正文", exact: true }); await expect(authorization).toBeVisible();
    await authorization.locator('input[type="password"]').fill(input.staff.password);
    await authorization.getByPlaceholder("请填写原因，便于留痕审计", { exact: true }).fill("核对保存前当前合同草稿纸面");
    const ticketPromise = page.waitForResponse(response => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/files/" + input.pdfFileId + "/download-ticket");
    const pdfPromise = page.waitForResponse(response => response.request().method() === "GET" && new URL(response.url()).pathname === "/api/files/" + input.pdfFileId + "/download");
    await authorization.getByRole("button", { name: "确认预览", exact: true }).click();
    const ticket = await ticketPromise; expect(ticket.status()).toBe(201); expect(ticket.request().postDataJSON().accessMode).toBe("preview");
    const pdf = await pdfPromise; expect(pdf.status()).toBe(200); expect(pdf.headers()["content-type"]).toMatch(/^application\/pdf/u);
    const paper = page.getByRole("region", { name: "合同正文 PDF 预览", exact: true }); await expect(paper).toBeVisible();
    const blobUrl = await paper.getAttribute("data-pdf-source"); expect(blobUrl).toMatch(/^blob:/u);
    const viewerPdf = await page.evaluate(async url => {
      const response = await fetch(url!); const bytes = await response.arrayBuffer();
      const digest = await crypto.subtle.digest("SHA-256", bytes);
      return { status: response.status, mime: response.headers.get("content-type"), size: bytes.byteLength,
        sha256: [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, "0")).join("") };
    }, blobUrl);
    const preparedPdf = await readFile(resolve(process.env.TASK10_BODY_BROWSER_OUTPUT!, "..", "actual.pdf"));
    expect(preparedPdf.length).toBeGreaterThan(0); expect(preparedPdf.length).toBeLessThanOrEqual(100_000_000);
    expect(sha(preparedPdf)).toBe(input.pdfSha256);
    expect(viewerPdf).toMatchObject({ status: 200, size: preparedPdf.length, sha256: input.pdfSha256 }); expect(viewerPdf.mime).toMatch(/^application\/pdf/u);
    const canvas = paper.getByRole("img", { name: "合同正文第 1 页", exact: true }); await expect(canvas).toBeVisible();
    const nonwhite = await canvas.evaluate(node => {
      if (!(node instanceof HTMLCanvasElement)) throw new Error("不是真实PDF画布");
      const context = node.getContext("2d"); if (!context) throw new Error("画布不可读");
      const data = context.getImageData(0, 0, node.width, node.height).data; let count = 0;
      for (let i = 0; i < data.length; i += 4) if (data[i + 3] && Math.min(data[i], data[i + 1], data[i + 2]) < 240) count++;
      return count;
    }); expect(nonwhite).toBeGreaterThan(0);
    await expect(paper).toContainText("共 " + input.pageCount + " 页");
    await paper.getByText("查看本页文字", { exact: true }).click();
    const titleText = (await paper.locator(".pdf-page-text").innerText()).replace(/\s/gu, "");
    expect(titleText).toContain("上游新建当前合同名称"); expect(titleText).toContain("草稿");
    await writeFile(testInfo.outputPath("old-current-real-viewer.json"), JSON.stringify({ generationId: oldJob.id, pdfFileId: oldJob.pdfFileId,
      oldR: oldJob.documentContentRevision, oldF: oldJob.documentContentFingerprint, viewerPdf, nonwhite }, null, 2));
    await editor.getByRole("button", { name: "适宽编辑", exact: true }).click();
    await expect(ordinary).toBeEditable(); await expect(ordinary).toHaveValue(input.manualText); await expect(addition).toHaveValue("补充条款1：纸面核对新增约定。");

    // Ordinary real input: do not fake/pause autosave or demand a particular saveKind/count.
    await ordinary.fill(newText);
    const dirtyObservation = { atMs: Date.now(), actualValue: await ordinary.inputValue(), paperEnabled: await paperButton.isEnabled() };
    await saveBodyButton.click();
    await expect.poll(async () => {
      const current = await readState();
      return current.body.blocks.some((block: { id: string; text: string }) => block.id === input.ordinaryId && block.text === newText) &&
        current.wb.version.documentContentRevision > input.contentRevision && current.wb.version.draftRevision > input.oldDraftRevision &&
        current.body.documentContentRevision === current.wb.version.documentContentRevision && current.body.draftRevision === current.wb.version.draftRevision;
    }).toBe(true);
    await expect(saveBodyButton).toBeEnabled();
    const current = await readState();
    expect(current.wb.version.documentContentFingerprint).toMatch(/^[a-f0-9]{64}$/u);
    expect(current.wb.version.documentContentFingerprint).not.toBe(input.contentFingerprint);
    expect(current.wb.version).toMatchObject({ amountYuan: "6.5000", layoutTemplateVersionId: input.layoutId,
      pricingNature: wb.version.pricingNature, amountSource: wb.version.amountSource, numericProtocolVersion: 2 });
    expect(current.wb.contract.name).toBe(wb.contract.name); expect(current.wb.contract.code).toBeNull();
    expect(current.body.blocks.filter((block: { id: string; text: string }) => block.id === input.ordinaryId && block.text === newText)).toHaveLength(1);
    expect(current.body).toMatchObject({ sourceSha256: input.sourceSha256, layoutTemplateVersionId: input.layoutId });
    const partyFacts = (parties: Array<{ roleKey: string; displayOrder: number; businessPartyVersionId?: string; snapshot: Record<string, unknown> }>) =>
      parties.map(party => ({ roleKey: party.roleKey, displayOrder: party.displayOrder,
        businessPartyVersionId: party.businessPartyVersionId ?? null, snapshot: party.snapshot }));
    expect(partyFacts(current.wb.parties)).toEqual(partyFacts(wb.parties));
    expect(current.wb.version.taxFacts).toEqual(wb.version.taxFacts);
    const expectedPlan = JSON.parse(JSON.stringify(wb.draft.documentBody));
    const oldEdit = expectedPlan.edits.find((edit: { positionId: string }) => edit.positionId === input.ordinaryId);
    expect(oldEdit).toBeDefined(); oldEdit.text = newText;
    expect(current.wb.draft.documentBody).toEqual(expectedPlan);
    expect(current.documents).toHaveLength(1);
    const stale = current.documents[0];
    expect(stale).toMatchObject({ id: oldJob.id, status: "stale", purpose: "draft", layoutTemplateVersionId: input.layoutId,
      docxFileId: oldJob.docxFileId, pdfFileId: oldJob.pdfFileId, documentContentRevision: input.contentRevision, documentContentFingerprint: input.contentFingerprint });
    expect(stale.inputSnapshot).toEqual(oldJob.inputSnapshot);
    expect(current.documents.some((item: { status: string; documentContentRevision: number; documentContentFingerprint: string }) => item.status === "success" &&
      item.documentContentRevision === current.wb.version.documentContentRevision && item.documentContentFingerprint === current.wb.version.documentContentFingerprint)).toBe(false);
    await Promise.allSettled(pendingObservers);
    expect(observerErrors).toEqual([]); expect(saves.length).toBeGreaterThanOrEqual(1);
    expect(saves.some(row => row.carriesChangedOrdinary && row.status === 200)).toBe(true);
    for (const row of saves) { expect(row.status).toBe(200); expect(row.transportFailed).not.toBe(true); }
    expect(queues).toEqual([]);
    await expect(ordinary).toHaveValue(newText); await expect(ordinary).toBeEditable();
    await expect(addition).toHaveValue("补充条款1：纸面核对新增约定。");
    await expect(paperButton).toBeEnabled(); await paperButton.click();
    const paperState = page.getByRole("region", { name: "合同草稿纸面检查", exact: true });
    await expect(paperState).toContainText("当前已保存正文还没有可查看的草稿 PDF。");
    await expect(page.getByRole("region", { name: "合同正文 PDF 预览", exact: true })).toHaveCount(0);
    await expect(page.getByRole("dialog", { name: "预览合同正文", exact: true })).toHaveCount(0);
    expect(queues).toEqual([]);
    await editor.getByRole("button", { name: "适宽编辑", exact: true }).click();
    await expect(ordinary).toHaveValue(newText); await expect(ordinary).toBeEditable();
    await expect(addition).toHaveValue("补充条款1：纸面核对新增约定。");
    await expect(tables).toHaveCount(2); await expect(amount).toHaveText("6.5000"); await expect(amount.getByRole("textbox")).toHaveCount(0);
    expect(await ordinary.evaluate(node => Number.parseFloat(getComputedStyle(node).fontSize))).toBeGreaterThanOrEqual(16);
    const viewport = await page.evaluate(() => ({ viewport: innerWidth, documentWidth: document.documentElement.scrollWidth }));
    expect(viewport.documentWidth).toBeLessThanOrEqual(viewport.viewport + 1);
    await writeFile(testInfo.outputPath("core-invalidation-receipt.json"), JSON.stringify({ status: "passed", oldJobId: oldJob.id,
      oldR: input.contentRevision, oldF: input.contentFingerprint, newR: current.wb.version.documentContentRevision,
      newF: current.wb.version.documentContentFingerprint, oldDraftRevision: input.oldDraftRevision, newDraftRevision: current.wb.version.draftRevision,
      dirtyObservation, saves, queues, oldSnapshotUnchanged: true, oldFileIdsUnchanged: true, noCurrentPdfBeforeReload: true, viewport,
      scope: "one old-current actual PDF; real save and stale selection; not second new-R generation" }, null, 2));

    // Independent stale-file public capability/ticket AFTER the core current-selection proof.
    // There was no role/project/lifecycle mutation. A403 is a preserved unexpected denial, NOT an alternate GREEN.
    const historicalCap = await page.request.get("/api/files/" + input.pdfFileId + "/download-ticket-capability", { headers });
    await writeFile(testInfo.outputPath("historical-capability-status.json"), JSON.stringify({ fileId: input.pdfFileId,
      status: historicalCap.status(), unchangedActorProjectAndLifecycleFixture: true,
      unexpectedDenialNeedsExactPolicyClassification: historicalCap.status() === 403 }, null, 2));
    expect(historicalCap.status()).toBe(200);
    expect(await historicalCap.json()).toMatchObject({ action: { key: "create_private_file_download_ticket", enabled: true },
      availableActions: expect.arrayContaining(["create_private_file_download_ticket"]) });
    const historicalTicket = await page.request.post("/api/files/" + input.pdfFileId + "/download-ticket", { headers,
      data: { confirmationPassword: input.staff.password, downloadReason: "核对旧修订草稿文件保持原样", accessMode: "download" } });
    expect(historicalTicket.status()).toBe(201);
    const historicalValue = await historicalTicket.json(); expect(historicalValue.downloadUrl).toMatch(/^\/files\/[^/?#]+\/download\?/u);
    const historicalBytesResponse = await page.request.get("/api" + historicalValue.downloadUrl, { headers });
    expect(historicalBytesResponse.status()).toBe(200); expect(historicalBytesResponse.headers()["content-type"]).toMatch(/^application\/pdf/u);
    const historicalBytes = await historicalBytesResponse.body(); expect(historicalBytes.length).toBe(preparedPdf.length);
    expect(sha(historicalBytes)).toBe(input.pdfSha256);
    await writeFile(testInfo.outputPath("historical-file-read-receipt.json"), JSON.stringify({ status: "passed", pdfFileId: input.pdfFileId,
      mode: "fresh-public-capability-and-ticket", bytes: historicalBytes.length, sha256: sha(historicalBytes), oldAuthorizedPdfUnchanged: true }, null, 2));
    const final = await readState(); expect(final.documents).toHaveLength(1);
    expect(final.documents[0].inputSnapshot).toEqual(oldJob.inputSnapshot); expect(final.documents[0].pdfFileId).toBe(input.pdfFileId);
    expect(final.documents[0].status).toBe("stale"); expect(final.wb.draft.documentBody).toEqual(expectedPlan); expect(final.wb.contract.code).toBeNull();
    await Promise.allSettled(pendingObservers); expect(observerErrors).toEqual([]); expect(queues).toEqual([]);
    for (const row of saves) { expect(row.status).toBe(200); expect(row.transportFailed).not.toBe(true); }
    await page.screenshot({ path: testInfo.outputPath("saved-new-body-old-pdf-stale.png"), fullPage: true });
    await writeFile(testInfo.outputPath("receipt.json"), JSON.stringify({ status: "passed", project: testInfo.project.name, saves, queues,
      noSecondNative: true, historicalPdfSha256: sha(historicalBytes), finalR: final.wb.version.documentContentRevision,
      finalF: final.wb.version.documentContentFingerprint, noFixedPutCountOrRevisionIncrement: true, legalSigningAcceptance: false }, null, 2));
  } finally {
    await Promise.allSettled(pendingObservers);
    // Explicit allowlisted facts only. Raw request/headers/ticketURL/password are never serialized; trace is off.
    await writeFile(testInfo.outputPath("sanitized-save-and-queue-observation.json"), JSON.stringify({ saves, queues, observerErrors }, null, 2));
  }
});
