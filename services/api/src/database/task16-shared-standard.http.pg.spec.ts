import { createHash, randomUUID } from "node:crypto";
import { types } from "node:util";
import { hash } from "bcryptjs";
import { Prisma, PrismaClient } from "@prisma/client";
import { Test } from "@nestjs/testing";
import { Catch, ConflictException, Controller, Post, type ArgumentsHost, type INestApplication } from "@nestjs/common";
import { APP_FILTER, HttpAdapterHost } from "@nestjs/core";
import { Task16RegistrationErrorFilter, projectTask16RegistrationError } from "./task16-registration-error-diagnostic";
import { createApiValidationPipe } from "../validation/api-validation";
import { apiJsonReplacer } from "../api-json-replacer";
import { REGISTERED_PAYMENT_IMPACT_READER, readTask16RegisteredPaymentImpacts } from "../payment/registered-payment-impact-reader";
import { OperatingSourceReplayService } from "../operating-ledger/operating-source-replay.service";
import { PrismaService } from "./prisma.service";
import { Task16SharedPaymentApplicationModule } from "./task16-shared-payment-application";
import { buildRegisteredPgFixturePlan } from "./registered-payment-postgres.fixture";
import { seedSharedPaymentPredecessors } from "./task16-shared-standard-fixture";

const enabled=process.env.RUN_TASK398_SHARED_PG16 === "1";

