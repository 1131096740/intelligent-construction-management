import { expect, test, type Page } from "@playwright/test";
const classes = [["inside", "表内（我方签约）", "500000000"], ["outside", "表外（施工企业签约）", "200000000"], ["upward", "对上（施工企业—我方）", "800000000"]];
async function login(page:Page,writes:Array<{path:string;body:Record<string,unknown>}>=[]) {
  await page.route("**/api/**", (route) => {
    const url = new URL(route.request().url());
    const path = decodeURIComponent(url.pathname);
    if (!path.startsWith("/api/")) return route.continue();
    if(path==='/api/files'&&route.request().method()==='POST')return route.fulfill({status:201,contentType:'application/json',body:JSON.stringify({id:"uploaded-bank-proof"})});
    let data: unknown = [];
    if(route.request().method()==="POST"&&!path.endsWith("/auth/login")){writes.push({path,body:route.request().postDataJSON()});return route.fulfill({status:201,contentType:"application/json",body:JSON.stringify({id:"saved",status:"pending_confirm"})});}
    if(path.endsWith("/contract-bank-verifications"))data={companies:[{value:"company",label:"我方建设公司"}],rows:[]};
    else if(path.endsWith("/contract-proxy-executions/bank-options"))data=[{value:"verified-bank",label:"我方建设公司 · 入款 300.00 元 · 2026年8月22日"}];
    else if(path.endsWith("/contract-economic-reviews"))data={canPrepare:true,documents:[{ref:"contract:c1",reference:"表内材料合同",title:"道路第一批",counterparty:"供应商甲",amountCents:"100000"},{ref:"affiliate:c2",reference:"表外材料合同",title:"道路第一批",counterparty:"供应商甲",amountCents:"100000"}],reviews:[],pendingSettlements:[],candidates:[{leftSourceRef:"contract:c1",rightSourceRef:"affiliate:c2",reason:"同一批次"}]};
    else if(path.endsWith("/contract-proxy-executions"))data={observations:[{value:"bank",label:"甲公司 出账 100.00 元"}],requests:[],sources:[{value:"settlement:s",label:"表内结算第一期"}],payers:[{value:"participating_company:b",label:"乙公司"}],entries:[]};
    else if(path.endsWith("/upward-contract-amount-revisions"))data={canPrepare:true,contracts:[{id:"up",label:"对上合同一",amountNature:"uncapped",amountCents:null}],revisions:[]};
    else if(path.endsWith("/upward-receipt-matches"))data={receipts:[{id:"receipt",label:"真实到账",occurredAt:"2026-08-05",amountCents:"30000",matchedCents:"10000"}],settlements:[{id:"upsettled",label:"对上第一期"}],matches:[]};
    else if((path.includes("/operating-projections/project/")||path.includes("/operating-projections/company/")||path.endsWith("/operating-projections/as-of")))data={asOf:{businessDate:"2026-10-19"},integrity:{statusLabel:"合成完整",moneyComplete:true,notices:[]},relationshipTotals:[{relationship:"inside",label:"表内（我方签约）",confirmedCostCents:"40000",receivableCents:"0",payableCents:"20000",interSubjectReceivableCents:"0",interSubjectPayableCents:"10000"},{relationship:"upward",label:"对上（施工企业—我方）",confirmedCostCents:"0",receivableCents:"30000",payableCents:"0",interSubjectReceivableCents:"0",interSubjectPayableCents:"0"}],operating:{receivableCents:"0",internalReceivableCents:"30000",payableCents:"20000"},actualFunds:{companyProjectFundsCents:"20000",companyAdvanceForProjectCents:"0"}};
    else if(path.endsWith("/contract-relationship-ledger/preflight"))data={readOnly:true,checkedFacts:10,unprojectedFormalSources:2,unclassifiedExternalDocuments:1,pendingEconomicReviews:1,differences:[],notice:"只读预检，不改历史数据"};
    else if(path.endsWith("/contract-relationship-ledger/export"))return route.fulfill({status:200,contentType:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",headers:{"content-disposition":"attachment; filename=ledger.xlsx"},body:"synthetic-export"});
    else
    if (path.endsWith("/auth/login")) data = { user: { id: "local-classification-test", name: "分类测试", phone: "13900000000", mustChangePassword: false, globalRoleKeys: ["finance_director", "contract_director"], roleKeys: ["finance_director", "contract_director", "project_manager"] }, tokens: { accessToken: "local-synthetic-token", refreshToken: "local-synthetic-refresh", expiresIn: 900 } };
    else if (path.endsWith("/projects")) data = [{ id: "p", name: "合成验收项目", code: "TEST" }];
    else if (path.endsWith("/contract-relationship-ledger")) {
      const selected = classes.filter(([type]) => !url.searchParams.get("relationship") || type === url.searchParams.get("relationship"));
      data = { readAt: "2026-10-19T00:00:00Z", companies: [{ id: "company", name: "我方建设公司" }], notice: "合成数据：三类金额分别列示。", rows: selected.map(([relationship, relationshipLabel, amountCents], id) => ({ id: String(id), projectId: "p", projectName: "合成验收项目", section: url.searchParams.get("section"), relationship, relationshipLabel, reference: `合同-${id + 1}`, name: "验收合同", signingParty: relationship === "inside" ? "我方建设公司" : "施工企业", counterparty: relationship === "upward" ? "我方建设公司" : "供应商甲", companyEntityId: relationship === "outside" ? null : "company", actualPayer: null, amountCents, amountLabel: "合同承诺", statusLabel: "已确认", accountingEffect: relationship === "upward" ? "主体往来，不计项目成本" : "确认结算后计成本", detailPath: "/合同工作台" })), totals: selected.map(([relationship, label, knownAmountCents]) => ({ relationship, label, knownAmountCents, count: 1, unknownAmountCount: 0 })) };
    } else if (path.includes("work-items")) data = { generatedAt: new Date().toISOString(), visibleProjectCount: 1, queues: { pending: [], blocked: [], started: [] }, approvalCenter: { pendingApproval: [], startedByMe: [], handledByMe: [], delegatedToMe: [], overdueReminder: [] } };
    else if (path.includes("ledger")) data = { rows: [], page: 1, pageSize: 20, total: 0, totalPages: 0, summary: {} };
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(data) });
  });
  await page.goto("/login");
  await page.getByPlaceholder("请输入手机号").fill("13900000000");
  await page.getByPlaceholder("请输入密码").fill("Local-test-only");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("heading", { name: "工作台", exact: true })).toBeVisible();
}
test("三类合同在原台账、财务和项目页使用相同分类；手机保留双方主体", async ({ page }, info) => {
  await login(page);
  for (const path of ["/合同工作台", "/结算工作台", "/付款管理", "/统一资金办理工作台", "/资金执行案件", "/项目经营", "/清分工作台", "/历史经营接管"]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    const ledger = page.getByRole("region", { name: "签约关系分类台账" });
    await expect(ledger.getByRole("heading", { name: "签约关系分类台账" }), `分类组件缺失：${path}`).toBeVisible();
    for (const [, label] of classes) await expect(ledger.getByText(label, { exact: true }).first()).toBeVisible();
    if (info.project.name === "mobile") {
      const box=await ledger.boundingBox(); expect(box!.x+box!.width,`分类台账超出手机视口：${path}`).toBeLessThanOrEqual(page.viewportSize()!.width);
      await expect(ledger.locator(".relationship-ledger__mobile").getByText("签约/原债务主体：我方建设公司", { exact: false })).toBeVisible();
    }
  }
  const ledger = page.getByRole("region", { name: "签约关系分类台账" });
  await expect(ledger.getByRole("button", { name: "导出当前分类范围" })).toBeEnabled();
  if (info.project.name === "mobile") {
    const firstCard = ledger.locator(".relationship-ledger__mobile article").first();
    await firstCard.scrollIntoViewIfNeeded();
    await expect(firstCard.getByText("签约/原债务主体：我方建设公司", { exact: false })).toBeInViewport();
  }
  await page.screenshot({ path: `/private/tmp/contract-classification-${info.project.name}.png` });
});

