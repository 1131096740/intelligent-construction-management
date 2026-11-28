import { createHash, randomUUID } from "node:crypto";
import { appendFileSync } from "node:fs";
import { types } from "node:util";
import { hash } from "bcryptjs";
import { Prisma, PrismaClient } from "@prisma/client";
import { Test } from "@nestjs/testing";
import { Catch, ConflictException, Controller, HttpException, Post, type ArgumentsHost, type INestApplication } from "@nestjs/common";
import { APP_FILTER, HttpAdapterHost } from "@nestjs/core";
import { Task16RegistrationErrorFilter, projectTask16RegistrationError } from "./task16-registration-error-diagnostic";
import { createApiValidationPipe } from "../validation/api-validation";
import { apiJsonReplacer } from "../api-json-replacer";
import { projectOperatingConstraintMessage, PROJECT_OPERATING_CONSTRAINT_MESSAGES } from "../project/project-operating-constraint";
import { REGISTERED_PAYMENT_IMPACT_READER, readTask16RegisteredPaymentImpacts } from "../payment/registered-payment-impact-reader";
import { OperatingSourceReplayService } from "../operating-ledger/operating-source-replay.service";
import { AuditService } from "../audit/audit.service";
import { AuthService } from "../auth/auth.service";
import { ProjectVisibilityService } from "../auth/project-visibility.service";
import { ContractBankVerificationService } from "../contract-ledger/contract-bank-verification.service";
import * as projectAdvancePlanning from "../payment/registered-payment-project-advance";
import { PrismaService } from "./prisma.service";
import { registeredPaymentInstalled } from "./registered-payment-catalog";
import { Task16SharedPaymentApplicationModule } from "./task16-shared-payment-application";
import { buildRegisteredPgFixturePlan } from "./registered-payment-postgres.fixture";
import { seedSharedPaymentPredecessors } from "./task16-shared-standard-fixture";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const approvalPgLog:{capture:(env:NodeJS.ProcessEnv)=>string|null;finish:(before:string|null,after:string|null,env:NodeJS.ProcessEnv)=>string}=require("../../prisma/task398-approval-postgres-error.cjs");
async function observedMeRequest<T>(request:()=>Promise<T>,index:number,env:NodeJS.ProcessEnv=process.env):Promise<T>{
 const logEnv={...env,TASK398_LOG_FILE:env.TASK398_LOG_FILE?`${env.TASK398_LOG_FILE}.me-${index}`:undefined};
 const before=approvalPgLog.capture(logEnv);
 try{return await request();}
 finally{const result=approvalPgLog.finish(before,approvalPgLog.capture(logEnv),logEnv);console.error(`TASK398_ME_PG_OBJECT ${result}`);}
}

