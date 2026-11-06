import {expect, test} from "@playwright/test";
test("production material grid saves through the actual Nest API, reloads unknown values and submits the same draft", async ({page, request}) => {
  const session = await (await request.get("/api/__spot_fixture/session")).json();
  const headers = {authorization: `Bearer ${session.accessToken}`};
  await request.post("/api/__spot_fixture/reset", {headers});
  const created = await request.post("/api/spot-procurements", {headers, data: {projectId: "spot-project", lines: [{materialName: "铲子"}]}});
  expect(await created.json()).toEqual(expect.objectContaining({status: "draft"}));
  expect(created.status()).toBe(201);
  const result = await created.json();
  await page.addInitScript(value => localStorage.setItem("jiangkong-web-admin-auth", JSON.stringify(value)), session);
  await page.goto(`/零星采购/${result.procurementId}`);
  await page.getByText("审批与动作", {exact: true}).click();
  await page.getByRole("button", {name: "编辑采购草稿", exact: true}).click();
  const grid = page.getByTestId("spot-request-grid").locator("revo-grid");
  await expect(grid.getByRole("columnheader", {name: /材料名称/})).toBeVisible();
  await expect(page.getByRole("button", {name: "复制所选", exact: true})).toBeVisible();
  const cell = grid.getByRole("gridcell", {name: "铲子",exact: true});
  await cell.dblclick();
  const input = grid.locator("revogr-edit input");
  await input.fill("铲子（采购需求）");
  await input.press("Tab");
  await expect(grid.getByRole("gridcell", {name: "铲子（采购需求）", exact: true})).toBeVisible();
  await grid.getByRole("gridcell", {name: "选择第1行",exact:true}).locator(".t-checkbox").click();
  await page.getByRole("button",{name:"复制所选",exact:true}).click();
  await expect(grid.getByRole("checkbox",{name:"选择第2行"})).toBeVisible();
  await page.getByRole("button",{name:"删除所选",exact:true}).click();
  await page.getByRole("button",{name:"撤销删除",exact:true}).click();
  await expect(grid.getByRole("checkbox",{name:"选择第2行"})).toBeVisible();
  await page.screenshot({path:test.info().outputPath("request-grid.png"),fullPage:true});
  const saved = page.waitForResponse(response => response.request().method() === "PATCH" && response.url().includes(`/spot-procurements/${result.procurementId}`));
  await page.getByRole("button",{name:"保存草稿",exact:true}).click();
  expect((await saved).status()).toBe(200);
  await page.reload();
  await page.getByText("审批与动作", {exact: true}).click();
  await page.getByRole("button", {name: "编辑采购草稿", exact: true}).click();
  await expect(grid.getByRole("gridcell",{name:"铲子（采购需求）",exact:true})).toHaveCount(2);
  await expect(page.getByText("部分预计金额待确定",{exact:true})).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("button",{name:"取消",exact:true}).click();
  const submitted = page.waitForResponse(response=>response.request().method()==="POST"&&response.url().endsWith("/submission"));
  await page.getByRole("button",{name:"提交采购审批",exact:true}).first().click();
  expect((await submitted).status()).toBe(201);
  await expect(page.getByText("采购审批中",{exact:true}).first()).toBeVisible();
  const directorSession=await(await request.get("/api/__spot_fixture/session?actor=director")).json();
  const managerSession=await(await request.get("/api/__spot_fixture/session?actor=manager")).json();
  const directorHeaders={authorization:`Bearer ${directorSession.accessToken}`};const managerHeaders={authorization:`Bearer ${managerSession.accessToken}`};
  const [directorDetail,managerDetail]=await Promise.all([request.get(`/api/spot-procurements/${result.procurementId}`,{headers:directorHeaders}).then(reply=>reply.json()),request.get(`/api/spot-procurements/${result.procurementId}`,{headers:managerHeaders}).then(reply=>reply.json())]);
  const decisions=await Promise.all([request.post(`/api/spot-procurements/${result.procurementId}/approval`,{headers:directorHeaders,data:{...directorDetail.reviewApprovalContext,decision:"approve"}}),request.post(`/api/spot-procurements/${result.procurementId}/approval`,{headers:managerHeaders,data:{...managerDetail.reviewApprovalContext,decision:"approve"}})]);
  expect(decisions.map(reply=>reply.status())).toEqual([201,201]);
  const approved=await(await request.get(`/api/spot-procurements/${result.procurementId}`,{headers})).json();
  expect(approved.payments).toEqual([]);expect(approved.receipt.available).toBe(false);expect(approved.purchaseTask).toMatchObject({pending:true,canHandle:true,requiresReceipt:false});
  const revisionDenied = await request.post(`/api/spot-procurements/${result.procurementId}/versions`, {headers,data:{changeReason:"全批后尝试撤回待办",applicationDepartment:"项目部",applicationName:"物资员",requestedArrivalAt:"2026-11-20",reason:"新增需求",lines:[{materialName:"不得改写",unit:"个",quantity:"1"}]}});
  expect(revisionDenied.status(), await revisionDenied.text()).toBe(409);
  const unchanged = await(await request.get(`/api/spot-procurements/${result.procurementId}`,{headers})).json();
  expect(unchanged.currentVersion).toEqual(approved.currentVersion);
  expect(unchanged.purchaseTask).toEqual(approved.purchaseTask);
  expect(unchanged.availableActions.find((action:{key:string})=>action.key==="create_version")?.enabled).not.toBe(true);
  await page.reload();await expect(page.getByText("待采购",{exact:true}).first()).toBeVisible();await expect(page.getByRole("button",{name:"进入收货确认",exact:true})).toHaveCount(0);
  const returned=await(await request.post("/api/spot-procurements",{headers,data:{projectId:"spot-project",lines:[{materialName:"退回材料"}]}})).json();
  const oldCoordinates={expectedVersionId:returned.versionId,expectedDraftRevision:returned.draftRevision};
  expect((await request.post(`/api/spot-procurements/${returned.procurementId}/submission`,{headers,data:oldCoordinates})).status()).toBe(201);
  const pendingReturn=await(await request.get(`/api/spot-procurements/${returned.procurementId}`,{headers:managerHeaders})).json();
  expect((await request.post(`/api/spot-procurements/${returned.procurementId}/approval`,{headers:managerHeaders,data:{...pendingReturn.reviewApprovalContext,decision:"reject",comment:"请补充需求"}})).status()).toBe(201);
  expect((await request.patch(`/api/spot-procurements/${returned.procurementId}/draft`,{headers,data:{...oldCoordinates,lines:[{materialName:"迟到旧轮请求"}]}})).status()).toBe(409);
  expect((await request.post(`/api/spot-procurements/${returned.procurementId}/submission`,{headers,data:oldCoordinates})).status()).toBe(409);
  const editable=await(await request.get(`/api/spot-procurements/${returned.procurementId}`,{headers})).json();expect(editable.procurement.status).toBe("draft");expect(editable.lines[0]).toMatchObject({materialName:"退回材料",quantity:null});expect(editable.currentVersion.id).not.toBe(returned.versionId);

});

