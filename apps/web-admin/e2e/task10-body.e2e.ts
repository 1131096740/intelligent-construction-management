import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

test("完整正文直接编辑、保存后从真实HTTP重读并刷新页面保留", async ({ page }, testInfo) => {
  const input = JSON.parse(process.env.TASK10_BODY_BROWSER_INPUT ?? "{}");
  const draft = input.drafts[testInfo.project.name];
  const target = `/合同工作台/${draft.contract.id}?versionId=${draft.version.id}`;
  await page.goto("/login?redirect=" + encodeURIComponent(target));
  await page.getByPlaceholder("请输入手机号").fill(input.staff.phone);
  await page.getByPlaceholder("请输入密码").fill(input.staff.password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.getByText("合同正文", { exact: true }).click();
  const servedSources = [];
  for (const file of ["src/pages/contracts/ContractWorkbenchPage.vue", "src/pages/contracts/workbench/ContractDocumentCanvas.vue", "src/pages/contracts/workbench/ContractBodyEditor.vue", "src/pages/contracts/workbench/ContractBodyFlow.vue"]) {
    const response = await page.request.get(`/${file}`);
    expect(response.status()).toBe(200);
    const body = await response.body();
    await writeFile(testInfo.outputPath(file.split("/").at(-1)! + ".served.js"), body);
    servedSources.push({ file, diskSha256: createHash("sha256").update(await readFile(resolve(file))).digest("hex"), publicServedJavaScriptSha256: createHash("sha256").update(body).digest("hex"), legacyCanvasMarkerPresent: body.toString().includes("合同正文画布"), completeBodyMarkerPresent: body.toString().includes("完整合同正文") });
  }
  await writeFile(testInfo.outputPath("public-source-freshness.json"), JSON.stringify(servedSources, null, 2));
  await expect(page.getByRole("heading", { name: "完整合同正文", exact: true })).toBeVisible();
  await expect(page.getByText("甲方：当前单甲方", { exact: true })).toBeVisible();
  const ordinary = page.getByRole("textbox", { name: "编辑普通条款7", exact: true });
  await expect(ordinary).toHaveValue("手工条款：本项普通约定按原文保留。");
  await expect(ordinary).toBeEditable();
  await expect(page.getByRole("button", { name: "保存正文", exact: true })).toBeEnabled();
  const edited = `手工条款：${testInfo.project.name}端在完整正文保存，约定金额1.5340保留。`;
  const savedResponse = page.waitForResponse(response => response.request().method() === "PUT" && response.url().endsWith(`/contract-drafts/${draft.version.id}`) &&
    response.request().postDataJSON()?.draft?.draftData?.documentBody?.edits?.some((edit: { text: string }) => edit.text === edited));
  await ordinary.fill(edited);
  await page.getByRole("button", { name: "保存正文", exact: true }).click();
  expect((await savedResponse).status()).toBe(200);
  const login = await page.request.post("/api/auth/login", { data: input.staff });
  expect(login.status()).toBe(201);
  const headers = { authorization: `Bearer ${(await login.json()).tokens.accessToken}`, "x-contract-numeric-protocol": "2" };
  const reread = await page.request.get(`/api/contract-drafts/${draft.version.id}/document-body`, { headers });
  expect(reread.status()).toBe(200);
  const savedBody = await reread.json();
  expect(savedBody.blocks.some((block: { text: string }) => block.text === edited)).toBe(true);
  await page.reload();
  await page.getByText("合同正文", { exact: true }).click();
  await expect(page.getByRole("textbox", { name: "编辑普通条款7", exact: true })).toHaveValue(edited);
  const dimensions = await page.evaluate(() => ({ viewport: window.innerWidth, documentWidth: document.documentElement.scrollWidth }));
  expect(dimensions.documentWidth).toBeLessThanOrEqual(dimensions.viewport + 1);
  const font = await ordinary.evaluate(element => Number.parseFloat(getComputedStyle(element).fontSize));
  expect(font).toBeGreaterThanOrEqual(16);
  await page.screenshot({ path: testInfo.outputPath("complete-body.png"), fullPage: true });
  await writeFile(testInfo.outputPath("receipt.json"), JSON.stringify({ draft, documentContentRevision: savedBody.documentContentRevision, edited, dimensions, font, scope: "real guarded local HTTP, synthetic persistence, actual desktop/mobile editor" }, null, 2));
});
