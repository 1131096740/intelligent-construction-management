import {expect,test} from "@playwright/test";
test("劳务签署编辑逐项取消、确认并保存重读",async({page},testInfo)=>{
 const input=JSON.parse(process.env.TASK10_BODY_BROWSER_INPUT??"{}"),draft=input.drafts[testInfo.project.name],path=`/contract-drafts/${draft.version.id}`;
 await page.goto("/login?redirect="+encodeURIComponent(`/合同工作台/${draft.contract.id}?versionId=${draft.version.id}`));
 await page.getByPlaceholder("请输入手机号").fill(input.staff.phone);await page.getByPlaceholder("请输入密码").fill(input.staff.password);await page.getByRole("button",{name:"登录",exact:true}).click();await page.getByText("合同正文",{exact:true}).click();
 const editor=page.getByRole("region",{name:"完整合同正文",exact:true}),notice=editor.getByRole("status",{name:"正文提示",exact:true});
 await expect(notice.getByText("虚构甲方保留原文",{exact:true})).toBeVisible();await expect(notice.getByText("虚构乙方保留原文",{exact:true})).toBeVisible();
 const choice=notice.locator("div").filter({has:page.getByText("虚构甲方保留原文",{exact:true})}).last();
 await choice.getByRole("button",{name:"恢复此签署栏",exact:true}).click();
 const dialog=page.getByRole("dialog",{name:"恢复此签署栏"});await expect(dialog).toBeVisible();await dialog.getByRole("button",{name:"取消",exact:true}).click();
 await expect(notice.getByText("虚构甲方保留原文",{exact:true})).toBeVisible();
 await choice.getByRole("button",{name:"恢复此签署栏",exact:true}).click();
 const saved=page.waitForResponse(response=>response.request().method()==="PUT"&&response.url().endsWith(path)&&!response.request().postDataJSON()?.draft?.draftData?.documentBody?.edits?.some((entry:{text:string})=>entry.text==="虚构甲方保留原文")&&response.request().postDataJSON()?.draft?.draftData?.documentBody?.edits?.some((entry:{text:string})=>entry.text==="虚构乙方保留原文"));
 await dialog.getByRole("button",{name:"确认恢复此处",exact:true}).click();await editor.getByRole("button",{name:"保存正文",exact:true}).click();expect((await saved).status()).toBe(200);
 await expect(notice.getByText("虚构甲方保留原文",{exact:true})).toHaveCount(0);await expect(notice.getByText("虚构乙方保留原文",{exact:true})).toBeVisible();
 await page.reload();await page.getByText("合同正文",{exact:true}).click();
 await expect(notice.getByText("虚构甲方保留原文",{exact:true})).toHaveCount(0);await expect(notice.getByText("虚构乙方保留原文",{exact:true})).toBeVisible();
});
