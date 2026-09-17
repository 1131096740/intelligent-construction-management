import { expect, test, type Page } from "@playwright/test";

type Session = { user: unknown; tokens: { accessToken: string; refreshToken: string } };

async function useSession(page: Page, session: Session) {
  await page.evaluate((value) => localStorage.setItem("jiangkong-web-admin-auth", JSON.stringify(value)), {
    user: session.user, accessToken: session.tokens.accessToken, refreshToken: session.tokens.refreshToken
  });
  await page.reload();
}

test("零采申请退回修订后完成两级审批，桌面与390窄屏回读冻结版本", async ({ page, request }, testInfo) => {
  const applicant = JSON.parse(process.env.POL115_BROWSER_SESSION!) as Session;
  const director = JSON.parse(process.env.POL115_SPOT_DIRECTOR_SESSION!) as Session;
  const manager = JSON.parse(process.env.POL115_SPOT_MANAGER_SESSION!) as Session;
  const projectId = (JSON.parse(process.env.POL115_SPOT_PROJECT_IDS!) as Record<string, string>)[testInfo.project.name]!;
  const headers = { authorization: `Bearer ${applicant.tokens.accessToken}` };
  const label = testInfo.project.name;
  const upload = await request.post(`${process.env.POL115_API_URL}/spot-procurements/projects/${projectId}/draft-file-uploads`, {
    headers, multipart: { file: { name: `浏览器报价-${label}.png`, mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=", "base64") } }
  });
  expect(upload.status(), await upload.text()).toBe(201);
  const fileId = ((await upload.json()) as { id: string }).id;
  const created = await request.post(`${process.env.POL115_API_URL}/spot-procurements`, { headers, data: {
    projectId, applicationDepartment: "浏览器工程部", applicationName: "浏览器申请人", requestedArrivalAt: "2026-10-03",
    reason: `浏览器旧版原因-${label}`, lines: [{ materialName: "砂子", specification: "中砂", unit: "吨", quantity: "2", note: "现场使用" }],
    attachments: [{ fileId, category: "merchant_quote" }]
  } });
  expect(created.status(), await created.text()).toBe(201);
  const id = ((await created.json()) as { procurementId: string }).procurementId;
  expect(id).toEqual(expect.any(String));

  await page.goto("/login");
  await useSession(page, applicant);
  await page.goto(`/零星采购/${id}`);
  const panelByHeading = (name: string) => page.locator("section.detail-panel").filter({
    has: page.getByRole("heading", { name, exact: true })
  });
  const processPanel = page.locator("section.detail-panel").filter({
    has: page.getByRole("heading", { name: "审批与动作", exact: true })
  });
  await page.locator(".t-tabs").getByText("材料与附件", { exact: true }).click();
  await expect(panelByHeading("材料明细").getByText(`浏览器报价-${label}.png`, { exact: true })).toBeVisible();
  await page.locator(".t-tabs").getByText("审批与动作", { exact: true }).click();
  const initialSubmission = page.waitForResponse((response) => response.url().endsWith(`/spot-procurements/${id}/submission`) && response.request().method() === "POST");
  await processPanel.getByRole("button", { name: "提交采购审批", exact: true }).click();
  expect((await initialSubmission).status()).toBe(201);
  await expect(page.getByText("零星材料采购申请已提交审批。", { exact: true })).toBeVisible();

  await useSession(page, director);
  await page.locator(".t-tabs").getByText("审批与动作", { exact: true }).click();
  await processPanel.getByRole("button", { name: "退回申请人", exact: true }).click();
  const returnDialog = page.locator(".t-dialog").filter({ hasText: "退回采购申请人" });
  await returnDialog.locator("textarea").fill("请补充具体施工区域");
  const returned = page.waitForResponse((response) => response.url().endsWith(`/spot-procurements/${id}/approval`) && response.request().method() === "POST");
  await returnDialog.getByRole("button", { name: "确认退回", exact: true }).click();
  expect((await returned).status()).toBe(201);
  await expect(page.getByText("采购申请已退回，并已生成新的修改草稿。", { exact: true })).toBeVisible();
  await expect(returnDialog).toBeHidden();

  await useSession(page, applicant);
  await page.locator(".t-tabs").getByText("审批与动作", { exact: true }).click();
  await processPanel.getByRole("button", { name: "编辑采购草稿", exact: true }).click();
  const editDialog = page.locator(".t-dialog").filter({ hasText: "编辑零星材料采购草稿" });
  await editDialog.locator("label").filter({ hasText: "物资用途及采购原因" }).locator("textarea").fill(`浏览器新版原因-${label}`);
  const saved = page.waitForResponse((response) => response.url().endsWith(`/spot-procurements/${id}/draft`) && response.request().method() === "PATCH");
  await editDialog.getByRole("button", { name: "保存草稿", exact: true }).click();
  expect((await saved).status()).toBe(200);
  await expect(editDialog).toBeHidden();
  await page.locator(".t-tabs").getByText("采购申请", { exact: true }).click();
  const overviewPanel = panelByHeading("零星/小额材料采购申请表");
  await expect(overviewPanel.locator(".detail-grid").getByText(`浏览器新版原因-${label}`, { exact: true })).toBeVisible();
  const versionList = overviewPanel.locator(".version-list");
  const versionTwo = versionList.getByRole("row").filter({ hasText: "V2" });
  const versionOne = versionList.getByRole("row").filter({ hasText: "V1" });
  await expect(versionTwo.getByText(`浏览器新版原因-${label}`, { exact: true })).toBeVisible();
  await expect(versionOne.getByText(`浏览器旧版原因-${label}`, { exact: true })).toBeVisible();
  await page.locator(".t-tabs").getByText("审批与动作", { exact: true }).click();
  const resubmission = page.waitForResponse((response) => response.url().endsWith(`/spot-procurements/${id}/submission`) && response.request().method() === "POST");
  await processPanel.getByRole("button", { name: "提交采购审批", exact: true }).click();
  expect((await resubmission).status()).toBe(201);
  await expect(page.getByText("零星材料采购申请已提交审批。", { exact: true })).toBeVisible();

  for (const [session, node] of [[director, "物资主管审批"], [manager, "项目经理审批"]] as const) {
    await useSession(page, session);
    await page.locator(".t-tabs").getByText("审批与动作", { exact: true }).click();
    await expect(page.locator(".business-detail-header__facts").getByText(node, { exact: true })).toBeVisible();
    await processPanel.getByRole("button", { name: "审批通过", exact: true }).click();
    const dialog = page.locator(".t-dialog").filter({ hasText: "确认通过采购审批" });
    const approved = page.waitForResponse((response) => response.url().endsWith(`/spot-procurements/${id}/approval`) && response.request().method() === "POST");
    await dialog.getByRole("button", { name: "确认通过", exact: true }).click();
    expect((await approved).status()).toBe(201);
    await expect(page.getByText("采购审批已通过。", { exact: true })).toBeVisible();
    await expect(dialog).toBeHidden();
  }

  await expect(page.locator(".business-detail-header").getByText("采购已批，办理中", { exact: true })).toBeVisible();
  await page.locator(".t-tabs").getByText("采购申请", { exact: true }).click();
  await expect(overviewPanel.locator(".detail-grid").getByText(`浏览器新版原因-${label}`, { exact: true })).toBeVisible();
  await expect(page.locator("body")).not.toContainText(id);
  expect(await page.locator(".spot-procurement-detail").evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
});
