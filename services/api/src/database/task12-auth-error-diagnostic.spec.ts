import "reflect-metadata";
import { Controller, Module, Post, Req } from "@nestjs/common";
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, HttpAdapterHost, NestFactory } from "@nestjs/core";
import { Prisma } from "@prisma/client";
import { Server } from "node:http";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import { AuthController } from "../auth/auth.controller";
import { AuthService } from "../auth/auth.service";
import { AuthRateLimitService } from "../auth/auth-rate-limit.service";
import { AccountRateLimitGuard } from "../auth/guards/account-rate-limit.guard";
import { JwtTokenService } from "../auth/jwt-token.service";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "./prisma.service";
import { Task16RegistrationErrorFilter, armTask16RegistrationError, takeTask16RegistrationError } from "./task16-registration-error-diagnostic";
import { Task12AuthErrorFilter, Task12AuthStageInterceptor, armTask12AuthError, takeTask12AuthError } from "./task12-auth-error-diagnostic";
const phone = "18000000001";
let thrown: unknown;
let bodyMode = "normal", getterReads = 0;
const native = (code = "P2010", sql = "42501") => new Prisma.PrismaClientKnownRequestError("private error must never escape", { code, clientVersion: "fixture", meta: { code: sql, private: "hidden" } });
@Controller("auth")
class TechnicalAuthController {
  @Post("login")
  login(@Req() request: { body: Record<string, unknown> }) {
    if (bodyMode === "password-getter") Object.defineProperty(request.body, "password", { get() { getterReads++; throw Error("PASSWORD_READ"); } });
    if (bodyMode === "phone-getter") Object.defineProperty(request.body, "phone", { get() { getterReads++; return phone; } });
    if (bodyMode === "proxy") request.body = new Proxy(request.body, { getOwnPropertyDescriptor() { getterReads++; throw Error("BODY_TRAP"); } });
    throw thrown ?? native();
  }
  @Post("other") other() { throw native(); }
}
@Module({controllers:[TechnicalAuthController],providers:[Task12AuthErrorFilter,Task12AuthStageInterceptor,{provide:APP_FILTER,useExisting:Task12AuthErrorFilter},{provide:APP_INTERCEPTOR,useExisting:Task12AuthStageInterceptor}]})
class TechnicalAuthModule {}
describe("Task12 private AUTH diagnostic (technical HTTP only, no business admission)",()=>{
 test("actual native request retains a finite cause while original public500 is unchanged",async()=>{
  const app=await NestFactory.create(TechnicalAuthModule,{logger:false});
  try{
   await app.listen(0,"127.0.0.1");const server=app.getHttpServer() as Server,filter=app.get(Task12AuthErrorFilter);
   const ticket=armTask12AuthError(filter,server,phone);const address=server.address();if(!address||typeof address==="string")throw Error("NO_PORT");
   const response=await fetch(`http://127.0.0.1:${address.port}/auth/login`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({phone,password:"fictional-private-password"})});
   expect(response.status).toBe(500);expect(await response.json()).toEqual({statusCode:500,message:"Internal server error"});
   expect(takeTask12AuthError(filter,server,ticket)).toEqual({serverAuthBoundary:"CONTROLLER_MARKER_REACHED",serverErrorKind:"KNOWN_REQUEST_ERROR",serverPrismaCode:"P2010",serverSqlState:"42501"});
   expect(()=>takeTask12AuthError(filter,server,ticket)).toThrow();
  }finally{await app.close();}
 });
});

