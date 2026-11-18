import {makePendingPaymentAttempt,readPendingPaymentAttempt,type PendingPaymentAttempt} from "./registered-payment-pending-attempt";

type PaymentStorage=Pick<Storage,"getItem"|"setItem"|"removeItem">;
export interface PaymentLockPort { request<T>(name:string,options:{mode:"exclusive"},callback:()=>T|PromiseLike<T>):Promise<T> }
const key=(userId:string)=>`jiangkong-payment-pending:v1:${userId}`;
const canonical=(pointer:PendingPaymentAttempt)=>JSON.stringify({...makePendingPaymentAttempt(pointer.userId,pointer.paymentId,pointer.command,pointer.draft),phase:pointer.phase});

// Only this tab's older session record is readable. Other pre-upgrade tabs
// must be closed or upgraded before cross-tab recovery can be relied upon.
export async function withSharedPaymentStorage<T>(userId:string,shared:PaymentStorage,legacy:PaymentStorage,locks:PaymentLockPort|undefined,operation:(storage:PaymentStorage)=>T,validate:()=>void=()=>{}):Promise<T> {
 if(!userId || !locks || typeof locks.request!=="function") throw new Error("PAYMENT_SHARED_LOCK_UNAVAILABLE");
 return locks.request(`jiangkong-payment-pending:v1:${userId}`,{mode:"exclusive"},()=>{
  validate();
  const oldRaw=legacy.getItem(key(userId));
  const sharedRaw=shared.getItem(key(userId));
  if(oldRaw!==null){
   const old=readPendingPaymentAttempt(userId,()=>legacy);
   if(old.kind!=="restored") throw new Error("PAYMENT_LEGACY_RECORD_UNREADABLE");
   const intended=canonical(old.attempt),current=sharedRaw;
   if(current!==null){const existing=readPendingPaymentAttempt(userId,()=>shared);if(existing.kind!=="restored"||canonical(existing.attempt)!==intended)throw new Error("PAYMENT_LEGACY_RECORD_CONFLICT");}
   else {shared.setItem(key(userId),intended);if(shared.getItem(key(userId))!==intended)throw new Error("PAYMENT_SHARED_WRITE_UNCONFIRMED");}
   if(legacy.getItem(key(userId))!==oldRaw)throw new Error("PAYMENT_LEGACY_RECORD_CHANGED");
   legacy.removeItem(key(userId));
   if(legacy.getItem(key(userId))!==null)throw new Error("PAYMENT_LEGACY_REMOVE_UNCONFIRMED");
  }
  return operation(shared);
 });
}
