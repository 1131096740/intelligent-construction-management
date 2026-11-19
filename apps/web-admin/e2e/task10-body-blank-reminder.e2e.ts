import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

type Paragraph = { id: string; text: string; editable: boolean; blankFields: string[] };
type Body = { contractVersionId: string; draftRevision: number; documentContentRevision: number; layoutTemplateVersionId: string; sourceSha256: string; blocks: Paragraph[] };

test("附加空位可填并保存，仍有空位时可确认当前版本且新输入使确认失效", async ({ page }, testInfo) => {
  const input = JSON.parse(process.env.TASK10_BODY_BROWSER_INPUT ?? "{}");
  const draft = input.draft;
  const target = "/合同工作台/" + draft.contract.id + "?versionId=" + draft.version.id;
  const puts: Array<Record<string, unknown>> = [];
  const submissions: string[] = [];
  page.on("request", request => {
    if (request.method() === "POST" && request.url().endsWith("/submission")) submissions.push(request.url());
    if (request.method() !== "PUT" || !request.url().endsWith("/contract-drafts/" + draft.version.id)) return;
    const payload = request.postDataJSON();
    puts.push({ key: payload.idempotencyKey, expectedRevision: payload.expectedRevision, documentBody: payload.draft?.draftData?.documentBody });
  });
  await page.goto("/login?redirect=" + encodeURIComponent(target));
  await page.getByPlaceholder("请输入手机号").fill(input.staff.phone);
  await page.getByPlaceholder("请输入密码").fill(input.staff.password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.getByText("合同正文", { exact: true }).click();
  const editor = page.getByRole("region", { name: "完整合同正文", exact: true });
  await expect(editor).toBeVisible();
  await expect(editor.getByRole("button", { name: "保存正文", exact: true })).toBeEnabled();
  const freshness = [];
  for (const file of ["src/pages/contracts/ContractWorkbenchPage.vue", "src/pages/contracts/workbench/ContractBodyEditor.vue", "src/pages/contracts/workbench/ContractBodyFlow.vue"]) {
    const response = await page.request.get("/" + file);
    expect(response.status()).toBe(200);
    const bytes = await response.body();
    await writeFile(testInfo.outputPath(file.split("/").at(-1)! + ".served.js"), bytes);
    freshness.push({ file, diskSha256: createHash("sha256").update(await readFile(resolve(file))).digest("hex"), publicServedJavaScriptSha256: createHash("sha256").update(bytes).digest("hex") });
  }
  await writeFile(testInfo.outputPath("public-source-freshness.json"), JSON.stringify(freshness, null, 2));
  const login = await page.request.post("/api/auth/login", { data: input.staff });
  expect(login.status()).toBe(201);
  const headers = { authorization: "Bearer " + (await login.json()).tokens.accessToken, "x-contract-numeric-protocol": "2" };
  const base = "/api/contract-drafts/" + draft.version.id;
  const readBody = async (): Promise<Body> => {
    const response = await page.request.get(base + "/document-body", { headers });
    expect(response.status()).toBe(200);
    return response.json();
  };
  const readWorkbench = async () => {
    const response = await page.request.get(base + "/workbench", { headers });
    expect(response.status()).toBe(200);
    return response.json();
  };
  const before = await readBody();
  const initialWorkbench = await readWorkbench();
  expect(before).toMatchObject({ contractVersionId: draft.version.id, layoutTemplateVersionId: input.layout.id, sourceSha256: input.sourceSha256, draftRevision: initialWorkbench.version.draftRevision });
  expect(initialWorkbench.version).toMatchObject({ numericProtocolVersion: 2, amountYuan: "6.5000" });
  const delivery = before.blocks.find(block => block.id === input.deliveryId)!;
  const acceptance = before.blocks.find(block => block.id === input.acceptanceId)!;
  expect(delivery).toMatchObject({ text: "交货地点：【待补充：交货地点】", editable: true, blankFields: ["交货地点"] });
  expect(acceptance).toMatchObject({ text: "验收地点：【待补充：验收地点】", editable: true, blankFields: ["验收地点"] });
  expect(before.blocks.find(block => block.text === "甲方：当前单甲方")).toMatchObject({ editable: false });
  expect(before.blocks.find(block => block.text === "乙方：当前单乙方")).toMatchObject({ editable: false });
  const deliveryNumber = before.blocks.findIndex(block => block.id === delivery.id) + 1;
  const acceptanceNumber = before.blocks.findIndex(block => block.id === acceptance.id) + 1;
  const deliveryInput = editor.getByRole("textbox", { name: "编辑普通条款" + deliveryNumber, exact: true });
  const acceptanceInput = editor.getByRole("textbox", { name: "编辑普通条款" + acceptanceNumber, exact: true });
  await expect(deliveryInput).toHaveValue(delivery.text);
  await expect(deliveryInput).toBeEditable();
  await expect(acceptanceInput).toHaveValue(acceptance.text);
  await expect(acceptanceInput).toBeEditable();
  const deliveryParagraph = editor.locator(".body-paragraph").filter({ has: page.getByRole("textbox", { name: "编辑普通条款" + deliveryNumber, exact: true }) });
  const acceptanceParagraph = editor.locator(".body-paragraph").filter({ has: page.getByRole("textbox", { name: "编辑普通条款" + acceptanceNumber, exact: true }) });
  await expect(deliveryParagraph).toHaveCount(1);
  await expect(acceptanceParagraph).toHaveCount(1);
  await writeFile(testInfo.outputPath("public-before-blank-review.json"), JSON.stringify({ body: before, amountYuan: initialWorkbench.version.amountYuan, scope: "two optional ordinary markers in synthetic confirmed DOCX; not adopted44be/publication or formal submission" }, null, 2));
  // First functional target, after actual public marker qualification and real textboxes.
  await expect(deliveryParagraph.getByText("正文空位：交货地点", { exact: true })).toBeVisible();
  await expect(acceptanceParagraph.getByText("正文空位：验收地点", { exact: true })).toBeVisible();
  const check = editor.getByRole("button", { name: "检查正文空位", exact: true });
  await expect(check).toBeVisible();
  const filledText = "交货地点：北区仓库。";
  const savedResponse = page.waitForResponse(response => response.request().method() === "PUT" && response.url().endsWith("/contract-drafts/" + draft.version.id) &&
    response.request().postDataJSON()?.draft?.draftData?.documentBody?.edits?.some((edit: { positionId: string; text: string }) => edit.positionId === delivery.id && edit.text === filledText));
  await deliveryInput.fill(filledText);
  await expect(deliveryParagraph.getByText("正文空位：交货地点", { exact: true })).toHaveCount(0);
  await expect(acceptanceParagraph.getByText("正文空位：验收地点", { exact: true })).toBeVisible();
  await editor.getByRole("button", { name: "保存正文", exact: true }).click();
  const saved = await savedResponse;
  await writeFile(testInfo.outputPath("public-blank-edit-save-response.json"), JSON.stringify({ status: saved.status(), response: await saved.text(), body: saved.request().postDataJSON()?.draft?.draftData?.documentBody }, null, 2));
  expect(saved.status()).toBe(200);
  const after = await readBody();
  const afterWorkbench = await readWorkbench();
  expect(after.layoutTemplateVersionId).toBe(before.layoutTemplateVersionId);
  expect(after.sourceSha256).toBe(before.sourceSha256);
  expect(after.draftRevision).toBe(before.draftRevision + 1);
  expect(after.blocks.find(block => block.id === delivery.id)).toMatchObject({ text: filledText, editable: true, blankFields: [] });
  expect(after.blocks.find(block => block.id === acceptance.id)).toMatchObject({ text: acceptance.text, editable: true, blankFields: ["验收地点"] });
  expect(after.blocks.find(block => block.text === "甲方：当前单甲方")).toMatchObject({ editable: false });
  expect(after.blocks.find(block => block.text === "乙方：当前单乙方")).toMatchObject({ editable: false });
  expect(afterWorkbench.version.amountYuan).toBe("6.5000");
  await writeFile(testInfo.outputPath("public-after-blank-edit.json"), JSON.stringify({ body: after, amountYuan: afterWorkbench.version.amountYuan }, null, 2));
  const afterDeliveryNumber = after.blocks.findIndex(block => block.id === delivery.id) + 1;
  const afterAcceptanceNumber = after.blocks.findIndex(block => block.id === acceptance.id) + 1;
  // A normal new tab restores only the existing application login. It gets no
  // copy of the original page's in-memory lease grant, so it must remain read-only.
  const reader = await page.context().newPage();
  const readerWrites: Array<{ method: string; url: string }> = [];
  reader.on("request", request => {
    if (request.url().includes("/contract-drafts/" + draft.version.id) && !["GET", "HEAD", "OPTIONS"].includes(request.method())) {
      readerWrites.push({ method: request.method(), url: request.url() });
    }
  });
  try {
    await reader.goto(target);
    await reader.getByText("合同正文", { exact: true }).click();
    const readerEditor = reader.getByRole("region", { name: "完整合同正文", exact: true });
    await expect(readerEditor.getByRole("textbox", { name: "编辑普通条款" + afterDeliveryNumber, exact: true })).toHaveValue(filledText);
    await expect(readerEditor.getByRole("textbox", { name: "编辑普通条款" + afterDeliveryNumber, exact: true })).not.toBeEditable();
    await expect(readerEditor.getByRole("button", { name: "保存正文", exact: true })).toBeDisabled();
    // This independent read-only page really reloads and rereads the same saved
    // revision; the original legitimate editor stays open and keeps its grant.
    await reader.reload();
    await reader.getByText("合同正文", { exact: true }).click();
    const readerDelivery = readerEditor.getByRole("textbox", { name: "编辑普通条款" + afterDeliveryNumber, exact: true });
    const readerAcceptance = readerEditor.getByRole("textbox", { name: "编辑普通条款" + afterAcceptanceNumber, exact: true });
    await expect(readerDelivery).toHaveValue(filledText);
    await expect(readerAcceptance).toHaveValue(acceptance.text);
    await expect(readerDelivery).not.toBeEditable();
    await expect(readerAcceptance).not.toBeEditable();
    await expect(readerEditor.getByRole("button", { name: "保存正文", exact: true })).toBeDisabled();
    const readerBodyResponse = await reader.request.get(base + "/document-body", { headers });
    expect(readerBodyResponse.status()).toBe(200);
    const readerBody = await readerBodyResponse.json();
    expect(readerBody).toEqual(after);
    const readerWorkbenchResponse = await reader.request.get(base + "/workbench", { headers });
    expect(readerWorkbenchResponse.status()).toBe(200);
    const readerWorkbench = await readerWorkbenchResponse.json();
    expect(readerWorkbench.version).toMatchObject({ draftRevision: after.draftRevision, layoutTemplateVersionId: after.layoutTemplateVersionId, amountYuan: "6.5000" });
    expect(readerWorkbench.lease.state).toBe("held_by_me");
    expect(readerWrites).toHaveLength(0);
    await writeFile(testInfo.outputPath("independent-reader-reload.json"), JSON.stringify({ sourceSha256: readerBody.sourceSha256, layoutTemplateVersionId: readerBody.layoutTemplateVersionId, draftRevision: readerBody.draftRevision, documentContentRevision: readerBody.documentContentRevision,
      delivery: readerBody.blocks.find((block: Paragraph) => block.id === delivery.id), acceptance: readerBody.blocks.find((block: Paragraph) => block.id === acceptance.id), amountYuan: readerWorkbench.version.amountYuan, leaseState: readerWorkbench.lease.state, readerWrites,
      scope: "separate normally authenticated read-only tab really reloaded; no lease token copy/acquire/forcedwrite, original editor retained its grant" }, null, 2));
  } finally { await reader.close(); }
  await page.bringToFront();
  await page.getByText("合同正文", { exact: true }).click();
  const savedDeliveryInput = editor.getByRole("textbox", { name: "编辑普通条款" + afterDeliveryNumber, exact: true });
  await expect(savedDeliveryInput).toHaveValue(filledText);
  await expect(editor.getByRole("textbox", { name: "编辑普通条款" + afterAcceptanceNumber, exact: true })).toHaveValue(acceptance.text);
  await expect(editor.getByRole("button", { name: "保存正文", exact: true })).toBeEnabled();
  const baselinePUTCount = puts.length;
  const beforeReview = await readBody();
  const confirmedStatus = editor.getByRole("status").filter({ hasText: "已检查当前版本" });
  await check.click();
  const dialog = page.getByRole("dialog", { name: "检查正文空位", exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("验收地点");
  await expect(dialog).not.toContainText("交货地点");
  await dialog.getByRole("button", { name: "返回检查", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(confirmedStatus).toHaveCount(0);
  expect(puts).toHaveLength(baselinePUTCount);
  expect(submissions).toHaveLength(0);
  expect(await readBody()).toEqual(beforeReview);
  await check.click();
  await expect(dialog).toBeVisible();
  const continueButton = dialog.getByRole("button", { name: "已检查，继续", exact: true });
  await expect(continueButton).toBeEnabled();
  await continueButton.click();
  await expect(dialog).toBeHidden();
  await expect(confirmedStatus).toHaveCount(1);
  await expect(confirmedStatus).toContainText("仍有1处待补充");
  expect(puts).toHaveLength(baselinePUTCount);
  expect(submissions).toHaveLength(0);
  expect(await readBody()).toEqual(beforeReview);
  await writeFile(testInfo.outputPath("public-confirm-current-revision.json"), JSON.stringify({ bodyContext: { contractVersionId: beforeReview.contractVersionId, draftRevision: beforeReview.draftRevision, documentContentRevision: beforeReview.documentContentRevision, layoutTemplateVersionId: beforeReview.layoutTemplateVersionId, sourceSha256: beforeReview.sourceSha256 }, optionalMarkerRetained: acceptance.text, PUTsBeforeReview: baselinePUTCount, PUTsAfterConfirm: puts.length, submissions: submissions.length, visibleConfirmation: await confirmedStatus.innerText(), scope: "temporary current-revision UI check, not backend permission or task12 formal submit" }, null, 2));
  const changedAfterConfirmation = "交货地点：北区仓库，请先核对。";
  await savedDeliveryInput.fill(changedAfterConfirmation);
  await expect(confirmedStatus).toHaveCount(0);
  await expect(savedDeliveryInput).toHaveValue(changedAfterConfirmation);
  await expect(check).toBeEnabled();
  expect(submissions).toHaveLength(0);
  const dimensions = await page.evaluate(() => ({ viewport: innerWidth, documentWidth: document.documentElement.scrollWidth }));
  expect(dimensions.documentWidth).toBeLessThanOrEqual(dimensions.viewport + 1);
  await page.screenshot({ path: testInfo.outputPath("blank-review-invalidated.png"), fullPage: true });
  await writeFile(testInfo.outputPath("receipt.json"), JSON.stringify({ sourceSha256: after.sourceSha256, layoutTemplateVersionId: after.layoutTemplateVersionId, savedRevision: after.draftRevision, retainedOptionalMarker: acceptance.text, typedAfterConfirm: changedAfterConfirmation, observedPUTs: puts, independentReaderWrites: readerWrites, submissions: submissions.length, dimensions, scope: "optional ordinary marker live hint/edit/publicsave+separate-readonly-page-reload/original-granted-editor currentrevision confirm withoneblank/cancelconfirm0PUT/noformalSubmit/newinputinvalidates; originaleditorhardreload-writable assumption is not claimed; not task12/query/races/mobile/PDF" }, null, 2));
});
