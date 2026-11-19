import { Prisma } from "@prisma/client";
import { types } from "node:util";

// Closed normal-case query. Values are bound by the original Prisma transaction;
// all columns below already occur in the original observer's where/select sets.
const normalSnapshotSql = `WITH
 executions AS (SELECT "id","idempotencyKey","amountCents"::text AS "amountCents","paymentRequestId","voucherFileId" FROM public."PaymentExecution" WHERE "paymentRequestId"=$1),
 opening_a AS (SELECT "accountId","balanceYuan"::text AS "balanceYuan","coveredExecutionIds" FROM public."FundAccountBalanceRegistration" WHERE id=$3),
 opening_b AS (SELECT "accountId","balanceYuan"::text AS "balanceYuan","coveredExecutionIds" FROM public."FundAccountBalanceRegistration" WHERE id=$4)
SELECT
 (SELECT to_jsonb(t) FROM (SELECT "approvedAmountCents"::text AS "approvedAmountCents","paidAmountCents"::text AS "paidAmountCents",status FROM public."PaymentRequest" WHERE id=$1) t) AS request,
 (SELECT to_jsonb(t) FROM (SELECT "payableAmountCents"::text AS "payableAmountCents","paidAmountCents"::text AS "paidAmountCents" FROM public."Settlement" WHERE id=$2) t) AS settlement,
 COALESCE((SELECT jsonb_agg(to_jsonb(t)) FROM executions t),'[]'::jsonb) AS executions,
 COALESCE((SELECT jsonb_agg(to_jsonb(t)) FROM (SELECT "executionId",to_char("operatingLedgerEffectiveDateAtRegistration",'YYYY-MM-DD') AS "operatingLedgerEffectiveDateAtRegistration","actualPayerId","actualPayerKind" FROM public."RegisteredPaymentFunding" WHERE "executionId" IN (SELECT id FROM executions)) t),'[]'::jsonb) AS funding,
 COALESCE((SELECT jsonb_agg(to_jsonb(t)) FROM (SELECT "executionId","accountId","sourceBatchId","amountCents"::text AS "amountCents" FROM public."RegisteredFundPaymentAllocation" WHERE "executionId" IN (SELECT id FROM executions)) t),'[]'::jsonb) AS allocations,
 COALESCE((SELECT jsonb_agg(to_jsonb(t)) FROM (SELECT "executionId" FROM public."RegisteredPaymentEvent" WHERE "executionId" IN (SELECT id FROM executions)) t),'[]'::jsonb) AS events,
 COALESCE((SELECT jsonb_agg(to_jsonb(t)) FROM (SELECT id,"paymentExecutionId","sourceType","entryKind",direction,status,"originalDebtorCompanyId","creditorCompanyId","amountCents"::text AS "amountCents","projectId" FROM public."InterEntityRelationshipEntry" WHERE "paymentExecutionId" IN (SELECT id FROM executions)) t),'[]'::jsonb) AS roots,
 COALESCE((SELECT jsonb_agg(to_jsonb(t)) FROM (SELECT id FROM public."OperatingFact" WHERE "sourceType"='payment_execution' AND "sourceBusinessId" IN (SELECT id FROM executions)) t),'[]'::jsonb) AS facts,
 COALESCE((SELECT jsonb_agg(to_jsonb(t)) FROM (SELECT id FROM public."OperatingImpactEntry" WHERE "sourceType"='payment_execution' AND "sourceBusinessId" IN (SELECT id FROM executions)) t),'[]'::jsonb) AS impacts,
 COALESCE((SELECT jsonb_agg(to_jsonb(t)) FROM (SELECT "actorUserId",metadata FROM public."AuditLog" WHERE "businessType"='payment_request' AND "businessId"=$1 AND action='payment.execution.record') t),'[]'::jsonb) AS audits,
 (SELECT to_jsonb(t) FROM opening_a t) AS "openingA",(SELECT to_jsonb(t) FROM opening_b t) AS "openingB",
 COALESCE((SELECT jsonb_agg(to_jsonb(t)) FROM (SELECT "executionId","accountId","sourceBatchId","amountCents"::text AS "amountCents" FROM public."RegisteredFundPaymentAllocation" WHERE "accountId" IN (SELECT "accountId" FROM opening_a UNION ALL SELECT "accountId" FROM opening_b)) t),'[]'::jsonb) AS postings`;
