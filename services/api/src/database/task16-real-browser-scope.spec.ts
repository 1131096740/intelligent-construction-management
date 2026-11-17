import { createTask16BrowserSubmissionGate, task16RealBrowserRequestAllowed } from "./task16-real-browser-scope";
const scope={paymentId:"11111111-1111-4111-8111-111111111111",executionIds:[],resultKeys:[],fileIds:[]};
it("admits only the fixed payment page query and existing scoped routes",()=>{
 expect(task16RealBrowserRequestAllowed("GET","/payments?view=formal_ledger&page=1&pageSize=20",scope)).toBe(true);
 expect(task16RealBrowserRequestAllowed("GET","/payment-executions/work-items",scope)).toBe(true);
 expect(task16RealBrowserRequestAllowed("GET","/projects",scope)).toBe(true);
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
