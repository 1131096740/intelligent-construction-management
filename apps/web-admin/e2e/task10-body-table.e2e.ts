import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

test("原Word八列清单与双方签署表按实际正文结构可读", async ({ page }, testInfo) => {
  const input = JSON.parse(process.env.TASK10_BODY_BROWSER_INPUT ?? "{}");
  const draft = input.drafts[testInfo.project.name];
  const target = `/合同工作台/${draft.contract.id}?versionId=${draft.version.id}`;
  await page.goto("/login?redirect=" + encodeURIComponent(target));
  await page.getByPlaceholder("请输入手机号").fill(input.staff.phone);
  await page.getByPlaceholder("请输入密码").fill(input.staff.password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.getByText("合同正文", { exact: true }).click();
  const editor = page.getByRole("region", { name: "完整合同正文", exact: true });
  await expect(editor).toBeVisible();
  const regions = editor.getByRole("region", { name: "合同正文表格", exact: true });
  await expect(regions).toHaveCount(2);
  const table = regions.nth(0).getByRole("table");
  const rows = table.getByRole("row");
  await expect(rows).toHaveCount(2);
  const header = rows.nth(0).getByRole("cell");
  await expect(header).toHaveCount(8);
  const labels = [];
  const headerMetrics = [];
  for (let index = 0; index < 8; index++) {
    const cell = header.nth(index), paragraph = cell.locator(".body-paragraph > p");
    await expect(paragraph).toHaveCount(1);
    labels.push((await paragraph.innerText()).trim());
    {
      const metrics = await paragraph.evaluate(element => {
        const style = getComputedStyle(element);
        const table = element.closest("table");
        function box(node: Element | null) {
          if (!node) return null;
          const css = getComputedStyle(node);
          return { width: node.getBoundingClientRect().width, clientWidth: node.clientWidth, scrollWidth: node.scrollWidth,
            height: node.getBoundingClientRect().height, clientHeight: node.clientHeight, scrollHeight: node.scrollHeight,
            cssWidth: css.width, minWidth: css.minWidth, maxWidth: css.maxWidth, boxSizing: css.boxSizing,
            paddingLeft: css.paddingLeft, paddingRight: css.paddingRight, borderLeft: css.borderLeftWidth, borderRight: css.borderRightWidth,
            paddingTop: css.paddingTop, paddingBottom: css.paddingBottom, lineHeight: css.lineHeight, fontSize: css.fontSize,
            overflowX: css.overflowX, overflowY: css.overflowY, transform: css.transform, zoom: css.getPropertyValue("zoom") };
        }
        return { fontSize: Number.parseFloat(style.fontSize), contentWidth: element.clientWidth - Number.parseFloat(style.paddingLeft) - Number.parseFloat(style.paddingRight),
          paragraph: box(element), cell: box(element.closest("td")), table: box(table),
          content: box(element.closest(".t-table__content")), root: box(element.closest(".body-source-table")),
          localScroll: box(element.closest(".body-table-scroll")),
          columns: Array.from(table?.querySelectorAll("col") ?? []).map(column => column.getBoundingClientRect().width) };
      });
      await writeFile(testInfo.outputPath(`header-geometry-${index}.json`), JSON.stringify(metrics, null, 2));
      expect(metrics.fontSize).toBeGreaterThanOrEqual(16);
      // A Chinese header must have room for at least one full-size character,
      // using actual semantic text, without a textarea-dependent skip.
      expect(metrics.contentWidth).toBeGreaterThanOrEqual(metrics.fontSize);
      headerMetrics.push(metrics);
    }
  }
  expect(labels).toEqual(["序号", "货物名称", "规格型号", "计量单位", "数量", "含税单价", "税率(%)", "价税合计"]);
  const data = rows.nth(1).getByRole("cell");
  await expect(data).toHaveCount(8);
  await expect(data.nth(1)).toHaveText("正文清单钢材");
  await expect(data.nth(3)).toHaveText("吨");
  await expect(data.nth(4)).toHaveText("2");
  await expect(data.nth(5)).toHaveText("3.25");
  await expect(data.nth(6)).toHaveText("0%");
  await expect(data.nth(7)).toHaveText("6.5000");
  for (const index of [4, 5, 7]) await expect(data.nth(index).getByRole("textbox")).toHaveCount(0);
  await expect(regions.nth(1).getByText("买方（章）：当前单甲方", { exact: true })).toBeVisible();
  await expect(regions.nth(1).getByText("卖方（章）：当前单乙方", { exact: true })).toBeVisible();
  // The observed mobile run reports zero COL rectangles; measure the eight actual,
  // unmerged source header cells so a zero total cannot vacuously pass.
  const widths = await header.evaluateAll(cells => cells.map(cell => cell.getBoundingClientRect().width));
  expect(widths).toHaveLength(8);
  const total = widths.reduce((sum, width) => sum + width, 0);
  expect(total).toBeGreaterThan(0);
  const sourceWidths = [510, 1276, 1106, 680, 765, 1446, 510, 2211];
  const sourceTotal = sourceWidths.reduce((sum, width) => sum + width, 0);
  for (let index = 0; index < widths.length; index++) expect(Math.abs(widths[index] - sourceWidths[index] / sourceTotal * total)).toBeLessThanOrEqual(1);
  const dimensions = await page.evaluate(() => ({ viewport: window.innerWidth, documentWidth: document.documentElement.scrollWidth }));
  expect(dimensions.documentWidth).toBeLessThanOrEqual(dimensions.viewport + 1);
  const login = await page.request.post("/api/auth/login", { data: input.staff });
  expect(login.status()).toBe(201);
  const headers = { authorization: `Bearer ${(await login.json()).tokens.accessToken}`, "x-contract-numeric-protocol": "2" };
  const originalRead = await page.request.get(`/api/contract-drafts/${draft.version.id}/document-body`, { headers });
  expect(originalRead.status()).toBe(200);
  const originalBody = await originalRead.json();
  type SourceFlow = { kind: string; paragraphId?: string; rows?: { cells: { flow: SourceFlow[] }[] }[] };
  function paragraphIds(node: SourceFlow): string[] {
    return node.kind === "paragraph" ? [node.paragraphId!] : (node.rows ?? []).flatMap(row => row.cells.flatMap(cell => cell.flow.flatMap(paragraphIds)));
  }
  const signature = originalBody.flow.filter((node: { kind: string }) => node.kind === "table")[1];
  const editableSignature = paragraphIds(signature).map(id => originalBody.blocks.find((block: { id: string }) => block.id === id))
    .filter((block: { editable: boolean }) => block.editable);
  expect(editableSignature.length).toBeGreaterThan(1);
  const lastParagraph = editableSignature.at(-1)!;
  const signatureEdited = `地址：${testInfo.project.name}端约定地点`;
  await editor.getByRole("button", { name: "编辑表格文字", exact: true }).nth(0).click();
  const dialog = page.locator(".t-dialog").filter({ has: page.getByText("编辑表格文字", { exact: true }) });
  await expect(dialog).toBeVisible();
  const tableText = dialog.getByRole("textbox").last();
  await expect(tableText).toBeEditable();
  await expect(tableText).toHaveValue("序号");
  const edited = `序号（${testInfo.project.name}补充说明）`;
  const savedResponse = page.waitForResponse(response => response.request().method() === "PUT" && response.url().endsWith(`/contract-drafts/${draft.version.id}`) &&
    response.request().postDataJSON()?.draft?.draftData?.documentBody?.edits?.some((edit: { text: string }) => edit.text === edited) &&
    response.request().postDataJSON()?.draft?.draftData?.documentBody?.edits?.some((edit: { text: string }) => edit.text === signatureEdited));
  const firstSave = page.waitForResponse(response => response.request().method() === "PUT" && response.url().endsWith(`/contract-drafts/${draft.version.id}`) &&
    response.request().postDataJSON()?.draft?.draftData?.documentBody?.edits?.some((edit: { text: string }) => edit.text === edited));
  const refreshedBody = page.waitForResponse(response => response.request().method() === "GET" && response.url().endsWith(`/contract-drafts/${draft.version.id}/document-body`));
  await tableText.fill(edited);
  expect((await firstSave).status()).toBe(200);
  expect((await refreshedBody).status()).toBe(200);
  // A same-source save acknowledgement must not close the editing view or steal focus.
  await expect(dialog).toBeVisible();
  await expect(tableText).toHaveValue(edited);
  await expect(tableText).toBeFocused();
  await dialog.getByRole("button", { name: "完成编辑", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(header.nth(0)).toHaveText(edited);
  await editor.getByRole("button", { name: "编辑表格文字", exact: true }).nth(1).click();
  await expect(dialog).toBeVisible();
  await dialog.locator(".t-select").click();
  for (const block of editableSignature) {
    const number = originalBody.blocks.findIndex((item: { id: string }) => item.id === block.id) + 1;
    await expect(page.getByText(`段落${number}：${block.text.slice(0, 48) || "空白段落"}`, { exact: true }).last()).toBeVisible();
  }
  const lastNumber = originalBody.blocks.findIndex((block: { id: string }) => block.id === lastParagraph.id) + 1;
  await page.getByText(`段落${lastNumber}：${lastParagraph.text.slice(0, 48) || "空白段落"}`, { exact: true }).last().click();
  await expect(tableText).toHaveValue(lastParagraph.text);
  await tableText.fill(signatureEdited);
  await dialog.getByRole("button", { name: "完成编辑", exact: true }).click();
  await editor.getByRole("button", { name: "保存正文", exact: true }).click();
  expect((await savedResponse).status()).toBe(200);
  const reread = await page.request.get(`/api/contract-drafts/${draft.version.id}/document-body`, { headers });
  expect(reread.status()).toBe(200);
  const savedBody = await reread.json();
  expect(savedBody.blocks.some((block: { text: string }) => block.text === edited)).toBe(true);
  expect(savedBody.blocks.some((block: { id: string; text: string }) => block.id === lastParagraph.id && block.text === signatureEdited)).toBe(true);
  await page.reload();
  await page.getByText("合同正文", { exact: true }).click();
  await expect(editor.getByRole("region", { name: "合同正文表格", exact: true }).nth(0).getByRole("row").nth(0).getByRole("cell").nth(0)).toHaveText(edited);
  await expect(editor.getByText(signatureEdited, { exact: true })).toBeVisible();
  const sources = [];
  for (const file of ["src/pages/contracts/workbench/ContractBodyEditor.vue", "src/pages/contracts/workbench/ContractBodyFlow.vue"]) {
    const response = await page.request.get(`/${file}`);
    expect(response.status()).toBe(200);
    const bytes = await response.body();
    await writeFile(testInfo.outputPath(file.split("/").at(-1)! + ".served.js"), bytes);
    sources.push({ file, diskSha256: createHash("sha256").update(await readFile(resolve(file))).digest("hex"), servedSha256: createHash("sha256").update(bytes).digest("hex") });
  }
  await writeFile(testInfo.outputPath("receipt.json"), JSON.stringify({ sourceSha256: input.sourceSha256, draft, labels, headerMetrics, sourceWidths, widths, dimensions, sources, edited, signatureEdited, editableSignatureCount: editableSignature.length, documentContentRevision: savedBody.documentContentRevision,
    scope: "actual reviewed eight-column Word, two real body tables; numeric values readonly; no claim thirteen-column/45-row/vMerge/A4 or export" }, null, 2));
  await page.screenshot({ path: testInfo.outputPath("actual-word-tables.png"), animations: "disabled", fullPage: true });
});