test("an open request grid automatically saves committed cells to the server and retains input after a stale save", async ({page, request}) => {
  const session = await (await request.get("/api/__spot_fixture/session")).json();
  const headers = {authorization: `Bearer ${session.accessToken}`};
  await request.post("/api/__spot_fixture/reset",{headers});
  const created = await request.post("/api/spot-procurements",{headers,data:{projectId:"spot-project",lines:[{materialName:"角钢"}]}});
  expect(created.status()).toBe(201);
  const result = await created.json();
  await page.addInitScript(value=>localStorage.setItem("jiangkong-web-admin-auth",JSON.stringify(value)),session);
  await page.goto(`/零星采购/${result.procurementId}`);
  await page.getByText("审批与动作",{exact:true}).click();
  await page.getByRole("button",{name:"编辑采购草稿",exact:true}).click();
  const grid=page.getByTestId("spot-request-grid").locator("revo-grid");
  await grid.getByRole("gridcell",{name:"角钢",exact:true}).dblclick();
  const input=grid.locator("revogr-edit input");
  await input.fill("角钢自动保存"); await input.press("Tab");
  await expect(page.getByText("已自动保存",{exact:true})).toBeVisible();
  const saved=await(await request.get(`/api/spot-procurements/${result.procurementId}`,{headers})).json();
  expect(saved.lines[0].materialName).toBe("角钢自动保存");
  const other=await request.patch(`/api/spot-procurements/${result.procurementId}/draft`,{headers,data:{expectedVersionId:saved.currentVersion.id,expectedDraftRevision:saved.currentVersion.draftRevision,lines:[{materialName:"另一页面内容"}]}});
  expect(other.status()).toBe(200);
  // Tab intentionally left the native editor in the next specification cell.
  await expect(input).toBeFocused();
  await expect(input).toHaveValue("");
  await input.fill("本页尚未保存"); await input.press("Tab");
  await expect(page.getByRole("status").filter({hasText:"保存结果待核对，请保留当前填写并核对服务器最新内容"})).toBeVisible();
  await expect(grid.getByRole("gridcell",{name:"本页尚未保存",exact:true})).toBeVisible();
  expect((await(await request.get(`/api/spot-procurements/${result.procurementId}`,{headers})).json()).lines[0].materialName).toBe("另一页面内容");
  await grid.getByRole("gridcell",{name:"本页尚未保存",exact:true}).dblclick();
  await expect(input).toHaveValue("本页尚未保存");
  await input.press("Escape");
  await expect(grid.getByRole("gridcell",{name:"本页尚未保存",exact:true})).toHaveText("本页尚未保存");
  await page.screenshot({path:test.info().outputPath("conflict-input-preserved.png"),fullPage:true});
  await page.getByRole("status").filter({hasText:"保存结果待核对，请保留当前填写并核对服务器最新内容"}).scrollIntoViewIfNeeded();
  await page.screenshot({path:test.info().outputPath("conflict-status.png"),fullPage:true});
});

