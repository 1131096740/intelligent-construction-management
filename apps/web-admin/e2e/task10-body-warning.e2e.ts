import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

test("真实旧正文警告可见且仅在填写保存和新正文回执后消失", async ({ page }, testInfo) => {
  const input = JSON.parse(process.env.TASK10_BODY_BROWSER_INPUT ?? "{}");
  const path = "/contract-drafts/" + input.versionId;
  const isBody = (url: string) => new URL(url).pathname.endsWith(path + "/document-body");
  const oldBrowserRead = page.waitForResponse(response => response.request().method() === "GET" && isBody(response.url()));
  const writes: Array<{ method: string; pathname: string }> = [];
  page.on("request", request => {
    const pathname = new URL(request.url()).pathname;
    if ((request.method() === "PUT" && pathname.endsWith(path)) || (request.method() === "POST" && pathname.endsWith(path + "/preview-generation"))) writes.push({ method: request.method(), pathname });
  });
  const target = "/合同工作台/" + input.contractId + "?versionId=" + input.versionId;
  await page.goto("/login?redirect=" + encodeURIComponent(target));
  await page.getByPlaceholder("请输入手机号").fill(input.staff.phone);
  await page.getByPlaceholder("请输入密码").fill(input.staff.password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.getByText("合同正文", { exact: true }).click();
  const editor = page.getByRole("region", { name: "完整合同正文", exact: true });
  await expect(editor).toBeVisible();
  await expect(editor.getByRole("button", { name: "保存正文", exact: true })).toBeEnabled();
  const oldResponse = await oldBrowserRead; expect(oldResponse.status()).toBe(200);
  const oldBody = await oldResponse.json();
  expect(oldBody).toMatchObject({ contractVersionId: input.versionId, layoutTemplateVersionId: input.layoutId, sourceSha256: input.sourceSha256,
    draftRevision: input.oldDraftR, documentContentRevision: input.oldContentR, warnings: [input.warning] });
  const taxIndex = oldBody.blocks.findIndex((block: { id: string }) => block.id === input.taxPositionId);
  expect(taxIndex).toBeGreaterThanOrEqual(0);
  expect(oldBody.blocks[taxIndex]).toMatchObject({ editable: true });
  expect(oldBody.blocks[taxIndex].text).toMatch(/税率\s*3\s*%/u);
  await expect(editor.getByRole("textbox", { name: "编辑普通条款" + (taxIndex + 1), exact: true })).toHaveValue(oldBody.blocks[taxIndex].text);
  const login = await page.request.post("/api/auth/login", { data: input.staff }); expect(login.status()).toBe(201);
  const headers = { authorization: "Bearer " + (await login.json()).tokens.accessToken, "x-contract-numeric-protocol": "2" };
  const beforeResponse = await page.request.get("/api" + path + "/workbench", { headers }); expect(beforeResponse.status()).toBe(200);
  const before = await beforeResponse.json();
  expect(before.version).toMatchObject({ draftRevision: input.oldDraftR, documentContentRevision: input.oldContentR, documentContentFingerprint: input.oldF, amountYuan: "600.0000" });
  expect(Object.hasOwn(before.draft, "documentRenderProfile")).toBe(false);
  expect(before.bills[0].rows.map((row: { rowKey: string }) => row.rowKey)).toEqual(input.rowKeys);
  for (const file of ["src/api/contract-workbench.api.ts", "src/pages/contracts/workbench/ContractBodyEditor.vue", "src/pages/contracts/workbench/use-contract-draft.ts"]) {
    const served = await page.request.get("/" + file); expect(served.status()).toBe(200);
    const bytes = await served.body();
    await writeFile(testInfo.outputPath(file.split("/").at(-1)! + ".served.js"), bytes);
    await writeFile(testInfo.outputPath(file.split("/").at(-1)! + ".hash.json"), JSON.stringify({ file,
      diskSha256: createHash("sha256").update(await readFile(resolve(file))).digest("hex"), servedSha256: createHash("sha256").update(bytes).digest("hex") }));
  }
  expect(writes).toEqual([]);
  await writeFile(testInfo.outputPath("old-public-preconditions.json"), JSON.stringify({ oldBody, version: before.version, rowKeys: input.rowKeys, writes }, null, 2));
  // Sole first RED target after the real historical HTTP/app preconditions.
  const notice = editor.getByRole("status", { name: "正文提示", exact: true });
  await expect(notice).toBeVisible();
  await expect(notice).toContainText(input.warning);
  await notice.scrollIntoViewIfNeeded();
  await expect(notice).toBeInViewport({ ratio: 1 });
  await page.screenshot({ path: testInfo.outputPath("old-warning-visible.png"), fullPage: true });
  await page.getByText("填写信息", { exact: true }).click();
  const name = page.locator('section[data-section-id="basic"]').getByRole("textbox", { name: /合同名称/u });
  await expect(name).toHaveValue("上游新建当前合同名称");
  const newName = "历史正文提示已核对";
  const savedPromise = page.waitForResponse(response => response.request().method() === "PUT" && new URL(response.url()).pathname.endsWith(path)
    && response.request().postDataJSON()?.draft?.draftData?.contractName === newName);
  const refreshedPromise = page.waitForResponse(async response => {
    if (response.request().method() !== "GET" || !isBody(response.url()) || response.status() !== 200) return false;
    const body = await response.json();
    return body.draftRevision > input.oldDraftR && Array.isArray(body.warnings) && body.warnings.length === 0;
  });
  // Existing real natural autosave; no top-level save (it also queues a preview), no fake clock.
  await name.fill(newName);
  const [saved, refreshed] = await Promise.all([savedPromise, refreshedPromise]); expect(saved.status()).toBe(200);
  const ack = await saved.json(); const payload = saved.request().postDataJSON();
  expect(payload.draft.numericProtocolVersion).toBe(2);
  expect(Object.hasOwn(payload.draft.draftData, "documentRenderProfile")).toBe(false);
  await page.getByText("合同正文", { exact: true }).click();
  const body = await refreshed.json();
  expect(body).toMatchObject({ contractVersionId: input.versionId, sourceSha256: input.sourceSha256, layoutTemplateVersionId: input.layoutId,
    draftRevision: ack.serverRevision, documentContentRevision: ack.documentContentRevision, warnings: [] });
  expect(body.blocks.find((block: { id: string }) => block.id === input.taxPositionId)).toMatchObject({ editable: false });
  expect(body.blocks.find((block: { id: string }) => block.id === input.taxPositionId).text).toMatch(/税率\s*0%/u);
  await expect(notice).toHaveCount(0);
  const afterResponse = await page.request.get("/api" + path + "/workbench", { headers }); expect(afterResponse.status()).toBe(200);
  const after = await afterResponse.json();
  expect(after.draft).toMatchObject({ contractName: newName, documentRenderProfile: { reviewedLaborTaxBindingVersion: "reviewed-labor-tax-v1" } });
  expect(after.version.amountYuan).toBe("600.0000"); expect(after.version.documentContentFingerprint).not.toBe(input.oldF);
  expect(after.bills[0].rows.map((row: { rowKey: string }) => row.rowKey)).toEqual(input.rowKeys);
  const documents = await page.request.get("/api/contract-workbench/" + input.versionId + "/documents", { headers });
  expect(documents.status()).toBe(200); expect(await documents.json()).toEqual([]);
  expect(writes.filter(write => write.method === "POST")).toEqual([]);
  await writeFile(testInfo.outputPath("fresh-public-save-and-body.json"), JSON.stringify({ ack, body, version: after.version, rowKeys: input.rowKeys, writes, naturalAutosaveNoFixedCountOrRevisionDelta: true }, null, 2));
  await page.screenshot({ path: testInfo.outputPath("fresh-body-warning-cleared.png"), fullPage: true });
});