async function scope(use: (filter: Task12AuthErrorFilter, server: Server, send: (body?: object, route?: string) => Promise<Response>, adapter: HttpAdapterHost) => Promise<void>) {
 const app=await NestFactory.create(TechnicalAuthModule,{logger:false});thrown=undefined;bodyMode="normal";getterReads=0;
 try { await app.listen(0,"127.0.0.1");const server=app.getHttpServer() as Server,filter=app.get(Task12AuthErrorFilter),address=server.address();if(!address||typeof address==="string")throw Error("NO_PORT");
  await use(filter,server,(body={phone,password:"private"},route="login")=>fetch(`http://127.0.0.1:${address.port}/auth/${route}`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)}),app.get(HttpAdapterHost));
 }finally{await app.close();thrown=undefined;bodyMode="normal";}
}
test("actual AUTH route preserves all20 supported Prisma codes without raw details",async()=>{
 const codes=["P1000","P1001","P1002","P1003","P1008","P1010","P1011","P1017","P2000","P2002","P2003","P2004","P2010","P2011","P2021","P2022","P2024","P2025","P2028","P2034"];
 await scope(async(filter,server,send)=>{for(const code of codes){thrown=native(code);const ticket=armTask12AuthError(filter,server,phone);expect((await send()).status).toBe(500);expect(takeTask12AuthError(filter,server,ticket)).toEqual({serverAuthBoundary:"CONTROLLER_MARKER_REACHED",serverErrorKind:"KNOWN_REQUEST_ERROR",serverPrismaCode:code,serverSqlState:"42501"});}});
});
test("route and serialized phone identity must match, and duplicate observations clear rather than reuse a cause",async()=>{
 await scope(async(filter,server,send)=>{
  for(const [body,route]of [[{username:phone},"login"],[{phone:"18000000002"},"login"],[{phone},"other"]] as const){const ticket=armTask12AuthError(filter,server,phone);expect((await send(body,route)).status).toBe(500);expect(takeTask12AuthError(filter,server,ticket)).toBeUndefined();}
  const ticket=armTask12AuthError(filter,server,phone);await send();await send();expect(takeTask12AuthError(filter,server,ticket)).toBeUndefined();
 });
});
test("copied/proxied/foreign tickets and an unowned filter cannot take the real event",async()=>{
 await scope(async(filter,server,send)=>{const ticket=armTask12AuthError(filter,server,phone);await send();
  for(const fake of [{...ticket},new Proxy(ticket,{}),Object.freeze({})])expect(()=>takeTask12AuthError(filter,server,fake)).toThrow();
  expect(()=>takeTask12AuthError(Object.create(Task12AuthErrorFilter.prototype),server,ticket)).toThrow();
  expect(takeTask12AuthError(filter,server,ticket)).toMatchObject({serverPrismaCode:"P2010"});
  expect(()=>armTask12AuthError(Object.create(Task12AuthErrorFilter.prototype),server,phone)).toThrow();
 });
});
test("the diagnostic never reads password, accessors or proxied body fields",async()=>{
 for(const mode of ["password-getter","phone-getter","proxy"])await scope(async(filter,server,send)=>{bodyMode=mode;const ticket=armTask12AuthError(filter,server,phone);await send();const detail=takeTask12AuthError(filter,server,ticket);expect(getterReads).toBe(0);if(mode==="password-getter")expect(detail).toMatchObject({serverPrismaCode:"P2010"});else expect(detail).toBeUndefined();});
});
test("unknown/native getter values are omitted and expired tickets cannot reveal a retained event",async()=>{
 await scope(async(filter,server,send)=>{
  thrown=native("P9999","99999");let ticket=armTask12AuthError(filter,server,phone);await send();expect(takeTask12AuthError(filter,server,ticket)).toEqual({serverAuthBoundary:"CONTROLLER_MARKER_REACHED",serverErrorKind:"KNOWN_REQUEST_ERROR"});
  const error=native();Object.defineProperty(error,"code",{get(){getterReads++;return "P2010";}});thrown=error;await send();const originalFilterReads=getterReads;getterReads=0;ticket=armTask12AuthError(filter,server,phone);await send();expect(takeTask12AuthError(filter,server,ticket)).toEqual({serverAuthBoundary:"CONTROLLER_MARKER_REACHED",serverErrorKind:"KNOWN_REQUEST_ERROR",serverSqlState:"42501"});expect(getterReads).toBe(originalFilterReads);
  ticket=armTask12AuthError(filter,server,phone,1);await new Promise(resolve=>setTimeout(resolve,10));expect(()=>takeTask12AuthError(filter,server,ticket)).toThrow();
 });
});