test("a new request automatically becomes one server draft while its grid stays open",async({page,request})=>{
 const session=await(await request.get("/api/__spot_fixture/session")).json();
 await request.post("/api/__spot_fixture/reset");
 await page.addInitScript(value=>localStorage.setItem("jiangkong-web-admin-auth",JSON.stringify(value)),session);
 await page.goto("/零星采购工作台");
 await page.getByRole("button",{name:"新建采购申请",exact:true}).click();
 const grid=page.getByTestId("spot-request-grid").locator("revo-grid");
 await expect(grid).toBeVisible();
 await grid.locator('revogr-data[col-type="colPinStart"] [data-rgrow="0"][data-rgcol="1"]').dblclick();
 const input=grid.locator("revogr-edit input");await input.fill("帆布新申请");await input.press("Tab");
 await expect(page.getByText("已自动保存",{exact:true})).toBeVisible();
 await expect(grid).toBeVisible();
 const list=await(await request.get("/api/spot-procurements",{headers:{authorization:`Bearer ${session.accessToken}`}})).json();
 expect(list.items).toHaveLength(1);
 expect(list.items[0]).toMatchObject({status:"draft"});
 const secondSave=page.waitForResponse(response=>response.request().method()==="PATCH"&&response.url().includes("/spot-procurements/"));
 await grid.getByRole("gridcell",{name:"帆布新申请",exact:true}).dblclick();await input.fill("帆布继续填写");await input.press("Tab");
 expect((await secondSave).status()).toBe(200);
 await expect(page.getByText("已自动保存",{exact:true})).toBeVisible();
 await page.getByRole("button",{name:"保存草稿",exact:true}).click();
 await expect(page).toHaveURL(url => decodeURIComponent(url.pathname).startsWith("/零星采购/"));
 const listAfter=await(await request.get("/api/spot-procurements",{headers:{authorization:`Bearer ${session.accessToken}`}})).json();expect(listAfter.items).toHaveLength(1);
});

