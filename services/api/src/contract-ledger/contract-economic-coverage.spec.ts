import { economicExcludedAt, assertEconomicContractReady, documentFingerprint, excludedAmount, latestEconomicReviews, normalizeCoverage, suspectedOverlap, type EconomicDocument } from "./contract-economic-coverage";
const left:EconomicDocument={ref:"contract:one",projectId:"p",reference:"甲-001",title:"道路材料",counterparty:"供应商甲",amountCents:100000n,version:"v1",formal:true,settledCents:0n};
const right:EconomicDocument={...left,ref:"affiliate:two",reference:"乙-002",title:"道路材料供应",version:"f1"};
describe("经济重复范围与唯一统计归属",()=>{
 it("不同编号但同相对方近额会要求复核，相同金额的不同相对方不会自动判重",()=>{expect(suspectedOverlap(left,right)).toBe(true);expect(suspectedOverlap(left,{...right,counterparty:"供应商乙"})).toBe(false);});
 it("金额相同不是确定重复，专业确认独立后两份均保留",()=>{expect(normalizeCoverage([],"independent",left,right)).toEqual([]);});
 it("部分覆盖只排除非归属文书的覆盖金额",()=>{const coverage=normalizeCoverage([{scope:"K0至K1供货批次",leftAmountCents:"30000",rightAmountCents:"35000",owner:"left"}],"supplement",left,right);const review={leftSourceRef:left.ref,rightSourceRef:right.ref,coverage};expect(excludedAmount(review,left.ref)).toBe(0n);expect(excludedAmount(review,right.ref)).toBe(35000n);});
 it.each([
  [{scope:"同一分项",leftAmountCents:"100001",rightAmountCents:"100",owner:"left"}],
  [{scope:"同一分项",leftAmountCents:"0",rightAmountCents:"100",owner:"left"}],
  [{scope:"",leftAmountCents:"100",rightAmountCents:"100",owner:"left"}],
  [{scope:"分项",leftAmountCents:"1.5",rightAmountCents:"100",owner:"left"}],
  [{scope:"分项",leftAmountCents:"100",rightAmountCents:"100",owner:"both"}]
 ])("拒绝无法守恒或没有唯一归属的分项 %#",line=>{expect(()=>normalizeCoverage(line,"shared_evidence",left,right)).toThrow();});
 it("未定金额不能以零金额冲抵",()=>{expect(()=>normalizeCoverage([{scope:"批次",leftAmountCents:"100",rightAmountCents:"100",owner:"left"}],"replacement",{...left,amountCents:null},right)).toThrow("未定价");});
 it("原金额或版本变化使原复核指纹失效",()=>{expect(documentFingerprint(left)).not.toBe(documentFingerprint({...left,amountCents:90000n}));expect(documentFingerprint(left)).not.toBe(documentFingerprint({...left,version:"v2"}));});
 it("历史复核保留，按同一基准日最新复核读取而不叠加两代",()=>{const base={leftSourceRef:left.ref,rightSourceRef:right.ref};expect(latestEconomicReviews([{...base,confirmedAt:new Date("2026-01-01"),id:"old"},{...base,confirmedAt:new Date("2026-02-01"),id:"new"}]).map(r=>r.id)).toEqual(["new"]);});
 it("正式确认在项目锁内检测跨表内表外重叠，确认独立后才放行",async()=>{
  const tx={ contractEconomicSettlementCoverage:{findMany:jest.fn().mockResolvedValue([])},$queryRaw:jest.fn(),contract:{findMany:jest.fn().mockResolvedValue([{id:"one",name:left.title,counterparty:left.counterparty,code:left.reference}])},
   contractVersion:{findMany:jest.fn().mockResolvedValue([{id:"v1",contractId:"one",versionNo:1,documentContentRevision:1,amountLimitType:"capped",amountCents:100000n,effectiveAt:new Date()}])},
   projectAffiliateContractFact:{findMany:jest.fn().mockResolvedValue([{id:"f1",ledgerId:"two",entryKind:"original",status:"confirmed",documentVersion:1,externalContractReference:right.reference,counterpartyName:right.counterparty,amountCents:100000n,effectDirection:"increase",description:right.title}])},
   settlement:{findMany:jest.fn().mockResolvedValue([])},projectAffiliateSettlementFact:{findMany:jest.fn().mockResolvedValue([])},contractEconomicReview:{findMany:jest.fn().mockResolvedValue([])} };
  await expect(assertEconomicContractReady(tx as never,"p",left.ref)).rejects.toThrow("经济重复复核");
  expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
  const l={...left,version:"v1:1"},r={...right,version:"f1:1:"};
  tx.contractEconomicReview.findMany.mockResolvedValue([{leftSourceRef:left.ref,rightSourceRef:right.ref,leftFingerprint:documentFingerprint(l),rightFingerprint:documentFingerprint(r),coverage:[]}]);
  await expect(assertEconomicContractReady(tx as never,"p",left.ref)).resolves.toMatchObject({excludedAmountCents:0n});
  tx.contractEconomicReview.findMany.mockResolvedValue([{leftSourceRef:left.ref,rightSourceRef:right.ref,leftFingerprint:documentFingerprint(l),rightFingerprint:documentFingerprint(r),coverage:[{scope:"已覆盖",leftAmountCents:"40000",rightAmountCents:"40000",owner:"right"}]}]);
  await expect(assertEconomicContractReady(tx as never,"p",left.ref,60001n)).rejects.toThrow("不能重复确认成本");
  await expect(assertEconomicContractReady(tx as never,"p",left.ref,60000n)).rejects.toThrow("须先明确本次结算覆盖范围");
 });
});

it("草稿新版本复核不会提前抵减旧有效版本，两个版本各按冻结依据读取",async()=>{
 const common={leftSourceRef:left.ref,rightSourceRef:right.ref};
 const tx={contractEconomicReview:{findMany:jest.fn().mockResolvedValue([
 {...common,confirmedAt:new Date("2026-01-01"),frozenSources:[{ref:left.ref,version:"v1:1"}],coverage:[{scope:"道路",leftAmountCents:"20",rightAmountCents:"20",owner:"right"}]},
 {...common,confirmedAt:new Date("2026-02-01"),frozenSources:[{ref:left.ref,version:"v2:1"}],coverage:[{scope:"道路",leftAmountCents:"40",rightAmountCents:"40",owner:"right"}]}])}};
 expect(await economicExcludedAt(tx as never,"p",left.ref,new Date(),"v1:1")).toBe(20n);
 expect(await economicExcludedAt(tx as never,"p",left.ref,new Date(),"v2:1")).toBe(40n);
});
