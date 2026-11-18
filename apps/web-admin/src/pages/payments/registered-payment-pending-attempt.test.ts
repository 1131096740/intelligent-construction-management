import {describe,it,expect} from "vitest";
import {makePendingPaymentAttempt,readPendingPaymentAttempt,writePendingPaymentAttempt,clearPreparedPaymentAttempt,updatePreparedPaymentAttempt} from "./registered-payment-pending-attempt";
const command={idempotencyKey:"original-key",expectedPaymentUpdatedAt:"2026-11-01",amountCents:"3000",paidAt:"2026-11-01",scopeKey:"company:a",expectedRegistrationId:"reg",openingTreatment:"not_included" as const,openingReason:"reason",openingEvidence:"evidence",sourceAllocations:[{sourceBatchId:"source",amountCents:"3000"}]};
const draft={amountYuan:"30",paidAt:command.paidAt,scopeKey:command.scopeKey,treatment:command.openingTreatment,reason:"reason",evidence:"evidence",accountName:"A",allocations:[{sourceBatchId:"source",amountYuan:"30"}]};
const attempt=makePendingPaymentAttempt("user","payment",command,draft);
function memory(){let value:string|null=null;return {getItem:()=>value,setItem:(_key:string,v:string)=>{value=v;},removeItem:()=>{value=null;}};}
describe("payment recovery storage",()=>{
 it("blocks a new attempt when the prior pointer cannot be read",()=>{const result=readPendingPaymentAttempt("user",()=>({getItem(){throw Error("unavailable");},setItem(){},removeItem(){}}));expect(result).toMatchObject({kind:"unreadable",blocksNewAttempt:true});});
 it("treats an empty existing pointer as unreadable rather than absent",()=>{const store={getItem:()=>"",setItem(){},removeItem(){}};expect(readPendingPaymentAttempt("user",()=>store)).toMatchObject({kind:"unreadable",blocksNewAttempt:true});});
 it("does not authorize submission when writing or reading back fails",()=>{const store=memory();expect(writePendingPaymentAttempt(attempt,()=>({...store,setItem(){throw Error("quota");}})).saved).toBe(false);let calls=0;expect(writePendingPaymentAttempt(attempt,()=>({...store,getItem(){if(++calls===2)throw Error("unavailable");return null;}})).saved).toBe(false);});
 it("rejects a storage implementation that accepts writes but cannot read them back",()=>{const store={getItem:()=>null,setItem(){},removeItem(){}};expect(writePendingPaymentAttempt(attempt,()=>store).saved).toBe(false);});
 it("preserves an existing different request rather than overwrite it",()=>{const store=memory(),other=makePendingPaymentAttempt("user","other",{...command,idempotencyKey:"different-key"},draft);store.setItem("",JSON.stringify(other));expect(writePendingPaymentAttempt(attempt,()=>store).saved).toBe(false);expect(readPendingPaymentAttempt("user",()=>store)).toMatchObject({kind:"restored",attempt:{paymentId:"other"}});});
 it("saves a verified pointer and permits a retry after storage recovers",()=>{const store=memory();expect(writePendingPaymentAttempt(attempt,()=>store).saved).toBe(true);expect(readPendingPaymentAttempt("user",()=>store)).toMatchObject({kind:"restored",attempt:{paymentId:"payment"}});expect(writePendingPaymentAttempt(attempt,()=>store).saved).toBe(false);});
});

it("retains a safe prepared pointer after write succeeded but readback failed, including after refresh",()=>{
 let stored:string|null=null,reads=0;const store={getItem:()=>{reads++;if(reads===2)throw Error("temporary failure");return stored;},setItem:(_key:string,value:string)=>{stored=value;},removeItem:()=>{stored=null;}};
 expect(writePendingPaymentAttempt(attempt,()=>store).saved).toBe(false);const restored=readPendingPaymentAttempt("user",()=>store);expect(restored).toMatchObject({kind:"restored",attempt:{phase:"prepared"}});
 if(restored.kind!=="restored")throw Error("missing");expect(clearPreparedPaymentAttempt(restored.attempt,()=>store)).toBe(true);expect(readPendingPaymentAttempt("user",()=>store).kind).toBe("missing");
});
it("treats legacy and ambiguous sending records as unknown and never clears them as prepared",()=>{
 const store=memory();const legacy={...attempt} as Partial<typeof attempt>;delete legacy.phase;store.setItem("",JSON.stringify(legacy));let restored=readPendingPaymentAttempt("user",()=>store);expect(restored).toMatchObject({kind:"restored",attempt:{phase:"sending"}});if(restored.kind!=="restored")throw Error("missing");expect(clearPreparedPaymentAttempt(restored.attempt,()=>store)).toBe(false);
 const sending={...attempt,phase:"sending"};store.setItem("",JSON.stringify(sending));restored=readPendingPaymentAttempt("user",()=>store);expect(restored).toMatchObject({kind:"restored",attempt:{phase:"sending"}});
});
it("restores the exact unsent sending marker to prepared if readback temporarily fails",()=>{
 let stored:string|null=null,reads=0;const store={getItem:()=>{reads++;if(reads===3)throw Error("sending readback");return stored;},setItem:(_key:string,value:string)=>{stored=value;},removeItem:()=>{stored=null;}};
 expect(writePendingPaymentAttempt(attempt,()=>store).saved).toBe(false);expect(readPendingPaymentAttempt("user",()=>store)).toMatchObject({kind:"restored",attempt:{phase:"prepared"}});
});
it("preserves the sending marker when cleanup cannot prove its identity",()=>{
 let stored:string|null=null,reads=0;const store={getItem:()=>{reads++;if(reads>=3)throw Error("persistent failure");return stored;},setItem:(_key:string,value:string)=>{stored=value;},removeItem:()=>{stored=null;}};
 expect(writePendingPaymentAttempt(attempt,()=>store).saved).toBe(false);expect(JSON.parse(stored!).phase).toBe("sending");
});
it("does not overwrite a different marker during unsent cleanup",()=>{
 let stored:string|null=null,reads=0;const other=JSON.stringify({...attempt,paymentId:"other",phase:"sending"});const store={getItem:()=>{reads++;if(reads===3){stored=other;throw Error("changed");}return stored;},setItem:(_key:string,value:string)=>{stored=value;},removeItem:()=>{stored=null;}};
 expect(writePendingPaymentAttempt(attempt,()=>store).saved).toBe(false);expect(stored).toBe(other);
});
it("never downgrades an already sending marker even for an identical command",()=>{
 const sending=JSON.stringify({...attempt,phase:"sending"});let stored:string|null=sending,writes=0;
 const store={getItem:()=>stored,setItem:(_key:string,value:string)=>{writes++;stored=value;},removeItem:()=>{stored=null;}};
 expect(writePendingPaymentAttempt(attempt,()=>store)).toMatchObject({saved:false,conflict:true});expect(writes).toBe(0);expect(stored).toBe(sending);
});

