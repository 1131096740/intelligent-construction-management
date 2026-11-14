import { performance } from "node:perf_hooks";
import { types } from "node:util";
export type Task12AuthTransactionPhase = Readonly<{
 operation: "ACCOUNT_RATE_LIMIT";
 phase: "PRE_CALLBACK_UNRESOLVED" | "DELETE_PENDING" | "DELETE_RETURNED" | "UPSERT_1_PENDING" | "UPSERT_1_RETURNED" | "UPSERT_2_PENDING" | "UPSERT_2_RETURNED" | "POST_CALLBACK_UNRESOLVED";
 upsertOrdinal: 0 | 1 | 2; callbackEntered: boolean; callbackReturned: boolean; elapsedMs: number; phaseElapsedMs: number;
}>;
type Step = "TX_CALL" | "CALLBACK_ENTERED" | "DELETE_PENDING" | "DELETE_RETURNED" | "UPSERT_1_PENDING" | "UPSERT_1_RETURNED" | "UPSERT_2_PENDING" | "UPSERT_2_RETURNED" | "CALLBACK_RETURNED" | "TX_RESOLVED";
type Entry = { request: object; proof: Task12AuthTransactionPhase; taken: boolean; recordedAt: number };
const errors = new WeakMap<object, Entry | false>();
export function observeTask12AuthTransaction(request?: object) {
 const started=performance.now();let changed=started,phase: Step="TX_CALL",ordinal: 0|1|2=0,entered=false,returned=false,valid=true;
 return {
  step(next: Step, index = 0) {
   try { if(index>2){valid=false;return;} phase=next;changed=performance.now();if(index)ordinal=index as 1|2;
    if(next==="CALLBACK_ENTERED")entered=true;if(next==="CALLBACK_RETURNED")returned=true;
   } catch { valid=false; }
  },
  capture(error: unknown) {
   try {
    if(!error || typeof error!=="object" || types.isProxy(error) || !types.isNativeError(error))return;
    // Tombstones remain after consumption: a reused Error can never lend an old request its phase.
    if(errors.has(error)){errors.set(error,false);return;}
    if(!valid || !request || types.isProxy(request) || phase==="TX_RESOLVED")return;
    const now=performance.now(),elapsedMs=Math.round(now-started),phaseElapsedMs=Math.round(now-changed);
    if(!Number.isSafeInteger(elapsedMs)||elapsedMs<0||elapsedMs>3600000||phaseElapsedMs<0||phaseElapsedMs>elapsedMs)return;
    const observed=phase==="TX_CALL"?"PRE_CALLBACK_UNRESOLVED":phase==="CALLBACK_RETURNED"?"POST_CALLBACK_UNRESOLVED":phase;
    if(observed==="CALLBACK_ENTERED")return;
    const proof=Object.freeze({operation:"ACCOUNT_RATE_LIMIT" as const,phase:observed,upsertOrdinal:ordinal,callbackEntered:entered,callbackReturned:returned,elapsedMs,phaseElapsedMs});
    errors.set(error,{request,proof,taken:false,recordedAt:now});
   } catch { /* A diagnostic must preserve the original exception. */ }
  }
 };
}
export function takeTask12AuthTransactionPhase(error: unknown, request: unknown, notBefore=0): Task12AuthTransactionPhase | undefined {
 try {
  if(!error||typeof error!=="object"||types.isProxy(error)||!request||typeof request!=="object"||types.isProxy(request))return;
  const entry=errors.get(error);if(!entry||entry.taken||entry.request!==request||entry.recordedAt<notBefore||performance.now()-entry.recordedAt>15000)return;
  entry.taken=true;return entry.proof;
 } catch { return; }
}
