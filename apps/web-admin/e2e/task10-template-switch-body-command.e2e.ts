import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

test("换版及名称回执后刷新前可确认当前模板正文命令", async ({ page }, testInfo) => {
  const input = JSON.parse(process.env.TASK10_BODY_BROWSER_INPUT ?? "{}");
  const draft = input.draft;
  const target = "/合同工作台/" + draft.contract.id + "?versionId=" + draft.version.id;
  await page.goto("/login?redirect=" + encodeURIComponent(target));
  await page.getByPlaceholder("请输入手机号").fill(input.staff.phone);
  await page.getByPlaceholder("请输入密码").fill(input.staff.password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.getByText("合同正文", { exact: true }).click();
  const editor = page.getByRole("region", { name: "完整合同正文", exact: true });
  await expect(editor).toBeVisible();
  await expect(editor.getByRole("button", { name: "保存正文", exact: true })).toBeEnabled();
  const freshness = [];
  for (const file of ["src/pages/contracts/ContractWorkbenchPage.vue", "src/pages/contracts/workbench/ContractDocumentsSection.vue", "src/pages/contracts/workbench/ContractBodyEditor.vue", "src/pages/contracts/workbench/ContractBodyFlow.vue", "src/pages/contracts/workbench/use-contract-draft.ts"]) {
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
  const readWorkbench = async () => { const response = await page.request.get(base + "/workbench", { headers }); expect(response.status()).toBe(200); return response.json(); };
  const readBody = async () => { const response = await page.request.get(base + "/document-body", { headers }); expect(response.status()).toBe(200); return response.json(); };
  const workbench = await readWorkbench();
  const before = await readBody();
  const oldPlan = workbench.version.draftData.documentBody;
  expect(workbench.version.numericProtocolVersion).toBe(2);
  expect(workbench.version.amountYuan).toBe("6.5000");
  expect(workbench.version.layoutTemplateVersionId).toBe(input.original.id);
  expect(before.sourceSha256).toBe(input.sourceSha256);
  expect(before.layoutTemplateVersionId).toBe(input.original.id);
  expect(before.draftRevision).toBe(workbench.version.draftRevision);
  expect(oldPlan.edits).toEqual([{ positionId: draft.ordinaryId, text: draft.originalOrdinaryText + "原有人工条款需保留。" }]);
  expect(oldPlan.additions).toEqual([{ id: draft.additionId, afterPositionId: draft.ordinaryId, text: "更换模板前已保存的新增约定。" }]);
  const facts = (value: typeof workbench) => ({ amountYuan: value.version.amountYuan, invoiceType: value.version.invoiceType, taxMode: value.version.taxMode, defaultTaxRatePercent: value.version.defaultTaxRatePercent, taxFactStatus: value.version.taxFactStatus,
    bills: value.bills.map((bill: { billKey: string; taxInclusiveAmountYuan: string; taxExclusiveAmountYuan: string; taxAmountYuan: string }) => ({ billKey: bill.billKey, taxInclusiveAmountYuan: bill.taxInclusiveAmountYuan, taxExclusiveAmountYuan: bill.taxExclusiveAmountYuan, taxAmountYuan: bill.taxAmountYuan })) });
  const oldFacts = facts(workbench);
  const ordinaryNumber = before.blocks.findIndex((block: { id: string }) => block.id === draft.ordinaryId) + 1;
  await expect(editor.getByRole("textbox", { name: "编辑普通条款" + ordinaryNumber, exact: true })).toHaveValue(oldPlan.edits[0].text);
  const originalTables = editor.getByRole("region", { name: "合同正文表格", exact: true });
  await expect(originalTables).toHaveCount(2);
  await expect(originalTables.nth(0).getByRole("table").getByRole("row").nth(1).getByRole("cell").nth(7)).toHaveText("6.5000");
  const puts: string[] = [];
  page.on("request", request => { if (request.method() === "PUT" && request.url().endsWith("/contract-drafts/" + draft.version.id)) puts.push(request.postData() ?? ""); });
  await page.getByText("填写信息", { exact: true }).click();
  await page.getByRole("navigation", { name: "合同资料章节", exact: true }).getByRole("link", { name: "合同文档", exact: true }).click();
  const selector = page.locator(".document-controls").getByPlaceholder("选择已发布版式", { exact: true });
  await expect(selector).toBeEnabled();
  await expect(selector).toHaveValue("原版材料合同 · V1");
  await writeFile(testInfo.outputPath("public-before-template-switch.json"), JSON.stringify({ before, oldPlan, oldFacts, original: input.original, alternative: input.alternative, scope: "two distinctsyntheticrecords/same44besource" }, null, 2));
  await selector.click();
  await page.getByText("备选材料合同 · V1", { exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "更换模板", exact: true });
  // First functional target: real selection must warn before any aggregate PUT.
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("手工");
  await expect(dialog).toContainText("新增");
  expect(puts).toHaveLength(0);
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(selector).toHaveValue("原版材料合同 · V1");
  expect(puts).toHaveLength(0);
  expect(await readBody()).toEqual(before);
  const cancelled = await readWorkbench();
  expect(cancelled.version.layoutTemplateVersionId).toBe(input.original.id);
  expect(cancelled.version.draftData.documentBody).toEqual(oldPlan);
  expect(cancelled.version.draftRevision).toBe(workbench.version.draftRevision);
  expect(facts(cancelled)).toEqual(oldFacts);
  await selector.click();
  await page.getByText("备选材料合同 · V1", { exact: true }).click();
  await expect(dialog).toBeVisible();
  const firstSave = page.waitForResponse(response => response.request().method() === "PUT" && response.url().endsWith("/contract-drafts/" + draft.version.id));
  await dialog.getByRole("button", { name: "确认更换", exact: true }).click();
  const saved = await firstSave;
  const payload = saved.request().postDataJSON();
  const responseText = await saved.text();
  await writeFile(testInfo.outputPath("public-template-switch-save-response.json"), JSON.stringify({ status: saved.status(), response: responseText, idempotencyKey: payload.idempotencyKey, expectedRevision: payload.expectedRevision, draftProtocol: payload.draft?.numericProtocolVersion, selected: payload.draft?.layoutTemplateVersionId, bodyPresent: Object.hasOwn(payload.draft?.draftData ?? {}, "documentBody"), action: payload.draft?.draftData?.documentBodyAction }, null, 2));
  expect(payload.expectedRevision).toBe(before.draftRevision);
  expect(payload.draft.numericProtocolVersion).toBe(2);
  expect(payload.draft.layoutTemplateVersionId).toBe(input.alternative.id);
  expect(Object.hasOwn(payload.draft.draftData, "documentBody")).toBe(false);
  expect(payload.draft.draftData.documentBodyAction).toEqual({ kind: "regenerate", confirmOverwrite: true });
  expect(saved.status()).toBe(200);
  const firstReceipt = JSON.parse(responseText);
  expect(firstReceipt.serverRevision).toBe(before.draftRevision + 1);
  const after = await readBody();
  expect(after.layoutTemplateVersionId).toBe(input.alternative.id);
  expect(after.sourceSha256).toBe(before.sourceSha256); // Same approved bytes, not a new source.
  expect(after.draftRevision).toBe(firstReceipt.serverRevision);
  expect(after.documentContentRevision).toBe(before.documentContentRevision + 1);
  expect(after.blocks.find((block: { id: string }) => block.id === draft.ordinaryId).text).toBe(draft.originalOrdinaryText);
  expect(after.blocks.some((block: { id: string }) => block.id.startsWith("added:"))).toBe(false);
  expect(after.savePoints).toHaveLength(before.savePoints.length + 1);
  expect(after.savePoints).toContainEqual(expect.objectContaining({ layoutTemplateVersionId: input.original.id, documentContentRevision: before.documentContentRevision, documentBody: oldPlan }));
  const switched = await readWorkbench();
  expect(switched.version.layoutTemplateVersionId).toBe(input.alternative.id);
  expect(switched.version.draftData.documentBodyAction).toBeUndefined();
  expect(facts(switched)).toEqual(oldFacts);
  // No reload or body edit can mask command consumption before this non-body save.
  const navigation = page.getByRole("navigation", { name: "合同资料章节", exact: true });
  await navigation.getByRole("link", { name: "基础信息", exact: true }).click();
  const name = page.locator('section[data-section-id="basic"]').getByRole("textbox", { name: /合同名称/u });
  await expect(name).toBeEditable();
  await expect(name).toHaveValue("上游新建当前合同名称");
  const changedName = "换模板回执后更新合同名称";
  const secondSave = page.waitForResponse(response => response.request().method() === "PUT" && response.url().endsWith("/contract-drafts/" + draft.version.id) && response.request().postDataJSON()?.draft?.draftData?.contractName === changedName);
  await name.fill(changedName);
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  const second = await secondSave;
  const secondPayload = second.request().postDataJSON();
  const secondText = await second.text();
  await writeFile(testInfo.outputPath("public-second-nonbody-save-response.json"), JSON.stringify({ status: second.status(), response: secondText, idempotencyKey: secondPayload.idempotencyKey, expectedRevision: secondPayload.expectedRevision, selected: secondPayload.draft?.layoutTemplateVersionId, body: secondPayload.draft?.draftData?.documentBody, hasAction: Object.hasOwn(secondPayload.draft?.draftData ?? {}, "documentBodyAction") }, null, 2));
  expect(secondPayload.idempotencyKey).not.toBe(payload.idempotencyKey);
  expect(secondPayload.expectedRevision).toBe(firstReceipt.serverRevision);
  expect(secondPayload.draft.layoutTemplateVersionId).toBe(input.alternative.id);
  expect(Object.hasOwn(secondPayload.draft.draftData, "documentBodyAction")).toBe(false);
  expect(second.status()).toBe(200);
  const secondReceipt = JSON.parse(secondText);
  expect(secondReceipt.serverRevision).toBe(firstReceipt.serverRevision + 1);
  const afterName = await readWorkbench();
  expect(afterName.version.draftData.contractName).toBe(changedName);
  expect(afterName.version.layoutTemplateVersionId).toBe(input.alternative.id);
  expect(afterName.version.draftData.documentBodyAction).toBeUndefined();
  expect(facts(afterName)).toEqual(oldFacts);
  const afterNameBody = await readBody();
  expect(afterNameBody.savePoints).toEqual(after.savePoints);
  expect(afterNameBody.blocks.find((block: { id: string }) => block.id === draft.ordinaryId).text).toBe(draft.originalOrdinaryText);
  expect(afterNameBody.blocks.some((block: { id: string }) => block.id.startsWith("added:"))).toBe(false);
  // Independent target after the switch and non-body ACKs: no reload yet.
  const currentBody = await readBody();
  const currentWorkbench = await readWorkbench();
  expect(currentWorkbench.version.layoutTemplateVersionId).toBe(input.alternative.id);
  expect(currentWorkbench.version.draftRevision).toBe(secondReceipt.serverRevision);
  expect(currentBody.layoutTemplateVersionId).toBe(input.alternative.id);
  expect(currentBody.sourceSha256).toBe(input.sourceSha256);
  expect(currentBody.draftRevision).toBe(currentWorkbench.version.draftRevision);
  expect(currentBody.blocks.find((block: { id: string }) => block.id === draft.ordinaryId).text).toBe(draft.originalOrdinaryText);
  await page.getByText("合同正文", { exact: true }).click();
  const currentNumber = currentBody.blocks.findIndex((block: { id: string }) => block.id === draft.ordinaryId) + 1;
  await expect(editor.getByRole("textbox", { name: "编辑普通条款" + currentNumber, exact: true })).toHaveValue(draft.originalOrdinaryText);
  await expect(editor.getByRole("button", { name: "保存正文", exact: true })).toBeEnabled();
  const regenerate = editor.getByRole("button", { name: "重新生成正文", exact: true });
  await expect(regenerate).toBeVisible();
  await expect(regenerate).toBeEnabled();
  await regenerate.click();
  const regenerationDialog = page.getByRole("dialog", { name: "重新生成正文", exact: true });
  await expect(regenerationDialog).toBeVisible();
  await expect(regenerationDialog.getByRole("button", { name: "确认重新生成", exact: true })).toBeEnabled();
  const laterRequests: Array<Record<string, unknown>> = [];
  page.on("request", request => {
    if (request.method() !== "PUT" || !request.url().endsWith("/contract-drafts/" + draft.version.id)) return;
    const body = request.postDataJSON();
    laterRequests.push({ expectedRevision: body.expectedRevision, selected: body.draft?.layoutTemplateVersionId,
      body: body.draft?.draftData?.documentBody, action: body.draft?.draftData?.documentBodyAction });
  });
  await writeFile(testInfo.outputPath("public-before-third-body-command.json"), JSON.stringify({ newLayout: input.alternative.id, sourceSha256: currentBody.sourceSha256,
    draftRevision: currentBody.draftRevision, documentContentRevision: currentBody.documentContentRevision, observableCommandControls: "visible/enabled actualDialog confirmation, no reload or injectedpayload", priorSavePoints: currentBody.savePoints }, null, 2));
  const thirdResponse = page.waitForResponse(response => {
    if (response.request().method() !== "PUT" || !response.url().endsWith("/contract-drafts/" + draft.version.id)) return false;
    const body = response.request().postDataJSON();
    return body.expectedRevision === currentBody.draftRevision && body.draft?.layoutTemplateVersionId === input.alternative.id &&
      body.draft?.draftData?.documentBodyAction?.kind === "regenerate";
  }, { timeout: 10_000 });
  await regenerationDialog.getByRole("button", { name: "确认重新生成", exact: true }).click();
  let third;
  try { third = await thirdResponse; }
  catch (cause) {
    await writeFile(testInfo.outputPath("public-third-body-command-timeout.json"), JSON.stringify({ observableWindowMs: 10_000, laterRequests,
      expectedLayout: input.alternative.id, expectedRevision: currentBody.draftRevision, scope: "no matching realthirdPUT response; classify actualnetwork rather than privateVue" }, null, 2));
    throw cause;
  }
  const thirdPayload = third.request().postDataJSON();
  const thirdText = await third.text();
  await writeFile(testInfo.outputPath("public-third-body-command-response.json"), JSON.stringify({ status: third.status(), response: thirdText,
    idempotencyKey: thirdPayload.idempotencyKey, expectedRevision: thirdPayload.expectedRevision, selected: thirdPayload.draft.layoutTemplateVersionId,
    plan: thirdPayload.draft.draftData.documentBody, action: thirdPayload.draft.draftData.documentBodyAction }, null, 2));
  expect(thirdPayload.idempotencyKey).not.toBe(payload.idempotencyKey);
  expect(thirdPayload.idempotencyKey).not.toBe(secondPayload.idempotencyKey);
  expect(thirdPayload.draft.numericProtocolVersion).toBe(2);
  expect(thirdPayload.draft.draftData.documentBody).toMatchObject({ protocolVersion: 1, layoutTemplateVersionId: input.alternative.id, sourceSha256: input.sourceSha256, edits: [] });
  expect(thirdPayload.draft.draftData.documentBodyAction).toEqual({ kind: "regenerate", confirmOverwrite: true });
  expect(third.status()).toBe(200);
  const thirdReceipt = JSON.parse(thirdText);
  const afterThird = await readBody();
  expect(afterThird.layoutTemplateVersionId).toBe(input.alternative.id);
  expect(afterThird.sourceSha256).toBe(input.sourceSha256);
  expect(afterThird.draftRevision).toBe(thirdReceipt.serverRevision);
  expect(afterThird.savePoints).toEqual(currentBody.savePoints);
  const finalWorkbench = await readWorkbench();
  expect(finalWorkbench.version.layoutTemplateVersionId).toBe(input.alternative.id);
  expect(finalWorkbench.version.draftData.contractName).toBe(changedName);
  expect(finalWorkbench.version.draftData.documentBodyAction).toBeUndefined();
  expect(facts(finalWorkbench)).toEqual(oldFacts);
  await writeFile(testInfo.outputPath("receipt.json"), JSON.stringify({ original: input.original.id, selected: input.alternative.id, same44beSource: input.sourceSha256,
    firstRevision: firstReceipt.serverRevision, secondRevision: secondReceipt.serverRevision, thirdRevision: thirdReceipt.serverRevision,
    thirdBody: thirdPayload.draft.draftData.documentBody, scope: "normal switch+nameACK then actualsamecurrentbodycommand before anyreload; no forcedprivatecanonicalstate orsourcebytechange" }, null, 2));
});


test("跨不同原源更换模板时取消不写入且确认整篇替换", async ({ page }, testInfo) => {
  const input = JSON.parse(process.env.TASK10_BODY_BROWSER_INPUT ?? "{}");
  const draft = input.draft;
  expect(input.original.sha256).toBe("ef9b75b39a487903d33bfc239f7c9754b8172ff1a1f6c6b6b3ba20178e098e5d");
  expect(input.alternative.sha256).toBe("3a3d0fb5e9b5e49798f3773f213296b9cfa224874d14bda6aa89006b63bd366a");
  expect(input.original.sha256).not.toBe(input.alternative.sha256);
  const target = "/合同工作台/" + draft.contract.id + "?versionId=" + draft.version.id;
  await page.goto("/login?redirect=" + encodeURIComponent(target));
  await page.getByPlaceholder("请输入手机号").fill(input.staff.phone);
  await page.getByPlaceholder("请输入密码").fill(input.staff.password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.getByText("合同正文", { exact: true }).click();
  const editor = page.getByRole("region", { name: "完整合同正文", exact: true });
  await expect(editor).toBeVisible();
  const freshness = [];
  for (const file of ["src/pages/contracts/ContractWorkbenchPage.vue", "src/pages/contracts/workbench/ContractDocumentsSection.vue", "src/pages/contracts/workbench/ContractBodyEditor.vue", "src/pages/contracts/workbench/ContractBodyFlow.vue", "src/pages/contracts/workbench/use-contract-draft.ts"]) {
    const response = await page.request.get("/" + file); expect(response.status()).toBe(200);
    const bytes = await response.body();
    await writeFile(testInfo.outputPath(file.split("/").at(-1)! + ".served.js"), bytes);
    freshness.push({ file, diskSha256: createHash("sha256").update(await readFile(resolve(file))).digest("hex"), publicServedJavaScriptSha256: createHash("sha256").update(bytes).digest("hex") });
  }
  await writeFile(testInfo.outputPath("public-source-freshness.json"), JSON.stringify(freshness, null, 2));
  const login = await page.request.post("/api/auth/login", { data: input.staff }); expect(login.status()).toBe(201);
  const headers = { authorization: "Bearer " + (await login.json()).tokens.accessToken, "x-contract-numeric-protocol": "2" };
  const base = "/api/contract-drafts/" + draft.version.id;
  const readWorkbench = async () => { const response = await page.request.get(base + "/workbench", { headers }); expect(response.status()).toBe(200); return response.json(); };
  const readBody = async () => { const response = await page.request.get(base + "/document-body", { headers }); expect(response.status()).toBe(200); return response.json(); };
  const readCheckpointProjection = async () => { const response = await page.request.get("/api/contract-workbench/" + draft.contract.id, { headers }); expect(response.status()).toBe(200); return response.json(); };
  const facts = (value: Awaited<ReturnType<typeof readWorkbench>>) => ({ amountYuan: value.version.amountYuan, invoiceType: value.version.invoiceType, taxMode: value.version.taxMode, defaultTaxRatePercent: value.version.defaultTaxRatePercent,
    parties: value.parties.map((party: { roleKey: string; displayOrder: number; snapshot: unknown }) => ({ roleKey: party.roleKey, displayOrder: party.displayOrder, snapshot: party.snapshot })),
    bills: value.bills.map((bill: { billKey: string; taxInclusiveAmountYuan: string; taxExclusiveAmountYuan: string; taxAmountYuan: string; rows: Array<{ itemName: string; unit: string; quantity: string; unitPrice: string; taxRatePercent: string; customData: unknown }> }) => ({ billKey: bill.billKey, taxInclusiveAmountYuan: bill.taxInclusiveAmountYuan, taxExclusiveAmountYuan: bill.taxExclusiveAmountYuan, taxAmountYuan: bill.taxAmountYuan,
      rows: bill.rows.map(row => ({ itemName: row.itemName, unit: row.unit, quantity: row.quantity, unitPrice: row.unitPrice, taxRatePercent: row.taxRatePercent, customData: row.customData })) })) });
  const initialWorkbench = await readWorkbench(), initialBody = await readBody();
  const oldPlan = initialWorkbench.version.draftData.documentBody;
  const renderedAdditionText = "补充条款1：" + draft.additionText;
  const assertManualInputs = async (body: typeof initialBody) => {
    for (const [id, text] of [[draft.ordinaryId, draft.manualText], ["added:" + draft.additionId, renderedAdditionText]]) {
      const index = body.blocks.findIndex((block: { id: string }) => block.id === id);
      expect(index).toBeGreaterThanOrEqual(0);
      await expect(editor.getByRole("textbox", { name: "编辑普通条款" + (index + 1), exact: true })).toHaveValue(text);
    }
  };
  await assertManualInputs(initialBody);
  expect(initialWorkbench.contract.contractTypeKey).toBe("other");
  expect(initialBody.sourceSha256).toBe(input.original.sha256);
  expect(initialWorkbench.version.amountYuan).toBe("6.5000");
  expect(oldPlan.edits).toEqual([{ positionId: draft.ordinaryId, text: draft.manualText }]);
  expect(oldPlan.additions).toEqual([{ id: draft.additionId, afterPositionId: draft.ordinaryId, text: draft.additionText }]);
  expect(initialWorkbench.version.draftData.documentRenderProfile).toEqual({ typographyVersion: "reviewed-generic-primary-roles-v1" });
  const puts: string[] = [];
  page.on("request", request => { if (request.method() === "PUT" && request.url().endsWith("/contract-drafts/" + draft.version.id)) puts.push(request.postData() ?? ""); });
  await page.getByText("填写信息", { exact: true }).click();
  await page.getByRole("navigation", { name: "合同资料章节", exact: true }).getByRole("link", { name: "基础信息", exact: true }).click();
  const changedName = "跨源切换前已确认的合同名称";
  const nameSave = page.waitForResponse(response => response.request().method() === "PUT" && response.url().endsWith("/contract-drafts/" + draft.version.id) && response.request().postDataJSON()?.draft?.draftData?.contractName === changedName);
  await page.getByRole("textbox", { name: "合同名称" }).fill(changedName);
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  const nameResponse = await nameSave; expect(nameResponse.status()).toBe(200);
  const nameReceipt = await nameResponse.json();
  const namedWorkbench = await readWorkbench(), namedBody = await readBody();
  expect(namedWorkbench.version.draftRevision).toBe(nameReceipt.serverRevision);
  expect(namedWorkbench.version.draftData.contractName).toBe(changedName);
  expect(namedWorkbench.version.draftData.documentBody).toEqual(oldPlan);
  expect(namedWorkbench.version.draftData.documentRenderProfile).toEqual(initialWorkbench.version.draftData.documentRenderProfile);
  expect(facts(namedWorkbench)).toEqual(facts(initialWorkbench));
  expect(namedBody.sourceSha256).toBe(input.original.sha256);
  expect(namedBody.blocks.find((block: { id: string }) => block.id === draft.ordinaryId).text).toBe(draft.manualText);
  expect(namedBody.blocks.find((block: { id: string }) => block.id === "added:" + draft.additionId).text).toBe(renderedAdditionText);
  await page.getByText("合同正文", { exact: true }).click();
  await expect(editor).toContainText(changedName);
  await assertManualInputs(namedBody);
  const oldCheckpointRead = await readCheckpointProjection();
  await writeFile(testInfo.outputPath("public-after-name-ack.json"), JSON.stringify({ initialWorkbench, initialBody, namedWorkbench, namedBody, nameReceipt, oldCheckpointRead }, null, 2));
  await page.getByText("填写信息", { exact: true }).click();
  await page.getByRole("navigation", { name: "合同资料章节", exact: true }).getByRole("link", { name: "合同文档", exact: true }).click();
  const selector = page.locator(".document-controls").getByPlaceholder("选择已发布版式", { exact: true });
  await expect(selector).toHaveValue(input.original.name + " · V1");
  const cancelBaseline = puts.length; // Only after the real name SAVE acknowledgement.
  await selector.click(); await page.getByText(input.alternative.name + " · V1", { exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "更换模板", exact: true });
  await expect(dialog).toBeVisible(); await expect(dialog).toContainText("手工"); await expect(dialog).toContainText("新增");
  expect(puts).toHaveLength(cancelBaseline);
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await expect(dialog).not.toBeVisible(); await expect(selector).toHaveValue(input.original.name + " · V1");
  expect(puts).toHaveLength(cancelBaseline);
  expect(await readBody()).toEqual(namedBody);
  expect((await readWorkbench()).version).toEqual(namedWorkbench.version);
  expect((await readCheckpointProjection()).checkpoints).toEqual(oldCheckpointRead.checkpoints);
  await writeFile(testInfo.outputPath("public-cancel-no-write.json"), JSON.stringify({ cancelBaseline, afterCancelPutCount: puts.length, body: namedBody, version: namedWorkbench.version, checkpointIds: oldCheckpointRead.checkpoints.map((checkpoint: { id: string }) => checkpoint.id) }, null, 2));
  await selector.click(); await page.getByText(input.alternative.name + " · V1", { exact: true }).click(); await expect(dialog).toBeVisible();
  const switchedSave = page.waitForResponse(response => response.request().method() === "PUT" && response.url().endsWith("/contract-drafts/" + draft.version.id));
  await dialog.getByRole("button", { name: "确认更换", exact: true }).click();
  const switchedResponse = await switchedSave, payload = switchedResponse.request().postDataJSON();
  const responseText = await switchedResponse.text();
  await writeFile(testInfo.outputPath("public-confirm-request-response.json"), JSON.stringify({ status: switchedResponse.status(), payload, responseText }, null, 2));
  expect(payload.expectedRevision).toBe(nameReceipt.serverRevision);
  expect(payload.draft.layoutTemplateVersionId).toBe(input.alternative.id);
  expect(Object.hasOwn(payload.draft.draftData, "documentBody")).toBe(false);
  expect(payload.draft.draftData.documentBodyAction).toEqual({ kind: "regenerate", confirmOverwrite: true });
  expect(switchedResponse.status()).toBe(200);
  const receipt = JSON.parse(responseText);
  const afterBody = await readBody(), afterWorkbench = await readWorkbench(), checkpointRead = await readCheckpointProjection();
  expect(puts).toHaveLength(cancelBaseline + 1);
  expect(afterBody).toMatchObject({ layoutTemplateVersionId: input.alternative.id, sourceSha256: input.alternative.sha256, draftRevision: receipt.serverRevision });
  expect(afterWorkbench.version.layoutTemplateVersionId).toBe(input.alternative.id);
  expect(afterWorkbench.version.documentContentRevision).toBeGreaterThan(namedWorkbench.version.documentContentRevision);
  expect(afterWorkbench.version.documentContentFingerprint).not.toBe(namedWorkbench.version.documentContentFingerprint);
  expect(afterBody.documentContentRevision).toBe(afterWorkbench.version.documentContentRevision);
  expect(afterWorkbench.version.draftData.documentRenderProfile?.typographyVersion).toBeUndefined();
  expect(facts(afterWorkbench)).toEqual(facts(namedWorkbench));
  expect(afterWorkbench.version.draftData.documentBodyAction).toBeUndefined();
  const targetPlan = afterWorkbench.version.draftData.documentBody;
  if (targetPlan !== undefined) {
    expect(targetPlan).toMatchObject({ layoutTemplateVersionId: input.alternative.id, sourceSha256: input.alternative.sha256, edits: [] });
    expect(targetPlan.additions ?? []).toEqual([]);
  }
  const targetText = afterBody.blocks.map((block: { text: string }) => block.text).join("");
  for (const text of ["其他合同", "第二条 价款及付款约定", "第一条 业务内容", "第三条 付款条款", "第四条 特别约定", "第五条 合同清单", "签章页", changedName, "当前单甲方", "当前单乙方", "跨源清单项", "6.5000"]) expect(targetText).toContain(text);
  for (const text of ["通用合同", "第二条 价款及结算", draft.manualText, draft.additionText]) expect(targetText).not.toContain(text);
  expect(afterBody.blocks.some((block: { id: string }) => block.id === draft.ordinaryId || block.id.startsWith("added:"))).toBe(false);
  expect(afterBody.flow.filter((item: { kind: string }) => item.kind === "table").map((table: { columns: unknown[]; rows: unknown[] }) => [table.columns.length, table.rows.length])).toEqual([[7, 2], [2, 1]]);
  expect(afterBody.savePoints).toHaveLength(namedBody.savePoints.length + 1);
  expect(checkpointRead.checkpoints).toHaveLength(oldCheckpointRead.checkpoints.length + 1);
  const checkpoint = checkpointRead.checkpoints.find((item: { id: string }) => !oldCheckpointRead.checkpoints.some((old: { id: string }) => old.id === item.id));
  expect(checkpoint.name).toBe("正文重新生成前");
  expect(checkpoint.snapshot).toMatchObject({ kind: "contract_body", layoutTemplateVersionId: input.original.id, documentBody: oldPlan, documentContentRevision: namedWorkbench.version.documentContentRevision, documentContentFingerprint: namedWorkbench.version.documentContentFingerprint });
  expect(afterBody.savePoints).toContainEqual(expect.objectContaining({ id: checkpoint.id, layoutTemplateVersionId: input.original.id, documentBody: oldPlan, documentContentRevision: namedWorkbench.version.documentContentRevision }));
  const checkpointProfileExposed = Boolean(checkpoint.snapshot.draftData && Object.hasOwn(checkpoint.snapshot.draftData, "documentRenderProfile"));
  if (checkpointProfileExposed) expect(checkpoint.snapshot.draftData.documentRenderProfile).toEqual(namedWorkbench.version.draftData.documentRenderProfile);
  await expect(selector).toHaveValue(input.alternative.name + " · V1");
  await page.getByText("合同正文", { exact: true }).click();
  for (const text of ["其他合同", "第二条 价款及付款约定", "第四条 特别约定"]) {
    const index = afterBody.blocks.findIndex((block: { text: string }) => block.text === text);
    expect(index).toBeGreaterThanOrEqual(0);
    await expect(editor.getByRole("textbox", { name: "编辑普通条款" + (index + 1), exact: true })).toHaveValue(text);
  }
  expect(await readBody()).toEqual(afterBody);
  expect((await readWorkbench()).version).toEqual(afterWorkbench.version);
  await page.screenshot({ path: testInfo.outputPath("different-source-confirmed-without-reload.png"), fullPage: true });
  await writeFile(testInfo.outputPath("public-different-source-complete.json"), JSON.stringify({ original: input.original, alternative: input.alternative, namedWorkbench, namedBody, afterWorkbench, afterBody, receipt, checkpointRead, checkpointProfileExposed, oldServerProfile: namedWorkbench.version.draftData.documentRenderProfile, beforeFacts: facts(namedWorkbench), afterFacts: facts(afterWorkbench), targetPlan: targetPlan ?? null, puts: puts.map(value => JSON.parse(value)), scope: "Actual different-source cancel and explicit complete replacement, same type other; no cross-source carry of old manual plan" }, null, 2));
});
