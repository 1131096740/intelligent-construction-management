import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

test.skip(!process.env.SIGNATURE_REAL_DB_CONFIG || !process.env.SIGNATURE_REAL_ACCOUNTS,
  "真实后台签名验收仅在专用本机合成配置下运行");

for (const role of ["employee", "project_manager"]) {
 for (const handoff of [false, true]) {
  test(role + (handoff ? " 扫码" : " 直接登录") + "真实后台保存与存储恢复重试", async ({page}, info) => {
   const users = JSON.parse(readFileSync(process.env.SIGNATURE_REAL_ACCOUNTS!, "utf8")) as Array<{phone:string;password:string;role:string}>;
   const user=users.find(x=>x.role===role)!;
   await page.route("**/api/**", route => {
    const p=new URL(route.request().url()).pathname;
    if (!p.startsWith("/api/")) return route.continue();
    return p.startsWith("/api/auth/") || p.startsWith("/api/me/signature") || p.startsWith("/api/files/")
     ? route.continue() : route.fulfill({contentType:"application/json",body:"[]"});
   });
   await page.goto("/login");
   await page.getByPlaceholder("请输入手机号").fill(user.phone);
   await page.getByPlaceholder("请输入密码").fill(user.password);
   await page.getByRole("button",{name:"登录",exact:true}).click();
   await expect(page).not.toHaveURL(/\/login(?:\?|$)/);
   await page.goto("/系统配置");
   if(handoff){
    // Same account creates its real one-time token; login, guard and DB are real.
    await page.setViewportSize({width:1280,height:900});
    const created=page.waitForResponse(r=>r.url().endsWith("/me/signature/canvas-handoffs")&&r.request().method()==="POST");
    await page.getByRole("button",{name:"生成手写签名二维码"}).click();
    const response=await created;expect(response.status()).toBe(201);
    const token=(await response.json()).token as string;
    await page.setViewportSize({width:390,height:844});
    await page.goto("/手写签名?handoff="+encodeURIComponent(token));
   }
   const pad=page.getByLabel("横向手写签字板");await expect(pad).toBeVisible();
   const b=(await pad.boundingBox())!;
   for(const [type,x,y] of [["pointerdown",40,80],["pointermove",120,140],["pointermove",240,50],["pointerup",240,50]] as const){
    await pad.dispatchEvent(type,{pointerId:1,pointerType:"touch",clientX:b.x+x,clientY:b.y+y});
   }
   const before=await pad.evaluate(n=>(n as HTMLCanvasElement).toDataURL());
   const save=page.getByRole("button",{name:"保存手写签名"});
   const isSave=(r:import("@playwright/test").Response)=>r.request().method()==="POST"&&/\/me\/signature\/(?:canvas$|canvas-handoffs\/[^/]+\/complete$)/.test(new URL(r.url()).pathname);
   let responsePromise=page.waitForResponse(isSave);await save.click();
   expect((await responsePromise).status()).toBe(503);
   await expect(page.getByText("签名未保存，笔迹已保留。资料存储服务当前受限，暂时无法上传。请联系管理员检查服务状态，恢复后重试。",{exact:true})).toBeVisible();
   expect(await pad.evaluate(n=>(n as HTMLCanvasElement).toDataURL())).toBe(before);
   await page.screenshot({path:info.outputPath("真实后台失败保留笔迹.png"),fullPage:true});
   responsePromise=page.waitForResponse(isSave);await save.click();
   const saved=await responsePromise;expect(saved.status()).toBe(201);
   expect((await saved.json()).signatureVersionId).toBeTruthy();
   await expect(page.getByText(handoff?"手写签名已完成，请回到电脑端继续。":"手写签名已保存，将用于之后的审批。",{exact:true})).toBeVisible();
   if (handoff) await page.goto("/系统配置");
   const preview=page.getByAltText("当前手写签名");
   await expect(preview).toBeVisible();
   await expect.poll(()=>preview.evaluate(n=>(n as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  });
 }
}
