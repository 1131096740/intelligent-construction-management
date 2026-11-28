import { createHash } from "node:crypto";
import { task16SharedPaymentRequestAllowed } from "./task16-shared-payment-application";

type Scope={paymentId:string;executionIds:readonly string[];resultKeys:readonly string[];fileIds:readonly string[]};
/** Narrow test-only ingress for the actual payment page. Never grants DB access. */
export function task16RealBrowserRequestAllowed(method:string,raw:string,scope:Scope,ticket?:string):boolean {
 const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
 if (!scope || !uuid.test(scope.paymentId) || ![...scope.executionIds,...scope.resultKeys,...scope.fileIds].every(value=>uuid.test(value))) return false;
 if (method==="GET" && raw==="/payments?view=formal_ledger&page=1&pageSize=20") return true;
 if (method==="GET" && raw==="/projects") return true;
 if (method==="GET" && /^\/operating-projections\/as-of\?(?:numericProtocolVersion=2&)?asOf=\d{4}-\d{2}-\d{2}&scopeKind=projects$/u.test(raw)) return true;
 if (method==="GET" && /^\/contract-relationship-ledger\?section=payments&asOf=\d{4}-\d{2}-\d{2}$/u.test(raw)) return true;
 return task16SharedPaymentRequestAllowed(method,raw,scope,ticket);
}

/** Admits one bounded synthetic command only after its key digest is persisted. */
export function createTask16BrowserSubmissionGate(input:{companyId:string;paidAt:string;getOpening:()=>{id:string;sourceId:string}|undefined;record:(keySha256:string)=>void}) {
 let submitted=false;
 return (body:Record<string,unknown>|undefined):boolean=>{
  const opening=input.getOpening(),key=body?.idempotencyKey;
  if(submitted || !opening || typeof key!=="string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(key) || body?.amountCents!=="3000" || body.scopeKey!==`company:${input.companyId}` || body.paidAt!==input.paidAt || body.openingTreatment!=="not_included" || body.expectedRegistrationId!==opening.id || JSON.stringify(body.sourceAllocations)!==JSON.stringify([{sourceBatchId:opening.sourceId,amountCents:"3000"}])) return false;
  try{input.record(createHash("sha256").update(key).digest("hex"));}catch{return false;}
  submitted=true;return true;
 };
}