interface TechnicalHttpBridge { send(actor: number, message: object): Promise<unknown> }
interface TechnicalHttpApi {
 withCurrent261LocalLifecycleHttp(config: object, server: Server, verify: () => void, verifyToken: () => unknown, use: (bridge: TechnicalHttpBridge) => Promise<unknown>): Promise<unknown>;
 describeCurrent261LocalLifecycleHttpFailure(error: unknown): object | undefined;
}
interface MainModel { result(): Promise<Record<string, unknown>> }
type MainPorts = { applicationRun: () => Promise<unknown>; httpFailureApi: TechnicalHttpApi };
const fixtureRequire = createRequire(__filename);
const lifecycleHttpFile = join(__dirname,"../../prisma/task12-current261-local-lifecycle-http.cjs");
const lifecycleHttpRequire = createRequire(lifecycleHttpFile);
const createMainModel: (cleanup: { after(action: () => void): void }, ports: MainPorts) => MainModel = fixtureRequire("../../test-support/task12-lifecycle-main-model.cjs").model;
test("actual Nest finite catalog survives failing AFTER_CHECK through the actual closed main receipt",async()=>{
 const codes=["P1000","P1001","P1002","P1003","P1008","P1010","P1011","P1017","P2000","P2002","P2003","P2004","P2010","P2011","P2021","P2022","P2024","P2025","P2028","P2034"];
 const sqlStates=["23502","23503","23505","42501","25006","25P02","40001","40P01","42P01","42703","57014"];
 const cases=[...codes.map(code=>({code,sql:"42501"})),...sqlStates.map(sql=>({code:"P2010",sql}))];
 await scope(async(filter,server)=>{
  for(const {code,sql} of cases){
   thrown=native(code,sql);let valid=true,claimed=false;const cleanups:Array<()=>void>=[];
   const id=(n:number)=>"10000000-0000-4000-8000-"+String(n).padStart(12,"0");
   const users=Array.from({length:8},(_,i)=>({id:id(i+1),phone:i===0?phone:"1990000000"+i}));
   const passwords=Object.fromEntries(users.map((u,i)=>[u.id,String(i).repeat(64)]));
   const config=Object.freeze({fixture:{approval:{users,handler:users[0],project:{id:id(20)},members:[],globalRoles:[]}},passwords,sourceDocx:Buffer.from("source"),originals:[Buffer.from("first"),Buffer.from("second")]});
   const diagnostics=Object.freeze({arm(identity:string){return armTask12AuthError(filter,server,identity);},take(ticket:object){const detail=takeTask12AuthError(filter,server,ticket);valid=false;return detail;}});
   const imported=(name:string)=>name==="./task12-current259-document-application.cjs"?{takeCurrent261LocalLifecycleHttpBridge(c:unknown,s:unknown){expect(c).toBe(config);expect(s).toBe(server);expect(claimed).toBe(false);claimed=true;return diagnostics;}}:name.startsWith(".")?lifecycleHttpRequire(name):require(name);
   const module={exports:{}};
   new Function("require","module",readFileSync(lifecycleHttpFile,"utf8"))(imported,module);
   const api=module.exports as TechnicalHttpApi;
   const verify=()=>{if(!valid)throw Object.assign(new Error("private secondary relay evidence"),{code:"TASK01_RESOURCE_LOOPBACK_FORWARD_FAILED"});};
   try{
    const model=createMainModel({after(action){cleanups.push(action);}},{httpFailureApi:api,applicationRun:()=>api.withCurrent261LocalLifecycleHttp(config,server,verify,()=>undefined,bridge=>bridge.send(0,{method:"POST",path:"/auth/login",json:{phone,password:passwords[users[0].id]}}))});
    const receipt=await model.result();
    expect(receipt.status).toBe("CURRENT261_LOCAL_LIFECYCLE_STOPPED");expect(receipt.businessOutcome).toBe("UNKNOWN");expect(receipt.full394Accepted).toBe(false);
    expect(receipt.httpFailure).toEqual({method:"POST",routeTemplate:"/auth/login",phase:"AFTER_CHECK",httpStatus:500,businessOutcome:"UNKNOWN",serverAuthBoundary:"CONTROLLER_MARKER_REACHED",serverErrorKind:"KNOWN_REQUEST_ERROR",serverPrismaCode:code,serverSqlState:sql});
    expect(JSON.stringify(receipt)).not.toMatch(/private secondary|must never escape|fictional-private-password|1990000000|18000000001/u);
   }finally{cleanups.forEach(action=>action());}
  }
 });
});