test("four-decimal quantity errors stay in the cell and expose a Chinese location",async({page,request})=>{
 const session=await(await request.get("/api/__spot_fixture/session")).json();const headers={authorization:`Bearer ${session.accessToken}`};await request.post("/api/__spot_fixture/reset");
 const result=await(await request.post("/api/spot-procurements",{headers,data:{projectId:"spot-project",lines:[{materialName:"彩钢瓦",quantity:"1"}]}})).json();
 await page.addInitScript(value=>localStorage.setItem("jiangkong-web-admin-auth",JSON.stringify(value)),session);await page.goto(`/零星采购/${result.procurementId}`);
 await page.getByText("审批与动作",{exact:true}).click();await page.getByRole("button",{name:"编辑采购草稿",exact:true}).click();
 const grid=page.getByTestId("spot-request-grid").locator("revo-grid");
 if(test.info().project.use.isMobile){const cdp=await page.context().newCDPSession(page);try{const view=page.viewportSize()!;const box=(await grid.boundingBox())!;for(let gesture=0;gesture<6;gesture++){const target=grid.getByRole("gridcell",{name:"1",exact:true});const cell=await target.count()?await target.boundingBox():null;if(cell&&cell.x>=200&&cell.x+cell.width<=view.width)break;await cdp.send("Input.synthesizeScrollGesture",{x:view.width-25,y:Math.min(view.height-100,box.y+140),xDistance:-180,yDistance:0,preventFling:true,gestureSourceType:"touch"});}}finally{await cdp.detach();}}
 await grid.getByRole("gridcell",{name:"1",exact:true}).dblclick();const input=grid.locator("revogr-edit input");await input.fill("1.23456");await input.press("Tab");
 await expect(page.getByRole("button",{name:/第1行数量/})).toBeVisible();await expect(grid.getByRole("gridcell",{name:"1.23456",exact:true})).toBeVisible();
 await page.getByRole("button",{name:/第1行数量/}).click();await expect(input).toBeFocused();await expect(input).toHaveValue("1.23456");
});

test("auto-saved confirmed content and revision reopen as one snapshot before another field changes", async ({page, request}) => {
  const session = await (await request.get("/api/__spot_fixture/session")).json();
  const headers = {authorization: `Bearer ${session.accessToken}`};
  await request.post("/api/__spot_fixture/reset", {headers});
  const created = await request.post("/api/spot-procurements", {headers, data: {projectId: "spot-project", lines: [{materialName: "材料甲"}]}});
  expect(created.status()).toBe(201);
  const result = await created.json();
  await page.addInitScript(value => localStorage.setItem("jiangkong-web-admin-auth", JSON.stringify(value)), session);
  await page.goto(`/零星采购/${result.procurementId}`);
  await page.getByText("审批与动作", {exact: true}).click();
  await page.getByRole("button", {name: "编辑采购草稿", exact: true}).click();
  const grid = page.getByTestId("spot-request-grid").locator("revo-grid");
  await grid.getByRole("gridcell", {name: "材料甲", exact: true}).dblclick();
  const input = grid.locator("revogr-edit input");
  await input.fill("材料乙"); await input.press("Tab");
  await expect(page.getByText("已自动保存", {exact: true})).toBeVisible();
  expect((await (await request.get(`/api/spot-procurements/${result.procurementId}`, {headers})).json()).lines[0].materialName).toBe("材料乙");
  await page.getByRole("button", {name: "取消", exact: true}).click();
  await page.getByRole("button", {name: "编辑采购草稿", exact: true}).click();
  await expect(grid.getByRole("gridcell", {name: "材料乙", exact: true})).toBeVisible();
  const noteSaved = page.waitForResponse(response => response.request().method() === "PATCH" && response.url().endsWith(`/spot-procurements/${result.procurementId}/draft`));
  await page.getByLabel("备注（可选）", {exact: true}).fill("只改备注");
  expect((await noteSaved).status()).toBe(200);
  await expect(page.getByText("已自动保存", {exact: true})).toBeVisible();
  const saved = await (await request.get(`/api/spot-procurements/${result.procurementId}`, {headers})).json();
  expect(saved.lines[0].materialName).toBe("材料乙");
  expect(saved.currentVersion.note).toBe("只改备注");
});

