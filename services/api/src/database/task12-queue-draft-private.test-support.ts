import { ArgumentsHost, Catch } from "@nestjs/common";
import { HttpAdapterHost } from "@nestjs/core";
import { IncomingMessage, Server, ServerResponse } from "node:http";
import { createHash } from "node:crypto";
import { chmodSync, closeSync, constants, fsyncSync, mkdtempSync, openSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { types } from "node:util";
import { Task12AuthErrorFilter, armTask12AuthError, takeTask12AuthError } from "./task12-auth-error-diagnostic";

// Test-only: arms the existing request-bound filter for one synthetic GET or PUT.
// The raw data never leaves memory until finish confirms the existing ticket.
type Raw = Readonly<{message:string;stack:string}>;
type Active = {server:Server;version:string;nonce:string;ticket:object;target:"workbench"|"save";count:number;raw?:Raw};
const own=(v:unknown,key:string):unknown=>v&&typeof v==="object"&&!types.isProxy(v)?Object.getOwnPropertyDescriptor(v,key)?.value:undefined;
const headers=Object.getOwnPropertyDescriptor(IncomingMessage.prototype,"headers")?.get;
const privateCaptures=new WeakSet<object>();
const unavailable=()=>Object.freeze({status:"UNAVAILABLE" as const});
@Catch()
export class Task12QueueDraftPrivateFilter extends Task12AuthErrorFilter {
 private active?:Active;
 constructor(adapter:HttpAdapterHost){super(adapter);}
 arm(server:Server,version:string,nonce:string,target:"workbench"|"save"="workbench"):void {
  if(this.active||!["workbench","save"].includes(target)||!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(version)||!/^[a-f0-9]{32}$/u.test(nonce))throw new Error("TASK12_PRIVATE_DRAFT_CAPTURE");
  this.active={server,version,nonce,ticket:armTask12AuthError(this,server,`${version}:${nonce}:${target}`),target,count:0};
 }
 override catch(exception:unknown,host:ArgumentsHost) {
  try {
   const a=this.active,http=a&&host.switchToHttp(),request=http?.getRequest(),response=http?.getResponse();
   if(a&&!types.isProxy(request)&&!types.isProxy(response)&&request instanceof IncomingMessage&&response instanceof ServerResponse&&own(response,"req")===request&&own(response,"socket")===own(request,"socket")&&own(own(request,"socket"),"server")===a.server&&own(request,"method")===(a.target==="save"?"PUT":"GET")&&own(own(request,"route"),"path")===(a.target==="save"?"/contract-drafts/:contractVersionId":"/contract-drafts/:contractVersionId/workbench")&&own(own(request,"params"),"contractVersionId")===a.version&&own(headers?.call(request),"x-task12-diagnostic")===a.nonce){
    a.count++;a.raw=undefined;
    if(a.count===1&&exception&&!types.isProxy(exception)&&types.isNativeError(exception)){
     const message=own(exception,"message"),stack=own(exception,"stack");
     if(typeof message==="string"&&typeof stack==="string"&&Buffer.byteLength(message)<=16384&&Buffer.byteLength(stack)<=65536)a.raw=Object.freeze({message,stack});
    }
   }
  }catch{/* Capture must never affect the original response. */}
  return super.catch(exception,host);
 }
 finish(){
  const a=this.active;this.active=undefined;if(!a)return unavailable();
  try{const observed=takeTask12AuthError(this,a.server,a.ticket);if(!observed||a.count!==1||!a.raw)return unavailable();
   const finite=Object.freeze({serverErrorKind:observed.serverErrorKind,...(observed.serverPrismaCode?{serverPrismaCode:observed.serverPrismaCode}:{}),...(observed.serverSqlState?{serverSqlState:observed.serverSqlState}:{})});
   const result=Object.freeze({status:"CAPTURED" as const,finite,raw:a.raw});privateCaptures.add(result);return result;
  }catch{return unavailable();}
 }
}

// Only a genuine one-use filter result can create this retained private file.
export function retainTask12QueueDraftPrivateCapture(captured:ReturnType<Task12QueueDraftPrivateFilter["finish"]>){
 try{if(!captured||types.isProxy(captured)||!privateCaptures.delete(captured))return unavailable();
  const bytes=Buffer.from(JSON.stringify(captured));if(bytes.length>131072)return unavailable();
  const directory=mkdtempSync("/private/tmp/jg-task12-private-draft-");chmodSync(directory,0o700);
  const target=resolve(directory,"workbench-error.json"),fd=openSync(target,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
  try{writeFileSync(fd,bytes);fsyncSync(fd);}finally{closeSync(fd);}
  return Object.freeze({status:"CAPTURED" as const,path:target,sha256:createHash("sha256").update(bytes).digest("hex")});
 }catch{return unavailable();}
}