test("foreign registration-domain tickets, wrong servers and extra arguments cannot reveal AUTH events",async()=>{
 await scope(async(filter,server,send,adapter)=>{
  const registration=new Task16RegistrationErrorFilter(adapter),foreign=armTask16RegistrationError(registration,server,"10000000-0000-4000-8000-000000000001","20000000-0000-4000-8000-000000000001");
  expect(()=>takeTask12AuthError(filter,server,foreign)).toThrow();expect(takeTask16RegistrationError(registration,server,foreign)).toBeUndefined();
  expect(()=>Reflect.apply(armTask12AuthError,undefined,[filter,server,phone,15000,{}])).toThrow();
  let ticket=armTask12AuthError(filter,server,phone);await send();expect(()=>Reflect.apply(takeTask12AuthError,undefined,[filter,server,ticket,{}])).toThrow();expect(takeTask12AuthError(filter,server,ticket)).toMatchObject({serverPrismaCode:"P2010"});
  ticket=armTask12AuthError(filter,server,phone);await send();expect(()=>takeTask12AuthError(filter,new Server(),ticket)).toThrow();expect(()=>takeTask12AuthError(filter,server,ticket)).toThrow();
  let traps=0;const hostile=new Proxy(server,{getPrototypeOf(){traps++;throw Error("TRAP");}});expect(()=>armTask12AuthError(filter,hostile,phone)).toThrow();expect(traps).toBe(0);
 });
});

test("the finite native event identifies whether this actual request reached the controller interceptor marker",async()=>{
 await scope(async(filter,server,send)=>{const ticket=armTask12AuthError(filter,server,phone);await send();expect(takeTask12AuthError(filter,server,ticket)).toMatchObject({serverAuthBoundary:"CONTROLLER_MARKER_REACHED"});});
});


