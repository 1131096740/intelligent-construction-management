import { AuthRateLimitService } from "../auth/auth-rate-limit.service";
import { PrismaService } from "./prisma.service";
import { takeTask12AuthTransactionPhase } from "./task12-auth-transaction-phase";
const limits=[{scope:"account-ip",value:"private-ip",seconds:900,max:300},{scope:"login-phone",value:"private-phone",seconds:900,max:30}];
async function attempt(fail: string, error = new Error("private SQL password"), request = {}) {
 const calls:string[]=[];let ordinal=0;
 const prisma={$transaction:async (callback: (tx: unknown)=>Promise<boolean>)=>{calls.push("transaction");if(fail==="before")throw error;
  const value=await callback({authRateLimit:{deleteMany:async()=>{calls.push("delete");if(fail==="delete")throw error;},upsert:async()=>{calls.push("upsert"+(++ordinal));if(fail==="upsert"+ordinal)throw error;return {hits:1};}}});if(fail==="after")throw error;return value;}};
 const service=new AuthRateLimitService(prisma as unknown as PrismaService);
 try {await (service.take as (...args:unknown[])=>Promise<void>)(limits,request);}catch(value){expect(value).toBe(error);}
 return {calls,error,request};
}
test.each([["before","PRE_CALLBACK_UNRESOLVED",["transaction"]],["delete","DELETE_PENDING",["transaction","delete"]],["upsert1","UPSERT_1_PENDING",["transaction","delete","upsert1"]],["upsert2","UPSERT_2_PENDING",["transaction","delete","upsert1","upsert2"]],["after","POST_CALLBACK_UNRESOLVED",["transaction","delete","upsert1","upsert2"]]])("original %s rejection retains its own bounded application phase",async(failure,phase,calls)=>{
 const result=await attempt(failure as string);expect(result.calls).toEqual(calls);
 const proof=takeTask12AuthTransactionPhase(result.error,result.request);expect(proof).toMatchObject({operation:"ACCOUNT_RATE_LIMIT",phase});
 expect(JSON.stringify(proof)).not.toMatch(/private|SQL|password|BEGIN|COMMIT/);
});

test("same Error reused across requests is permanently unknown; foreign, stale and duplicate reads cannot borrow",async()=>{
 const error=new Error("private");const first=await attempt("delete",error);
 expect(takeTask12AuthTransactionPhase(error,{})).toBeUndefined();
 expect(takeTask12AuthTransactionPhase(error,first.request,Number.MAX_SAFE_INTEGER)).toBeUndefined();
 expect(takeTask12AuthTransactionPhase(error,first.request)).toMatchObject({phase:"DELETE_PENDING"});
 expect(takeTask12AuthTransactionPhase(error,first.request)).toBeUndefined();
 const second=await attempt("upsert2",error);expect(takeTask12AuthTransactionPhase(error,second.request)).toBeUndefined();
});
test("untrusted getters and proxy errors are never traversed",async()=>{
 let reads=0;const error=new Proxy(new Error("private"),{get(){reads++;throw Error();},getOwnPropertyDescriptor(){reads++;throw Error();}});
 const result=await attempt("delete",error);expect(takeTask12AuthTransactionPhase(error,result.request)).toBeUndefined();expect(reads).toBe(0);
});

test("concurrent requests sharing the same Error omit both rather than lending a phase",async()=>{
 const error=new Error("private");const [a,b]=await Promise.all([attempt("delete",error),attempt("upsert2",error)]);
 expect(takeTask12AuthTransactionPhase(error,a.request)).toBeUndefined();expect(takeTask12AuthTransactionPhase(error,b.request)).toBeUndefined();
});
test.each([1,2])("original rate-limit denial after upsert%s preserves short circuit and429",async deny=>{
 const calls:string[]=[];let ordinal=0;
 const prisma={$transaction:async(callback:(tx:unknown)=>Promise<boolean>)=>{calls.push("transaction");return callback({authRateLimit:{deleteMany:async()=>{calls.push("delete");},upsert:async()=>{calls.push("upsert"+(++ordinal));return {hits:ordinal===deny?(deny===1?301:31):1};}}});}};
 const service=new AuthRateLimitService(prisma as unknown as PrismaService);
 await expect(service.take(limits,{})).rejects.toMatchObject({status:429});expect(calls).toEqual(deny===1?["transaction","delete","upsert1"]:["transaction","delete","upsert1","upsert2"]);
});
