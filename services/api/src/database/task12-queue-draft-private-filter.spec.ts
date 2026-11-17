import "reflect-metadata";
import { CanActivate, Controller, ExecutionContext, Get, Injectable, Module, Req, UseGuards } from "@nestjs/common";
import { APP_FILTER, HttpAdapterHost, NestFactory } from "@nestjs/core";
import { Server } from "node:http";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, rmdirSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";
import { ProjectOperatingConstraintFilter } from "../project/project-operating-constraint.filter";
import { Task12QueueDraftPrivateFilter, retainTask12QueueDraftPrivateCapture } from "./task12-queue-draft-private.test-support";
const version="10000000-0000-4000-8000-000000000001",nonce="a".repeat(32);
@Injectable() class ProbeGuard implements CanActivate { canActivate(context:ExecutionContext){const request=context.switchToHttp().getRequest<{headers:Record<string,string>}>();if(request.headers["x-model-guard"])throw new Error("PRIVATE_GUARD_EXCEPTION");return true;} }
@Controller("contract-drafts") class ProbeController { @UseGuards(ProbeGuard) @Get(":contractVersionId/workbench") workbench(@Req() request:{headers:Record<string,string>}){throw new Error(request.headers["x-model-large"] ? "x".repeat(20000) : "PRIVATE_TEST_EXCEPTION");} }
@Module({controllers:[ProbeController],providers:[ProbeGuard,{provide:APP_FILTER,useClass:ProjectOperatingConstraintFilter}]}) class ProbeModule {}
async function scope(run:(f:Task12QueueDraftPrivateFilter,server:Server,send:(marker:string,large?:boolean,target?:string,guard?:boolean)=>Promise<Response>)=>Promise<void>){const app=await NestFactory.create(ProbeModule,{logger:false});try{const f=new Task12QueueDraftPrivateFilter(app.get(HttpAdapterHost));app.useGlobalFilters(f);await app.listen(0,"127.0.0.1");const server=app.getHttpServer() as Server,address=server.address();if(!address||typeof address==="string")throw Error("NO_PORT");await run(f,server,(marker,large,target=version,guard)=>fetch(`http://127.0.0.1:${address.port}/contract-drafts/${target}/workbench`,{headers:{"x-task12-diagnostic":marker,...(large?{"x-model-large":"1"}:{}),...(guard?{"x-model-guard":"1"}:{})}}));}finally{await app.close();}}
it("captures the matched native exception privately and preserves HTTP 500",async()=>scope(async(f,server,send)=>{f.arm(server,version,nonce);const response=await send(nonce);expect(response.status).toBe(500);expect(await response.json()).toEqual({statusCode:500,message:"Internal server error"});const result=f.finish();expect(result.status).toBe("CAPTURED");if(result.status!=="CAPTURED")throw Error("NOT_CAPTURED");expect(result.raw.message).toBe("PRIVATE_TEST_EXCEPTION");expect(result.finite.serverErrorKind).toBe("ERROR");expect(f.finish()).toEqual({status:"UNAVAILABLE"});}));
it("does not retain mismatched or repeated requests",async()=>scope(async(f,server,send)=>{f.arm(server,version,nonce);await send("b".repeat(32));expect(f.finish()).toEqual({status:"UNAVAILABLE"});f.arm(server,version,nonce);await send(nonce);await send(nonce);expect(f.finish()).toEqual({status:"UNAVAILABLE"});}));

it("retains one genuine result in an owner-only file and never returns its contents",async()=>scope(async(f,server,send)=>{
 f.arm(server,version,nonce);await send(nonce);const captured=f.finish(),retained=retainTask12QueueDraftPrivateCapture(captured);expect(retained.status).toBe("CAPTURED");if(retained.status!=="CAPTURED")throw Error("NO_FILE");
 try{const directory=dirname(retained.path),bytes=readFileSync(retained.path);expect(lstatSync(directory).mode&0o777).toBe(0o700);expect(lstatSync(retained.path).mode&0o777).toBe(0o600);expect(createHash("sha256").update(bytes).digest("hex")).toBe(retained.sha256);expect(JSON.parse(bytes.toString("utf8")).raw.message).toBe("PRIVATE_TEST_EXCEPTION");expect(JSON.stringify(retained)).not.toContain("PRIVATE_TEST_EXCEPTION");expect(retainTask12QueueDraftPrivateCapture(captured)).toEqual({status:"UNAVAILABLE"});}
 finally{unlinkSync(retained.path);rmdirSync(dirname(retained.path));}
}));
it("rejects a forged capture without inspecting accessors",()=>{let reads=0;const fake=Object.defineProperty({},"status",{get(){reads++;throw Error("PRIVATE");}});expect(retainTask12QueueDraftPrivateCapture(fake as never)).toEqual({status:"UNAVAILABLE"});expect(reads).toBe(0);});

it("unrelated requests cannot consume the matched ticket",async()=>scope(async(f,server,send)=>{f.arm(server,version,nonce);await send("b".repeat(32));await send(nonce);expect(f.finish().status).toBe("CAPTURED");}));
it("oversized exception is never retained",async()=>scope(async(f,server,send)=>{f.arm(server,version,nonce);const response=await send(nonce,true);expect(response.status).toBe(500);expect(f.finish()).toEqual({status:"UNAVAILABLE"});}));

it("wrong contract version cannot borrow the original error",async()=>scope(async(f,server,send)=>{f.arm(server,version,nonce);await send(nonce,false,"10000000-0000-4000-8000-000000000002");expect(f.finish()).toEqual({status:"UNAVAILABLE"});}));

it("captures the same-request guard exception without claiming controller execution",async()=>scope(async(f,server,send)=>{f.arm(server,version,nonce);const response=await send(nonce,false,version,true);expect(response.status).toBe(500);const result=f.finish();expect(result.status).toBe("CAPTURED");if(result.status!=="CAPTURED")throw Error("NO_CAPTURE");expect(result.raw.message).toBe("PRIVATE_GUARD_EXCEPTION");expect(result.finite).not.toHaveProperty("serverAuthBoundary");}));