let cohort: "GUARD" | "SERVICE" = "GUARD";
let guardDbCalls = 0, serviceDbCalls = 0;
const txPort = { authRateLimit: { async deleteMany() { return {count:0}; }, async upsert() { return {hits:1}; } } };
const cohortError = () => new Prisma.PrismaClientKnownRequestError("controlled database port, not native PostgreSQL proof", {code:"P2028",clientVersion:"5.22.0"});
const dbPort = {
 async $transaction(work: (tx: typeof txPort) => Promise<unknown>) { guardDbCalls++;if(cohort==="GUARD")throw cohortError();return work(txPort); },
 user: { async findUnique() { serviceDbCalls++;throw cohortError(); } }
};
@Module({controllers:[AuthController],providers:[
 {provide:PrismaService,useValue:dbPort},{provide:JwtTokenService,useValue:Object.freeze({})},AuditService,AuthService,AuthRateLimitService,AccountRateLimitGuard,
 Task12AuthErrorFilter,Task12AuthStageInterceptor,{provide:APP_GUARD,useExisting:AccountRateLimitGuard},
 {provide:APP_FILTER,useExisting:Task12AuthErrorFilter},{provide:APP_INTERCEPTOR,useExisting:Task12AuthStageInterceptor}
]})
class ActualAuthCohortTechnicalModule {}
test("actual original RateLimitGuard versus AuthService cohorts yield distinct markers for identical P2028, preserving500/UNKNOWN after postcheck failure",async()=>{
 const evidence: Array<object> = [];
 for(const selected of ["GUARD","SERVICE"] as const){
  cohort=selected;guardDbCalls=0;serviceDbCalls=0;
  const app=await NestFactory.create(ActualAuthCohortTechnicalModule,{logger:false});const cleanups:Array<()=>void>=[];
  try{
   await app.listen(0,"127.0.0.1");const server=app.getHttpServer() as Server,filter=app.get(Task12AuthErrorFilter);let valid=true,claimed=false;
   const id=(n:number)=>"10000000-0000-4000-8000-"+String(n).padStart(12,"0");const users=Array.from({length:8},(_,i)=>({id:id(i+1),phone:i===0?phone:"1990000000"+i}));const passwords=Object.fromEntries(users.map((u,i)=>[u.id,String(i).repeat(64)]));
   const config=Object.freeze({fixture:{approval:{users,handler:users[0],project:{id:id(20)},members:[],globalRoles:[]}},passwords,sourceDocx:Buffer.from("source"),originals:[Buffer.from("first"),Buffer.from("second")]});
   const address=server.address();if(!address||typeof address==="string")throw Error("NO_PORT");
   const directTicket=armTask12AuthError(filter,server,phone);
   const directResponse=await fetch(`http://127.0.0.1:${address.port}/auth/login`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({phone,password:"controlled-fictional"})});
   expect(directResponse.status).toBe(500);expect(await directResponse.json()).toEqual({statusCode:500,message:"Internal server error"});
   expect(takeTask12AuthError(filter,server,directTicket)).toMatchObject({serverPrismaCode:"P2028",serverAuthBoundary:selected==="GUARD"?"PRE_CONTROLLER_MARKER":"CONTROLLER_MARKER_REACHED"});
   guardDbCalls=0;serviceDbCalls=0;
   const diagnostics=Object.freeze({arm(identity:string){return armTask12AuthError(filter,server,identity);},take(ticket:object){const detail=takeTask12AuthError(filter,server,ticket);valid=false;return detail;}});
   const imported=(name:string)=>name==="./task12-current259-document-application.cjs"?{takeCurrent261LocalLifecycleHttpBridge(c:unknown,s:unknown){expect(c).toBe(config);expect(s).toBe(server);expect(claimed).toBe(false);claimed=true;return diagnostics;}}:name.startsWith(".")?lifecycleHttpRequire(name):require(name);
   const module={exports:{}};new Function("require","module",readFileSync(lifecycleHttpFile,"utf8"))(imported,module);const api=module.exports as TechnicalHttpApi;
   const verify=()=>{if(!valid)throw Object.assign(new Error("controlled secondary frame"),{code:"TASK01_RESOURCE_LOOPBACK_FORWARD_FAILED"});};
   const model=createMainModel({after(action){cleanups.push(action);}},{httpFailureApi:api,applicationRun:()=>api.withCurrent261LocalLifecycleHttp(config,server,verify,()=>undefined,bridge=>bridge.send(0,{method:"POST",path:"/auth/login",json:{phone,password:passwords[users[0].id]}}))});
   const receipt=await model.result(),boundary=selected==="GUARD"?"PRE_CONTROLLER_MARKER":"CONTROLLER_MARKER_REACHED";
   expect(receipt.httpFailure).toEqual({method:"POST",routeTemplate:"/auth/login",phase:"AFTER_CHECK",httpStatus:500,businessOutcome:"UNKNOWN",serverErrorKind:"KNOWN_REQUEST_ERROR",serverPrismaCode:"P2028",serverAuthBoundary:boundary});
   expect(receipt.businessOutcome).toBe("UNKNOWN");expect(receipt.full394Accepted).toBe(false);expect(guardDbCalls).toBe(1);expect(serviceDbCalls).toBe(selected==="GUARD"?0:1);
   evidence.push({cohort:selected,sourceClasses:"original AccountRateLimitGuard/AuthRateLimitService/AuthController/AuthService",database:"CONTROLLED_PORT_NOT_NATIVE_PG",publicResponse:{status:500,body:{statusCode:500,message:"Internal server error"}},httpFailure:receipt.httpFailure,businessOutcome:receipt.businessOutcome,full394Accepted:false,guardDbCalls,serviceDbCalls});
  }finally{await app.close();cleanups.forEach(action=>action());}
 }
 console.log("AUTH_COHORT_PROOF "+JSON.stringify(evidence));
});

