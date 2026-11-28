import { Prisma } from "@prisma/client";
import { readRegisteredNormalSnapshot as readNormal, finishRegisteredNormalSnapshot } from "./registered-payment-postgres.snapshot";
async function readRegisteredNormalSnapshot(...args:Parameters<typeof readNormal>) { return finishRegisteredNormalSnapshot(await readNormal(...args)); }
function wire():Record<string,unknown> { return {request:{approvedAmountCents:"9007199254740993",paidAmountCents:"0",status:"approved_pending_payment"},settlement:{payableAmountCents:"9007199254740993",paidAmountCents:"0"},executions:[],funding:[],allocations:[],events:[],roots:[],facts:[],impacts:[],audits:[],openingA:{accountId:"a",balanceYuan:"100.1234",coveredExecutionIds:["covered"]},openingB:{accountId:"b",balanceYuan:"100.0000",coveredExecutionIds:[]},postings:[{executionId:"covered",accountId:"a",sourceBatchId:"s",amountCents:"99999"},{executionId:"other",accountId:"a",sourceBatchId:"s",amountCents:"2"}]}; }
test("one fixed four-parameter query preserves large bigint, original covered-posting arithmetic and four decimals",async()=>{
 const query=jest.fn().mockResolvedValue([wire()]);const result=await readRegisteredNormalSnapshot({$queryRawUnsafe:query} as unknown as Prisma.TransactionClient,"payment","settlement","opening-a","opening-b");
 expect(query).toHaveBeenCalledTimes(1);expect(query.mock.calls[0].slice(1)).toEqual(["payment","settlement","opening-a","opening-b"]);
 expect(result).toEqual({request:{approvedAmountCents:9007199254740993n,paidAmountCents:0n,status:"approved_pending_payment"},settlement:{payableAmountCents:9007199254740993n,paidAmountCents:0n},executions:[],funding:[],allocations:[],events:[],roots:[],facts:[],impacts:[],audits:[],balanceA:"100.1034",balanceB:"100.0000"});
});


test("decoder retains extra graph rows, nulls, DATE and JSON without rounding money",async()=>{
 const data=wire();data.executions=[{id:"e1",idempotencyKey:"key1",amountCents:"9007199254740993",paymentRequestId:"payment",voucherFileId:null},{id:"e2",idempotencyKey:"key2",amountCents:"2",paymentRequestId:"payment",voucherFileId:null}];
 data.funding=[{executionId:"e1",operatingLedgerEffectiveDateAtRegistration:"2026-01-02",actualPayerId:null,actualPayerKind:"participating_company"}];
 data.audits=[{actorUserId:null,metadata:{voucherFileId:null,voucherPending:true,actualPayer:{kind:"participating_company",id:"b"}}}];data.facts=[{id:"unexpected-fact"}];data.impacts=[{id:"unexpected-impact"}];
 const query=jest.fn().mockResolvedValue([data]);const result=await readRegisteredNormalSnapshot({$queryRawUnsafe:query} as unknown as Prisma.TransactionClient,"p","s","a","b");
 expect(result.executions.map(e=>e.amountCents)).toEqual([9007199254740993n,2n]);expect(result.funding[0]!.operatingLedgerEffectiveDateAtRegistration).toEqual(new Date("2026-01-02T00:00:00.000Z"));expect(result.audits[0]!.metadata).toEqual((data.audits as Array<{metadata:unknown}>)[0]!.metadata);expect(result.facts).toEqual([{id:"unexpected-fact"}]);expect(result.impacts).toEqual([{id:"unexpected-impact"}]);
 const sql=query.mock.calls[0][0] as string;
 expect(/\b(?:LIMIT|DISTINCT|INSERT|UPDATE|DELETE)\b/iu.test(sql)).toBe(false);
 expect(sql.includes('"sourceBusinessId" IN (SELECT id FROM executions)')).toBe(true);
 expect(sql.includes('"accountId" IN (SELECT "accountId" FROM opening_a UNION ALL SELECT "accountId" FROM opening_b)')).toBe(true);
});

test.each(["request","settlement","openingA","openingB"])("missing required %s produces explicit decoder error, never fake PrismaP2025",async field=>{
 const data=wire();data[field]=null;
 await expect(readRegisteredNormalSnapshot({$queryRawUnsafe:jest.fn().mockResolvedValue([data])} as unknown as Prisma.TransactionClient,"p","s","a","b")).rejects.toMatchObject({code:"PG_CASE_NORMAL_SNAPSHOT_DECODE"});
});
test.each(["getter","proxy","bad-bigint","bad-date"])("decoder rejects %s without invoking private accessors",async mode=>{
 const data=wire();let traps=0;
 if(mode==="getter")Object.defineProperty(data,"request",{get(){traps++;throw Error("private");}});
 if(mode==="proxy")data.request=new Proxy({},{ownKeys(){traps++;throw Error("private");},getOwnPropertyDescriptor(){traps++;throw Error("private");}});
 if(mode==="bad-bigint")data.request={approvedAmountCents:9007199254740992,paidAmountCents:"0",status:"approved"};
 if(mode==="bad-date")data.funding=[{executionId:"e",operatingLedgerEffectiveDateAtRegistration:"2026-02-30",actualPayerId:null,actualPayerKind:"participating_company"}];
 await expect(readRegisteredNormalSnapshot({$queryRawUnsafe:jest.fn().mockResolvedValue([data])} as unknown as Prisma.TransactionClient,"p","s","a","b")).rejects.toMatchObject({code:"PG_CASE_NORMAL_SNAPSHOT_DECODE"});expect(traps).toBe(0);
});
test("query rejection is rethrown as the original error before decoding",async()=>{
 const original=new Error("private");await expect(readRegisteredNormalSnapshot({$queryRawUnsafe:jest.fn().mockRejectedValue(original)} as unknown as Prisma.TransactionClient,"p","s","a","b")).rejects.toBe(original);
});

test.each([["null-balance","PG_CASE_INITIAL_BALANCE_MUST_BE_KNOWN"],["negative-spent","PG_CASE_POSTING_DIRECTION"]])("original financial invariant %s retains its existing failure code",async(mode,code)=>{
 const data=wire();
 if(mode==="null-balance")data.openingA={accountId:"a",balanceYuan:null,coveredExecutionIds:[]};
 else data.postings=[{executionId:"other",accountId:"a",sourceBatchId:"s",amountCents:"-2"}];
 await expect(readRegisteredNormalSnapshot({$queryRawUnsafe:jest.fn().mockResolvedValue([data])} as unknown as Prisma.TransactionClient,"p","s","a","b")).rejects.toMatchObject({code});
});