test("项目办理入口、经济复核提交、财务余额、待匹配到账及导出贯通",async({page})=>{
 const writes:Array<{path:string;body:Record<string,unknown>}>=[];await login(page,writes);
 await page.goto("/合同工作台?projectId=p");
 await expect(page.getByRole("heading",{name:"经济重复与履约复核"})).toBeVisible();
 await expect(page.getByRole("heading",{name:"项目应收应付与内部往来"})).toBeVisible();
 await page.getByRole("button",{name:"核对两份文书",exact:true}).click();
 const drawer=page.locator(".t-drawer").filter({hasText:"履约范围与统计归属复核"});
 await drawer.locator("textarea").fill("核对供货范围，两笔独立事项");
 await drawer.locator('input[type="password"]').fill("synthetic-password");
 await drawer.getByRole("button",{name:"提交专业复核",exact:true}).click();
 await expect.poll(()=>writes.filter(w=>w.path.endsWith("/contract-economic-reviews")).length).toBe(1);
 expect(writes[0].body).toMatchObject({projectId:"p",leftSourceRef:"contract:c1",rightSourceRef:"affiliate:c2",relation:"independent",coverage:[]});
 await page.getByRole("button",{name:"历史口径只读预检",exact:true}).click();
 await expect(page.getByText("尚未形成经营事实的正式来源 2 条",{exact:false})).toBeVisible();
 await page.getByRole("button",{name:"登记真实代付",exact:true}).click();
 await expect(page.getByText("我方账户已核验银行流水（涉及公司账户必选）",{exact:true})).toBeVisible();
 await page.keyboard.press("Escape");
 await page.goto("/付款管理?projectId=p&ledgerSection=receipts");
 await expect(page.getByRole("heading",{name:"对上到账匹配与核销",exact:true})).toBeVisible();
 await expect(page.getByText("待匹配 200.00 元",{exact:false})).toBeVisible();
 await page.getByRole("button",{name:"匹配对上应收",exact:true}).click();
 await expect(page.getByRole("button",{name:"提交财务复核",exact:true})).toBeVisible();
 const download=page.waitForEvent("download");
 await page.getByRole("button",{name:"导出当前分类范围",exact:true}).click();
 expect((await download).suggestedFilename()).toContain(".xlsx");
});