it("conditionally updates edited prepared drafts and transitions only the exact current record",()=>{
 const store=memory(),edited=makePendingPaymentAttempt("user","payment",command,{...draft,reason:"  edited  "});store.setItem("",JSON.stringify(attempt));
 expect(updatePreparedPaymentAttempt(attempt,edited,()=>store)).toBe(true);expect(writePendingPaymentAttempt(edited,()=>store,edited).saved).toBe(true);
 expect(readPendingPaymentAttempt("user",()=>store)).toMatchObject({kind:"restored",attempt:{phase:"sending",draft:{reason:"  edited  "}}});
});
it("never updates or sends if the prepared marker changed or disappeared",()=>{
 const store=memory(),edited=makePendingPaymentAttempt("user","payment",command,{...draft,reason:"new"}),sending=JSON.stringify({...attempt,phase:"sending"});store.setItem("",sending);
 expect(updatePreparedPaymentAttempt(attempt,edited,()=>store)).toBe(false);expect(writePendingPaymentAttempt(edited,()=>store,attempt).saved).toBe(false);expect(store.getItem()).toBe(sending);
 store.removeItem();expect(writePendingPaymentAttempt(edited,()=>store,attempt).saved).toBe(false);
});
it("accepts the exact intended prepared update after transient readback failure",()=>{
 let stored:string|null=JSON.stringify(attempt),reads=0;const edited=makePendingPaymentAttempt("user","payment",command,{...draft,reason:"新内容"});
 const store={getItem:()=>{reads++;if(reads===2)throw Error("readback");return stored;},setItem:(_key:string,value:string)=>{stored=value;},removeItem:()=>{stored=null;}};
 expect(updatePreparedPaymentAttempt(attempt,edited,()=>store)).toBe(false);expect(updatePreparedPaymentAttempt(attempt,edited,()=>store)).toBe(true);expect(readPendingPaymentAttempt("user",()=>store)).toMatchObject({kind:"restored",attempt:{phase:"prepared",draft:{reason:"新内容"}}});
});

it("preserves the original key, declared amount and confirmed company funding after reload", () => {
 const store = memory();
 const advance = { amountCents:"300", reason:"已核实公司自有资金", evidence:"本次付款核对单", sourceAllocations:[{sourceBatchId:"company-owned",amountCents:"300"}] };
 const original = {...command,amountCents:"800",sourceAllocations:[{sourceBatchId:"project",amountCents:"500"}],confirmedProjectAdvance:advance,confirmationPassword:"do-not-store"};
 const pointer = makePendingPaymentAttempt("user","payment",original,{...draft,amountYuan:"8",advance:{confirmed:true,reason:advance.reason,evidence:advance.evidence}});
 expect(writePendingPaymentAttempt(pointer,()=>store).saved).toBe(true);
 expect(store.getItem()).not.toContain(original.confirmationPassword);
 expect(readPendingPaymentAttempt("user",()=>store)).toMatchObject({
  kind:"restored",
  attempt:{phase:"sending",command:{idempotencyKey:"original-key",amountCents:"800",sourceAllocations:original.sourceAllocations,confirmedProjectAdvance:advance}},
 });
 store.setItem("",JSON.stringify({...pointer,command:{...pointer.command,confirmedProjectAdvance:null}}));
 expect(readPendingPaymentAttempt("user",()=>store)).toMatchObject({kind:"unreadable",blocksNewAttempt:true});
});
