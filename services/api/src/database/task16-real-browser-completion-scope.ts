import { createHash } from "node:crypto";

/** Test-only two-payment gate. Once evidence writing begins, failure stays closed. */
export function createTask16BrowserCompletionGate(input:{companyId:string;paidAt:string;getOpening:()=>{id:string;sourceId:string}|undefined;record:(stage:1|2,keySha256:string)=>void}) {
 let stage: "first"|"awaiting-observer"|"second"|"closed" = "first";
 let firstDigest: string|undefined;
 return {
  admit(body:Record<string,unknown>|undefined):boolean {
   const opening=input.getOpening(),key=body?.idempotencyKey;
   if((stage!=="first"&&stage!=="second")||!opening||typeof key!=="string"||!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(key))return false;
   const amount=stage==="first"?"3000":"7000",digest=createHash("sha256").update(key).digest("hex");
   if(digest===firstDigest||body?.amountCents!==amount||body.scopeKey!==`company:${input.companyId}`||body.paidAt!==input.paidAt||body.openingTreatment!=="not_included"||body.expectedRegistrationId!==opening.id||JSON.stringify(body.sourceAllocations)!==JSON.stringify([{sourceBatchId:opening.sourceId,amountCents:amount}]))return false;
   const current=stage==="first"?1:2;stage="closed";
   try{input.record(current,digest);}catch{return false;}
   if(current===1){firstDigest=digest;stage="awaiting-observer";}
   return true;
  },
  reconciledFirst(success:boolean):void {
   if(stage!=="awaiting-observer"||success!==true)throw new Error("TASK398_FIRST_RECONCILIATION_REQUIRED");
   stage="second";
  }
 };
}
