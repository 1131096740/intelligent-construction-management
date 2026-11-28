import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

test("合同主管通过真实HTTP上传Word并明确选择自动填写位置", async ({ page }) => {
  const account = JSON.parse(process.env.TEMPLATE_BROWSER_ACCOUNT ?? "{}");
  expect(account.phone).toBeTruthy();
  await page.goto("/login?redirect=" + encodeURIComponent("/合同模板库"));
  await page.getByPlaceholder("请输入手机号").fill(account.phone);
  await page.getByPlaceholder("请输入密码").fill(account.password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("heading", { name: "合同模板库", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "维护合同模板", exact: true }).click();
  await expect(page.getByRole("button", { name: "上传Word模板", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "上传Word模板", exact: true }).click();
  await page.getByPlaceholder("请输入版式名称").fill("浏览器显式映射模板");
  await page.locator(".t-form__item").filter({ hasText: "合同类型" }).locator("input").click();
  await page.getByText("材料采购合同", { exact: true }).click();
  await page.locator('input[type="file"]').setInputFiles(process.env.TEMPLATE_BROWSER_SOURCE!);
  await page.getByRole("button", { name: "创建版式草稿", exact: true }).click();
  await expect(page.getByText("合同名称：合成工程合同", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "废弃草稿版本", exact: true })).toHaveCount(0);
  const repeated = process.env.TEMPLATE_BROWSER_REPEATED_SOURCE === "1";
  const choices = [
    ["合同名称", "合同名称：合成工程合同", "合成工程合同", "浏览器预览合同"],
    ["甲方名称", repeated ? "甲方：________ 乙方：________" : "甲方：合成甲方公司", repeated ? "________" : "合成甲方公司", "浏览器甲方"],
    ["乙方名称", repeated ? "甲方：________ 乙方：________" : "乙方：合成乙方公司", repeated ? "________" : "合成乙方公司", "浏览器乙方"],
    ["草稿编号", "编号：{草稿编号}", "{草稿编号}", "BROWSER-11"],
    ["文档水印", "{文档水印}", "{文档水印}", "浏览器预览"]
  ];
  for (const [index, choice] of choices.entries()) {
    const [field, paragraph, selected, value] = choice;
    const row = page.getByRole("region", { name: `${field}填写位置`, exact: true });
    await row.locator("input").first().click();
    await page.locator(".t-select-option:visible").filter({ hasText: paragraph }).click();
    await expect(row.locator("input").first()).toHaveValue(`正文第${repeated && index === 2 ? 2 : index + 1}段：${paragraph}`);
    await expect(page.locator(".t-select-option:visible")).toHaveCount(0);
    await row.getByPlaceholder("输入需自动填写的原文", { exact: true }).fill(selected);
    if (repeated && ["甲方名称", "乙方名称"].includes(field)) {
      const occurrence = row.getByPlaceholder("选择出现位置", { exact: true });
      await expect(occurrence).toBeVisible({ timeout: 5000 });
      await expect(occurrence).toHaveValue("");
      await occurrence.click();
      await page.locator(".t-select-option:visible").filter({ hasText: new RegExp(`^第${field === "甲方名称" ? 1 : 2}处：`) }).click();
      if (field === "乙方名称") {
        await row.getByPlaceholder("输入需自动填写的原文", { exact: true }).fill("_______");
        await expect(occurrence).toHaveValue("");
        await row.getByPlaceholder("输入需自动填写的原文", { exact: true }).fill(selected);
        await expect(occurrence).toHaveValue("");
        await occurrence.click();
        await page.locator(".t-select-option:visible").filter({ hasText: /^第2处：/ }).click();
      }
    }
    await row.getByPlaceholder("填写预览样例值", { exact: true }).fill(value);
  }
  for (const [field, paragraph, value, index] of [["甲方名称", "甲方签章：合成甲方公司", "合成甲方公司", 8], ["乙方名称", "乙方签章：合成乙方公司", "合成乙方公司", 9]] as const) {
    await page.getByPlaceholder("选择其他字段或增加重复位置", { exact: true }).click();
    await page.locator(".t-select-option:visible").filter({ hasText: field }).click();
    await expect(page.locator(".t-select-option:visible")).toHaveCount(0);
    await page.getByRole("button", { name: "增加填写位置", exact: true }).click();
    const row = page.getByRole("region", { name: `${field}填写位置`, exact: true }).last();
    await row.locator("input").first().click();
    await page.locator(".t-select-option:visible").filter({ hasText: paragraph }).click();
    await expect(row.locator("input").first()).toHaveValue(`正文第${index}段：${paragraph}`);
    await expect(page.locator(".t-select-option:visible")).toHaveCount(0);
    await row.getByPlaceholder("输入需自动填写的原文", { exact: true }).fill(value);
    await expect(row.getByPlaceholder("填写预览样例值", { exact: true })).toHaveValue(field === "甲方名称" ? "浏览器甲方" : "浏览器乙方");
  }
  const saved = page.waitForResponse(response => response.url().includes("/source-mapping") && response.request().method() === "PATCH");
  await page.getByRole("button", { name: "保存填写位置", exact: true }).click();
  const mappingSave = await saved;
  expect(mappingSave.status()).toBe(200);
  if (repeated) {
    const owner = page.getByRole("region", { name: "甲方名称填写位置", exact: true });
    const other = page.getByRole("region", { name: "乙方名称填写位置", exact: true });
    await expect(owner.getByPlaceholder("选择出现位置", { exact: true })).toHaveValue(/^第1处：/);
    await expect(other.getByPlaceholder("选择出现位置", { exact: true })).toHaveValue(/^第2处：/);
  }
  await expect(page.getByText("R2", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "执行文档检查", exact: true }).click();
  await expect(page.getByText("检查对应 R2", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "生成当前修订样张", exact: true }).click();
  await expect(page.getByText("最新预览：生成成功", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "确认当前原文、位置和真实预览", exact: true }).click();
  await expect(page.getByText("当前修订填写位置已由主管确认", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "提交审核", exact: true }).click();
  await page.getByPlaceholder("请填写本次版式发布内容").fill("浏览器明确映射并确认真实样张");
  await page.getByRole("button", { name: "发布版式", exact: true }).click();
  await expect(page.getByText("版式已发布", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "提交审核", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "发布版式", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "保存填写位置", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "确认当前原文、位置和真实预览", exact: true })).toBeDisabled();
  const cloning = page.waitForResponse(response => response.url().endsWith("/clone") && response.request().method() === "POST");
  await page.getByRole("button", { name: "复制为新草稿", exact: true }).click();
  const clone = await (await cloning).json() as { id: string };
  await expect(page.getByText("R1", { exact: true })).toBeVisible();
  await page.locator('input[type="file"]').setInputFiles(process.env.TEMPLATE_BROWSER_SOURCE!);
  const login = await page.request.post("/api/auth/login", { data: { phone: account.phone, password: account.password } });
  expect(login.status()).toBe(201);
  const auth = await login.json() as { tokens: { accessToken: string } };
  const headers = { authorization: `Bearer ${auth.tokens.accessToken}` };
  const concurrentUpload = await page.request.post("/api/files", { headers, multipart: { file: { name: "另一主管新原文.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", buffer: readFileSync(process.env.TEMPLATE_BROWSER_SOURCE!) } } });
  expect(concurrentUpload.status()).toBe(201);
  const replacement = await concurrentUpload.json() as { id: string };
  const concurrentSave = await page.request.patch(`/api/contract-layout-template-versions/${clone.id}`, { headers, data: { expectedRevision: 1, docxFileId: replacement.id } });
  expect(concurrentSave.status()).toBe(200);
  const staleWrites: string[] = [];
  page.on("request", request => {
    if (["POST", "PATCH"].includes(request.method()) && (request.url().endsWith("/api/files") || request.url().includes(`/contract-layout-template-versions/${clone.id}`))) staleWrites.push(request.url());
  });
  await page.getByRole("button", { name: "保存新修订", exact: true }).click();
  await expect(page.getByText("版式修订已变化，请刷新后重试", { exact: true })).toBeVisible();
  await expect(page.locator(".t-upload")).toContainText("source.docx");
  expect(staleWrites).toEqual([]);
  const retained = await page.request.get(`/api/contract-layout-template-versions/${clone.id}/source-positions`, { headers });
  expect(await retained.json()).toMatchObject({ sourceFileId: replacement.id, draftRevision: 2 });


});