const enabled=process.env.RUN_TASK398_SHARED_PG16 === "1";
const overpay=process.env.TASK398_OVERPAY_MODE==="1";
const ledgerLoss=process.env.TASK398_LEDGER_LOSS_MODE==="1";
const transferRejection=process.env.TASK406_TRANSFER_MODE==="rejection";
const transferBrowser=process.env.TASK406_TRANSFER_MODE==="browser";
const advanceMode=process.env.RUN_TASK408_ADVANCE_PG16==="1";
const transferMode=process.env.TASK406_TRANSFER_MODE==="1"||transferRejection||transferBrowser;

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
 constructor(adapter:HttpAdapterHost,private readonly report:(detail:SignatureFailureDetail)=>void,private readonly approval?:{path:string;report:(detail:SignatureFailureDetail)=>void},private readonly workItemsReport?:(detail:SignatureFailureDetail)=>void){super(adapter);}
 override catch(exception:unknown,host:ArgumentsHost){
  try{
   const request=host.switchToHttp().getRequest<{method?:string;originalUrl?:string}>();
   if(request.method==="POST"&&request.originalUrl==="/me/signature/canvas")this.report(signatureFailureDetail(exception));
   else if(request.method==="POST"&&this.approval&&request.originalUrl===this.approval.path)this.approval.report(signatureFailureDetail(exception));
   else if(request.method==="GET"&&request.originalUrl==="/me/work-items"&&this.workItemsReport&&(!(exception instanceof HttpException)||exception.getStatus()===500)&&!projectOperatingConstraintMessage(exception))this.workItemsReport(signatureFailureDetail(exception));
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

it("keeps each work-item log window distinct and preserves request outcomes",async()=>{
 const capture=jest.spyOn(approvalPgLog,"capture").mockReturnValue("before\n"),finish=jest.spyOn(approvalPgLog,"finish").mockReturnValue("UNKNOWN"),log=jest.spyOn(console,"error").mockImplementation(()=>{});
 try{const env={TASK398_LOG_FILE:"/private/synthetic"};expect(await observedMeRequest(async()=>({status:200}),1,env)).toEqual({status:200});
  await expect(observedMeRequest(async()=>{throw new Error("synthetic");},2,env)).rejects.toThrow("synthetic");
  expect(finish.mock.calls.map(call=>call[2].TASK398_LOG_FILE)).toEqual(["/private/synthetic.me-1","/private/synthetic.me-2"]);
 }finally{capture.mockRestore();finish.mockRestore();log.mockRestore();}
});

it("captures only work-items 500 errors without leaking error text",()=>{
 const report=jest.fn(),parent=jest.spyOn(Task16RegistrationErrorFilter.prototype,"catch").mockImplementation(()=>{});
 const filter=new SignatureFailureCapture({} as HttpAdapterHost,()=>{},undefined,report);
 const host=(method:string,url:string)=>({switchToHttp:()=>({getRequest:()=>({method,originalUrl:url})})}) as ArgumentsHost;
 const error=new Prisma.PrismaClientUnknownRequestError('private data code: "42501", permission denied for table "FileObject"',{clientVersion:"test"});
 try{filter.catch(error,host("GET","/me/work-items"));expect(report).toHaveBeenCalledWith({serverErrorKind:"UNKNOWN_REQUEST_ERROR",serverSqlState:"42501",signatureFailureClass:"PERMISSION",signatureResource:"TABLE_030"});
  expect(JSON.stringify(report.mock.calls)).not.toMatch(/private|FileObject/u);report.mockClear();
  filter.catch(error,host("GET","/me/work-items?x=1"));filter.catch(error,host("POST","/me/work-items"));filter.catch(new ConflictException(),host("GET","/me/work-items"));
  const mapped=new Prisma.PrismaClientUnknownRequestError(`PostgresError { code: "23514", message: ${JSON.stringify(PROJECT_OPERATING_CONSTRAINT_MESSAGES[0])}, severity:`,{clientVersion:"test"});
  filter.catch(mapped,host("GET","/me/work-items"));expect(report).not.toHaveBeenCalled();expect(parent).toHaveBeenCalledTimes(5);
 }finally{parent.mockRestore();}
});

it("captures only the bound approval path without logging its coordinate",()=>{
 const report=jest.fn(),signatureReport=jest.fn(),parent=jest.spyOn(Task16RegistrationErrorFilter.prototype,"catch").mockImplementation(()=>{});
 const path="/payments/10000000-0000-4000-8000-000000000001/approval";
 const filter=new SignatureFailureCapture({} as HttpAdapterHost,signatureReport,{path,report});
 const host=(url:string)=>({switchToHttp:()=>({getRequest:()=>({method:"POST",originalUrl:url})})}) as ArgumentsHost;
 const error=new Prisma.PrismaClientUnknownRequestError('private value code: "42501", permission denied for table "FileObject"',{clientVersion:"test"});
 try{
  filter.catch(error,host(path));expect(report).toHaveBeenCalledWith({serverErrorKind:"UNKNOWN_REQUEST_ERROR",serverSqlState:"42501",signatureFailureClass:"PERMISSION",signatureResource:"TABLE_030"});
  expect(signatureReport).not.toHaveBeenCalled();expect(JSON.stringify(report.mock.calls)).not.toMatch(/private|FileObject|10000000/iu);
  report.mockClear();filter.catch(error,host(`${path}?other=1`));filter.catch(error,host("/payments/10000000-0000-4000-8000-000000000002/approval"));expect(report).not.toHaveBeenCalled();
  report.mockImplementation(()=>{throw new Error("recording failed");});filter.catch(error,host(path));expect(parent).toHaveBeenCalledTimes(4);
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
@Controller("payments")
class ApprovalFailureTestController {
 @Post(":id/approval") fail(){throw new ConflictException("synthetic conflict");}
}
it("preserves the original HTTP status through the actual Nest filter",async()=>{
 const module=await Test.createTestingModule({controllers:[SignatureFailureTestController],providers:[{provide:APP_FILTER,useClass:Task16RegistrationErrorFilter}]}).compile();
 const app=module.createNestApplication({logger:false}),report=jest.fn();
 app.useGlobalFilters(new SignatureFailureCapture(app.get(HttpAdapterHost),report));
 try{await app.listen(0,"127.0.0.1");const response=await fetch(`${await app.getUrl()}/me/signature/canvas`,{method:"POST"});expect(response.status).toBe(409);expect(report).toHaveBeenCalledTimes(1);}
 finally{await app.close();}
});
it("preserves the original approval HTTP status with the existing APP_FILTER",async()=>{
 const module=await Test.createTestingModule({controllers:[ApprovalFailureTestController],providers:[{provide:APP_FILTER,useClass:Task16RegistrationErrorFilter}]}).compile();
 const app=module.createNestApplication({logger:false}),report=jest.fn(),path="/payments/10000000-0000-4000-8000-000000000001/approval";
 app.useGlobalFilters(new SignatureFailureCapture(app.get(HttpAdapterHost),()=>{},{path,report}));
 try{await app.listen(0,"127.0.0.1");const response=await fetch(`${await app.getUrl()}${path}`,{method:"POST"});expect(response.status).toBe(409);expect(report).toHaveBeenCalledTimes(1);}
 finally{await app.close();}
});

(enabled?describe:describe.skip)("#398 isolated shared payment real HTTP and PostgreSQL",()=>{
 it(advanceMode ? "preserves actual advance origins and records one confirmed own-company payment gap" : transferRejection ? "distinguishes a fresh no-write rejection from a committed missing response" : transferMode ? "shares one cash transfer across receipt, rejection, return and actual payment contention" : overpay ? "allows only one of two concurrent instalments that would together overpay" : ledgerLoss ? "recovers and replays cross-company project payment after losing a committed response" : "rejects a project source gap, then shares three valid instalments and supplements the voucher",async()=>{
  const ownerUrl=new URL(process.env.TASK398_OWNER_URL??""),runtimeUrl=new URL(process.env.DATABASE_URL??""),observerUrl=new URL(process.env.TASK398_OBSERVER_URL??"");
  const db=ownerUrl.pathname;
  const runId=process.env.TASK398_RUN_ID??"";
  if(process.env.NODE_ENV!=="test"||![ownerUrl,runtimeUrl,observerUrl].every(url=>url.hostname==="127.0.0.1"&&url.port===ownerUrl.port&&url.pathname===db)||db!=="/jiangkong_payment_execution_concurrency"||!/^[a-f0-9]{32}$/u.test(runId)||ownerUrl.username!=="jg_task01_owner"||runtimeUrl.username!=="jg_task01_runtime"||observerUrl.username!=="jg_task01_observer")throw new Error("TASK398_ISOLATED_DATABASE_REQUIRED");
  const owner=new PrismaClient({datasources:{db:{url:ownerUrl.href}}}),runtime=new PrismaClient({datasources:{db:{url:runtimeUrl.href}}}),observer=new PrismaClient({datasources:{db:{url:observerUrl.href}}});
  let app:INestApplication | undefined;
  try{
   const identity=async(client:PrismaClient)=>client.$queryRaw<Array<{database:string;role:string;superuser:boolean;runId:string;app:string}>>`SELECT current_database() AS database,current_user::text AS role,(SELECT rolsuper FROM pg_roles WHERE rolname=current_user) AS superuser,current_setting('jg.task398_run_id',true) AS "runId",current_setting('application_name') AS app`;
   const [o,r,v]=await Promise.all([identity(owner),identity(runtime),identity(observer)]);
   expect(o[0]).toMatchObject({database:db.slice(1),role:"jg_task01_owner",runId});expect(r[0]).toMatchObject({database:db.slice(1),role:"jg_task01_runtime",superuser:false,runId,app:"jg398_runtime"});expect(v[0]).toMatchObject({database:db.slice(1),role:"jg_task01_observer",superuser:false,runId});
   expect(await runtime.$transaction(tx=>registeredPaymentInstalled(tx))).toBe(true);
   const plan=buildRegisteredPgFixturePlan(runId.slice(0,12),"2026-11-07","2026-11-01"),passwords=[randomUUID(),randomUUID(),randomUUID(),randomUUID()];
   const hashes=await Promise.all(passwords.map(value=>hash(value,10)));
   const seeded=await seedSharedPaymentPredecessors(owner,plan,{financeHash:hashes[0],keeperHash:hashes[1],directorHash:hashes[2]},process.env.FILE_STORAGE_ROOT??"");
   const outsiderPhone=`196${plan.phone.slice(3)}`;
   await owner.user.create({data:{id:randomUUID(),phone:outsiderPhone,name:"合成无权账号",passwordHash:hashes[3],isActive:true,mustChangePassword:false}});
   const module=await Test.createTestingModule({imports:[Task16SharedPaymentApplicationModule]}).overrideProvider(PrismaService).useValue(runtime).overrideProvider(REGISTERED_PAYMENT_IMPACT_READER).useValue(readTask16RegisteredPaymentImpacts).compile();
   app=module.createNestApplication({logger:false});app.useGlobalFilters(new SignatureFailureCapture(app.get(HttpAdapterHost),detail=>console.error(`TASK398_SIGNATURE_FAILURE ${JSON.stringify(detail)}`),{path:`/payments/${plan.ids.payment}/approval`,report:detail=>console.error(`TASK398_APPROVAL_FAILURE ${JSON.stringify(detail)}`)},detail=>console.error(`TASK398_ME_FAILURE ${JSON.stringify(detail)}`)));app.getHttpAdapter().getInstance().set("json replacer",apiJsonReplacer);app.useGlobalPipes(createApiValidationPipe());
   if(transferMode){
    const capturePath=process.env.TASK406_PRIVATE_FAILURE_PATH??"";
    if(!capturePath)throw new Error("TASK406_PRIVATE_FAILURE_PATH");
    class TransferFailureCapture extends Task16RegistrationErrorFilter {
     override catch(error:unknown,host:ArgumentsHost){
      const request=host.switchToHttp().getRequest<{method?:string;originalUrl?:string}>();
      if(request.method==="POST"&&request.originalUrl?.startsWith("/fund-account-transfers")&&error instanceof Error&&(!(error instanceof HttpException)||error.getStatus()>=500)){
       try{
        const safe=projectTask16RegistrationError(error);
        const httpStatus=error instanceof HttpException?error.getStatus():500;
        const response=error instanceof HttpException?error.getResponse():undefined;
        const freezeCode=typeof response==="object"&&response&&"code" in response&&
          ["OPERATIONAL_WRITE_FREEZE_ROUTE_UNCLASSIFIED","OPERATIONAL_WRITE_FREEZE_ACTIVE"].includes(String(response.code))?response.code:undefined;
        appendFileSync(capturePath,JSON.stringify({route:"fund-account-transfers",httpStatus,...safe,freezeCode,message:error.message.slice(0,8192),stack:error.stack?.slice(0,16384)})+"\n",{mode:0o600,flag:"a"});
        console.error("TASK406_FAILURE",JSON.stringify({httpStatus,...safe,freezeCode}));
       }catch{ /* Keep the original HTTP failure. */ }
      }
      super.catch(error,host);
     }
    }
    app.useGlobalFilters(new TransferFailureCapture(app.get(HttpAdapterHost)));
   }
   let waiting:Array<()=>void>|undefined,barrierTimer:NodeJS.Timeout|undefined,arrivals=0,barrierExpired=false;
   if(overpay||transferMode)app.use((req:{method:string;url:string},_res:unknown,next:()=>void)=>{
    if(!waiting||req.method!=="POST"||![`/payment-executions/${plan.ids.payment}/registrations`,...(transferMode?["/fund-account-transfers"]:[])].includes(req.url))return next();
    waiting.push(next);arrivals++;
    const release=()=>{
     const ready=waiting;
     waiting=undefined;
     ready?.forEach(proceed=>proceed());
    };
    if(waiting.length===1)barrierTimer=setTimeout(()=>{barrierExpired=true;release();},5000);
    else {clearTimeout(barrierTimer);release();}
   });
   await app.listen(0,"127.0.0.1");
   const origin=await app.getUrl();
   const json=async(path:string,method:string,body?:unknown,token?:string,send=fetch)=>{const response=await send(origin+path,{method,headers:{...(body!==undefined?{"content-type":"application/json"}:{}),...(token?{authorization:`Bearer ${token}`}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});return {status:response.status,body:await response.json()};};
   const login=async(phone:string,password:string)=>{const response=await json("/auth/login","POST",{phone,password});expect(response.status).toBe(201);return response.body.tokens.accessToken as string;};
   const finance=await login(plan.phone,passwords[0]),keeper=await login(seeded.keeperPhone,passwords[1]),director=await login(seeded.directorPhone,passwords[2]),outsider=await login(outsiderPhone,passwords[3]);
   const denied=await json(`/payment-executions/recorded-items?paymentId=${plan.ids.payment}`,"GET",undefined,outsider);expect(denied.status).toBe(403);
   const png=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=","base64"),signature=new FormData();signature.append("file",new Blob([png],{type:"image/png"}),"signature.png");
   const signatureResponse=await fetch(origin+"/me/signature/canvas",{method:"POST",headers:{authorization:`Bearer ${director}`},body:signature});expect(signatureResponse.status).toBe(201);
   const signatureReceipt=await signatureResponse.json() as {signatureFileId:string;signatureVersionId:string};
   const payment=await observer.paymentRequest.findUniqueOrThrow({where:{id:plan.ids.payment}}),round=await observer.approvalInstance.findUniqueOrThrow({where:{id:plan.ids.approvedRound}});
   const logBefore=approvalPgLog.capture(process.env);
   let approved:Awaited<ReturnType<typeof json>>;
   try{approved=await json(`/payments/${plan.ids.payment}/approval`,"POST",{decision:"approve",expectedPaymentUpdatedAt:payment.updatedAt.toISOString(),expectedApprovalInstanceId:round.id,expectedNodeIndex:0,expectedApprovalUpdatedAt:round.updatedAt.toISOString()},director);}
   finally{const object=approvalPgLog.finish(logBefore,approvalPgLog.capture(process.env),process.env);console.error(`TASK398_APPROVAL_PG_OBJECT ${object}`);}
   expect(approved.status).toBe(201);
   const signatureHash=createHash("sha256").update(png).digest("hex");
   const actions=await observer.approvalActionLog.findMany({where:{approvalInstanceId:round.id,action:"approve"},select:{actorUserId:true,signatureFileIdSnapshot:true,signatureVersionIdSnapshot:true,signatureSha256Snapshot:true}});
   expect(actions).toEqual([{actorUserId:seeded.director,signatureFileIdSnapshot:signatureReceipt.signatureFileId,signatureVersionIdSnapshot:signatureReceipt.signatureVersionId,signatureSha256Snapshot:signatureHash}]);
   expect(await observer.handwrittenSignatureVersion.findUnique({where:{id:signatureReceipt.signatureVersionId},select:{userId:true,fileId:true,contentSha256:true,source:true}})).toEqual({userId:seeded.director,fileId:signatureReceipt.signatureFileId,contentSha256:signatureHash,source:"canvas"});
   let meWindowIndex=0;
   for(const token of [finance,keeper]){const list=await json("/payment-executions/work-items","GET",undefined,token);expect(list.body.items).toContainEqual(expect.objectContaining({paymentId:plan.ids.payment,paidAmountCents:"0",remainingAmountCents:"10000"}));const me=await observedMeRequest(()=>json("/me/work-items","GET",undefined,token),++meWindowIndex);expect(me.status).toBe(200);expect(me.body.queues.pending).toContainEqual(expect.objectContaining({type:"payment_execution",businessId:plan.ids.payment}));const notifications=await json("/payment-executions/notifications","GET",undefined,token);expect(notifications.body.items).toContainEqual(expect.objectContaining({businessCode:payment.code,status:"queued"}));}
   await app.get(OperatingSourceReplayService).replaySource({projectId:plan.ids.project,sourceType:"settlement",sourceBusinessId:plan.ids.settlement},plan.ids.actor);
   const otherProjectId=randomUUID();
   await owner.project.create({data:{id:otherProjectId,code:`T16-${plan.runId}-OTHER`,name:"虚构其他项目",isActive:true}});
   const bScope=`company:${plan.ids.companyB}`;
   const projectSource=(projectId:string,amountYuan:string)=>({amountYuan,sourceStatus:"known",sourceName:"虚构项目资金",projectStatus:"project",projectId});
   type Opening={id:string;sources:Array<{id:string;projectId:string}>};
   const open=async(token:string,scopeKey:string,sources=[projectSource(plan.ids.project,"100")])=>{
    const response=await json("/fund-accounts/openings","POST",{scopeKey,balanceYuan:"100",asOfDate:plan.openingDate,evidenceReference:"虚构期初",reconciliationNote:"虚构项目来源",reason:"隔离测试",idempotencyKey:randomUUID(),sources},token);
    expect(response.status).toBe(201);
    return response.body as Opening;
   };
   const a=await open(finance,`company:${plan.ids.companyA}`),b=await open(finance,bScope,[projectSource(plan.ids.project,"97"),projectSource(otherProjectId,"3")]),cash=await open(keeper,"public_cash");
   const openingRows=await observer.fundAccountBalanceRegistration.findMany({where:{id:{in:[a.id,b.id,cash.id]}}});expect(openingRows).toHaveLength(3);for(const row of openingRows)expect(row.balanceYuan?.toFixed(4)).toBe("100.0000");
   const registrationOptions=async(token:string)=>{
    const options=await json(`/payment-executions/${plan.ids.payment}/registration-options`,"GET",undefined,token);
    expect(options.status).toBe(200);
    return options.body;
   };
   const registrationRoute=`/payment-executions/${plan.ids.payment}/registrations`;
   const command=async(token:string,scopeKey:string,opening:Opening,amountCents:string,sourceAllocations:Array<{sourceBatchId:string;amountCents:string}>,expectedPaymentUpdatedAt?:string)=>({
    idempotencyKey:randomUUID(),expectedPaymentUpdatedAt:expectedPaymentUpdatedAt??(await registrationOptions(token)).expectedPaymentUpdatedAt,amountCents,paidAt:plan.paidAt,scopeKey,expectedRegistrationId:opening.id,openingTreatment:"not_included",openingReason:"虚构付款未含期初",openingEvidence:"隔离登记",sourceAllocations,confirmationPassword:token===finance?passwords[0]:passwords[1]
   });
   const submit=async(...args:Parameters<typeof command>)=>{
    const body=await command(...args);
    const response=await json(registrationRoute,"POST",body,args[0]);
    return {key:body.idempotencyKey,response,body};
   };
   if (advanceMode) {
    const companyScope = `company:${plan.ids.companyA}`;
    const receiptPath = "/fund-account-advance-receipts";
    const transferPath = "/fund-account-transfers";
    const receivedOn = plan.paidAt.slice(0, 10);
    const beforeFacts = await observer.operatingFact.count();
    const intent = {
      scopeKey: "public_cash", expectedRegistrationId: cash.id, idempotencyKey: randomUUID(),
      contributorKind: "person", contributorName: "虚构出资人", projectId: plan.ids.project,
      amountYuan: "5.0001", receivedOn, evidenceReference: "虚构到账凭据"
    };
    const received = await json(receiptPath, "POST", intent, keeper);
    expect(received).toMatchObject({ status: 201, body: { amountYuan: "5.0001", registeredBalanceYuan: "105.0001" } });
    expect(await json(receiptPath, "POST", intent, keeper)).toEqual(received);
    expect(await json(receiptPath, "POST", { ...intent, amountYuan: "6.0000" }, keeper)).toMatchObject({ status: 409 });

    const transfer = await json(transferPath, "POST", {
      sourceScopeKey: "public_cash", destinationScopeKey: companyScope,
      expectedRegistrationId: received.body.registrationId, idempotencyKey: randomUUID(), transferredOn: receivedOn,
      evidenceReference: "虚构现金转款", lines: [{ sourceBatchId: received.body.sourceBatchId, amountYuan: "5.0001" }]
    }, keeper);
    expect(transfer).toMatchObject({ status: 201, body: { status: "pending_receipt" } });
    expect(await json(`${transferPath}/${transfer.body.id}/actions`, "POST", {
      idempotencyKey: randomUUID(), expectedRevision: 1, action: "confirm", evidenceReference: "虚构公司确认收款"
    }, finance)).toMatchObject({ status: 201, body: { status: "received" } });
    expect(await observer.operatingFact.count()).toBe(beforeFacts);

    const readAccount = () => json(`/fund-accounts/${encodeURIComponent(companyScope)}`, "GET", undefined, finance);
    const afterTransfer = await readAccount();
    expect(afterTransfer).toMatchObject({ status: 200, body: { balanceYuan: "105.0001" } });

    // Bank verification uses the existing formal service and synthetic evidence.
    const bank = new ContractBankVerificationService(owner as never, new ProjectVisibilityService(owner as never),
      app.get(AuthService), new AuditService());
    const company = await owner.companyEntity.findUniqueOrThrow({ where: { id: plan.ids.companyA } });
    const bankFile = (userId: string) => owner.fileObject.create({ data: {
      bucket: "task408", objectKey: `task408/${randomUUID()}`, originalName: "虚构银行核验.pdf",
      mimeType: "application/pdf", sizeBytes: 1,
      uploadedByUserId: userId, storageStatus: "active", contentSha256: "b".repeat(64)
    } });
    const transactionFile = await bankFile(plan.ids.actor);
    const holderFile = await bankFile(seeded.director);
    const accountNumber = "1000000000000123";
    const verification = await bank.prepare(plan.ids.actor, {
      projectId: null, companyEntityId: company.id, accountNumber, bankReference: `TASK408-${runId}`,
      direction: "inflow", amountCents: "300", occurredAt: plan.paidAt, evidenceFileId: transactionFile.id,
      reason: "虚构公司自有款到账", idempotencyKey: randomUUID(), confirmationPassword: passwords[0]
    });
    await bank.decide(seeded.director, verification.id, {
      decision: "confirm", holderEvidenceFileId: holderFile.id, accountNumber, confirmationPassword: passwords[2]
    });
    const ownIntent = {
      scopeKey: companyScope, expectedRegistrationId: afterTransfer.body.currentRegistrationId, idempotencyKey: randomUUID(),
      observationReference: `contract-bank:${verification.id}`, ownershipEvidence: "虚构自有本金依据"
    };
    expect((await json(receiptPath + "/company-owned", "POST", ownIntent, finance)).status).toBe(403);
    const owned = await json(receiptPath + "/company-owned", "POST", ownIntent, director);
    expect(owned).toMatchObject({ status: 201, body: { amountYuan: "3.0000", registeredBalanceYuan: "108.0001" } });
    expect(await json(receiptPath + "/company-owned", "POST", ownIntent, director)).toEqual(owned);
    expect((await json(receiptPath + "/company-owned", "POST", {
      ...ownIntent, idempotencyKey: randomUUID(), expectedRegistrationId: owned.body.registrationId
    }, director)).status).toBe(409);

    const account = await readAccount();
    expect(account.status).toBe(200);
    const named = account.body.sources.find((source: { originalContributorName?: string }) => source.originalContributorName === "虚构出资人");
    expect(named?.amountYuan).toBe("5.0001");
    const paymentInput = await command(finance, companyScope, { id: owned.body.registrationId, sources: [] }, "800",
      [{ sourceBatchId: named.id, amountCents: "500" }]);
    const mixed = { ...paymentInput, sourceAllocations: [...paymentInput.sourceAllocations,
      { sourceBatchId: owned.body.sourceBatchId, amountCents: "300" }] };
    expect(await json(registrationRoute, "POST", mixed, finance)).toMatchObject({
      status: 409, body: { code: "REGISTERED_PROJECT_ADVANCE_CONFIRMATION_REQUIRED", differenceCents: "300" }
    });
    // Independently exercise the database fence even if the app's ordinary mixed-allocation check is absent.
    const useDatabaseCheck = jest.spyOn(projectAdvancePlanning, "planRegisteredProjectAdvance").mockReturnValueOnce(null);
    try {
      const blocked = await json(registrationRoute, "POST", mixed, finance);
      expect(blocked.status).toBeGreaterThanOrEqual(400);
      expect(useDatabaseCheck).toHaveBeenCalledTimes(1);
      expect(await observer.paymentExecution.count({ where: { idempotencyKey: mixed.idempotencyKey } })).toBe(0);
    } finally {
      useDatabaseCheck.mockRestore();
    }

    const full = { ...paymentInput, confirmedProjectAdvance: {
      amountCents: "300", reason: "核对真实付款差额", evidence: "虚构银行依据",
      sourceAllocations: [{ sourceBatchId: owned.body.sourceBatchId, amountCents: "300" }]
    } };
    const paid = await json(registrationRoute, "POST", full, finance);
    expect(paid).toMatchObject({ status: 201, body: { amountCents: "800" } });
    expect(await json(registrationRoute, "POST", full, finance)).toEqual(paid);
    expect(await observer.registeredPaymentProjectAdvance.findMany()).toEqual([expect.objectContaining({
      executionId: paid.body.id, projectId: plan.ids.project, creditorCompanyId: company.id, amountCents: 300n,
      companyAllocations: full.confirmedProjectAdvance.sourceAllocations
    })]);
    expect(await observer.registeredFundAdvanceReceipt.count()).toBe(2);
    expect(await observer.registeredFundCompanyOwnedReceipt.count()).toBe(1);
    expect((await readAccount()).body.balanceYuan).toBe("100.0001");
    return;
   }
   if(transferMode){
    const beforeLedger=await observer.$transaction(async tx=>({
     facts:await tx.operatingFact.count(),impacts:await tx.operatingImpactEntry.count()
    }),{isolationLevel:"RepeatableRead"});
    const cashScope="public_cash",aScope=`company:${plan.ids.companyA}`,transferPath="/fund-account-transfers";
    const balance=async(scope:string)=>{
     const response=await json(`/fund-accounts/${encodeURIComponent(scope)}`,"GET",undefined,finance);
     expect(response.status).toBe(200);
     return response.body as { balanceYuan:string; currentRegistrationId:string;sources:Array<{id:string;amountYuan:string;projectId:string}> };
    };
    const readBalances=async(cashAmount:string,companyAmount:string)=>{
     expect((await balance(cashScope)).balanceYuan).toBe(cashAmount);
     expect((await balance(aScope)).balanceYuan).toBe(companyAmount);
    };
    const transferCommand=(sourceScopeKey:string,destinationScopeKey:string,expectedRegistrationId:string,sourceBatchId:string,amountYuan:string)=>({
     sourceScopeKey,destinationScopeKey,expectedRegistrationId,transferredOn:plan.paidAt.slice(0,10),
     idempotencyKey:randomUUID(),evidenceReference:"虚构线下交款凭据",lines:[{sourceBatchId,amountYuan}]
    });
    if(transferRejection){
     const stale=transferCommand(cashScope,aScope,randomUUID(),cash.sources[0].id,"20.0001");
     const actionCount=()=>observer.$transaction(async tx=>{
      await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
      const openings=await tx.fundAccountBalanceRegistration.findMany({
       where:{id:{in:[cash.id,a.id]}},select:{id:true,balanceYuan:true},orderBy:{id:"asc"}
      });
      return {actions:await tx.registeredFundTransferAction.count(),transfers:await tx.registeredFundTransfer.count(),
       openings:openings.map(row=>row.balanceYuan?.toFixed(4))};
     },{isolationLevel:"RepeatableRead"});
     const initialCount=await actionCount();
     expect(initialCount).toEqual({actions:0,transfers:0,openings:["100.0000","100.0000"]});
     const denied=await json(transferPath,"POST",stale,keeper);
     expect(denied).toMatchObject({status:409,body:{statusCode:409,code:"FUND_ACCOUNT_TRANSFER_REJECTED_NO_WRITE"}});
     expect(await actionCount()).toEqual(initialCount);
     await readBalances("100.0000","100.0000");

     const input=transferCommand(cashScope,aScope,cash.id,cash.sources[0].id,"20.0001");
     let upstreamStatus:number|undefined;
     const loseResponse:typeof fetch=async (url,request)=>{
      const response=await fetch(url,request);
      upstreamStatus=response.status;
      await response.body?.cancel();
      throw new TypeError("synthetic response loss");
     };
     await expect(json(transferPath,"POST",input,keeper,loseResponse)).rejects.toThrow("synthetic response loss");
     expect(upstreamStatus).toBe(201);
     const action=await observer.$transaction(async tx=>{
      await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
      return tx.registeredFundTransferAction.findUniqueOrThrow({where:{idempotencyKey:input.idempotencyKey}});
     },{isolationLevel:"RepeatableRead"});
     expect(await json(transferPath,"POST",input,keeper)).toMatchObject({
      status:201,body:{id:action.transferId,revision:1,status:"pending_receipt"}
     });
     expect(await actionCount()).toEqual({actions:1,transfers:1,openings:initialCount.openings});
     await readBalances("79.9999","100.0000");
     const confirmationPath = `${transferPath}/${action.transferId}/actions`;
     const confirmationCommands = [randomUUID(), randomUUID()].map(idempotencyKey => ({
       idempotencyKey, expectedRevision: 1, action: "confirm", evidenceReference: "虚构到账核对"
     }));
     const confirmations = await Promise.all(confirmationCommands.map(command => json(confirmationPath, "POST", command, finance)));
     expect(confirmations.map(response => response.status).sort()).toEqual([201, 409]);
     const winner = confirmations.findIndex(response => response.status === 201);
     const loser = 1 - winner;
     const losingReplay = await json(confirmationPath, "POST", confirmationCommands[loser], finance);
     expect(losingReplay).toMatchObject({ status: 409, body: { code: "FUND_ACCOUNT_TRANSFER_COMMAND_SUPERSEDED" } });
     expect(await json(confirmationPath, "POST", confirmationCommands[winner], finance)).toEqual(confirmations[winner]);
     expect(await observer.registeredFundTransferAction.count({ where: { idempotencyKey: confirmationCommands[loser].idempotencyKey } })).toBe(0);
     const oldRegistrationReplay = await json(transferPath, "POST", { ...input, idempotencyKey: randomUUID() }, keeper);
     expect(oldRegistrationReplay).toMatchObject({ status: 409, body: { code: "FUND_ACCOUNT_TRANSFER_COMMAND_SUPERSEDED" } });
     expect(await json(transferPath, "POST", input, keeper)).toMatchObject({ status: 201, body: { id: action.transferId, revision: 1 } });
     await readBalances("79.9999", "120.0001");
     console.info("TASK406_SUPERSEDED_WITNESS", JSON.stringify({
       firstStatuses: confirmations.map(response => response.status), losingReplay: losingReplay.status,
       staleRegistration: oldRegistrationReplay.status, confirmedCompany: "120.0001"
     }));
     console.info("TASK406_REJECTION_WITNESS",JSON.stringify({
      staleHttp:409,staleCode:denied.body.code,staleActions:0,staleTransferCount:0,cashAfterStale:"100.0000",
      lostUpstreamHttp:upstreamStatus,replayedHttp:201,committedActions:1,committedTransfers:1,cashAfterReplay:"79.9999"
     }));
     return;
    }
    const handle=(id:string,token:string,expectedRevision:number,action:string,key=randomUUID())=>
      json(`${transferPath}/${id}/actions`,"POST",{expectedRevision,action,idempotencyKey:key,evidenceReference:"虚构实收或退回核对"},token);
    let start=transferCommand(cashScope,aScope,cash.id,cash.sources[0].id,"30.0001");
    expect((await json(transferPath,"POST",start,finance)).status).toBe(403);
    let started: Awaited<ReturnType<typeof json>>;
    if (transferBrowser) {
      const login = await json("/auth/login", "POST", { phone: seeded.keeperPhone, password: passwords[1] });
      expect(login.status).toBe(201);
      const { user, tokens: { accessToken, refreshToken } } = login.body;
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { registerCashTransferInBrowser } = require("./task24-transfer-browser.cjs");
      const receipt = await registerCashTransferInBrowser(origin, { user, accessToken, refreshToken }, aScope);
      start = receipt.command;
      started = receipt;
    } else {
      started = await json(transferPath,"POST",start,keeper);
    }
    expect(started.status).toBe(201);
    const id=started.body.id as string;
    expect(started.body).toMatchObject({revision:1,status:"pending_receipt"});
    expect(await json(transferPath,"POST",start,keeper)).toMatchObject({status:201,body:started.body});
    await readBalances("69.9999","100.0000");
    expect((await handle(id,keeper,1,"confirm")).status).toBe(403);
    expect(await handle(id,finance,1,"reject")).toMatchObject({status:201,body:{status:"rejected_held",revision:2}});
    await readBalances("69.9999","100.0000");
    expect((await handle(id,finance,2,"confirm")).status).toBe(409);
    expect(await handle(id,keeper,2,"resubmit")).toMatchObject({status:201,body:{status:"pending_receipt",revision:3}});
    let exactKey=randomUUID();
    let received: Awaited<ReturnType<typeof json>>;
    if (transferBrowser) {
      const login = await json("/auth/login", "POST", { phone: plan.phone, password: passwords[0] });
      expect(login.status).toBe(201);
      const { user, tokens: { accessToken, refreshToken } } = login.body;
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { confirmCashTransferInBrowser } = require("./task24-transfer-browser.cjs");
      const receipt = await confirmCashTransferInBrowser(origin, { user, accessToken, refreshToken }, id);
      exactKey = receipt.command.idempotencyKey;
      received = receipt;
    } else {
      received = await handle(id,finance,3,"confirm",exactKey);
    }
    expect(received).toMatchObject({status:201,body:{status:"received",revision:4}});
    expect(await handle(id,finance,3,"confirm",exactKey)).toMatchObject({status:201,body:received.body});
    expect((await handle(id,finance,3,"confirm")).status).toBe(409);
    await readBalances("69.9999","130.0001");
    const firstReceipt=await observer.$transaction(async tx=>{
     await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
     return tx.registeredFundTransfer.findUniqueOrThrow({where:{id},include:{
      actions:{orderBy:{revision:"asc"}},lines:{include:{sourceBatch:true,receivedBatch:true}},registrations:true
     }});
    },{isolationLevel:"RepeatableRead"});
    expect(firstReceipt.actions.map(row=>row.action)).toEqual(["register","reject","resubmit","confirm"]);
    expect(firstReceipt.registrations).toHaveLength(2);
    expect(firstReceipt.lines).toHaveLength(1);
    const line=firstReceipt.lines[0];
    expect(line.sourceBatchId).toBe(cash.sources[0].id);
    expect(line.receivedBatch).toMatchObject({receivedTransferLineId:line.id,projectId:plan.ids.project,sourceName:line.sourceBatch.sourceName});
    expect(line.receivedBatch!.amountYuan.toFixed(4)).toBe("30.0001");
    expect(await observer.auditLog.count({where:{businessId:id,businessType:"registered_fund_transfer"}})).toBe(4);

    const currentCash=await balance(cashScope);
    const rejected=await json(transferPath,"POST",transferCommand(cashScope,aScope,currentCash.currentRegistrationId,currentCash.sources[0].id,"5"),keeper);
    expect(rejected.status).toBe(201);
    expect((await handle(rejected.body.id,finance,1,"reject")).status).toBe(201);
    await readBalances("64.9999","130.0001");
    expect(await handle(rejected.body.id,keeper,2,"return")).toMatchObject({status:201,body:{status:"returned",revision:3}});
    await readBalances("69.9999","130.0001");
    expect(await observer.fundAccountBalanceRegistration.count({where:{transferId:rejected.body.id}})).toBe(0);

    const currentCompany=await balance(aScope);
    const reverse=await json(transferPath,"POST",transferCommand(aScope,cashScope,currentCompany.currentRegistrationId,line.receivedBatch!.id,"30.0001"),finance);
    expect(reverse.status).toBe(201);
    await readBalances("69.9999","100.0000");
    expect((await handle(reverse.body.id,finance,1,"confirm")).status).toBe(403);
    expect(await handle(reverse.body.id,keeper,1,"confirm")).toMatchObject({status:201,body:{status:"received"}});
    await readBalances("100.0000","100.0000");
    expect(await observer.$transaction(async tx=>({facts:await tx.operatingFact.count(),impacts:await tx.operatingImpactEntry.count()}),{isolationLevel:"RepeatableRead"})).toEqual(beforeLedger);

    const restored=await balance(cashScope);
    const originalSource=restored.sources.find(source=>source.amountYuan==="69.9999")!;
    const latestCash:Opening={id:restored.currentRegistrationId,sources:restored.sources};
    const payBody=await command(keeper,cashScope,latestCash,"6000",[{sourceBatchId:originalSource.id,amountCents:"6000"}]);
    const holdBody=transferCommand(cashScope,aScope,restored.currentRegistrationId,originalSource.id,"60.0000");
    waiting=[];
    const [paid,held]=await Promise.all([json(registrationRoute,"POST",payBody,keeper),json(transferPath,"POST",holdBody,keeper)]);
    expect({arrivals,barrierExpired}).toEqual({arrivals:2,barrierExpired:false});
    expect([paid.status,held.status].sort()).toEqual([201,409]);
    await readBalances("40.0000","100.0000");
    const race=await observer.$transaction(async tx=>{
     await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
     return { paymentCount:await tx.paymentExecution.count({where:{paymentRequestId:plan.ids.payment}}),
      holdCount:await tx.registeredFundTransferAction.count({where:{idempotencyKey:holdBody.idempotencyKey}}) };
    },{isolationLevel:"RepeatableRead"});
    expect(race).toEqual({paymentCount:paid.status===201?1:0,holdCount:held.status===201?1:0});
    console.info("TASK406_HTTP_WITNESS",JSON.stringify({
     hold:"30.0001", heldCash:"69.9999", receivedCompany:"130.0001", returnRestored:"69.9999",
     reverseRestored:"100.0000", auditCount:firstReceipt.actions.length, transferOperatingDelta:0,
     raceHttp:[paid.status,held.status],race, cashAfterRace:"40.0000"
    }));
    return;
   }
   if(overpay){
    const choices=[{token:finance,scopeKey:`company:${plan.ids.companyA}`,opening:a,actor:plan.ids.actor},{token:keeper,scopeKey:"public_cash",opening:cash,actor:seeded.keeper}];
    const options=await Promise.all(choices.map(choice=>registrationOptions(choice.token)));
    expect(options.map(value=>value.remainingAmountCents)).toEqual(["10000","10000"]);
    expect(options[0].expectedPaymentUpdatedAt).toBe(options[1].expectedPaymentUpdatedAt);
    for(const [index,choice] of choices.entries())expect(options[index].accounts).toContainEqual(expect.objectContaining({scopeKey:choice.scopeKey,eligible:true,currentRegistrationId:choice.opening.id}));
    waiting=[];
    const results=await Promise.all(choices.map((choice,index)=>submit(choice.token,choice.scopeKey,choice.opening,"6000",[{sourceBatchId:choice.opening.sources[0].id,amountCents:"6000"}],options[index].expectedPaymentUpdatedAt)));
    expect({arrivals,barrierExpired}).toEqual({arrivals:2,barrierExpired:false});
    expect(results.map(result=>result.response.status).sort()).toEqual([201,409]);
    expect(new Set(results.map(result=>result.key)).size).toBe(2);
    const winnerIndex=results.findIndex(result=>result.response.status===201);
    const winner=results[winnerIndex],loser=results[1-winnerIndex],winnerChoice=choices[winnerIndex],loserChoice=choices[1-winnerIndex];
    const getResult=(key:string,token:string)=>json(`/payment-executions/results/${key}`,"GET",undefined,token);
    const executionId=winner.response.body.id;
    expect(typeof executionId).toBe("string");
    expect(await getResult(winner.key,winnerChoice.token)).toMatchObject({status:200,body:{status:"recorded",execution:{executionId,amountCents:"6000"}}});
    expect(await getResult(loser.key,loserChoice.token)).toMatchObject({status:200,body:{status:"unconfirmed"}});
    const observeRace=()=>observer.$transaction(async tx=>{
     await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
     return {
      paid:(await tx.paymentRequest.findUniqueOrThrow({where:{id:plan.ids.payment},select:{paidAmountCents:true}})).paidAmountCents,
      settlementPaid:(await tx.settlement.findUniqueOrThrow({where:{id:plan.ids.settlement},select:{paidAmountCents:true}})).paidAmountCents,
      executions:await tx.paymentExecution.findMany({select:{id:true,idempotencyKey:true,amountCents:true,executedByUserId:true}}),
      funding:await tx.registeredPaymentFunding.findMany({select:{executionId:true}}),
      allocations:await tx.registeredFundPaymentAllocation.findMany({select:{executionId:true,sourceBatchId:true,amountCents:true}}),
      events:await tx.registeredPaymentEvent.findMany({select:{executionId:true}}),
      audits:await tx.auditLog.findMany({where:{businessId:plan.ids.payment,action:"payment.execution.record"},select:{actorUserId:true}}),
      facts:await tx.operatingFact.findMany({where:{sourceType:"payment_execution"},select:{sourceBusinessId:true},orderBy:{id:"asc"}}),
      impacts:await tx.operatingImpactEntry.findMany({where:{sourceType:"payment_execution"},select:{sourceBusinessId:true,impactKind:true,amountCents:true},orderBy:{id:"asc"}})
     };
    },{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead});
    const recorded=await observeRace();
    expect(recorded).toEqual({
     paid:6000n,settlementPaid:6000n,executions:[{id:executionId,idempotencyKey:winner.key,amountCents:6000n,executedByUserId:winnerChoice.actor}],
     funding:[{executionId}],allocations:[{executionId,sourceBatchId:winnerChoice.opening.sources[0].id,amountCents:6000n}],
     events:[{executionId}],audits:[{actorUserId:winnerChoice.actor}],facts:[{sourceBusinessId:executionId}],impacts:expect.any(Array)
    });
    expect(recorded.impacts).toHaveLength(2);
    expect(recorded.impacts).toEqual(expect.arrayContaining(["payable_decrease",winnerChoice.scopeKey==="public_cash"?"public_cash_funds_decrease":"company_project_funds_decrease"].map(impactKind=>({sourceBusinessId:executionId,impactKind,amountCents:6000n}))));
    const accounts=await json("/fund-accounts","GET",undefined,finance);
    expect(accounts).toMatchObject({status:200,body:{accounts:expect.arrayContaining([
     expect.objectContaining({scopeKey:winnerChoice.scopeKey,balanceYuan:"40.0000"}),
     expect.objectContaining({scopeKey:loserChoice.scopeKey,balanceYuan:"100.0000"})
    ])}});
    for(const choice of choices)expect(await registrationOptions(choice.token)).toMatchObject({paidAmountCents:"6000",remainingAmountCents:"4000"});
    const replay=await json(registrationRoute,"POST",winner.body,winnerChoice.token);
    expect(replay).toMatchObject({status:201,body:{id:executionId}});
    expect(await observeRace()).toEqual(recorded);
    expect(await json("/fund-accounts","GET",undefined,finance)).toEqual(accounts);
    return;
   }
   const bAccount=async()=>{
    const response=await json("/fund-accounts","GET",undefined,finance);
    expect(response.status).toBe(200);
    return response.body.accounts.find((account:{scopeKey:string})=>account.scopeKey===bScope);
   };
   const observeGap=()=>observer.$transaction(async tx=>{
    await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
    return {
     paid:(await tx.paymentRequest.findUniqueOrThrow({where:{id:plan.ids.payment},select:{paidAmountCents:true}})).paidAmountCents,
     executions:await tx.paymentExecution.count(),funding:await tx.registeredPaymentFunding.count(),
     allocations:await tx.registeredFundPaymentAllocation.count(),events:await tx.registeredPaymentEvent.count(),
     audits:await tx.auditLog.count({where:{businessId:plan.ids.payment,action:"payment.execution.record"}}),
     facts:await tx.operatingFact.count({where:{projectId:{in:[plan.ids.project,otherProjectId]}}}),
     impacts:await tx.operatingImpactEntry.count({where:{projectId:{in:[plan.ids.project,otherProjectId]}}})
    };
   },{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead});
   const beforeGap=await observeGap();
   expect(beforeGap).toMatchObject({paid:0n,executions:0,funding:0,allocations:0,events:0,audits:0});
   const beforeAccount=await bAccount();
   expect(beforeAccount).toMatchObject({balanceYuan:"100.0000",projectBalances:expect.arrayContaining([
    {projectStatus:"project",projectId:plan.ids.project,amountYuan:"97.0000"},
    {projectStatus:"project",projectId:otherProjectId,amountYuan:"3.0000"}
   ])});
   const ownSource=b.sources.find(source=>source.projectId===plan.ids.project),otherSource=b.sources.find(source=>source.projectId===otherProjectId);
   if(!ownSource||!otherSource)throw new Error("TASK398_GAP_SOURCE_BINDING");
   const rejected=await submit(finance,bScope,b,"10000",[{sourceBatchId:ownSource.id,amountCents:"9700"},{sourceBatchId:otherSource.id,amountCents:"300"}]);
   expect(rejected.response.status).toBe(409);
   expect(rejected.response.body.message).toContain("所选来源的项目归属不足，差额须先由业务确认，不能自动形成垫资到账");
   const rejectedResult=await json(`/payment-executions/results/${rejected.key}`,"GET",undefined,finance);
   expect(rejectedResult.status).toBe(200);
   expect(rejectedResult.body).toMatchObject({status:"unconfirmed"});
   expect(await observeGap()).toEqual(beforeGap);
   expect(await bAccount()).toEqual(beforeAccount);
   const pay=async(token:string,scopeKey:string,opening:Opening,amountCents:string)=>{
    const source=opening.sources.find(item=>item.projectId===plan.ids.project);
    if(!source)throw new Error("TASK398_PAYMENT_SOURCE_BINDING");
    const {key,response}=await submit(token,scopeKey,opening,amountCents,[{sourceBatchId:source.id,amountCents}]);
    expect(response.status).toBe(201);
    return {key,id:response.body.id as string};
   };
   const payThroughLoss=async()=>{
    // Use the existing one-drop loopback proxy and the observed-commit replay sequence.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const {createNativeResponseLossTransport}=require("../../prisma/task16-native-response-loss-transport.cjs");
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const {runLedgerLossFlow}=require("../../prisma/task16-ledger-loss-flow.cjs");
    const attempt=await command(finance,bScope,b,"3000",[{sourceBatchId:ownSource.id,amountCents:"3000"}]);
    const key=attempt.idempotencyKey;
    const listener=app!.getHttpServer();
    const check=()=>{
     if(!listener.listening||`http://127.0.0.1:${listener.address()?.port}`!==origin)throw new Error("TASK398_LOSS_ENDPOINT");
    };
    const transport=await createNativeResponseLossTransport({origin,payment:plan.ids.payment,key,check,prepareBody:(body:string)=>{
     const fingerprint=createHash("sha256").update(body).digest("hex");
     return (candidate:string)=>{if(createHash("sha256").update(candidate).digest("hex")!==fingerprint)throw new Error("TASK398_LOSS_BODY_CHANGED");};
    }});
    const observe=()=>observer.$transaction(async tx=>{
     await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
     const openings=await tx.fundAccountBalanceRegistration.findMany({where:{id:{in:[a.id,b.id]}},select:{id:true,accountId:true,balanceYuan:true,coveredExecutionIds:true},orderBy:{id:"asc"}});
     const allocations=await tx.registeredFundPaymentAllocation.findMany({select:{executionId:true,accountId:true,sourceBatchId:true,amountCents:true}});
     const balances=Object.fromEntries(openings.map(opening=>{
      const spent=allocations.filter(row=>row.accountId===opening.accountId&&!opening.coveredExecutionIds.includes(row.executionId)).reduce((sum,row)=>sum+row.amountCents,0n);
      return [opening.id,opening.balanceYuan?.minus(new Prisma.Decimal(spent.toString()).div(100)).toFixed(4)];
     }));
     return {
      paid:(await tx.paymentRequest.findUniqueOrThrow({where:{id:plan.ids.payment},select:{paidAmountCents:true}})).paidAmountCents,
      settlementPaid:(await tx.settlement.findUniqueOrThrow({where:{id:plan.ids.settlement},select:{paidAmountCents:true}})).paidAmountCents,
      executions:await tx.paymentExecution.findMany({select:{id:true,idempotencyKey:true,amountCents:true,executedByUserId:true}}),
      funding:await tx.registeredPaymentFunding.findMany({select:{executionId:true,actualPayerId:true}}),
      allocations,events:await tx.registeredPaymentEvent.findMany({select:{executionId:true}}),
      audits:await tx.auditLog.findMany({where:{businessId:plan.ids.payment,action:"payment.execution.record"},select:{actorUserId:true}}),
      debt:await tx.interEntityRelationshipEntry.findMany({where:{sourceType:"registered_payment_execution"},select:{id:true,paymentExecutionId:true,sourceType:true,entryKind:true,direction:true,status:true,originalDebtorCompanyId:true,creditorCompanyId:true,amountCents:true,projectId:true}}),
      facts:await tx.operatingFact.findMany({where:{sourceType:"payment_execution"},select:{id:true,sourceBusinessId:true}}),
      impacts:await tx.operatingImpactEntry.findMany({where:{sourceType:"payment_execution"},select:{factId:true,sourceBusinessId:true,impactKind:true,amountCents:true},orderBy:{id:"asc"}}),
      balances
     };
    },{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead});
    let recorded:Awaited<ReturnType<typeof observe>>|undefined,id:string|undefined;
    try {
     await runLedgerLossFlow({
      lose:()=>transport.lose(()=>json(registrationRoute,"POST",attempt,finance,transport.fetch)),
      observeCommitted:async()=>{
       recorded=await observe();
       expect(recorded.executions).toHaveLength(1);
       id=recorded.executions[0].id;
       const debtId=recorded.debt[0]?.id,factId=recorded.facts[0]?.id;
       expect(typeof debtId).toBe("string");expect(typeof factId).toBe("string");
       expect(recorded).toMatchObject({
        paid:3000n,settlementPaid:3000n,balances:{[a.id]:"100.0000",[b.id]:"70.0000"},
        executions:[{id,idempotencyKey:key,amountCents:3000n,executedByUserId:plan.ids.actor}],
        funding:[{executionId:id,actualPayerId:plan.ids.companyB}],allocations:[{executionId:id,sourceBatchId:ownSource.id,amountCents:3000n}],
        events:[{executionId:id}],audits:[{actorUserId:plan.ids.actor}],facts:[{id:factId,sourceBusinessId:id}],
        debt:[{id:debtId,paymentExecutionId:id,sourceType:"registered_payment_execution",entryKind:"proxy_payment",direction:"increase",status:"confirmed",originalDebtorCompanyId:plan.ids.companyA,creditorCompanyId:plan.ids.companyB,amountCents:3000n,projectId:plan.ids.project}]
       });
       expect(recorded.impacts).toHaveLength(3);
       expect(recorded.impacts).toEqual(expect.arrayContaining(["payable_decrease","company_project_funds_decrease","inter_subject_balance_increase"].map(impactKind=>({factId,sourceBusinessId:id,impactKind,amountCents:3000n}))));
      },
      readOriginal:async()=>{
       expect(await json(`/payment-executions/results/${key}`,"GET",undefined,finance)).toMatchObject({status:200,body:{
        status:"recorded",execution:{executionId:id,amountCents:"3000"},
        intercompany:[{entryId:recorded!.debt[0].id,amountCents:"3000",debtorCompanyId:plan.ids.companyA,creditorCompanyId:plan.ids.companyB}]
       }});
      },
      authorizeReplay:()=>transport.authorizeReplay(),
      replay:async()=>{expect(await json(registrationRoute,"POST",attempt,finance,transport.fetch)).toMatchObject({status:201,body:{id}});},
      observeReplay:async()=>{expect(await observe()).toEqual(recorded);}
     });
     transport.assertCompleted();
     if(!id)throw new Error("TASK398_LOSS_EXECUTION_ID");
     return {key,id};
    } finally {await transport.close();}
   };
   const companyB=ledgerLoss ? await payThroughLoss() : await pay(finance,bScope,b,"3000"),companyA=await pay(keeper,`company:${plan.ids.companyA}`,a,"3000");
   for(const token of [finance,keeper])expect((await json("/payment-executions/work-items","GET",undefined,token)).body.items).toContainEqual(expect.objectContaining({paymentId:plan.ids.payment,paidAmountCents:"6000",remainingAmountCents:"4000"}));
   const final=await pay(keeper,"public_cash",cash,"4000");
   const accountView=await json("/fund-accounts","GET",undefined,finance);expect(accountView.status).toBe(200);
   for(const [scopeKey,balanceYuan] of [[`company:${plan.ids.companyA}`,"70.0000"],[`company:${plan.ids.companyB}`,"70.0000"],["public_cash","60.0000"]])expect(accountView.body.accounts).toContainEqual(expect.objectContaining({scopeKey,balanceYuan}));
   for(const token of [finance,keeper]){expect((await json("/payment-executions/work-items","GET",undefined,token)).body.items).not.toContainEqual(expect.objectContaining({paymentId:plan.ids.payment}));const me=await observedMeRequest(()=>json("/me/work-items","GET",undefined,token),++meWindowIndex);expect(me.status).toBe(200);expect(me.body.queues.pending).not.toContainEqual(expect.objectContaining({type:"payment_execution",businessId:plan.ids.payment}));}
   const before=await json(`/payment-executions/results/${final.key}`,"GET",undefined,keeper);expect(before.body.execution).toMatchObject({executionId:final.id,voucherPending:true});
   const voucher=new FormData();voucher.append("file",new Blob([png],{type:"image/png"}),"voucher.png");voucher.append("idempotencyKey",randomUUID());
   const uploaded=await fetch(`${origin}/payment-executions/${final.id}/voucher-file-uploads`,{method:"POST",headers:{authorization:`Bearer ${keeper}`},body:voucher});expect(uploaded.status).toBe(201);const file=await uploaded.json();
   expect((await json(`/payment-executions/${final.id}/voucher`,"POST",{fileId:file.id},keeper)).status).toBe(201);
   const ticket=await json(`/payment-executions/${final.id}/voucher-ticket`,"GET",undefined,keeper);expect(ticket.status).toBe(200);const download=await fetch(new URL(ticket.body.downloadUrl,origin));expect(download.status).toBe(200);expect(Buffer.from(await download.arrayBuffer())).toEqual(png);
   const executions=await observer.paymentExecution.findMany({where:{paymentRequestId:plan.ids.payment}}),events=await observer.registeredPaymentEvent.findMany({where:{executionId:{in:executions.map(row=>row.id)}}});expect(executions).toHaveLength(3);expect(events).toHaveLength(3);expect(executions.reduce((sum,row)=>sum+row.amountCents,0n)).toBe(10000n);
   const executionIds=executions.map(row=>row.id),funding=await observer.registeredPaymentFunding.findMany({where:{executionId:{in:executionIds}}}),allocations=await observer.registeredFundPaymentAllocation.findMany({where:{executionId:{in:executionIds}}});
   expect(funding).toHaveLength(3);expect(allocations).toHaveLength(3);expect(allocations.reduce((sum,row)=>sum+row.amountCents,0n)).toBe(10000n);
   for(const [opening,expected] of [[a,3000n],[b,3000n],[cash,4000n]] as const)expect(allocations.filter(row=>row.sourceBatchId===opening.sources.find(source=>source.projectId===plan.ids.project)?.id).reduce((sum,row)=>sum+row.amountCents,0n)).toBe(expected);
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
