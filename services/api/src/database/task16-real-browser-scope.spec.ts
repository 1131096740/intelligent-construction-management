import { createTask16BrowserCompletionGate } from "./task16-real-browser-completion-scope";
import { createTask16BrowserSubmissionGate, task16RealBrowserRequestAllowed } from "./task16-real-browser-scope";
const scope={paymentId:"11111111-1111-4111-8111-111111111111",executionIds:[],resultKeys:[],fileIds:[]};
it("admits only the fixed payment page query and existing scoped routes",()=>{
 expect(task16RealBrowserRequestAllowed("GET","/payments?view=formal_ledger&page=1&pageSize=20",scope)).toBe(true);
 expect(task16RealBrowserRequestAllowed("GET","/payment-executions/work-items",scope)).toBe(true);
 expect(task16RealBrowserRequestAllowed("GET","/projects",scope)).toBe(true);
 expect(task16RealBrowserRequestAllowed("GET","/operating-projections/as-of?asOf=2026-11-17&scopeKind=projects",scope)).toBe(true);
 expect(task16RealBrowserRequestAllowed("GET","/operating-projections/as-of?numericProtocolVersion=2&asOf=2026-11-17&scopeKind=projects",scope)).toBe(true);
 expect(task16RealBrowserRequestAllowed("GET","/operating-projections/as-of?numericProtocolVersion=3&asOf=2026-11-17&scopeKind=projects",scope)).toBe(false);
 expect(task16RealBrowserRequestAllowed("GET","/operating-projections/as-of?asOf=2026-11-17&scopeKind=projects&x=1",scope)).toBe(false);
 expect(task16RealBrowserRequestAllowed("POST","/operating-projections/as-of?asOf=2026-11-17&scopeKind=projects",scope)).toBe(false);
 expect(task16RealBrowserRequestAllowed("GET","/projects",{...scope,paymentId:"bad"})).toBe(false);
 expect(task16RealBrowserRequestAllowed("GET","/contract-relationship-ledger?section=payments&asOf=2026-11-17",scope)).toBe(true);
 expect(task16RealBrowserRequestAllowed("GET","/contract-relationship-ledger?section=contracts&asOf=2026-11-17",scope)).toBe(false);
 for(const raw of ["/payments?view=formal_ledger&page=2&pageSize=20","/payments?view=formal_ledger&page=1&pageSize=20&x=1","/payments?view=my_drafts&page=1&pageSize=20","/payments?view=formal_ledger&page=1&pageSize=21","/payments?view=formal_ledger&page=1&pageSize=20#x","//other/payments?view=formal_ledger&page=1&pageSize=20"])expect(task16RealBrowserRequestAllowed("GET",raw,scope)).toBe(false);
 expect(task16RealBrowserRequestAllowed("POST","/payments?view=formal_ledger&page=1&pageSize=20",scope)).toBe(false);
});

it("seals the original key before admitting exactly one matching payment",()=>{
 const proof=jest.fn(),opening={id:"opening",sourceId:"source"};
 const gate=createTask16BrowserSubmissionGate({companyId:"company",paidAt:"2026-11-07",getOpening:()=>opening,record:proof});
 const key="22222222-2222-4222-8222-222222222222",body={idempotencyKey:key,amountCents:"3000",scopeKey:"company:company",paidAt:"2026-11-07",openingTreatment:"not_included",expectedRegistrationId:"opening",sourceAllocations:[{sourceBatchId:"source",amountCents:"3000"}]};
 expect(gate({...body,amountCents:"3001"})).toBe(false);expect(proof).not.toHaveBeenCalled();
 proof.mockImplementationOnce(()=>{throw Error("evidence unavailable");});expect(gate(body)).toBe(false);
 expect(gate(body)).toBe(true);expect(proof).toHaveBeenCalledTimes(2);expect(proof.mock.calls[1]![0]).toMatch(/^[a-f0-9]{64}$/u);expect(proof.mock.calls[1]![0]).not.toContain(key);
 expect(gate(body)).toBe(false);expect(proof).toHaveBeenCalledTimes(2);
});