// Fixed technical candidates from the existing reviewed file-binding plan;
// input text can only select an entry, never become a logged value.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const signatureRequirements:{readDelta:Record<string,unknown>;routineSources:Array<{signature:string}>}=require("../../prisma/task16-current259-voucher-acl.requirements.json");
const signatureTables=[...new Set([...Object.keys(signatureRequirements.readDelta),"User","ApprovalInstance","PaymentRequest","RegisteredPaymentVoucher"])].sort();
const signatureFunctions=[...new Set([...signatureRequirements.routineSources.map(row=>/^public\.(?:"([A-Za-z0-9_]+)"|([A-Za-z0-9_]+))\(/u.exec(row.signature)?.slice(1).find(Boolean)).filter((value):value is string=>!!value),"jg_has_exclusive_file_business_binding","jg_enforce_exclusive_file_business_binding","jg_enforce_file_replacement_exclusive_binding"])].sort();
type SignatureFailureDetail=ReturnType<typeof projectTask16RegistrationError> & {signatureFailureClass?:"PERMISSION"|"CONSTRAINT"|"TRIGGER"|"OTHER";signatureResource?:string};
function signatureFailureDetail(error:unknown):SignatureFailureDetail {
 const safe=projectTask16RegistrationError(error);
 if(safe.serverErrorKind!=="UNKNOWN_REQUEST_ERROR"||!error||typeof error!=="object"||types.isProxy(error))return safe;
 const descriptor=Object.getOwnPropertyDescriptor(error,"message"),message=typeof descriptor?.value==="string"?descriptor.value.slice(0,16384):"";
 const match=/(?:SQLSTATE\s*[:=]?\s*|SqlState\s*\(\s*E?|code\s*:\s*["']?)(42501|23502|23503|23505|23514|42P01|42703|P0001)\b/iu.exec(message);
 const signatureFailureClass=/permission denied|not authorized|insufficient privilege/iu.test(message)?"PERMISSION":
  /violat(?:es|ion)[\s\S]{0,200}constraint|constraint[\s\S]{0,200}violat/iu.test(message)?"CONSTRAINT":/\btrigger\b/iu.test(message)?"TRIGGER":"OTHER";
 let signatureResource:string|undefined;
 if(signatureFailureClass==="PERMISSION"){
  const resource=/permission denied for (table|relation|function|schema|sequence)\s+(?:(?:\\?"?public\\?"?)\.)?\\?"?([A-Za-z_][A-Za-z0-9_]*)/iu.exec(message);
  const kind=resource?.[1].toLowerCase(),name=resource?.[2];
  const tableIndex=name?signatureTables.indexOf(name):-1,functionIndex=name?signatureFunctions.indexOf(name):-1;
  signatureResource=kind==="schema"&&name==="public"?"SCHEMA_PUBLIC":(kind==="table"||kind==="relation")&&tableIndex>=0?`TABLE_${String(tableIndex+1).padStart(3,"0")}`:kind==="function"&&functionIndex>=0?`FUNCTION_${String(functionIndex+1).padStart(3,"0")}`:"OTHER";
 }
 return {...safe,...(match?{serverSqlState:match[1].toUpperCase()}:{}),signatureFailureClass,...(signatureResource?{signatureResource}:{})};
}

@Catch()
class SignatureFailureCapture extends Task16RegistrationErrorFilter {
 constructor(adapter:HttpAdapterHost,private readonly report:(detail:SignatureFailureDetail)=>void){super(adapter);}
 override catch(exception:unknown,host:ArgumentsHost){
  try{
   const request=host.switchToHttp().getRequest<{method?:string;originalUrl?:string}>();
   if(request.method==="POST"&&request.originalUrl==="/me/signature/canvas")this.report(signatureFailureDetail(exception));
  }catch{ /* Diagnostic failure must not change the original HTTP response. */ }
  super.catch(exception,host);
 }
}

it("captures only a safe signature error and always preserves the original exception path",()=>{
 const report=jest.fn(),parent=jest.spyOn(Task16RegistrationErrorFilter.prototype,"catch").mockImplementation(()=>{});
 const filter=new SignatureFailureCapture({} as HttpAdapterHost,report);
 const host=(url:string)=>({switchToHttp:()=>({getRequest:()=>({method:"POST",originalUrl:url})})}) as ArgumentsHost;
 const error=new Prisma.PrismaClientKnownRequestError("private detail",{code:"P2010",clientVersion:"test",meta:{code:"42501",secret:"private detail"}});
 try{
  filter.catch(error,host("/me/signature/canvas"));
  expect(report).toHaveBeenCalledWith({serverErrorKind:"KNOWN_REQUEST_ERROR",serverPrismaCode:"P2010",serverSqlState:"42501"});
  expect(parent).toHaveBeenCalledWith(error,expect.anything());
  report.mockClear();filter.catch(error,host("/unrelated"));expect(report).not.toHaveBeenCalled();
  report.mockImplementation(()=>{throw new Error("recording failed");});filter.catch(error,host("/me/signature/canvas"));
  expect(parent).toHaveBeenCalledTimes(3);
 }finally{parent.mockRestore();}
});

it("reduces unknown signature database errors to fixed categories without leaking their text",()=>{
 const report=jest.fn(),parent=jest.spyOn(Task16RegistrationErrorFilter.prototype,"catch").mockImplementation(()=>{});
 const filter=new SignatureFailureCapture({} as HttpAdapterHost,report);
 const host={switchToHttp:()=>({getRequest:()=>({method:"POST",originalUrl:"/me/signature/canvas"})})} as ArgumentsHost;
 try{
  const unknown=(message:string)=>new Prisma.PrismaClientUnknownRequestError(message,{clientVersion:"test"});
  filter.catch(unknown('private account X table Y: code: "42501", permission denied for table Y'),host);
  expect(report).toHaveBeenLastCalledWith({serverErrorKind:"UNKNOWN_REQUEST_ERROR",serverSqlState:"42501",signatureFailureClass:"PERMISSION",signatureResource:"OTHER"});
  filter.catch(unknown('private value Z code: "23514", violates check constraint secret_constraint'),host);
  expect(report).toHaveBeenLastCalledWith({serverErrorKind:"UNKNOWN_REQUEST_ERROR",serverSqlState:"23514",signatureFailureClass:"CONSTRAINT"});
  filter.catch(unknown("private value Z trigger failed"),host);
  expect(report).toHaveBeenLastCalledWith({serverErrorKind:"UNKNOWN_REQUEST_ERROR",signatureFailureClass:"TRIGGER"});
  filter.catch(unknown("private value Z 42501 without a database code"),host);
  expect(report).toHaveBeenLastCalledWith({serverErrorKind:"UNKNOWN_REQUEST_ERROR",signatureFailureClass:"OTHER"});
  filter.catch(unknown('private value Z code: "99999"'),host);
  expect(report).toHaveBeenLastCalledWith({serverErrorKind:"UNKNOWN_REQUEST_ERROR",signatureFailureClass:"OTHER"});
  const getter=unknown("synthetic");Object.defineProperty(getter,"message",{get(){throw new Error("private getter");}});
  filter.catch(getter,host);expect(report).toHaveBeenLastCalledWith({serverErrorKind:"UNKNOWN_REQUEST_ERROR",signatureFailureClass:"OTHER"});
  filter.catch(unknown('private value Z code: "42501", permission denied for table "FileObject"'),host);
  expect(report).toHaveBeenLastCalledWith({serverErrorKind:"UNKNOWN_REQUEST_ERROR",serverSqlState:"42501",signatureFailureClass:"PERMISSION",signatureResource:"TABLE_030"});
  filter.catch(unknown('private value Z code: "42501", permission denied for function jg_file_business_collision_columns'),host);
  expect(report).toHaveBeenLastCalledWith({serverErrorKind:"UNKNOWN_REQUEST_ERROR",serverSqlState:"42501",signatureFailureClass:"PERMISSION",signatureResource:"FUNCTION_025"});
  expect(JSON.stringify(report.mock.calls)).not.toMatch(/private|account X|table Y|FileObject|jg_file_business_collision_columns|secret_constraint|value Z/iu);
  expect(parent).toHaveBeenCalledTimes(8);
 }finally{parent.mockRestore();}
});

@Controller("me/signature")
class SignatureFailureTestController {
 @Post("canvas") fail(){throw new ConflictException("synthetic conflict");}
}
it("preserves the original HTTP status through the actual Nest filter",async()=>{
 const module=await Test.createTestingModule({controllers:[SignatureFailureTestController],providers:[{provide:APP_FILTER,useClass:Task16RegistrationErrorFilter}]}).compile();
 const app=module.createNestApplication({logger:false}),report=jest.fn();
 app.useGlobalFilters(new SignatureFailureCapture(app.get(HttpAdapterHost),report));
 try{await app.listen(0,"127.0.0.1");const response=await fetch(`${await app.getUrl()}/me/signature/canvas`,{method:"POST"});expect(response.status).toBe(409);expect(report).toHaveBeenCalledTimes(1);}
 finally{await app.close();}
});

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
   app=module.createNestApplication({logger:false});app.useGlobalFilters(new SignatureFailureCapture(app.get(HttpAdapterHost),detail=>console.error(`TASK398_SIGNATURE_FAILURE ${JSON.stringify(detail)}`)));app.getHttpAdapter().getInstance().set("json replacer",apiJsonReplacer);app.useGlobalPipes(createApiValidationPipe());await app.listen(0,"127.0.0.1");
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
