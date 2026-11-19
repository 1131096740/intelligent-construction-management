import { assertSettledScopesPreserved, economicScopeOptions, normalizeSettlementAllocations, confirmEconomicSettlementCoverage } from "./contract-economic-settlement";
import { normalizeCoverage } from "./contract-economic-coverage";
const doc={ref:"contract:a",projectId:"p",reference:"甲合同",title:"道路",counterparty:"供应商",amountCents:100000n,version:"1",formal:true,settledCents:0n};
const review={id:"r",leftSourceRef:doc.ref,rightSourceRef:"affiliate:b",confirmedAt:new Date(),coverage:[{scope:"第一批材料",leftAmountCents:"40000",rightAmountCents:"40000",owner:"left"}]};
it("新版未知总价保留已知重叠容量，独立部分容量明确未知",()=>{
 const unknown=Object.assign({...doc,amountCents:null},{numericProtocolVersion:2 as const,amountYuan:null});
 const other=Object.assign({...doc,ref:"affiliate:b",amountCents:null},{numericProtocolVersion:2 as const,amountYuan:"1.5340"});
 const coverage=normalizeCoverage([{scope:"已验批次",leftAmountYuan:"0.0010",rightAmountYuan:"0.0010",owner:"left"}],"shared_evidence",unknown,other);
 const options=economicScopeOptions(unknown,[{...review,coverage}])!;
 expect(options).toMatchObject({numericProtocolVersion:2,scopes:[{capacityCents:null,capacityYuan:"0.0010"},{key:"uncovered",capacityCents:null,capacityYuan:null}]});
});
it("四位结算分项0.0050加0.0050完整对应真实一分结算，不写入半分",async()=>{
 const known=Object.assign({...doc,amountCents:null},{numericProtocolVersion:2 as const,amountYuan:"0.0100"});
 const coverage=normalizeCoverage([{scope:"已验批次",leftAmountYuan:"0.0050",rightAmountYuan:"0.0050",owner:"left"}],"shared_evidence",known,{...known,ref:"affiliate:b"});
 const options=economicScopeOptions(known,[{...review,coverage}])!;
 expect(normalizeSettlementAllocations([{scopeKey:options.scopes[0].key,amountYuan:"0.0050"},{scopeKey:"uncovered",amountYuan:"0.0050"}],options,1n)).toEqual([{scopeKey:options.scopes[0].key,numericProtocolVersion:2,amountCents:null,amountYuan:"0.0050"},{scopeKey:"uncovered",numericProtocolVersion:2,amountCents:null,amountYuan:"0.0050"}]);
 const allocations=normalizeSettlementAllocations([{scopeKey:options.scopes[0].key,amountYuan:"0.0050"},{scopeKey:"uncovered",amountYuan:"0.0050"}],options,1n);
 const row={id:"coverage-v2",projectId:"p",contractRef:doc.ref,amountCents:1n,reviewFingerprint:options.fingerprint,status:"prepared",allocations};
 const tx={contractEconomicSettlementCoverage:{findUnique:jest.fn(async()=>row),findMany:jest.fn(async()=>[]),update:jest.fn()}};
 await confirmEconomicSettlementCoverage(tx as never,known,[{...review,coverage}],"settlement:v1-header",1n);
 expect(tx.contractEconomicSettlementCoverage.update).toHaveBeenCalledWith({where:{id:"coverage-v2"},data:{status:"confirmed",confirmedAt:expect.any(Date)}});
 const prior={contractEconomicSettlementCoverage:{findMany:jest.fn(async():Promise<Array<{allocations:unknown}>>=>[{allocations}])}};
 await expect(assertSettledScopesPreserved(prior as never,known,[])).rejects.toThrow("不能转移");
 prior.contractEconomicSettlementCoverage.findMany.mockResolvedValue([{allocations:[...allocations,...allocations.map(a=>({...a,amountYuan:"-0.0050"}))]}]);
 await expect(assertSettledScopesPreserved(prior as never,known,[])).resolves.toBeUndefined();
});
describe("部分经济重复结算范围",()=>{
 it("唯一归属保留40000、未覆盖60000，另一文书不得结算共同部分",()=>{
  const options=economicScopeOptions(doc,[review])!;
  expect(options.scopes.map(s=>s.capacityCents)).toEqual([40000n,60000n]);
  const other=economicScopeOptions({...doc,ref:"affiliate:b"},[review])!;
  expect(other.scopes.map(s=>s.capacityCents)).toEqual([0n,60000n]);
  expect(()=>normalizeSettlementAllocations([{scopeKey:other.scopes[0].key,amountCents:"1"}],other,1n)).toThrow("唯一归属");
 });
 it("分项完整守恒，不能正负混填或伪造范围",()=>{
  const options=economicScopeOptions(doc,[review])!;
  expect(()=>normalizeSettlementAllocations([{scopeKey:"uncovered",amountCents:"99"}],options,100n)).toThrow("完整等于");
  expect(()=>normalizeSettlementAllocations([{scopeKey:"uncovered",amountCents:"-100"}],options,100n)).toThrow("方向");
  expect(()=>normalizeSettlementAllocations([{scopeKey:"fake",amountCents:"100"}],options,100n)).toThrow();
 });
 it("同一范围跨两次结算达到上限后，第三笔不能确认",async()=>{
  const options=economicScopeOptions(doc,[review])!,scopeKey=options.scopes[0].key;
  const prior=[{amountCents:25000n,allocations:[{scopeKey,amountCents:"25000"}]}];
  let current={id:"c",projectId:"p",contractRef:doc.ref,amountCents:15000n,reviewFingerprint:options.fingerprint,status:"prepared",allocations:[{scopeKey,amountCents:"15000"}]};
  const tx={contractEconomicSettlementCoverage:{findUnique:jest.fn(async()=>current),findMany:jest.fn(async()=>prior),update:jest.fn()}};
  await confirmEconomicSettlementCoverage(tx as never,{...doc,settledCents:25000n},[review],"settlement:2",15000n);
  expect(tx.contractEconomicSettlementCoverage.update).toHaveBeenCalledTimes(1);
  prior.push({amountCents:15000n,allocations:[{scopeKey,amountCents:"15000"}]});
  current={...current,amountCents:1n,allocations:[{scopeKey,amountCents:"1"}]};
  await expect(confirmEconomicSettlementCoverage(tx as never,{...doc,settledCents:40000n},[review],"settlement:3",1n)).rejects.toThrow("超出可结算范围");
  expect(tx.contractEconomicSettlementCoverage.update).toHaveBeenCalledTimes(1);
 });
 it("复核改变后旧分配失效，冲减不能超过原分项",async()=>{
  const options=economicScopeOptions(doc,[review])!;
  const current={id:"c",projectId:"p",contractRef:doc.ref,amountCents:-1n,reviewFingerprint:"old",status:"prepared",allocations:[{scopeKey:"uncovered",amountCents:"-1"}]};
  const tx={contractEconomicSettlementCoverage:{findUnique:jest.fn(async()=>current),findMany:jest.fn(async()=>[]),update:jest.fn()}};
  await expect(confirmEconomicSettlementCoverage(tx as never,doc,[review],"settlement:2",-1n)).rejects.toThrow("重新核对");
  current.reviewFingerprint=options.fingerprint;
  await expect(confirmEconomicSettlementCoverage(tx as never,doc,[review],"settlement:2",-1n)).rejects.toThrow("冲减超过原额");
  expect(tx.contractEconomicSettlementCoverage.update).not.toHaveBeenCalled();
 });
});

it("追加复核不能移动已确认的重叠分项，冲回后才可重分配",async()=>{
 const key=economicScopeOptions(doc,[review])!.scopes[0].key;
 const tx={contractEconomicSettlementCoverage:{findMany:jest.fn().mockResolvedValue([{allocations:[{scopeKey:key,amountCents:"20000"}]}])}};
 const reassigned={...review,coverage:[{scope:"第一批材料",leftAmountCents:"40000",rightAmountCents:"40000",owner:"right"}]};
 await expect(assertSettledScopesPreserved(tx as never,{...doc,settledCents:20000n},[reassigned])).rejects.toThrow("不能转移");
 await expect(assertSettledScopesPreserved(tx as never,doc,[])).rejects.toThrow("不能转移");
 tx.contractEconomicSettlementCoverage.findMany.mockResolvedValue([{allocations:[{scopeKey:key,amountCents:"20000"},{scopeKey:key,amountCents:"-20000"}]}]);
 await expect(assertSettledScopesPreserved(tx as never,doc,[reassigned])).resolves.toBeUndefined();
});
