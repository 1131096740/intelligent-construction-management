import {expect, test} from "@playwright/test";
test("approved production material request enters the real personal pending queue and opens its original detail", async ({page, request}) => {
  const session = await (await request.get("/api/__spot_fixture/session")).json();
  const headers = {authorization: `Bearer ${session.accessToken}`};
  await request.post("/api/__spot_fixture/reset", {headers});
  const created = await (await request.post("/api/spot-procurements", {headers, data:{projectId:"spot-project",reason:"我的材料采购",lines:[{materialName:"待采钢筋"}]}})).json();
  expect((await request.post(`/api/spot-procurements/${created.procurementId}/submission`, {headers,data:{expectedVersionId:created.versionId,expectedDraftRevision:created.draftRevision}})).status()).toBe(201);
  for (const actor of ["director", "manager"]) {
    const reviewer = await (await request.get(`/api/__spot_fixture/session?actor=${actor}`)).json();
    const reviewHeaders = {authorization:`Bearer ${reviewer.accessToken}`};
    const detail = await (await request.get(`/api/spot-procurements/${created.procurementId}`, {headers:reviewHeaders})).json();
    expect((await request.post(`/api/spot-procurements/${created.procurementId}/approval`,{headers:reviewHeaders,data:{...detail.reviewApprovalContext,decision:"approve"}})).status()).toBe(201);
  }
  const work = await request.get("/api/me/work-items", {headers});
  expect(work.status(),await work.text()).toBe(200);
  expect((await work.json()).queueMeta.pending.total).toBe(1);
  await page.addInitScript(value=>localStorage.setItem("jiangkong-web-admin-auth",JSON.stringify(value)),session);
  await page.goto("/");
  await expect(page.locator(".work-items-tabs").getByText("待我处理",{exact:true})).toBeVisible();
  await expect(page.getByText("生产材料采购：我的材料采购",{exact:true}).filter({visible:true})).toBeVisible();
  await expect(page.getByText("预计金额待确定",{exact:true}).filter({visible:true})).toBeVisible();
  await page.screenshot({path:test.info().outputPath("personal-purchase-queue.png"),fullPage:true});
  await page.getByText("按实际需要采购",{exact:true}).filter({visible:true}).click();
  await expect(page).toHaveURL(new RegExp(`/${encodeURIComponent("零星采购")}/${created.procurementId}$`));
  await expect(page.getByText("待采购",{exact:true}).first()).toBeVisible();
});
