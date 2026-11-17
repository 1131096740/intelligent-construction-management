import { createHash, randomUUID } from "node:crypto";
import { hash } from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import { createApiValidationPipe } from "../validation/api-validation";
import { apiJsonReplacer } from "../api-json-replacer";
import { REGISTERED_PAYMENT_IMPACT_READER, readTask16RegisteredPaymentImpacts } from "../payment/registered-payment-impact-reader";
import { OperatingSourceReplayService } from "../operating-ledger/operating-source-replay.service";
import { PrismaService } from "./prisma.service";
import { Task16SharedPaymentApplicationModule } from "./task16-shared-payment-application";
import { buildRegisteredPgFixturePlan } from "./registered-payment-postgres.fixture";
import { seedSharedPaymentPredecessors } from "./task16-shared-standard-fixture";

const enabled=process.env.RUN_TASK398_SHARED_PG16 === "1";

(enabled?describe:describe.skip)("#398 isolated shared payment real HTTP and PostgreSQL",()=>{
 it("signs and approves, shares partial duties, pays in three instalments and supplements the voucher",async()=>{
  const ownerUrl=new URL(process.env.TASK398_OWNER_URL??""),runtimeUrl=new URL(process.env.DATABASE_URL??""),observerUrl=new URL(process.env.TASK398_OBSERVER_URL??"");
  const db=ownerUrl.pathname;
  const runId=process.env.TASK398_RUN_ID??"";
  if(process.env.NODE_ENV!=="test"||![ownerUrl,runtimeUrl,observerUrl].every(url=>url.hostname==="127.0.0.1"&&url.port===ownerUrl.port&&url.pathname===db)||db!=="/jiangkong_payment_execution_concurrency"||!/^[a-f0-9]{32}$/u.test(runId)||ownerUrl.username!=="jg_task01_owner"||runtimeUrl.username!=="jg_task01_runtime"||observerUrl.username!=="jg_task01_observer")throw new Error("TASK398_ISOLATED_DATABASE_REQUIRED");
  const owner=new PrismaClient({datasources:{db:{url:ownerUrl.href}}}),runtime=new PrismaClient({datasources:{db:{url:runtimeUrl.href}}}),observer=new PrismaClient({datasources:{db:{url:observerUrl.href}}});
  let app:INestApplication | undefined;
  try{
   const identity=async(client:PrismaClient)=>client.$queryRaw<Array<{database:string;role:string;superuser:boolean;runId:string}>>`SELECT current_database() AS database,current_user::text AS role,(SELECT rolsuper FROM pg_roles WHERE rolname=current_user) AS superuser,current_setting('jg.task398_run_id',true) AS "runId"`;
   const [o,r,v]=await Promise.all([identity(owner),identity(runtime),identity(observer)]);
   expect(o[0]).toMatchObject({database:db.slice(1),role:"jg_task01_owner",runId});expect(r[0]).toMatchObject({database:db.slice(1),role:"jg_task01_runtime",superuser:false,runId});expect(v[0]).toMatchObject({database:db.slice(1),role:"jg_task01_observer",superuser:false,runId});
   const plan=buildRegisteredPgFixturePlan(runId.slice(0,12),"2026-11-07","2026-11-01"),passwords=[randomUUID(),randomUUID(),randomUUID()];
   const hashes=await Promise.all(passwords.map(value=>hash(value,10)));
   const seeded=await seedSharedPaymentPredecessors(owner,plan,{financeHash:hashes[0],keeperHash:hashes[1],directorHash:hashes[2]},process.env.FILE_STORAGE_ROOT??"");
   const module=await Test.createTestingModule({imports:[Task16SharedPaymentApplicationModule]}).overrideProvider(PrismaService).useValue(runtime).overrideProvider(REGISTERED_PAYMENT_IMPACT_READER).useValue(readTask16RegisteredPaymentImpacts).compile();
   app=module.createNestApplication({logger:false});app.getHttpAdapter().getInstance().set("json replacer",apiJsonReplacer);app.useGlobalPipes(createApiValidationPipe());await app.listen(0,"127.0.0.1");
   const origin=await app.getUrl();
   const json=async(path:string,method:string,body?:unknown,token?:string)=>{const response=await fetch(origin+path,{method,headers:{...(body!==undefined?{"content-type":"application/json"}:{}),...(token?{authorization:`Bearer ${token}`}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});return {status:response.status,body:await response.json()};};
   const login=async(phone:string,password:string)=>{const response=await json("/auth/login","POST",{phone,password});expect(response.status).toBe(201);return response.body.tokens.accessToken as string;};
   const finance=await login(plan.phone,passwords[0]),keeper=await login(seeded.keeperPhone,passwords[1]),director=await login(seeded.directorPhone,passwords[2]);
   const png=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=","base64"),signature=new FormData();signature.append("file",new Blob([png],{type:"image/png"}),"signature.png");
   const signatureResponse=await fetch(origin+"/me/signature/canvas",{method:"POST",headers:{authorization:`Bearer ${director}`},body:signature});expect(signatureResponse.status).toBe(201);
   const signatureReceipt=await signatureResponse.json() as {signatureFileId:string;signatureVersionId:string};
   const payment=await observer.paymentRequest.findUniqueOrThrow({where:{id:plan.ids.payment}}),round=await observer.approvalInstance.findUniqueOrThrow({where:{id:plan.ids.approvedRound}});
   const approved=await json(`/payments/${plan.ids.payment}/approval`,"POST",{decision:"approve",expectedPaymentUpdatedAt:payment.updatedAt.toISOString(),expectedApprovalInstanceId:round.id,expectedNodeIndex:0,expectedApprovalUpdatedAt:round.updatedAt.toISOString()},director);expect(approved.status).toBe(201);
   const signatureHash=createHash("sha256").update(png).digest("hex");
   const actions=await observer.approvalActionLog.findMany({where:{approvalInstanceId:round.id,action:"approve"},select:{actorUserId:true,signatureFileIdSnapshot:true,signatureVersionIdSnapshot:true,signatureSha256Snapshot:true}});
   expect(actions).toEqual([{actorUserId:seeded.director,signatureFileIdSnapshot:signatureReceipt.signatureFileId,signatureVersionIdSnapshot:signatureReceipt.signatureVersionId,signatureSha256Snapshot:signatureHash}]);
   expect(await observer.handwrittenSignatureVersion.findUnique({where:{id:signatureReceipt.signatureVersionId},select:{userId:true,fileId:true,contentSha256:true,source:true}})).toEqual({userId:seeded.director,fileId:signatureReceipt.signatureFileId,contentSha256:signatureHash,source:"canvas"});
   for(const token of [finance,keeper]){const list=await json("/payment-executions/work-items","GET",undefined,token);expect(list.body.items).toContainEqual(expect.objectContaining({paymentId:plan.ids.payment,paidAmountCents:"0",remainingAmountCents:"10000"}));const me=await json("/me/work-items","GET",undefined,token);expect(me.body.queues.pending).toContainEqual(expect.objectContaining({type:"payment_execution",businessId:plan.ids.payment}));const notifications=await json("/payment-executions/notifications","GET",undefined,token);expect(notifications.body.items).toContainEqual(expect.objectContaining({businessCode:payment.code,status:"queued"}));}
   await app.get(OperatingSourceReplayService).replaySource({projectId:plan.ids.project,sourceType:"settlement",sourceBusinessId:plan.ids.settlement},plan.ids.actor);
   const open=async(token:string,scopeKey:string)=>{const response=await json("/fund-accounts/openings","POST",{scopeKey,balanceYuan:"100",asOfDate:plan.openingDate,evidenceReference:"虚构期初",reconciliationNote:"虚构项目来源",reason:"隔离测试",idempotencyKey:randomUUID(),sources:[{amountYuan:"100",sourceStatus:"known",sourceName:"虚构项目资金",projectStatus:"project",projectId:plan.ids.project}]},token);expect(response.status).toBe(201);return response.body as {id:string;sources:Array<{id:string}>};};
   const a=await open(finance,`company:${plan.ids.companyA}`),b=await open(finance,`company:${plan.ids.companyB}`),cash=await open(keeper,"public_cash");
   const openingRows=await observer.fundAccountBalanceRegistration.findMany({where:{id:{in:[a.id,b.id,cash.id]}}});expect(openingRows).toHaveLength(3);for(const row of openingRows)expect(row.balanceYuan?.toFixed(4)).toBe("100.0000");
   const pay=async(token:string,scopeKey:string,opening:{id:string;sources:Array<{id:string}>},amountCents:string)=>{const options=await json(`/payment-executions/${plan.ids.payment}/registration-options`,"GET",undefined,token);expect(options.status).toBe(200);const key=randomUUID(),response=await json(`/payment-executions/${plan.ids.payment}/registrations`,"POST",{idempotencyKey:key,expectedPaymentUpdatedAt:options.body.expectedPaymentUpdatedAt,amountCents,paidAt:plan.paidAt,scopeKey,expectedRegistrationId:opening.id,openingTreatment:"not_included",openingReason:"虚构付款未含期初",openingEvidence:"隔离登记",sourceAllocations:[{sourceBatchId:opening.sources[0].id,amountCents}],confirmationPassword:token===finance?passwords[0]:passwords[1]},token);expect(response.status).toBe(201);return {key,id:response.body.id as string};};
   const companyB=await pay(finance,`company:${plan.ids.companyB}`,b,"3000"),companyA=await pay(keeper,`company:${plan.ids.companyA}`,a,"3000");
   for(const token of [finance,keeper])expect((await json("/payment-executions/work-items","GET",undefined,token)).body.items).toContainEqual(expect.objectContaining({paymentId:plan.ids.payment,paidAmountCents:"6000",remainingAmountCents:"4000"}));
   const final=await pay(keeper,"public_cash",cash,"4000");
   const accountView=await json("/fund-accounts","GET",undefined,finance);expect(accountView.status).toBe(200);
   for(const [scopeKey,balanceYuan] of [[`company:${plan.ids.companyA}`,"70.0000"],[`company:${plan.ids.companyB}`,"70.0000"],["public_cash","60.0000"]])expect(accountView.body.accounts).toContainEqual(expect.objectContaining({scopeKey,balanceYuan}));
   for(const token of [finance,keeper]){expect((await json("/payment-executions/work-items","GET",undefined,token)).body.items).not.toContainEqual(expect.objectContaining({paymentId:plan.ids.payment}));expect((await json("/me/work-items","GET",undefined,token)).body.queues.pending).not.toContainEqual(expect.objectContaining({type:"payment_execution",businessId:plan.ids.payment}));}
   const before=await json(`/payment-executions/results/${final.key}`,"GET",undefined,keeper);expect(before.body.execution).toMatchObject({executionId:final.id,voucherPending:true});
   const voucher=new FormData();voucher.append("file",new Blob([png],{type:"image/png"}),"voucher.png");voucher.append("idempotencyKey",randomUUID());
   const uploaded=await fetch(`${origin}/payment-executions/${final.id}/voucher-file-uploads`,{method:"POST",headers:{authorization:`Bearer ${keeper}`},body:voucher});expect(uploaded.status).toBe(201);const file=await uploaded.json();
   expect((await json(`/payment-executions/${final.id}/voucher`,"POST",{fileId:file.id},keeper)).status).toBe(201);
   const ticket=await json(`/payment-executions/${final.id}/voucher-ticket`,"GET",undefined,keeper);expect(ticket.status).toBe(200);const download=await fetch(new URL(ticket.body.downloadUrl,origin));expect(download.status).toBe(200);expect(Buffer.from(await download.arrayBuffer())).toEqual(png);
   const executions=await observer.paymentExecution.findMany({where:{paymentRequestId:plan.ids.payment}}),events=await observer.registeredPaymentEvent.findMany({where:{executionId:{in:executions.map(row=>row.id)}}});expect(executions).toHaveLength(3);expect(events).toHaveLength(3);expect(executions.reduce((sum,row)=>sum+row.amountCents,0n)).toBe(10000n);
   const executionIds=executions.map(row=>row.id),funding=await observer.registeredPaymentFunding.findMany({where:{executionId:{in:executionIds}}}),allocations=await observer.registeredFundPaymentAllocation.findMany({where:{executionId:{in:executionIds}}});
   expect(funding).toHaveLength(3);expect(allocations).toHaveLength(3);expect(allocations.reduce((sum,row)=>sum+row.amountCents,0n)).toBe(10000n);
   for(const [opening,expected] of [[a,3000n],[b,3000n],[cash,4000n]] as const)expect(allocations.filter(row=>row.sourceBatchId===opening.sources[0].id).reduce((sum,row)=>sum+row.amountCents,0n)).toBe(expected);
   const facts=await observer.operatingFact.findMany({where:{sourceType:"payment_execution",sourceBusinessId:{in:executionIds}}});expect(facts).toHaveLength(3);
   const impacts=await observer.operatingImpactEntry.findMany({where:{sourceType:"payment_execution",sourceBusinessId:{in:executionIds}},select:{factId:true,sourceBusinessId:true,projectId:true,impactKind:true,direction:true,amountCents:true,numericProtocolVersion:true}});
   for(const [executionId,amount,fundKind,proxy] of [[companyB.id,3000n,"company_project_funds_decrease",true],[companyA.id,3000n,"company_project_funds_decrease",false],[final.id,4000n,"public_cash_funds_decrease",false]] as const){
    const fact=facts.find(row=>row.sourceBusinessId===executionId);expect(fact).toBeDefined();
    const observed=impacts.filter(row=>row.sourceBusinessId===executionId);expect(observed).toHaveLength(proxy?3:2);
    const common={factId:fact!.id,projectId:plan.ids.project,sourceBusinessId:executionId,amountCents:amount,numericProtocolVersion:1};
    expect(observed).toContainEqual({...common,impactKind:"payable_decrease",direction:"decrease"});
    expect(observed).toContainEqual({...common,impactKind:fundKind,direction:"decrease"});
    if(proxy)expect(observed).toContainEqual({...common,impactKind:"inter_subject_balance_increase",direction:"increase"});
   }
   const audit=await observer.auditLog.findMany({where:{businessId:plan.ids.payment,action:"payment.execution.record"}});expect(audit).toHaveLength(3);
   expect(await observer.registeredPaymentVoucher.findUnique({where:{executionId:final.id}})).toMatchObject({fileId:file.id});
   expect((await observer.paymentRequest.findUniqueOrThrow({where:{id:plan.ids.payment}})).paidAmountCents).toBe(10000n);
  }finally{await app?.close();await Promise.all([owner.$disconnect(),runtime.$disconnect(),observer.$disconnect()]);}
 },120000);
});
