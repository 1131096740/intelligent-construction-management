import { Prisma } from "@prisma/client";
import { armCon18WorkerDiagnostic, beginCon18WorkerJob, takeCon18WorkerDiagnostic, closeCon18WorkerDiagnostic } from "./task12-con18-worker-diagnostic";
const id=(n:number)=>`10000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const fp="a".repeat(64);
const job=(n:number)=>({id:id(n),contractVersionId:id(1),sourceRevision:3,inputSnapshot:{documentContentRevision:4,documentContentFingerprint:fp}});
const coordinates=(n:number)=>({generationId:id(n),versionId:id(1),sourceRevision:3,documentContentRevision:4,documentContentFingerprint:fp});
it("captures only the exact task and omits exception details",()=>{
 const worker={},token=armCon18WorkerDiagnostic(worker),first=beginCon18WorkerJob(worker,job(2)),other=beginCon18WorkerJob(worker,job(3));
 first?.step("PDF_CONVERT");first?.fail(new Error("PRIVATE ERROR"));other?.step("DOCX_RENDER");other?.fail(new TypeError("SECRET"));
 const result=takeCon18WorkerDiagnostic(worker,token,coordinates(2));expect(result).toEqual({status:"OBSERVED",stage:"PDF_CONVERT",errorKind:"ERROR"});expect(JSON.stringify(result)).not.toMatch(/PRIVATE|SECRET|10000000/);
 expect(takeCon18WorkerDiagnostic(worker,token,coordinates(3))).toEqual({status:"UNAVAILABLE"});closeCon18WorkerDiagnostic(worker,token);expect(beginCon18WorkerJob(worker,job(4))).toBeUndefined();
});
it("fails closed on mismatched, duplicate and overflow observations",()=>{
 for(const mode of ["mismatch","duplicate","overflow"]){const worker={},token=armCon18WorkerDiagnostic(worker);const first=beginCon18WorkerJob(worker,job(2));first?.fail(new Error("private"));
  if(mode==="duplicate")beginCon18WorkerJob(worker,job(2))?.fail(new Error("private"));
  if(mode==="overflow")for(let n=3;n<13;n++)beginCon18WorkerJob(worker,job(n))?.fail(new Error("private"));
  expect(takeCon18WorkerDiagnostic(worker,token,coordinates(mode==="mismatch"?4:2))).toEqual({status:"UNAVAILABLE"});closeCon18WorkerDiagnostic(worker,token);
 }
});
it("does not expose successful work or allow foreign tokens",()=>{
 const a={},b={},token=armCon18WorkerDiagnostic(a),foreign=armCon18WorkerDiagnostic(b);beginCon18WorkerJob(a,job(2))?.success();
 expect(takeCon18WorkerDiagnostic(a,foreign,coordinates(2))).toEqual({status:"UNAVAILABLE"});expect(takeCon18WorkerDiagnostic(a,token,coordinates(2))).toEqual({status:"UNAVAILABLE"});
 closeCon18WorkerDiagnostic(a,token);closeCon18WorkerDiagnostic(b,foreign);
});
it("never evaluates error or coordinate accessors and drops opaque inputs",()=>{
 const worker={},token=armCon18WorkerDiagnostic(worker),record=beginCon18WorkerJob(worker,job(2));let traps=0;
 const error=new Error("private");Object.defineProperty(error,"code",{get(){traps++;throw Error("secret");}});record?.fail(error);
 const unsafe={...coordinates(2)};Object.defineProperty(unsafe,"generationId",{get(){traps++;throw Error("secret");}});
 expect(takeCon18WorkerDiagnostic(worker,token,unsafe)).toEqual({status:"UNAVAILABLE"});expect(traps).toBe(0);closeCon18WorkerDiagnostic(worker,token);
});
it("classifies a Prisma error by a fixed code without retaining its message",()=>{
 const worker={},token=armCon18WorkerDiagnostic(worker),record=beginCon18WorkerJob(worker,job(2));record?.step("PUBLISH");record?.fail(new Prisma.PrismaClientKnownRequestError("PRIVATE",{code:"P2028",clientVersion:"fictional"}));
 expect(takeCon18WorkerDiagnostic(worker,token,coordinates(2))).toEqual({status:"OBSERVED",stage:"PUBLISH",errorKind:"KNOWN_REQUEST_ERROR",prismaCode:"P2028"});closeCon18WorkerDiagnostic(worker,token);
});
it("drops a late worker failure after the diagnostic window closes",()=>{
 const worker={},token=armCon18WorkerDiagnostic(worker),record=beginCon18WorkerJob(worker,job(2));closeCon18WorkerDiagnostic(worker,token);record?.step("PDF_CONVERT");record?.fail(new Error("PRIVATE"));
 expect(takeCon18WorkerDiagnostic(worker,token,coordinates(2))).toEqual({status:"UNAVAILABLE"});
});

it("omits an unrecognized publication phase from the scoped diagnostic", () => {
 const worker = {}, token = armCon18WorkerDiagnostic(worker);
 const record = beginCon18WorkerJob(worker, job(2));
 try {
  record?.step("PUBLISH");
  record?.publishStep("PRIVATE_UNRECOGNIZED" as never);
  record?.fail(new Error("PRIVATE_MESSAGE"));
  expect(takeCon18WorkerDiagnostic(worker, token, coordinates(2))).toEqual({status:"OBSERVED",stage:"PUBLISH",errorKind:"ERROR"});
 } finally { closeCon18WorkerDiagnostic(worker, token); }
});
