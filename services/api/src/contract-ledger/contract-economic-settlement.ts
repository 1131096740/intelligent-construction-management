import { normalizeEconomicScope } from "./contract-economic-scope";
import { normalizeBusinessAmount } from "@jiangkong/shared-domain";
import { BadRequestException, ConflictException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
// Local precision covers the full numeric(24,4) range and bounded sums without global settings.
const EconomicDecimal=Prisma.Decimal.clone({precision:60});
import { createHash } from "node:crypto";
import { type EconomicCoverage, type EconomicCoverageV2, type EconomicDocument, economicDocumentYuan, latestEconomicReviews } from "./contract-economic-coverage";

type Review = { id:string; leftSourceRef:string; rightSourceRef:string; coverage:unknown; confirmedAt:Date|null };
function allocationYuan(value:unknown):Prisma.Decimal {
 if(!value||typeof value!=="object")throw new ConflictException("原结算分项金额依据不完整");
 const row=value as Record<string,unknown>;
 if(row.numericProtocolVersion===2){
  if(row.amountCents!==null||typeof row.amountYuan!=="string")throw new ConflictException("原结算分项金额协议不完整");
  return new EconomicDecimal(normalizeBusinessAmount(row.amountYuan,{allowNegative:true})!);
 }
 if(typeof row.amountCents!=="string"||! /^-?\d+$/u.test(row.amountCents))throw new ConflictException("原结算分项金额依据不完整");
 return new EconomicDecimal(row.amountCents).div(100);
}
export function economicScopeOptions(document:EconomicDocument,reviews:Review[]) {
 const current=latestEconomicReviews(reviews);
 if(document.numericProtocolVersion===2||current.some(r=>(r.coverage as Array<EconomicCoverage|EconomicCoverageV2>).some(line=>"numericProtocolVersion" in line&&line.numericProtocolVersion===2))){
  const scopes=new Map<string,{key:string;label:string;capacityCents:null;capacityYuan:string|null}>();
  let covered=new EconomicDecimal(0);
  for(const r of current)for(const line of r.coverage as Array<EconomicCoverage|EconomicCoverageV2>){
   const side=document.ref===r.leftSourceRef?"left":"right";
   const key=createHash("sha256").update(normalizeEconomicScope(line.scope)).digest("hex");
   const amount="numericProtocolVersion" in line?new EconomicDecimal(side==="left"?line.leftAmountYuan:line.rightAmountYuan):new EconomicDecimal(side==="left"?line.leftAmountCents:line.rightAmountCents).div(100);
   const capacity=line.owner===side?amount.toFixed(4):"0.0000";
   if(!scopes.has(key)){scopes.set(key,{key,label:line.scope,capacityCents:null,capacityYuan:capacity});covered=covered.plus(amount);}
   else if(scopes.get(key)!.capacityYuan!==capacity)throw new ConflictException("同一履约分项的覆盖金额或唯一归属不一致，请先复核");
  }
  if(!scopes.size)return null;
  const total=economicDocumentYuan(document);
  if(total!==null&&covered.gt(total))throw new ConflictException("履约分项覆盖金额超出文书金额");
  scopes.set("uncovered",{key:"uncovered",label:"未被关联文书覆盖的独立部分",capacityCents:null,capacityYuan:total===null?null:new EconomicDecimal(total).minus(covered).toFixed(4)});
  return {numericProtocolVersion:2 as const,fingerprint:createHash("sha256").update(current.map(r=>r.id).sort().join(":")).digest("hex"),scopes:[...scopes.values()]};
 }
 const scopes=new Map<string,{key:string;label:string;capacityCents:bigint}>();
 let covered=0n;
 for(const r of current) for(const line of r.coverage as EconomicCoverage[]){
  const side=document.ref===r.leftSourceRef?"left":"right";
  const key=createHash("sha256").update(normalizeEconomicScope(line.scope)).digest("hex");
  const amount=BigInt(side==="left"?line.leftAmountCents:line.rightAmountCents);
  if(!scopes.has(key)) { scopes.set(key,{key,label:line.scope,capacityCents:line.owner===side?amount:0n});covered+=amount; }
  else if(scopes.get(key)!.capacityCents!==(line.owner===side?amount:0n))throw new ConflictException("同一履约分项的覆盖金额或唯一归属不一致，请先复核");
 }
 if(!scopes.size)return null;
 if(document.amountCents===null||covered>document.amountCents)throw new ConflictException("履约分项覆盖金额不完整或超出文书金额");
 scopes.set("uncovered",{key:"uncovered",label:"未被关联文书覆盖的独立部分",capacityCents:document.amountCents-covered});
 return {fingerprint:createHash("sha256").update(current.map(r=>r.id).sort().join(":")).digest("hex"),scopes:[...scopes.values()]};
}
export async function confirmEconomicSettlementCoverage(tx:Prisma.TransactionClient,document:EconomicDocument,reviews:Review[],sourceRef:string|undefined,amountCents:bigint){
 const options=economicScopeOptions(document,reviews);if(!options)return;
 if(!sourceRef)throw new ConflictException("存在关联履约分项，须先明确本次结算覆盖范围，不能按整份文书重复接管");
 const coverage=await tx.contractEconomicSettlementCoverage.findUnique({where:{sourceRef}});
 if(!coverage||coverage.projectId!==document.projectId||coverage.contractRef!==document.ref||coverage.amountCents!==amountCents||coverage.reviewFingerprint!==options.fingerprint||coverage.status!=="prepared")throw new ConflictException("请在合同台账履约复核中分配本次结算范围；结算金额或复核变化后须重新核对");
 const rows=coverage.allocations as Array<{scopeKey:string;amountCents:string}>;
 const prior=await tx.contractEconomicSettlementCoverage.findMany({where:{projectId:document.projectId,contractRef:document.ref,status:"confirmed"}});
 if(options.numericProtocolVersion===2){
  const additions=normalizeSettlementAllocations(coverage.allocations,options,amountCents);
  const allocated=prior.reduce((s,r)=>s.plus(new EconomicDecimal(r.amountCents.toString()).div(100)),new EconomicDecimal(0));
  const unallocated=new EconomicDecimal(document.settledCents.toString()).div(100).minus(allocated);
  for(const scope of options.scopes){
   const used=prior.reduce((s,r)=>s.plus((r.allocations as Array<{scopeKey:string}>).filter(a=>a.scopeKey===scope.key).reduce((v,a)=>v.plus(allocationYuan(a)),new EconomicDecimal(0))),new EconomicDecimal(0)).plus(scope.key==="uncovered"?unallocated:0);
   const added=additions.filter(a=>a.scopeKey===scope.key).reduce((s,a)=>s.plus(allocationYuan(a)),new EconomicDecimal(0));
   if(scope.capacityYuan===null){if(!used.plus(added).isZero())throw new ConflictException("独立部分容量未知，须先核对该结算分项依据");}
   else if(used.plus(added).lt(0)||used.plus(added).gt(scope.capacityYuan))throw new ConflictException(`履约分项“${scope.label}”超出可结算范围或冲减超过原额，请核对分项及历史结算`);
  }
  await tx.contractEconomicSettlementCoverage.update({where:{id:coverage.id},data:{status:"confirmed",confirmedAt:new Date()}});
  return;
 }
 const allocated=prior.reduce((s,r)=>s+r.amountCents,0n);
 // 未具备分项依据的旧结算不臆测为某一履约分项；从独立部分扣除，超额则要求先核对历史范围。
 const unallocated=document.settledCents-allocated;
 for(const scope of options.scopes){
  const used=prior.reduce((s,r)=>s+(r.allocations as Array<{scopeKey:string;amountCents:string}>).filter(a=>a.scopeKey===scope.key).reduce((v,a)=>v+BigInt(a.amountCents),0n),0n)+(scope.key==="uncovered"?unallocated:0n);
  const added=rows.filter(a=>a.scopeKey===scope.key).reduce((s,a)=>s+BigInt(a.amountCents),0n);
  if(used+added<0n||used+added>scope.capacityCents)throw new ConflictException(`履约分项“${scope.label}”超出可结算范围或冲减超过原额，请核对分项及历史结算`);
 }
 await tx.contractEconomicSettlementCoverage.update({where:{id:coverage.id},data:{status:"confirmed",confirmedAt:new Date()}});
}
export function normalizeSettlementAllocations(value:unknown,options:NonNullable<ReturnType<typeof economicScopeOptions>>,amount:bigint){
 if(options.numericProtocolVersion===2){
  if(!Array.isArray(value)||!value.length||value.length>101)throw new BadRequestException("请填写本次结算的履约分项金额");
  const seen=new Set<string>();
  const rows=value.map(raw=>{
   if(!raw||typeof raw!=="object")throw new BadRequestException("结算分项格式不正确");
   const r=raw as Record<string,unknown>;
   const scope=options.scopes.find(s=>s.key===r.scopeKey);
   if(typeof r.scopeKey!=="string"||seen.has(r.scopeKey)||!scope||scope.capacityYuan===null||new EconomicDecimal(scope.capacityYuan).lte(0)||r.amountCents!=null||typeof r.amountYuan!=="string")throw new BadRequestException("分项金额、唯一归属或范围不正确；未知容量须先核对该分项依据");
   let amountYuan:string|null;
   try{amountYuan=normalizeBusinessAmount(r.amountYuan,{allowNegative:true});}catch{throw new BadRequestException("结算分项金额最多4位小数");}
   if(amountYuan===null||new EconomicDecimal(amountYuan).isZero()||new EconomicDecimal(amountYuan).gt(0)!==(amount>0n))throw new BadRequestException("分项方向必须与本次结算一致");
   seen.add(r.scopeKey);
   return {scopeKey:r.scopeKey,numericProtocolVersion:2 as const,amountCents:null,amountYuan};
  });
  if(!rows.reduce((s,r)=>s.plus(r.amountYuan),new EconomicDecimal(0)).eq(new EconomicDecimal(amount.toString()).div(100)))throw new BadRequestException("分项合计必须完整等于本次结算金额");
  return rows;
 }
 if(!Array.isArray(value)||!value.length||value.length>101)throw new BadRequestException("请填写本次结算的履约分项金额");
 const seen=new Set<string>();
 const rows=value.map(raw=>{
  if(!raw||typeof raw!=="object")throw new BadRequestException("结算分项格式不正确");
  const r=raw as Record<string,unknown>;
  if(typeof r.scopeKey!=="string"||seen.has(r.scopeKey)||!options.scopes.some(s=>s.key===r.scopeKey&&s.capacityCents>0n)||typeof r.amountCents!=="string"||! /^-?[1-9]\d{0,17}$/u.test(r.amountCents))throw new BadRequestException("分项金额、唯一归属或范围不正确");
  seen.add(r.scopeKey);
  if((BigInt(r.amountCents)>0n)!==(amount>0n))throw new BadRequestException("分项方向必须与本次结算一致");
  return {scopeKey:r.scopeKey,amountCents:r.amountCents};
 });
 if(rows.reduce((s,r)=>s+BigInt(r.amountCents),0n)!==amount)throw new BadRequestException("分项合计必须完整等于本次结算金额");
 return rows;
}

/** 追加复核只能重分配尚未结算的部分；已确认分项须先由原结算冲回。 */
export async function assertSettledScopesPreserved(tx: Prisma.TransactionClient, document: EconomicDocument, reviews: Review[]) {
 const options=economicScopeOptions(document,reviews);
 const prior=await tx.contractEconomicSettlementCoverage.findMany({where:{projectId:document.projectId,contractRef:document.ref,status:"confirmed"}});
 if(document.numericProtocolVersion===2||options?.numericProtocolVersion===2){
  const decimalOptions=options?.numericProtocolVersion===2?options:null;
  const used=new Map<string,Prisma.Decimal>();
  for(const row of prior)for(const allocation of row.allocations as Array<{scopeKey:string}>)used.set(allocation.scopeKey,(used.get(allocation.scopeKey)??new EconomicDecimal(0)).plus(allocationYuan(allocation)));
  for(const [key,amount] of used){
   const scope=decimalOptions?.scopes.find(s=>s.key===key);
   if(amount.isZero())continue;
   const capacity=scope?scope.capacityYuan:key==="uncovered"&&!decimalOptions?economicDocumentYuan(document):"0.0000";
   if(capacity===null||amount.lt(0)||amount.gt(capacity))throw new ConflictException("已有确认结算的履约分项不能转移、删除或缩减；请先按原分项冲回结算后再追加复核");
  }
  return;
 }
 const used=new Map<string,bigint>();
 for(const row of prior)for(const allocation of row.allocations as Array<{scopeKey:string;amountCents:string}>)used.set(allocation.scopeKey,(used.get(allocation.scopeKey)??0n)+BigInt(allocation.amountCents));
 for(const [key,amount] of used) {
  const capacity=options?.scopes.find(s=>s.key===key)?.capacityCents??(key==="uncovered"?document.amountCents??0n:0n);
  if(amount<0n||amount>capacity)throw new ConflictException("已有确认结算的履约分项不能转移、删除或缩减；请先按原分项冲回结算后再追加复核");
 }
}
