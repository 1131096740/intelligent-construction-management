import { performance } from "node:perf_hooks";
import { types } from "node:util";
import { projectTask16RegistrationError } from "../database/task16-registration-error-diagnostic";

// This observer is inert until explicitly armed by the isolated CON18 runner.
// It has no I/O and never retains exception objects or their messages.
type Stage = "SNAPSHOT" | "TEMPLATE" | "DOCX_RENDER" | "ATTACHMENTS" | "PDF_CONVERT" | "UPLOAD_DOCX" | "UPLOAD_PDF" | "PUBLISH" | "CLEANUP";
const publishPhases = ["TRANSACTION_BEGIN", "DRAFT_LOCK", "COMPANY_LOCK", "COMPANY_READ", "STALE_WRITE",
  "DOCUMENT_WRITE", "PREDECESSOR_READ", "FILE_REPLACEMENT", "PREVIEW_POINTER", "SUPERSEDE", "AUDIT", "CALLBACK_RETURNED"] as const;
export type Con18PublishPhase = typeof publishPhases[number];
type Coordinates = Readonly<{ generationId:string; versionId:string; sourceRevision:number; documentContentRevision:number; documentContentFingerprint:string }>;
type Job = { id:string; contractVersionId:string; sourceRevision:number; inputSnapshot:unknown };
type Detail = Readonly<{ status:"OBSERVED"; stage:Stage; errorKind:string; prismaCode?:string; sqlState?:string; publishPhase?:Con18PublishPhase; publishElapsedMs?:number }>;
type Row = { coordinates:Coordinates; stage:Stage; done:boolean; detail?:Detail };
type Session = { worker:object; token:object; rows:Map<string,Row>; invalid:boolean; claimed:boolean };
const sessions=new WeakMap<object,Session>();
const id=(v:unknown):v is string=>typeof v==="string"&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(v);
const own=(v:unknown,key:string):unknown=>v&&typeof v==="object"&&!types.isProxy(v)?Object.getOwnPropertyDescriptor(v,key)?.value:undefined;
const unavailable=()=>Object.freeze({status:"UNAVAILABLE" as const});
const valid=(c:Coordinates)=>id(c.generationId)&&id(c.versionId)&&Number.isSafeInteger(c.sourceRevision)&&c.sourceRevision>0&&Number.isSafeInteger(c.documentContentRevision)&&c.documentContentRevision>0&&typeof c.documentContentFingerprint==="string"&&/^[a-f0-9]{64}$/u.test(c.documentContentFingerprint);
export function armCon18WorkerDiagnostic(worker:object):object {
 if(!worker||types.isProxy(worker)||sessions.has(worker))throw new Error("TASK12_PRIVATE_WORKER_DIAGNOSTIC");
 const token=Object.freeze(Object.create(null)) as object;sessions.set(worker,{worker,token,rows:new Map(),invalid:false,claimed:false});return token;
}
export function beginCon18WorkerJob(worker:object,job:Job) {
 try {
  const s=worker&&!types.isProxy(worker)?sessions.get(worker):undefined;if(!s||s.invalid||s.claimed)return;
  const c={generationId:own(job,"id"),versionId:own(job,"contractVersionId"),sourceRevision:own(job,"sourceRevision"),documentContentRevision:own(own(job,"inputSnapshot"),"documentContentRevision"),documentContentFingerprint:own(own(job,"inputSnapshot"),"documentContentFingerprint")} as Coordinates;
  if(!valid(c)||s.rows.size>=8||s.rows.has(c.generationId)){s.invalid=true;return;}
  const row:Row={coordinates:Object.freeze(c),stage:"SNAPSHOT",done:false};s.rows.set(c.generationId,row);
  let publishStarted:number | undefined, publishPhase:Con18PublishPhase | undefined;
  return Object.freeze({
   publishStep(phase:Con18PublishPhase) {
    if(row.done||row.stage!=="PUBLISH"||!publishPhases.includes(phase))return;
    publishStarted??=performance.now();
    publishPhase=phase;
   },
   step(stage:Stage){try{if(!row.done&&["SNAPSHOT","TEMPLATE","DOCX_RENDER","ATTACHMENTS","PDF_CONVERT","UPLOAD_DOCX","UPLOAD_PDF","PUBLISH","CLEANUP"].includes(stage))row.stage=stage;else s.invalid=true;}catch{s.invalid=true;}},
   fail(error:unknown){try{if(row.done){s.invalid=true;return;}row.done=true;const d=projectTask16RegistrationError(error);
    const elapsed=publishStarted===undefined?undefined:Math.round(performance.now()-publishStarted);
    const publish=row.stage==="PUBLISH"&&publishPhase&&elapsed!==undefined&&elapsed>=0&&elapsed<=3600000?{publishPhase,publishElapsedMs:elapsed}:{};
    row.detail=Object.freeze({status:"OBSERVED",stage:row.stage,errorKind:d.serverErrorKind,...publish,...(d.serverPrismaCode?{prismaCode:d.serverPrismaCode}:{}),...(d.serverSqlState?{sqlState:d.serverSqlState}:{})});}catch{s.invalid=true;}},
   success(){if(row.done)s.invalid=true;else row.done=true;}
  });
 }catch{return;}
}
export function takeCon18WorkerDiagnostic(worker:object,token:object,coordinates:Coordinates) {
 try {
  const s=worker&&!types.isProxy(worker)?sessions.get(worker):undefined;if(!s||s.token!==token||s.claimed)return unavailable();s.claimed=true;
  if(s.invalid||!coordinates||types.isProxy(coordinates))return unavailable();
  const c={generationId:own(coordinates,"generationId"),versionId:own(coordinates,"versionId"),sourceRevision:own(coordinates,"sourceRevision"),documentContentRevision:own(coordinates,"documentContentRevision"),documentContentFingerprint:own(coordinates,"documentContentFingerprint")} as Coordinates;
  if(!valid(c))return unavailable();const row=s.rows.get(c.generationId);
  if(!row?.done||!row.detail||Object.keys(row.coordinates).some(key=>own(row.coordinates,key)!==own(c,key)))return unavailable();return row.detail;
 }catch{return unavailable();}
}
export function closeCon18WorkerDiagnostic(worker:object,token:object):void {
 try{const s=worker&&!types.isProxy(worker)?sessions.get(worker):undefined;if(s&&s.token===token){s.rows.clear();sessions.delete(worker);}}catch{/* Diagnostics never affect worker shutdown. */}
}