function fail(): never { throw Object.defineProperty(new Error("PG_CASE_NORMAL_SNAPSHOT_DECODE"),"code",{value:"PG_CASE_NORMAL_SNAPSHOT_DECODE"}); }
function own(value: unknown,key: string): unknown {
 if(!value||typeof value!=="object"||types.isProxy(value))return fail();
 const d=Object.getOwnPropertyDescriptor(value,key);if(!d||!Object.hasOwn(d,"value"))return fail();return d.value;
}
function array(value: unknown): unknown[] {
 if(!Array.isArray(value)||types.isProxy(value))return fail();
 return Array.from({length:value.length},(_,i)=>own(value,String(i)));
}
const text=(value: unknown): string=>{if(typeof value!=="string")return fail();return value;};
const integer=(value: unknown): bigint=>{const v=text(value);if(!/^-?(0|[1-9][0-9]*)$/u.test(v))return fail();return BigInt(v);};
const nullable=<T>(decode:(value:unknown)=>T)=>(value:unknown):T|null=>value===null?null:decode(value);
function row<S extends Record<string,(value:unknown)=>unknown>>(value:unknown,schema:S):{[K in keyof S]:ReturnType<S[K]>} {
 if(!value||typeof value!=="object"||types.isProxy(value)||Reflect.ownKeys(value).length!==Object.keys(schema).length)return fail();
 return Object.fromEntries(Object.entries(schema).map(([key,decode])=>[key,decode(own(value,key))])) as {[K in keyof S]:ReturnType<S[K]>};
}
function json(value:unknown,depth=0):Prisma.JsonValue {
 if(depth>32)return fail();
 if(value===null||typeof value==="string"||typeof value==="boolean")return value;
 if(typeof value==="number"&&Number.isFinite(value))return value;
 if(Array.isArray(value))return array(value).map(item=>json(item,depth+1));
 if(!value||typeof value!=="object"||types.isProxy(value))return fail();
 return Object.fromEntries(Reflect.ownKeys(value).map(key=>{if(typeof key!=="string")return fail();return [key,json(own(value,key),depth+1)];}));
}
const date=(value:unknown):Date=>{const s=text(value);if(!/^\d{4}-\d\d-\d\d$/u.test(s))return fail();const d=new Date(s+"T00:00:00.000Z");if(!Number.isFinite(d.getTime())||d.toISOString().slice(0,10)!==s)return fail();return d;};
const posting={executionId:text,accountId:text,sourceBatchId:text,amountCents:integer};
const opening={accountId:text,balanceYuan:nullable((value:unknown)=>{const s=text(value);if(!/^-?[0-9]+(?:\.[0-9]+)?$/u.test(s))return fail();return new Prisma.Decimal(s);}),coveredExecutionIds:(v:unknown)=>array(v).map(text)};

/** One query only; caller owns the original RR transaction and before/after guards. */
export async function readRegisteredNormalSnapshot(tx:Prisma.TransactionClient,payment:string,settlement:string,openingAId:string,openingBId:string) {
 const results=await tx.$queryRawUnsafe<unknown[]>(normalSnapshotSql,payment,settlement,openingAId,openingBId);
 const result=array(results);if(result.length!==1)return fail();const source=result[0];
 const request=row(own(source,"request"),{approvedAmountCents:integer,paidAmountCents:integer,status:text});
 const settlementRow=row(own(source,"settlement"),{payableAmountCents:integer,paidAmountCents:integer});
 const executions=array(own(source,"executions")).map(v=>row(v,{id:text,idempotencyKey:text,amountCents:integer,paymentRequestId:text,voucherFileId:nullable(text)}));
 const funding=array(own(source,"funding")).map(v=>row(v,{executionId:text,operatingLedgerEffectiveDateAtRegistration:nullable(date),actualPayerId:nullable(text),actualPayerKind:text}));
 const allocations=array(own(source,"allocations")).map(v=>row(v,posting));
 const events=array(own(source,"events")).map(v=>row(v,{executionId:text}));
 const roots=array(own(source,"roots")).map(v=>row(v,{id:text,paymentExecutionId:nullable(text),sourceType:text,entryKind:text,direction:text,status:text,originalDebtorCompanyId:nullable(text),creditorCompanyId:nullable(text),amountCents:integer,projectId:nullable(text)}));
 const facts=array(own(source,"facts")).map(v=>row(v,{id:text}));
 const impacts=array(own(source,"impacts")).map(v=>row(v,{id:text}));
 const audits=array(own(source,"audits")).map(v=>row(v,{actorUserId:nullable(text),metadata:json}));
 const openingA=row(own(source,"openingA"),opening),openingB=row(own(source,"openingB"),opening);
 const postings=array(own(source,"postings")).map(v=>row(v,posting));
 return {request,settlement:settlementRow,executions,funding,allocations,events,roots,facts,impacts,audits,openingA,openingB,postings};
}

/** Pure financial assertions run only after the caller's original query after-guard. */
export function finishRegisteredNormalSnapshot(snapshot:Awaited<ReturnType<typeof readRegisteredNormalSnapshot>>) {
 const {request,settlement,executions,funding,allocations,events,roots,facts,impacts,audits,openingA,openingB,postings}=snapshot;
 const accountAmount=(o:typeof openingA)=>{
  if(o.balanceYuan===null)throw Object.defineProperty(new Error("PG_CASE_INITIAL_BALANCE_MUST_BE_KNOWN"),"code",{value:"PG_CASE_INITIAL_BALANCE_MUST_BE_KNOWN"});const covered=new Set(o.coveredExecutionIds);
  const spent=postings.filter(p=>p.accountId===o.accountId&&!covered.has(p.executionId)).reduce((sum,p)=>sum+p.amountCents,0n);
  if(spent<0n)throw Object.defineProperty(new Error("PG_CASE_POSTING_DIRECTION"),"code",{value:"PG_CASE_POSTING_DIRECTION"});return o.balanceYuan.minus(`${spent/100n}.${(spent%100n).toString().padStart(2,"0")}`).toFixed(4);
 };
 return {request,settlement,executions,funding,allocations,events,roots,facts,impacts,audits,balanceA:accountAmount(openingA),balanceB:accountAmount(openingB)};
}