test("a confirmed save followed by a failed read is reported saved and is not sent again", async ({page, request}) => {
  const session = await (await request.get("/api/__spot_fixture/session")).json();
  const headers = {authorization: `Bearer ${session.accessToken}`}; await request.post("/api/__spot_fixture/reset");
  const result = await (await request.post("/api/spot-procurements", {headers, data: {projectId: "spot-project", lines: [{materialName: "保存前"}]}})).json();
  await page.addInitScript(value => localStorage.setItem("jiangkong-web-admin-auth", JSON.stringify(value)), session);
  await page.goto(`/零星采购/${result.procurementId}`); await page.getByText("审批与动作", {exact: true}).click();
  await page.getByRole("button", {name: "编辑采购草稿", exact: true}).click();
  expect((await request.post("/api/__spot_fixture/fail-confirmation-read")).status()).toBe(200);
  const writes: number[] = [];
  page.on("response", response => {if (response.request().method() === "PATCH" && response.url().endsWith(`/spot-procurements/${result.procurementId}/draft`)) writes.push(response.status());});
  const grid = page.getByTestId("spot-request-grid").locator("revo-grid");
  await grid.getByRole("gridcell", {name: "保存前", exact: true}).dblclick();
  await grid.locator("revogr-edit input").fill("已确认保存"); await grid.locator("revogr-edit input").press("Tab");
  await expect(page.getByText("草稿已保存，最新内容暂未核对", {exact: true})).toBeVisible();
  expect((await (await request.get(`/api/spot-procurements/${result.procurementId}`, {headers})).json()).lines[0].materialName).toBe("已确认保存");
  await expect(page.getByRole("button", {name: "保存草稿", exact: true})).toBeDisabled();
  expect(writes).toEqual([200]);
});

for (const mode of ["existing", "new"] as const) test(`raw native Chinese buffer protects reload in ${mode} request`, async ({page, request}) => {
  const session = await (await request.get("/api/__spot_fixture/session")).json();
  const headers = {authorization: `Bearer ${session.accessToken}`}; await request.post("/api/__spot_fixture/reset");
  await page.addInitScript(value => localStorage.setItem("jiangkong-web-admin-auth", JSON.stringify(value)), session);
  if (mode === "existing") {
    const result = await (await request.post("/api/spot-procurements", {headers, data: {projectId: "spot-project", lines: [{materialName: "已存材料"}]}})).json();
    await page.goto(`/零星采购/${result.procurementId}`);
  } else await page.goto("/零星采购工作台");
  const open = async () => {
    if (mode === "existing") {
      await page.getByText("审批与动作", {exact: true}).click();
      await page.getByRole("button", {name: "编辑采购草稿", exact: true}).click();
    } else await page.getByRole("button", {name: "新建采购申请", exact: true}).click();
  };
  await open();
  const grid = page.getByTestId("spot-request-grid").locator("revo-grid");
  const focus = async () => {
    await expect(grid).toBeVisible();
    await grid.locator('revogr-data[col-type="colPinStart"] [data-rgrow="0"][data-rgcol="1"]').dblclick();
  };
  await focus();
  const dialogs: string[] = [];
  const dismissals: Promise<void>[] = [];
  page.on("dialog", dialog => {dialogs.push(dialog.type()); dismissals.push(dialog.dismiss());});
  await page.reload({waitUntil: "commit"});
  expect(dialogs).toEqual([]); // Blank focus alone is not an unsaved change.
  await open(); await focus();
  const input = grid.locator("revogr-edit input"); await input.fill("中文尚未确认");
  await expect(input).toHaveValue("中文尚未确认");
  const originalDocument = await page.evaluateHandle(() => document);
  const originalUrl = page.url();
  // A cancelled real reload never commits a new document. Invoke the public
  // browser reload, then observe its native dialog and the retained old input.
  await page.evaluate(() => window.location.reload());
  await expect.poll(() => dialogs).toEqual(["beforeunload"]);
  await Promise.all(dismissals);
  expect(await originalDocument.evaluate(previous => previous === document)).toBe(true);
  expect(page.url()).toBe(originalUrl);
  await originalDocument.dispose();
  await expect(input).toHaveValue("中文尚未确认");
  await page.getByRole("button", {name: "取消", exact: true}).click();
  await expect(page.getByText("当前填写尚未保存", {exact: true})).toBeVisible();
  await page.getByRole("button", {name: "保留当前填写", exact: true}).click();
  await expect(grid).toBeVisible();
  await expect.poll(async () => await input.isVisible() ? await input.inputValue() :
    await grid.getByRole("gridcell", {name: "中文尚未确认", exact: true}).count() ? "中文尚未确认" : "").toBe("中文尚未确认");
});