test("银行流水从无候选可进入独立核验，不依靠测试后台预造流水",async({page})=>{
 const writes:Array<{path:string;body:Record<string,unknown>}>=[];await login(page,writes);
 await page.goto("/资金执行案件?projectId=p");
 await page.getByRole("button",{name:"提交银行流水核验",exact:true}).click();
 const drawer=page.locator(".t-drawer").filter({hasText:"银行账户与交易核验"});
 await drawer.locator(".t-form__item").filter({hasText:"真实开户公司"}).locator("input").click();
 await page.locator(".t-select-option").filter({hasText:"我方建设公司"}).last().click();
 await drawer.locator(".t-form__item").filter({hasText:"完整银行账号"}).locator("input").fill("6222000012345678");
 await drawer.locator(".t-form__item").filter({hasText:"银行交易流水号"}).locator("input").fill("TEST-BANK-001");
 await drawer.locator(".t-form__item").filter({hasText:"实际金额"}).locator("input").fill("100.00");
 await drawer.locator("textarea").fill("核对银行回单，提交独立财务核验");
 await drawer.getByLabel("上传银行核验依据").setInputFiles({name:"bank.pdf",mimeType:"application/pdf",buffer:Buffer.from("synthetic-private-bank-proof")});
 await drawer.locator('input[type="password"]').fill("synthetic-password");
 await drawer.getByRole("button",{name:"提交独立核验",exact:true}).click();
 await expect.poll(()=>writes.filter(w=>w.path==='/api/contract-bank-verifications').length).toBe(1);
 expect(writes.find(w=>w.path==='/api/contract-bank-verifications')?.body).toMatchObject({projectId:"p",companyEntityId:"company",amountCents:"10000",direction:"outflow",evidenceFileId:"uploaded-bank-proof"});
});

test("独立财务可翻阅待核验事项并重新输入完整账号确认",async({page})=>{
 const writes:Array<{path:string;body:Record<string,unknown>}>=[];await login(page,writes);
 const reads:string[]=[];
 await page.route("**/api/contract-bank-verifications?**",route=>{reads.push(route.request().url());return route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({page:1,pageSize:50,total:501,companies:[{value:"company",label:"我方建设公司"}],rows:[{id:"bank-check",companyName:"我方建设公司",accountLast4:"5678",bankReference:"BANK-REVIEW",direction:"outflow",amountCents:"10000",occurredAt:"2026-08-15T16:00:00Z",status:"pending_confirm",reason:"独立核验",evidenceFileId:"original-proof",canConfirm:true}]})});});
 await page.goto("/资金执行案件?projectId=p");
 const panel=page.getByRole("region",{name:"银行流水核验"});
 await expect(panel.getByText("2026/8/16",{exact:false})).toBeVisible();
 await panel.locator('.t-pagination__number').filter({hasText:/^2$/}).click();
 await expect.poll(()=>reads.some(url=>new URL(url).searchParams.get("page")==="2")).toBe(true);
 await panel.getByRole("button",{name:"核验账户及流水",exact:true}).click();
 const drawer=page.locator(".t-drawer").filter({hasText:"银行账户与交易核验"});
 await drawer.locator(".t-form__item").filter({hasText:"重新输入完整银行账号"}).locator("input").fill("6222-0000 12345678");
 await drawer.getByLabel("上传银行核验依据").setInputFiles({name:"holder.pdf",mimeType:"application/pdf",buffer:Buffer.from("independent-holder-proof")});
 await drawer.locator('input[type="password"]').fill("synthetic-password");
 await drawer.getByRole("button",{name:"提交核验决定",exact:true}).click();
 await expect.poll(()=>writes.find(w=>w.path==='/api/contract-bank-verifications/bank-check/decision')?.body).toMatchObject({decision:"confirm",accountNumber:"6222-0000 12345678",holderEvidenceFileId:"uploaded-bank-proof"});
});