test("former pre-consume full-verification ordering loses a native cause at the unchanged 15s lifetime (controlled negative)",async()=>{
 cohort="SERVICE";const app=await NestFactory.create(ActualAuthCohortTechnicalModule,{logger:false});
 try{
  await app.listen(0,"127.0.0.1");const server=app.getHttpServer() as Server,filter=app.get(Task12AuthErrorFilter),address=server.address();if(!address||typeof address==="string")throw Error("NO_PORT");
  const controlTicket=armTask12AuthError(filter,server,phone);const controlResponse=await fetch(`http://127.0.0.1:${address.port}/auth/login`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({phone,password:"controlled"})});expect(controlResponse.status).toBe(500);await controlResponse.json();const control=takeTask12AuthError(filter,server,controlTicket);expect(control?.serverPrismaCode).toBe("P2028");
  const id=(n:number)=>"10000000-0000-4000-8000-"+String(n).padStart(12,"0");const users=Array.from({length:8},(_,i)=>({id:id(i+1),phone:i===0?phone:"1990000000"+i}));const passwords=Object.fromEntries(users.map((u,i)=>[u.id,String(i).repeat(64)]));
  const config=Object.freeze({fixture:{approval:{users,handler:users[0],project:{id:id(20)},members:[],globalRoles:[]}},passwords,sourceDocx:Buffer.from("source"),originals:[Buffer.from("first"),Buffer.from("second")]});let valid=true;
  const diagnostics=Object.freeze({arm(identity:string){return armTask12AuthError(filter,server,identity);},take(ticket:object){
   // Only the owned-provider verification boundary is modeled; this is not a
   // measurement of the genuine factory's full source-check cost or PG.
   Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,16000);
   try{return takeTask12AuthError(filter,server,ticket);}finally{valid=false;}
  }});
  const imported=(name:string)=>name==="./task12-current259-document-application.cjs"?{takeCurrent261LocalLifecycleHttpBridge(c:unknown,s:unknown){expect(c).toBe(config);expect(s).toBe(server);return diagnostics;}}:name.startsWith(".")?lifecycleHttpRequire(name):require(name);
  const module={exports:{}};new Function("require","module",readFileSync(lifecycleHttpFile,"utf8"))(imported,module);const api=module.exports as TechnicalHttpApi;
  const first:unknown=await api.withCurrent261LocalLifecycleHttp(config,server,()=>{if(!valid)throw Object.assign(new Error("controlled original AFTER_CHECK"),{code:"TASK01_RESOURCE_LOOPBACK_FORWARD_FAILED"});},()=>undefined,b=>b.send(0,{method:"POST",path:"/auth/login",json:{phone,password:passwords[users[0].id]}})).then(()=>undefined,cause=>cause);
  expect(first).toBeDefined();expect(valid).toBe(false);
  const detail=api.describeCurrent261LocalLifecycleHttpFailure(first);
  expect(detail).toMatchObject({method:"POST",routeTemplate:"/auth/login",phase:"AFTER_CHECK",httpStatus:500,businessOutcome:"UNKNOWN"});
  console.log("AUTH_CAPTURE_DELAY_PROOF "+JSON.stringify({scope:"MODELED_INSPECT_DELAY_NOT_GENUINE_FACTORY_COST_NO_PG",delayMs:16000,ticketMs:15000,control,afterDelayedTake:detail,postcheckStillRejected:true}));
  // This deliberately models the former unsafe ordering, not the fixed factory.
  // The actual factory closure order is covered independently in CJS model tests.
  expect(detail).not.toHaveProperty("serverPrismaCode");
 }finally{await app.close();}
},25000);
