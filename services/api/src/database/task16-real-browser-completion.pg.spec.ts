import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServer } from "node:net";
import * as path from "node:path";
import { readFileSync } from "node:fs";
import { hash } from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { Test } from "@nestjs/testing";
import { type INestApplication } from "@nestjs/common";

import { apiJsonReplacer } from "../api-json-replacer";
import { createApiValidationPipe } from "../validation/api-validation";
import { REGISTERED_PAYMENT_IMPACT_READER, readTask16RegisteredPaymentImpacts } from "../payment/registered-payment-impact-reader";
import { OperatingSourceReplayService } from "../operating-ledger/operating-source-replay.service";
import { PrismaService } from "./prisma.service";
import { Task16RealBrowserModule } from "./task16-real-browser-application";
import { task16RealBrowserRequestAllowed } from "./task16-real-browser-scope";
import { createTask16BrowserCompletionGate } from "./task16-real-browser-completion-scope";
import { writeCompletionEvidence } from "./task16-browser-completion-evidence";
import { buildRegisteredPgFixturePlan } from "./registered-payment-postgres.fixture";
import { seedSharedPaymentPredecessors } from "./task16-shared-standard-fixture";

const enabled=process.env.RUN_TASK398_SHARED_PG16==="1" && process.env.TASK398_BROWSER_MODE==="2";
async function unusedPort():Promise<number>{
 const server=createServer();await new Promise<void>((resolve,reject)=>server.once("error",reject).listen(0,"127.0.0.1",resolve));
 const address=server.address();if(!address || typeof address==="string")throw new Error("TASK398_BROWSER_PORT");
 await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));return address.port;
}
async function closeChild(child:ChildProcess|undefined){
 if(!child || child.exitCode!==null || child.signalCode!==null)return;
 const exited=new Promise<void>(resolve=>child.once("exit",()=>resolve()));
 child.kill("SIGTERM");
 let timer:NodeJS.Timeout|undefined;
 try{await Promise.race([exited,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error("TASK398_BROWSER_VITE_CLEANUP_UNKNOWN")),5000);})]);}
 finally{if(timer)clearTimeout(timer);}
}
(enabled?describe:describe.skip)("#398 browser against real isolated PostgreSQL",()=>{
 it("recovers a lost payment response by the original key after page reload, then completes and reconciles payment",async()=>{
  const urls=[process.env.TASK398_OWNER_URL,process.env.DATABASE_URL,process.env.TASK398_OBSERVER_URL].map(value=>new URL(value??""));
  const runId=process.env.TASK398_RUN_ID??"",candidate=process.env.TASK398_CANDIDATE_SHA??"",output=process.env.TASK398_BROWSER_EVIDENCE??"";
  if(process.env.NODE_ENV!=="test"||!/^[a-f0-9]{32}$/u.test(runId)||!/^[a-f0-9]{40}$/u.test(candidate)||!output.startsWith("/private/tmp/")||!urls.every(url=>url.hostname==="127.0.0.1"&&url.port===urls[0]!.port&&url.pathname==="/jiangkong_payment_execution_concurrency")||urls.map(url=>url.username).join(",")!=="jg_task01_owner,jg_task01_runtime,jg_task01_observer")throw new Error("TASK398_BROWSER_ISOLATION");
  const [owner,runtime,observer]=urls.map(url=>new PrismaClient({datasources:{db:{url:url.href}}})) as [PrismaClient,PrismaClient,PrismaClient];
  let app:INestApplication|undefined,vite:ChildProcess|undefined;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const {chromium}=require(require.resolve("@playwright/test",{paths:[path.resolve(__dirname,"../../../../apps/web-admin")]}));
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const {json:expressJson}=require(require.resolve("express",{paths:[require.resolve("@nestjs/core")]}));
  let browser:Awaited<ReturnType<typeof chromium.launch>>|undefined;
  let primaryError:unknown;let cleanupFailed=false;let completedEvidence:object|undefined;
  const evidenceDir=path.dirname(output);
  if(path.basename(output)!=="receipt.json")throw new Error("TASK398_BROWSER_EVIDENCE_DIR");
  const recordEvidence=(value:object,name:string)=>writeCompletionEvidence(evidenceDir,name,value);
  let submitted=false;let admittedOpening:{id:string;sourceId:string}|undefined;
  try{
   type ClientIdentity={database:string;databaseOid:string;role:string;loginRole:string;runId:string;pid:number;superuser:boolean};
   const checkIdentity=async(client:PrismaClient,role:string)=>{const rows=await client.$queryRaw<ClientIdentity[]>`SELECT current_database() AS database,(SELECT oid::text FROM pg_catalog.pg_database WHERE datname=current_database()) AS "databaseOid",current_user::text AS role,session_user::text AS "loginRole",current_setting('jg.task398_run_id',true) AS "runId",pg_backend_pid() AS pid,(SELECT rolsuper FROM pg_catalog.pg_roles WHERE rolname=current_user) AS superuser`;expect(rows).toHaveLength(1);expect(rows[0]).toMatchObject({database:"jiangkong_payment_execution_concurrency",role,loginRole:role,runId,superuser:role==="jg_task01_owner"});return rows[0]!;};
   const identities=await Promise.all([checkIdentity(owner,"jg_task01_owner"),checkIdentity(runtime,"jg_task01_runtime"),checkIdentity(observer,"jg_task01_observer")]);
   expect(new Set(identities.map(row=>row.pid)).size).toBe(3);expect(new Set(identities.map(row=>row.databaseOid)).size).toBe(1);
   const plan=buildRegisteredPgFixturePlan(runId.slice(0,12),"2026-11-07","2026-11-01"),passwords=[randomUUID(),randomUUID(),randomUUID()];
   const hashes=await Promise.all(passwords.map(value=>hash(value,10)));
   const seeded=await seedSharedPaymentPredecessors(owner,plan,{financeHash:hashes[0]!,keeperHash:hashes[1]!,directorHash:hashes[2]!},process.env.FILE_STORAGE_ROOT??"");
   const module=await Test.createTestingModule({imports:[Task16RealBrowserModule]}).overrideProvider(PrismaService).useValue(runtime).overrideProvider(REGISTERED_PAYMENT_IMPACT_READER).useValue(readTask16RegisteredPaymentImpacts).compile();
   app=module.createNestApplication({logger:false});
   app.use(expressJson({limit:"1mb"}));
   const scope={paymentId:plan.ids.payment,executionIds:[] as string[],resultKeys:[] as string[],fileIds:[] as string[]};let ticket:string|undefined;
   const digests:string[]=[];
   const admit=createTask16BrowserCompletionGate({companyId:plan.ids.companyA,paidAt:plan.paidAt,getOpening:()=>admittedOpening,record:(_stage,requestKeySha256)=>{digests.push(requestKeySha256);recordEvidence({candidate,runId,status:"UNKNOWN_DO_NOT_RETRY",requestKeySha256:digests},digests.length===1?"receipt.json":"receipt-stage2.json");}});
   let registrationRequests=0;
   app.use((req:{method:string;originalUrl:string;body?:Record<string,unknown>},res:{status:(code:number)=>{end:()=>void}},next:()=>void)=>{
    if(req.method==="POST"&&req.originalUrl===`/payment-executions/${plan.ids.payment}/recovery-proof`){
     const originalKey=scope.resultKeys[0];
     return originalKey&&req.body?.idempotencyKey===originalKey ? next() : res.status(404).end();
    }
    if(!task16RealBrowserRequestAllowed(req.method,req.originalUrl,scope,ticket))return res.status(404).end();
    if(req.method==="POST"&&req.originalUrl===`/payment-executions/${plan.ids.payment}/registrations`){
     registrationRequests++;
     if(!admit.admit(req.body))return res.status(404).end();
     submitted=true;scope.resultKeys.push(req.body!.idempotencyKey as string);
    }
    return next();
   });
   app.getHttpAdapter().getInstance().set("json replacer",apiJsonReplacer);app.useGlobalPipes(createApiValidationPipe());await app.listen(0,"127.0.0.1");
   const origin=await app.getUrl();
   const json=async(route:string,method:string,body?:unknown,token?:string)=>{const response=await fetch(origin+route,{method,headers:{...(body!==undefined?{"content-type":"application/json"}:{}),...(token?{authorization:`Bearer ${token}`}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});return {status:response.status,body:await response.json()};};
   const login=async(phone:string,password:string)=>{const response=await json("/auth/login","POST",{phone,password});expect(response.status).toBe(201);return response.body;};
   const finance=await login(plan.phone,passwords[0]!),keeper=await login(seeded.keeperPhone,passwords[1]!),director=await login(seeded.directorPhone,passwords[2]!);
   const png=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=","base64"),signature=new FormData();signature.append("file",new Blob([png],{type:"image/png"}),"signature.png");
   const signatureResponse=await fetch(origin+"/me/signature/canvas",{method:"POST",headers:{authorization:`Bearer ${director.tokens.accessToken}`},body:signature});expect(signatureResponse.status).toBe(201);
   const payment=await observer.paymentRequest.findUniqueOrThrow({where:{id:plan.ids.payment}}),round=await observer.approvalInstance.findUniqueOrThrow({where:{id:plan.ids.approvedRound}});
   const approved=await json(`/payments/${plan.ids.payment}/approval`,"POST",{decision:"approve",expectedPaymentUpdatedAt:payment.updatedAt.toISOString(),expectedApprovalInstanceId:round.id,expectedNodeIndex:0,expectedApprovalUpdatedAt:round.updatedAt.toISOString()},director.tokens.accessToken);expect(approved.status).toBe(201);
   await app.get(OperatingSourceReplayService).replaySource({projectId:plan.ids.project,sourceType:"settlement",sourceBusinessId:plan.ids.settlement},plan.ids.actor);
   const opening=await json("/fund-accounts/openings","POST",{scopeKey:`company:${plan.ids.companyA}`,balanceYuan:"100",asOfDate:plan.openingDate,evidenceReference:"虚构期初",reconciliationNote:"虚构项目来源",reason:"隔离测试",idempotencyKey:randomUUID(),sources:[{amountYuan:"100",sourceStatus:"known",sourceName:"虚构项目资金",projectStatus:"project",projectId:plan.ids.project}]},finance.tokens.accessToken);expect(opening.status).toBe(201);
   if(typeof opening.body.id!=="string"||!Array.isArray(opening.body.sources)||opening.body.sources.length!==1||typeof opening.body.sources[0]?.id!=="string")throw new Error("TASK398_BROWSER_OPENING_SHAPE");
   admittedOpening={id:opening.body.id,sourceId:opening.body.sources[0].id};
   const observe=()=>observer.$transaction(async tx=>{
    await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
    const observed=await tx.$queryRaw<Array<{role:string;loginRole:string;databaseOid:string;runId:string;pid:number;readOnly:string;isolation:string}>>`SELECT current_user::text AS role,session_user::text AS "loginRole",(SELECT oid::text FROM pg_catalog.pg_database WHERE datname=current_database()) AS "databaseOid",current_setting('jg.task398_run_id',true) AS "runId",pg_backend_pid() AS pid,current_setting('transaction_read_only') AS "readOnly",current_setting('transaction_isolation') AS isolation`;
    expect(observed).toEqual([{role:"jg_task01_observer",loginRole:"jg_task01_observer",databaseOid:identities[2]!.databaseOid,runId,pid:identities[2]!.pid,readOnly:"on",isolation:"repeatable read"}]);
    const request=await tx.paymentRequest.findUniqueOrThrow({where:{id:plan.ids.payment},select:{paidAmountCents:true}}),settlement=await tx.settlement.findUniqueOrThrow({where:{id:plan.ids.settlement},select:{paidAmountCents:true}});
    const executions=await tx.paymentExecution.findMany({where:{paymentRequestId:plan.ids.payment},select:{id:true,amountCents:true}}),ids=executions.map(row=>row.id);
    const [funding,allocations,events,audits,facts,impacts]=await Promise.all([
     tx.registeredPaymentFunding.findMany({where:{executionId:{in:ids}},select:{executionId:true,actualPayerId:true,actualPayerKind:true}}),tx.registeredFundPaymentAllocation.findMany({where:{executionId:{in:ids}},select:{executionId:true,amountCents:true,sourceBatchId:true}}),tx.registeredPaymentEvent.findMany({where:{executionId:{in:ids}},select:{executionId:true}}),tx.auditLog.findMany({where:{businessType:"payment_request",businessId:plan.ids.payment,action:"payment.execution.record"},select:{actorUserId:true}}),tx.operatingFact.findMany({where:{projectId:plan.ids.project,sourceType:"payment_execution"},select:{id:true,status:true,sourceBusinessId:true}}),tx.operatingImpactEntry.findMany({where:{projectId:plan.ids.project,sourceType:"payment_execution"},select:{id:true,factId:true,sourceBusinessId:true,impactKind:true,direction:true,amountCents:true,numericProtocolVersion:true}})]);
    if(executions.length>2||funding.length!==executions.length||allocations.length!==executions.length||events.length!==executions.length||audits.length!==executions.length||audits.some(row=>row.actorUserId!==plan.ids.actor))throw new Error("TASK398_BROWSER_PAYMENT_BINDING");
    for(const execution of executions){
     if(![3000n,7000n].includes(execution.amountCents)||funding.filter(row=>row.executionId===execution.id&&row.actualPayerId===plan.ids.companyA&&row.actualPayerKind==="participating_company").length!==1||allocations.filter(row=>row.executionId===execution.id&&row.sourceBatchId===admittedOpening?.sourceId&&row.amountCents===execution.amountCents).length!==1||events.filter(row=>row.executionId===execution.id).length!==1)throw new Error("TASK398_BROWSER_PAYMENT_BINDING");
    }
    const settlementFacts=await tx.operatingFact.findMany({where:{projectId:plan.ids.project,sourceType:"settlement",sourceBusinessId:plan.ids.settlement},select:{id:true,status:true}});
    const settlementImpacts=await tx.operatingImpactEntry.findMany({where:{projectId:plan.ids.project,sourceType:"settlement",sourceBusinessId:plan.ids.settlement},select:{id:true,factId:true,impactKind:true,direction:true,amountCents:true,numericProtocolVersion:true}});
    if(settlementFacts.length!==1||settlementFacts[0]!.status!=="confirmed"||settlementImpacts.length!==2||settlementImpacts.some(row=>row.factId!==settlementFacts[0]!.id||row.direction!=="increase"||row.amountCents!==10000n||row.numericProtocolVersion!==1)||!["confirmed_cost","payable_increase"].every(kind=>settlementImpacts.filter(row=>row.impactKind===kind).length===1))throw new Error("TASK398_BROWSER_SETTLEMENT_WITNESS");
    if(facts.length!==executions.length||impacts.length!==executions.length*2)throw new Error("TASK398_BROWSER_PAYMENT_WITNESS");
    for(const execution of executions){const fact=facts.find(row=>row.sourceBusinessId===execution.id),entries=impacts.filter(row=>row.sourceBusinessId===execution.id);
     if(!fact||fact.status!=="confirmed"||entries.length!==2||entries.some(row=>row.factId!==fact.id||row.amountCents!==execution.amountCents||row.direction!=="decrease"||row.numericProtocolVersion!==1)||!["payable_decrease","company_project_funds_decrease"].every(kind=>entries.filter(row=>row.impactKind===kind).length===1))throw new Error("TASK398_BROWSER_PAYMENT_WITNESS");
    }
    const settlementWitness={factId:settlementFacts[0]!.id,impactIds:settlementImpacts.map(row=>row.id).sort()};
    const registration=await tx.fundAccountBalanceRegistration.findUniqueOrThrow({where:{id:opening.body.id},select:{accountId:true,balanceYuan:true,coveredExecutionIds:true}});
    const postings=await tx.registeredFundPaymentAllocation.findMany({where:{accountId:registration.accountId},select:{executionId:true,amountCents:true}});
    if(registration.balanceYuan===null)throw new Error("TASK398_BROWSER_UNKNOWN_BALANCE");
    const uncovered=postings.filter(row=>!registration.coveredExecutionIds.includes(row.executionId)).reduce((sum,row)=>sum+row.amountCents,0n);
    const balance=registration.balanceYuan.minus(`${uncovered/100n}.${(uncovered%100n).toString().padStart(2,"0")}`).toFixed(4);
    return {balance,executionWitness:executions.map(row=>({id:row.id,amount:row.amountCents.toString()})).sort((a,b)=>a.amount.localeCompare(b.amount)),settlementWitness,settlementFacts:settlementFacts.length,settlementImpacts:settlementImpacts.length,paid:request.paidAmountCents.toString(),settlementPaid:settlement.paidAmountCents.toString(),executions:executions.length,amount:executions.reduce((sum,row)=>sum+row.amountCents,0n).toString(),funding:funding.length,allocations:allocations.length,allocationAmount:allocations.reduce((sum,row)=>sum+row.amountCents,0n).toString(),events:events.length,audits:audits.length,facts:facts.length,impacts:impacts.length};
   },{isolationLevel:"RepeatableRead"});
   const before=await observe();expect(before).toEqual({balance:"100.0000",executionWitness:[],settlementWitness:expect.objectContaining({factId:expect.any(String),impactIds:expect.any(Array)}),settlementFacts:1,settlementImpacts:2,paid:"0",settlementPaid:"0",executions:0,amount:"0",funding:0,allocations:0,allocationAmount:"0",events:0,audits:0,facts:0,impacts:0});
   const port=await unusedPort(),root=path.resolve(__dirname,"../../../.."),web=path.join(root,"apps/web-admin");
   vite=spawn(process.execPath,[path.join(web,"node_modules/vite/bin/vite.js"),"--host","127.0.0.1","--port",String(port),"--strictPort"],{cwd:web,env:{PATH:process.env.PATH,HOME:process.env.HOME,TMPDIR:process.env.TMPDIR,VITE_API_PROXY_TARGET:origin},stdio:"ignore"});
   const end=Date.now()+30000;let ready=false;while(Date.now()<=end&&!ready){if(vite.exitCode!==null||vite.signalCode!==null)throw new Error("TASK398_BROWSER_VITE_START");try{const response=await fetch(`http://127.0.0.1:${port}/`);ready=response.ok;}catch{/* wait for owned Vite listener */}if(!ready)await new Promise(resolve=>setTimeout(resolve,100));}if(!ready)throw new Error("TASK398_BROWSER_VITE_START");
   browser=await chromium.launch({headless:true,env:{PATH:process.env.PATH,HOME:process.env.HOME,TMPDIR:process.env.TMPDIR}});
   const first=await browser.newContext({viewport:{width:1366,height:768}}),second=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
   const session=(value:typeof finance)=>({user:value.user,accessToken:value.tokens.accessToken,refreshToken:value.tokens.refreshToken});
   await first.addInitScript((value:unknown)=>localStorage.setItem("jiangkong-web-admin-auth",JSON.stringify(value)),session(finance));
   await second.addInitScript((value:unknown)=>localStorage.setItem("jiangkong-web-admin-auth",JSON.stringify(value)),session(keeper));
   const page=await first.newPage();const required=["/api/payments","/api/projects","/api/contract-relationship-ledger","/api/operating-projections/as-of","/api/payment-executions/work-items","/api/payment-executions/recorded-items"];
   const waits=required.map(route=>page.waitForResponse((response:{url:()=>string})=>new URL(response.url()).pathname===route,{timeout:15000}));
   await page.goto(`http://127.0.0.1:${port}/付款管理`);const responses=await Promise.all(waits);expect(responses.map((response:{status:()=>number})=>response.status())).toEqual(required.map(()=>200));
   const initialProjection=await responses[3]!.json();expect(initialProjection.operating.payableCents).toBe("10000");
   const panel=page.getByRole("region",{name:"共享实付待办"});await panel.getByRole("button",{name:"办理实付登记",exact:true}).click();
   const form=page.getByRole("region",{name:"实际付款登记"});await form.locator('[aria-label="实付金额（元）"] input').fill("30");await form.locator('[aria-label="实际付款日期"] input').fill(plan.paidAt);
   await form.locator('[aria-label="实际付款资金"] .t-select').click();await page.getByRole("listitem",{name:`合成甲公司${plan.runId}`,exact:true}).click();
   await form.getByText("未含期初，需要扣减登记资金",{exact:true}).click();await form.locator('[aria-label="来源分摊金额1"] input').fill("30");await form.locator('[aria-label="期初核对原因"] textarea').fill("虚构付款未含期初");await form.locator('[aria-label="期初核对依据"] textarea').fill("隔离虚构凭据");await form.locator('[aria-label="本人当前密码"] input').fill(passwords[0]!);
   await form.getByRole("button",{name:"确认登记这笔实付",exact:true}).click();
   await page.locator(".financial-balances").getByText("业务基准日：",{exact:false}).waitFor();
   const registrationPattern=`**/api/payment-executions/${plan.ids.payment}/registrations`;
   let firstExecutionId:string|undefined;
   await page.route(registrationPattern,async(route:{
    fetch:(options:{maxRetries:number})=>Promise<{status:()=>number;json:()=>Promise<{id?:string}>}>;
    abort:()=>Promise<void>;
   })=>{
    const response=await route.fetch({maxRetries:0});
    const body=await response.json();
    if(response.status()===201&&typeof body.id==="string")firstExecutionId=body.id;
    await route.abort();
   },{times:1});
   await page.getByRole("button",{name:"已核实并确认登记",exact:true}).click();
   await panel.getByText("登记结果暂未确认，请保留当前填写并查询本次结果，不能重复登记。",{exact:true}).waitFor();
   expect(typeof firstExecutionId).toBe("string");
   expect(submitted).toBe(true);
   expect(await panel.getByRole("button",{name:"开始下一笔实付登记",exact:true}).count()).toBe(0);
   const originalKey=scope.resultKeys[0]!;
   const resultRead=page.waitForResponse((response:{request:()=>{method:()=>string};url:()=>string})=>response.request().method()==="GET"&&new URL(response.url()).pathname===`/api/payment-executions/results/${originalKey}`);
   const recoveryProof=page.waitForResponse((response:{request:()=>{method:()=>string};url:()=>string})=>response.request().method()==="POST"&&new URL(response.url()).pathname===`/api/payment-executions/${plan.ids.payment}/recovery-proof`);
   // Recreate the page before recovery; only persisted browser state can supply the original command.
   const [result,proof]=await Promise.all([resultRead,recoveryProof,page.reload()]);
   expect(result.status()).toBe(200);
   expect(await result.json()).toMatchObject({status:"recorded",execution:{executionId:firstExecutionId,amountCents:"3000"}});
   expect(proof.status()).toBe(201);
   expect(await proof.json()).toEqual({status:"matched",executionId:firstExecutionId});
   await panel.getByText("已查到本次付款登记，电子凭证可继续补充。",{exact:true}).waitFor();
   expect(scope.resultKeys).toEqual([originalKey]);
   expect(registrationRequests).toBe(1);
   await page.locator(".business-status-summary__item").filter({hasText:"已实付金额"}).getByText("¥30.00",{exact:true}).waitFor();
   await page.locator(".financial-balances").getByText("应付余额：70.00 元",{exact:false}).first().waitFor();
   await panel.getByText("已付 ¥30.00 · 剩余待付 ¥70.00",{exact:true}).first().waitFor();
   const other=await second.newPage();await other.goto(`http://127.0.0.1:${port}/付款管理`);await other.getByRole("region",{name:"共享实付待办"}).getByText("已付 ¥30.00 · 剩余待付 ¥70.00",{exact:true}).first().waitFor();
   await page.screenshot({path:path.join(path.dirname(output),"finance-partial.png"),fullPage:true});
   await other.screenshot({path:path.join(path.dirname(output),"keeper-shared.png"),fullPage:true});
   const after=await observe();expect(after).toEqual({balance:"70.0000",executionWitness:[{id:firstExecutionId,amount:"3000"}],settlementWitness:before.settlementWitness,settlementFacts:1,settlementImpacts:2,paid:"3000",settlementPaid:"3000",executions:1,amount:"3000",funding:1,allocations:1,allocationAmount:"3000",events:1,audits:1,facts:1,impacts:2});
   // No second submission until all first-payment facts above have reconciled.
   admit.reconciledFirst(true);
   await panel.getByRole("button",{name:"开始下一笔实付登记",exact:true}).click();
   await form.locator('[aria-label="实付金额（元）"] input').fill("70");
   await form.locator('[aria-label="实际付款日期"] input').fill(plan.paidAt);
   await form.locator('[aria-label="实际付款资金"] .t-select').click();await page.getByRole("listitem",{name:`合成甲公司${plan.runId}`,exact:true}).click();
   await form.getByText("未含期初，需要扣减登记资金",{exact:true}).click();await form.locator('[aria-label="来源分摊金额1"] input').fill("70");await form.locator('[aria-label="期初核对原因"] textarea').fill("虚构付款未含期初");await form.locator('[aria-label="期初核对依据"] textarea').fill("隔离虚构凭据");await form.locator('[aria-label="本人当前密码"] input').fill(passwords[0]!);
   await form.getByRole("button",{name:"确认登记这笔实付",exact:true}).click();
   const finalPost=page.waitForResponse((response:{request:()=>{method:()=>string};url:()=>string})=>response.request().method()==="POST"&&new URL(response.url()).pathname===`/api/payment-executions/${plan.ids.payment}/registrations`);
   const refreshes=["/api/payments","/api/contract-relationship-ledger","/api/operating-projections/as-of"].map(route=>
    page.waitForResponse((response:{request:()=>{method:()=>string};url:()=>string})=>response.request().method()==="GET"&&new URL(response.url()).pathname===route)
   );
   const [finalResponse,ledger,relationship,projection]=await Promise.all([
    finalPost,...refreshes,page.getByRole("button",{name:"已核实并确认登记",exact:true}).click()
   ]);
   expect(finalResponse.status()).toBe(201);
   expect([ledger.status(),relationship.status(),projection.status()]).toEqual([200,200,200]);
   expect((await projection.json()).operating.payableCents).toBe("0");
   expect(registrationRequests).toBe(2);
   const finalBody=await finalResponse.json();expect(typeof finalBody.id).toBe("string");scope.executionIds.push(finalBody.id);
   await panel.getByText("当前没有待登记的实付。",{exact:true}).waitFor();await other.reload();await other.getByRole("region",{name:"共享实付待办"}).getByText("当前没有待登记的实付。",{exact:true}).waitFor();
   const final=await observe();expect(final).toEqual({balance:"0.0000",executionWitness:[{id:firstExecutionId,amount:"3000"},{id:finalBody.id,amount:"7000"}],settlementWitness:before.settlementWitness,settlementFacts:1,settlementImpacts:2,paid:"10000",settlementPaid:"10000",executions:2,amount:"10000",funding:2,allocations:2,allocationAmount:"10000",events:2,audits:2,facts:2,impacts:4});
   const recorded=page.getByRole("region",{name:"已登记实付"});
   const finalRow=recorded.locator(".registered-payment__item").filter({hasText:"¥70.00"});
   await finalRow.getByRole("button",{name:"补充电子凭证",exact:true}).click();
   await recorded.locator('input[type="file"]').setInputFiles({name:"合成付款凭证.png",mimeType:"image/png",buffer:png});
   const uploaded=page.waitForResponse((response:{request:()=>{method:()=>string};url:()=>string})=>response.request().method()==="POST"&&new URL(response.url()).pathname===`/api/payment-executions/${finalBody.id}/voucher-file-uploads`);
   await recorded.getByRole("button",{name:"上传并关联凭证",exact:true}).click();const uploadResponse=await uploaded;expect(uploadResponse.status()).toBe(201);const file=await uploadResponse.json();expect(typeof file.id).toBe("string");scope.fileIds.push(file.id);
   await finalRow.getByText("电子凭证已补充",{exact:true}).waitFor();
   // Hold the actual ticket response until the fence has its exact server-issued URL.
   await page.route(`**/api/payment-executions/${finalBody.id}/voucher-ticket`,async(route:{fetch:()=>Promise<{json:()=>Promise<{downloadUrl:string}>}>;fulfill:(arg:{response:unknown})=>Promise<void>})=>{const response=await route.fetch();const value=await response.json();ticket=value.downloadUrl;await route.fulfill({response});});
   const downloaded=page.waitForEvent("download");await finalRow.getByRole("button",{name:"下载电子凭证",exact:true}).click();const download=await downloaded;
   const pathToDownload=path.join(path.dirname(output),"downloaded-voucher.png");await download.saveAs(pathToDownload);expect(readFileSync(pathToDownload)).toEqual(png);
   expect(await observe()).toEqual(final);
   await page.screenshot({path:path.join(path.dirname(output),"finance-complete-voucher.png"),fullPage:true});
   completedEvidence={candidate,runId,status:"BROWSER_COMPLETION_CASE_RETURNED_NOT_FULL_ACCEPTANCE",requestKeySha256:digests,before,after,final,voucherDownloaded:true,firstResponseRecovered:true,firstResponseRecoveredAfterReload:true};
  }catch(error){primaryError=error;throw error;}
  finally{
   const failures:string[]=[];
   for(const [name,close] of [["BROWSER",()=>browser?.close()],["VITE",()=>closeChild(vite)],["APP",()=>app?.close()],["CLIENTS",()=>Promise.all([owner.$disconnect(),runtime.$disconnect(),observer.$disconnect()])]] as const){try{await close();}catch{failures.push(name);}}
   if(failures.length){console.error(`TASK398_BROWSER_CLEANUP_UNKNOWN ${failures.join(",")}`);if(primaryError===undefined)cleanupFailed=true;}
  }
  if(cleanupFailed)throw new Error("TASK398_BROWSER_CLEANUP_UNKNOWN");
  if(completedEvidence)recordEvidence(completedEvidence,"receipt-complete.json");
 },120000);
});