it("admits the second unique payment only after independently reconciling the first",()=>{
 const opening={id:"opening",sourceId:"source"}, records:string[]=[];
 const gate=createTask16BrowserCompletionGate({companyId:"company",paidAt:"2026-11-07",getOpening:()=>opening,record:(_stage,digest)=>{records.push(digest);}});
 const first="22222222-2222-4222-8222-222222222222",second="33333333-3333-4333-8333-333333333333";
 const body=(idempotencyKey:string,amountCents:string)=>({idempotencyKey,amountCents,scopeKey:"company:company",paidAt:"2026-11-07",openingTreatment:"not_included",expectedRegistrationId:"opening",sourceAllocations:[{sourceBatchId:"source",amountCents}]});
 expect(gate.admit(body(second,"7000"))).toBe(false);
 expect(gate.admit(body(first,"3000"))).toBe(true);
 expect(gate.admit(body(second,"7000"))).toBe(false);
 expect(()=>gate.reconciledFirst(false)).toThrow();
 expect(gate.admit(body(first,"3000"))).toBe(false);
 gate.reconciledFirst(true);
 expect(gate.admit(body(first,"7000"))).toBe(false);
 expect(gate.admit(body(second,"7000"))).toBe(true);
 expect(gate.admit(body(second,"7000"))).toBe(false);
 expect(records).toHaveLength(2);expect(records[0]).not.toBe(records[1]);
});

it("never retries when sealing a completion key fails",()=>{
 const record=jest.fn(()=>{throw Error("disk failure")});
 const gate=createTask16BrowserCompletionGate({companyId:"company",paidAt:"2026-11-07",getOpening:()=>({id:"opening",sourceId:"source"}),record});
 const body={idempotencyKey:"22222222-2222-4222-8222-222222222222",amountCents:"3000",scopeKey:"company:company",paidAt:"2026-11-07",openingTreatment:"not_included",expectedRegistrationId:"opening",sourceAllocations:[{sourceBatchId:"source",amountCents:"3000"}]};
 expect(gate.admit(body)).toBe(false);expect(gate.admit(body)).toBe(false);expect(record).toHaveBeenCalledTimes(1);
});

it("allows only the exact same-run authorized ticket and file",()=>{
 const fileId="33333333-3333-4333-8333-333333333333",fileScope={...scope,fileIds:[fileId]},ticket=`/files/${fileId}/download?token=opaque`;
 expect(task16RealBrowserRequestAllowed("GET",ticket,fileScope)).toBe(false);
 expect(task16RealBrowserRequestAllowed("GET",ticket,fileScope,ticket)).toBe(true);
 expect(task16RealBrowserRequestAllowed("GET",`${ticket}x`,fileScope,ticket)).toBe(false);
 expect(task16RealBrowserRequestAllowed("GET",ticket,scope,ticket)).toBe(false);
});

it("does not re-admit the second payment if its evidence write fails",()=>{
 const record=jest.fn().mockImplementationOnce(()=>{}).mockImplementationOnce(()=>{throw Error("disk failure")});
 const gate=createTask16BrowserCompletionGate({companyId:"company",paidAt:"2026-11-07",getOpening:()=>({id:"opening",sourceId:"source"}),record});
 const body=(idempotencyKey:string,amountCents:string)=>({idempotencyKey,amountCents,scopeKey:"company:company",paidAt:"2026-11-07",openingTreatment:"not_included",expectedRegistrationId:"opening",sourceAllocations:[{sourceBatchId:"source",amountCents}]});
 expect(gate.admit(body("22222222-2222-4222-8222-222222222222","3000"))).toBe(true);gate.reconciledFirst(true);
 expect(gate.admit(body("33333333-3333-4333-8333-333333333333","7000"))).toBe(false);
 expect(gate.admit(body("44444444-4444-4444-8444-444444444444","7000"))).toBe(false);expect(record).toHaveBeenCalledTimes(2);
});