test("selected estimated amounts distinguish partial unknown and a genuinely known zero", async ({page, request}) => {
  const session = await (await request.get("/api/__spot_fixture/session")).json(); const headers = {authorization: `Bearer ${session.accessToken}`};
  await request.post("/api/__spot_fixture/reset");
  const result = await (await request.post("/api/spot-procurements", {headers, data: {projectId: "spot-project", lines: [
    {materialName: "已知预计", estimatedAmount: "1.5340"}, {materialName: "未知预计"}, {materialName: "已知零额", estimatedAmount: "0.0000"}
  ]}})).json();
  await page.addInitScript(value => localStorage.setItem("jiangkong-web-admin-auth", JSON.stringify(value)), session);
  await page.goto(`/零星采购/${result.procurementId}`); await page.getByText("审批与动作", {exact: true}).click();
  await page.getByRole("button", {name: "编辑采购草稿", exact: true}).click();
  const grid = page.getByTestId("spot-request-grid");
  await grid.getByRole("columnheader", {name: "全选清单行", exact: true}).locator(".t-checkbox").click();
  await expect(grid.getByText("已选择 3 行", {exact: true})).toBeVisible();
  await expect(grid.getByText("所选已知预计合计：1.5340 元（部分预计金额待确定）", {exact: true})).toBeVisible();
  await grid.getByRole("gridcell", {name: "选择第2行", exact: true}).locator(".t-checkbox").click();
  await expect(grid.getByText("所选预计合计：1.5340 元", {exact: true})).toBeVisible();
  await grid.getByRole("gridcell", {name: "选择第1行", exact: true}).locator(".t-checkbox").click();
  await expect(grid.getByText("所选预计合计：0.0000 元", {exact: true})).toBeVisible();
  await grid.getByRole("gridcell", {name: "选择第3行", exact: true}).locator(".t-checkbox").click();
  await grid.getByRole("gridcell", {name: "选择第2行", exact: true}).locator(".t-checkbox").click();
  await expect(grid.getByText("所选预计金额待确定", {exact: true})).toBeVisible();
  await page.screenshot({path: test.info().outputPath("selected-unknown-is-not-zero.png"), fullPage: true});
});


test("an uncommitted editor buffer blocks the actual browser back route", async ({page, request}) => {
  const session = await (await request.get("/api/__spot_fixture/session")).json(); const headers = {authorization: `Bearer ${session.accessToken}`};
  await request.post("/api/__spot_fixture/reset");
  const result = await (await request.post("/api/spot-procurements", {headers, data: {projectId: "spot-project", lines: [{materialName: "原材料"}]}})).json();
  await page.addInitScript(value => localStorage.setItem("jiangkong-web-admin-auth", JSON.stringify(value)), session);
  await page.goto("/零星采购工作台");
  await page.getByText("查看详情", {exact: true}).filter({visible: true}).or(page.getByRole("button", {name: "继续填写", exact: true})).first().click();
  await expect(page).toHaveURL(url => decodeURIComponent(url.pathname) === `/零星采购/${result.procurementId}`);
  await page.getByText("审批与动作", {exact: true}).click(); await page.getByRole("button", {name: "编辑采购草稿", exact: true}).click();
  const grid = page.getByTestId("spot-request-grid").locator("revo-grid");
  await grid.getByRole("gridcell", {name: "原材料", exact: true}).dblclick();
  const input = grid.locator("revogr-edit input"); await input.fill("返回前未确认");
  await page.goBack({waitUntil: "commit"});
  await expect(page).toHaveURL(url => decodeURIComponent(url.pathname) === `/零星采购/${result.procurementId}`);
  await expect(page.getByText("当前填写尚未保存，请先确认单元格并保存，或关闭填写窗口后再离开", {exact: true})).toBeVisible();
  await expect(input).toHaveValue("返回前未确认");
});
