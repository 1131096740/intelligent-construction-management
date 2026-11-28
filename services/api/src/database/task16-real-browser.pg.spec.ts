import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServer } from "node:net";
import * as path from "node:path";
import { closeSync, constants, fstatSync, fsyncSync, ftruncateSync, lstatSync, openSync, realpathSync, writeFileSync } from "node:fs";
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
import { createTask16BrowserSubmissionGate, task16RealBrowserRequestAllowed } from "./task16-real-browser-scope";
import { buildRegisteredPgFixturePlan } from "./registered-payment-postgres.fixture";
import { seedSharedPaymentPredecessors } from "./task16-shared-standard-fixture";

const enabled=process.env.RUN_TASK398_SHARED_PG16==="1" && process.env.TASK398_BROWSER_MODE==="1";
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
 it("shares one partial payment between roles and independently reconciles its effects",async()=>{
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
  let evidenceIdentity:{dev:number;ino:number}|undefined;
  const evidenceDir=path.dirname(output);
  const recordEvidence=(value:object,initial:boolean)=>{
   const directory=lstatSync(evidenceDir);
   if(!evidenceDir.startsWith("/private/tmp/jg398-browser-evidence-")||realpathSync(evidenceDir)!==evidenceDir||!directory.isDirectory()||directory.isSymbolicLink()||directory.uid!==process.getuid?.()||(directory.mode&0o777)!==0o700||path.basename(output)!=="receipt.json")throw new Error("TASK398_BROWSER_EVIDENCE_DIR");
   const flags=initial?constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW:constants.O_WRONLY|constants.O_NOFOLLOW;
   const fd=openSync(output,flags,0o600);
   try{const stat=fstatSync(fd);if(!stat.isFile()||stat.uid!==process.getuid?.()||(stat.mode&0o777)!==0o600||(!initial&&(!evidenceIdentity||stat.dev!==evidenceIdentity.dev||stat.ino!==evidenceIdentity.ino)))throw new Error("TASK398_BROWSER_EVIDENCE_IDENTITY");
    if(!initial)ftruncateSync(fd,0);writeFileSync(fd,JSON.stringify(value)+"\n");fsyncSync(fd);if(initial)evidenceIdentity={dev:stat.dev,ino:stat.ino};
   }finally{closeSync(fd);}
   const dirfd=openSync(evidenceDir,constants.O_RDONLY);try{fsyncSync(dirfd);}finally{closeSync(dirfd);}
  };
  let submitted=false;let submittedKeySha256:string|undefined;let admittedOpening:{id:string;sourceId:string}|undefined;
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
   const scope={paymentId:plan.ids.payment,executionIds:[] as string[],resultKeys:[] as string[],fileIds:[] as string[]};
   const admit=createTask16BrowserSubmissionGate({companyId:plan.ids.companyA,paidAt:plan.paidAt,getOpening:()=>admittedOpening,record:requestKeySha256=>{recordEvidence({candidate,runId,status:"UNKNOWN_DO_NOT_RETRY",requestKeySha256},true);submittedKeySha256=requestKeySha256;}});
   app.use((req:{method:string;originalUrl:string;body?:Record<string,unknown>},res:{status:(code:number)=>{end:()=>void}},next:()=>void)=>{
    if(!task16RealBrowserRequestAllowed(req.method,req.originalUrl,scope))return res.status(404).end();
    if(req.method==="POST"&&req.originalUrl===`/payment-executions/${plan.ids.payment}/registrations`){
     if(!admit(req.body))return res.status(404).end();
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
    if(executions.length>0&&(executions.length!==1||funding.length!==1||funding[0]!.executionId!==executions[0]!.id||funding[0]!.actualPayerId!==plan.ids.companyA||funding[0]!.actualPayerKind!=="participating_company"||allocations.length!==1||allocations[0]!.executionId!==executions[0]!.id||allocations[0]!.sourceBatchId!==admittedOpening?.sourceId||allocations[0]!.amountCents!==3000n||events.length!==1||events[0]!.executionId!==executions[0]!.id||audits.length!==1||audits[0]!.actorUserId!==plan.ids.actor))throw new Error("TASK398_BROWSER_PAYMENT_BINDING");
    const settlementFacts=await tx.operatingFact.findMany({where:{projectId:plan.ids.project,sourceType:"settlement",sourceBusinessId:plan.ids.settlement},select:{id:true,status:true}});
    const settlementImpacts=await tx.operatingImpactEntry.findMany({where:{projectId:plan.ids.project,sourceType:"settlement",sourceBusinessId:plan.ids.settlement},select:{id:true,factId:true,impactKind:true,direction:true,amountCents:true,numericProtocolVersion:true}});
    if(settlementFacts.length!==1||settlementFacts[0]!.status!=="confirmed"||settlementImpacts.length!==2||settlementImpacts.some(row=>row.factId!==settlementFacts[0]!.id||row.direction!=="increase"||row.amountCents!==10000n||row.numericProtocolVersion!==1)||!["confirmed_cost","payable_increase"].every(kind=>settlementImpacts.filter(row=>row.impactKind===kind).length===1))throw new Error("TASK398_BROWSER_SETTLEMENT_WITNESS");
    if(facts.length>0&&(facts.length!==1||facts[0]!.status!=="confirmed"||executions.length!==1||facts[0]!.sourceBusinessId!==executions[0]!.id||impacts.length!==2||impacts.some(row=>row.factId!==facts[0]!.id||row.sourceBusinessId!==executions[0]!.id||row.amountCents!==3000n||row.direction!=="decrease"||row.numericProtocolVersion!==1)||!["payable_decrease","company_project_funds_decrease"].every(kind=>impacts.filter(row=>row.impactKind===kind).length===1)))throw new Error("TASK398_BROWSER_PAYMENT_WITNESS");
    const settlementWitness={factId:settlementFacts[0]!.id,impactIds:settlementImpacts.map(row=>row.id).sort()};
    const registration=await tx.fundAccountBalanceRegistration.findUniqueOrThrow({where:{id:opening.body.id},select:{accountId:true,balanceYuan:true,coveredExecutionIds:true}});
    const postings=await tx.registeredFundPaymentAllocation.findMany({where:{accountId:registration.accountId},select:{executionId:true,amountCents:true}});
    if(registration.balanceYuan===null)throw new Error("TASK398_BROWSER_UNKNOWN_BALANCE");
    const uncovered=postings.filter(row=>!registration.coveredExecutionIds.includes(row.executionId)).reduce((sum,row)=>sum+row.amountCents,0n);
    const balance=registration.balanceYuan.minus(`${uncovered/100n}.${(uncovered%100n).toString().padStart(2,"0")}`).toFixed(4);
    return {balance,settlementWitness,settlementFacts:settlementFacts.length,settlementImpacts:settlementImpacts.length,paid:request.paidAmountCents.toString(),settlementPaid:settlement.paidAmountCents.toString(),executions:executions.length,amount:executions.reduce((sum,row)=>sum+row.amountCents,0n).toString(),funding:funding.length,allocations:allocations.length,allocationAmount:allocations.reduce((sum,row)=>sum+row.amountCents,0n).toString(),events:events.length,audits:audits.length,facts:facts.length,impacts:impacts.length};
   },{isolationLevel:"RepeatableRead"});
   const before=await observe();expect(before).toEqual({balance:"100.0000",settlementWitness:expect.objectContaining({factId:expect.any(String),impactIds:expect.any(Array)}),settlementFacts:1,settlementImpacts:2,paid:"0",settlementPaid:"0",executions:0,amount:"0",funding:0,allocations:0,allocationAmount:"0",events:0,audits:0,facts:0,impacts:0});
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
   const ledgerRefresh=page.waitForResponse((response:{request:()=>{method:()=>string};url:()=>string})=>response.request().method()==="GET"&&new URL(response.url()).pathname==="/api/payments");
   const relationshipRefresh=page.waitForResponse((response:{request:()=>{method:()=>string};url:()=>string})=>response.request().method()==="GET"&&new URL(response.url()).pathname==="/api/contract-relationship-ledger");
   const balanceRefresh=page.waitForResponse((response:{request:()=>{method:()=>string};url:()=>string})=>response.request().method()==="GET"&&new URL(response.url()).pathname==="/api/operating-projections/as-of");
   const posted=page.waitForResponse((response:{request:()=>{method:()=>string};url:()=>string})=>response.request().method()==="POST"&&new URL(response.url()).pathname===`/api/payment-executions/${plan.ids.payment}/registrations`);
   await page.getByRole("button",{name:"已核实并确认登记",exact:true}).click();expect((await posted).status()).toBe(201);expect(submitted).toBe(true);expect((await ledgerRefresh).status()).toBe(200);expect((await relationshipRefresh).status()).toBe(200);const refreshedProjection=await balanceRefresh;expect(refreshedProjection.status()).toBe(200);expect((await refreshedProjection.json()).operating.payableCents).toBe("7000");
   await page.locator(".business-status-summary__item").filter({hasText:"已实付金额"}).getByText("¥30.00",{exact:true}).waitFor();
   await page.locator(".financial-balances").getByText("应付余额：70.00 元",{exact:false}).first().waitFor();
   await panel.getByText("已付 ¥30.00 · 剩余待付 ¥70.00",{exact:true}).first().waitFor();
   const other=await second.newPage();await other.goto(`http://127.0.0.1:${port}/付款管理`);await other.getByRole("region",{name:"共享实付待办"}).getByText("已付 ¥30.00 · 剩余待付 ¥70.00",{exact:true}).first().waitFor();
   await page.screenshot({path:path.join(path.dirname(output),"finance-partial.png"),fullPage:true});
   await other.screenshot({path:path.join(path.dirname(output),"keeper-shared.png"),fullPage:true});
   const after=await observe();expect(after).toEqual({balance:"70.0000",settlementWitness:before.settlementWitness,settlementFacts:1,settlementImpacts:2,paid:"3000",settlementPaid:"3000",executions:1,amount:"3000",funding:1,allocations:1,allocationAmount:"3000",events:1,audits:1,facts:1,impacts:2});
   completedEvidence={candidate,runId,status:"BROWSER_PARTIAL_CASE_RETURNED_NOT_FULL_ACCEPTANCE",requestKeySha256:submittedKeySha256,before,after};
  }catch(error){primaryError=error;throw error;}
  finally{
   const failures:string[]=[];
   for(const [name,close] of [["BROWSER",()=>browser?.close()],["VITE",()=>closeChild(vite)],["APP",()=>app?.close()],["CLIENTS",()=>Promise.all([owner.$disconnect(),runtime.$disconnect(),observer.$disconnect()])]] as const){try{await close();}catch{failures.push(name);}}
   if(failures.length){console.error(`TASK398_BROWSER_CLEANUP_UNKNOWN ${failures.join(",")}`);if(primaryError===undefined)cleanupFailed=true;}
  }
  if(cleanupFailed)throw new Error("TASK398_BROWSER_CLEANUP_UNKNOWN");
  if(completedEvidence)recordEvidence(completedEvidence,false);
 },120000);
});
