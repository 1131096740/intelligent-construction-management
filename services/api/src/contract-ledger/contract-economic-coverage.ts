import { normalizeEconomicScope } from "./contract-economic-scope";
import { confirmEconomicSettlementCoverage,assertSettledScopesPreserved } from "./contract-economic-settlement";
import { BadRequestException, ConflictException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";

export interface EconomicDocument {
 targetVersionId?:string;
  ref: string; projectId: string; reference: string; title: string; counterparty: string;
  amountCents: bigint | null; version: string; formal: boolean; hasFormalHistory?: boolean; settledCents: bigint;
}
export interface EconomicCoverage {
  scope: string; leftAmountCents: string; rightAmountCents: string;
  owner: "left" | "right";
}
export const ECONOMIC_RELATIONS = ["independent", "supplement", "replacement", "shared_evidence"] as const;
export function documentFingerprint(d: EconomicDocument) {
  return createHash("sha256").update(JSON.stringify({ ref: d.ref, version: d.version, amount: d.amountCents?.toString() ?? null,
    party: d.counterparty, reference: d.reference, title: d.title })).digest("hex");
}
export function money(value: unknown, label: string) {
  if (typeof value !== "string" || !/^(0|[1-9]\d{0,17})$/u.test(value)) throw new BadRequestException(`${label}必须按分填写非负整数`);
  return BigInt(value);
}
export function normalizeCoverage(value: unknown, relation: string, left: EconomicDocument, right: EconomicDocument): EconomicCoverage[] {
  if (!ECONOMIC_RELATIONS.includes(relation as typeof ECONOMIC_RELATIONS[number])) throw new BadRequestException("文书关系不正确");
  if (!Array.isArray(value) || value.length > 100) throw new BadRequestException("请按履约分项填写重叠范围，最多100项");
  if (relation === "independent") {
    if (value.length) throw new BadRequestException("独立履约不应包含重叠分项");
    return [];
  }
  if (!value.length || left.amountCents === null || right.amountCents === null) throw new BadRequestException("存在重叠时须明确双方金额及分项，未定价范围不能直接抵减");
  const scopes = new Set<string>();
  const rows = value.map((raw: unknown) => {
    if (!raw || typeof raw !== "object") throw new BadRequestException("重叠分项格式不正确");
    const row = raw as Record<string, unknown>;
    const scope = typeof row.scope === "string" ? row.scope.trim() : "";
    if (!scope || scope.length > 300 || scopes.has(normalizeEconomicScope(scope))) throw new BadRequestException("履约分项名称不能为空或重复");
    scopes.add(normalizeEconomicScope(scope));
    if (row.owner !== "left" && row.owner !== "right") throw new BadRequestException("每个重叠分项必须指定唯一统计及结算归属");
    const l = money(row.leftAmountCents, "左方覆盖金额"); const r = money(row.rightAmountCents, "右方覆盖金额");
    if (l <= 0n || r <= 0n) throw new BadRequestException("重叠分项双方覆盖金额必须大于零");
    return { scope, leftAmountCents: l.toString(), rightAmountCents: r.toString(), owner: row.owner } as EconomicCoverage;
  });
  if (rows.reduce((s,r)=>s+BigInt(r.leftAmountCents),0n) > left.amountCents || rows.reduce((s,r)=>s+BigInt(r.rightAmountCents),0n) > right.amountCents) throw new BadRequestException("覆盖金额不能超过任一原文书金额");
  return rows;
}
function normalized(value: string) { return value.normalize("NFKC").replace(/[\s\p{P}\p{S}]/gu, "").toLowerCase(); }
export function suspectedOverlap(a: EconomicDocument, b: EconomicDocument) {
  if (a.ref === b.ref || !normalized(a.counterparty) || normalized(a.counterparty) !== normalized(b.counterparty)) return false;
  if (normalized(a.reference) && normalized(a.reference) === normalized(b.reference)) return true;
  if (normalized(a.title) && normalized(a.title) === normalized(b.title)) return true;
  if (a.amountCents === null || b.amountCents === null || a.amountCents === 0n || b.amountCents === 0n) return false;
  const delta = a.amountCents > b.amountCents ? a.amountCents-b.amountCents : b.amountCents-a.amountCents;
  return delta * 10n <= (a.amountCents > b.amountCents ? a.amountCents : b.amountCents);
}
export async function lockEconomicProject(tx: Prisma.TransactionClient, projectId: string) {
  await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "Project" WHERE "id" = ${projectId} FOR UPDATE`);
}
export async function economicDocuments(tx: Prisma.TransactionClient, projectId: string, selection?: { targetRef: string; targetVersionId?: string }): Promise<EconomicDocument[]> {
  const [contracts, external, settlements, externalSettlements] = await Promise.all([
    tx.contract.findMany({ where: { projectId, voidedAt: null }, take: 10001 }),
    tx.projectAffiliateContractFact.findMany({ where: { projectId, status: { in: ["pending_confirm", "confirmed"] } }, take: 10001 }),
    tx.settlement.findMany({ where: { projectId, status: { in: ["effective", "partially_paid", "paid"] } }, select: { contractId: true, amountCents: true }, take: 10001 }),
    tx.projectAffiliateSettlementFact.findMany({ where: { projectId, status: "confirmed", affiliateCompanyContractId: null }, select: { contractLedgerId: true, amountCents: true, effectDirection: true }, take: 10001 })
  ]);
  if ([contracts,external,settlements,externalSettlements].some(rows=>rows.length>10000)) throw new BadRequestException("项目履约资料过多，不能使用不完整范围确认复核");
  const versions = await tx.contractVersion.findMany({ where: { contractId: { in: contracts.map(c=>c.id) } }, orderBy: { versionNo: "desc" } });
  const documents: EconomicDocument[] = [];
  for (const c of contracts) {
    const own=versions.filter(v=>v.contractId===c.id);
    const v = selection ? (selection.targetRef===`contract:${c.id}` && selection.targetVersionId ? own.find(v=>v.id===selection.targetVersionId) : own.find(v=>v.effectiveAt) ?? own[0]) : own[0]; if (!v) continue;
    documents.push({ ref: `contract:${c.id}`, projectId, reference: c.code ?? c.temporaryCode ?? "", title: c.name, counterparty: c.counterparty,
      amountCents: v.amountLimitType === "uncapped" ? null : v.amountCents, version: `${v.id}:${v.documentContentRevision}`,targetVersionId:v.id,
      formal: Boolean(v.effectiveAt), hasFormalHistory: own.some(v=>Boolean(v.effectiveAt)), settledCents: settlements.filter(s=>s.contractId===c.id).reduce((a,s)=>a+s.amountCents,0n) });
  }
  for (const c of external.filter(c=>c.entryKind==="original")) {
    const pending=external.filter(a=>a.ledgerId===c.ledgerId&&a.entryKind!=="original"&&a.status==="pending_confirm");
    const target=selection?(selection.targetRef===`affiliate:${c.ledgerId}`?pending.find(a=>a.id===selection.targetVersionId):undefined):pending[0];
    const adjustments = external.filter(a=>a.ledgerId===c.ledgerId && (a.status==="confirmed"||a.id===target?.id));
    const amount = c.amountCents === null ? null : c.amountCents + adjustments.filter(a=>a.id!==c.id).reduce((a,c)=>a+(c.effectDirection==="decrease"?-1n:1n)*(c.amountCents??0n),0n);
    documents.push({ ref: `affiliate:${c.ledgerId}`, projectId, reference: c.externalContractReference, title: c.description ?? c.externalContractReference,
      counterparty: c.counterpartyName, amountCents: amount, version: `${c.id}:${c.documentVersion}:${adjustments.filter(a=>a.id!==c.id).map(a=>a.id).sort().join(",")}`,
      targetVersionId:target?.id,formal: c.status==="confirmed"&&!target, hasFormalHistory:c.status==="confirmed", settledCents: externalSettlements.filter(s=>s.contractLedgerId===c.ledgerId).reduce((a,s)=>a+(s.effectDirection==="decrease"?-s.amountCents:s.amountCents),0n) });
  }
  return documents;
}
export function excludedAmount(review: { leftSourceRef: string; rightSourceRef: string; coverage: unknown }, ref: string) {
  const side = ref === review.leftSourceRef ? "left" : ref === review.rightSourceRef ? "right" : null;
  if (!side) return 0n;
  const coverage = review.coverage as EconomicCoverage[];
  return coverage.filter(row=>row.owner!==side).reduce((sum,row)=>sum+BigInt(side==="left"?row.leftAmountCents:row.rightAmountCents),0n);
}
/** 事务内执行，所有入口共用。未知关系不会由付款方或金额猜测为独立。 */
export async function assertEconomicContractReady(tx: Prisma.TransactionClient, projectId: string, ref: string, nextSettlementAmount?: bigint, settlementRef?: string, targetVersionId?: string) {
  await lockEconomicProject(tx, projectId);
  const documents = await economicDocuments(tx, projectId, { targetRef: ref, targetVersionId });
  const document = documents.find(d=>d.ref===ref); if (!document) throw new BadRequestException("履约复核未找到原合同");
  const reviews = await tx.contractEconomicReview.findMany({ where: { projectId, status: "confirmed", OR: [{leftSourceRef:ref},{rightSourceRef:ref}] } });
  const current = latestEconomicReviews(reviews.filter(r=> {
    const l=documents.find(d=>d.ref===r.leftSourceRef), rr=documents.find(d=>d.ref===r.rightSourceRef);
    return l && rr && documentFingerprint(l)===r.leftFingerprint && documentFingerprint(rr)===r.rightFingerprint;
  }));
  const conflicts = documents.filter(other=>(other.formal||other.hasFormalHistory) && (suspectedOverlap(document,other)||reviews.some(r=>[r.leftSourceRef,r.rightSourceRef].includes(other.ref))) && !current.some(r=>[r.leftSourceRef,r.rightSourceRef].includes(other.ref)));
  if (conflicts.length) throw new ConflictException({ code: "CONTRACT_ECONOMIC_REVIEW_REQUIRED", message: "存在相同相对方及相近履约资料，请先在合同台账完成经济重复复核；相关部分尚不能正式确认", references: conflicts.map(c=>c.reference) });
  await assertSettledScopesPreserved(tx,document,current);
  const excluded = current.reduce((sum,r)=>sum+excludedAmount(r,ref),0n);
  if (document.amountCents !== null && (excluded > document.amountCents||document.settledCents>document.amountCents-excluded)) throw new ConflictException("跨文书覆盖金额重复分配，请重新核对履约范围");
  if (nextSettlementAmount !== undefined && document.amountCents !== null && excluded > 0n && document.settledCents + nextSettlementAmount > document.amountCents-excluded) throw new ConflictException("本次结算覆盖了其他文书已承接的履约范围；请按未覆盖分项办理，不能重复确认成本");
  if(nextSettlementAmount !== undefined) await confirmEconomicSettlementCoverage(tx,document,current,settlementRef,nextSettlementAmount);
  return { document, excludedAmountCents: excluded, reviews: current };
}

export function latestEconomicReviews<T extends {leftSourceRef:string;rightSourceRef:string;confirmedAt:Date|null}>(reviews:T[]):T[] {
 const found=new Map<string,T>();
 for(const r of [...reviews].sort((a,b)=>(b.confirmedAt?.getTime()??0)-(a.confirmedAt?.getTime()??0))){const key=`${r.leftSourceRef}|${r.rightSourceRef}`;if(!found.has(key))found.set(key,r);}
 return [...found.values()];
}
export function reviewAppliesToVersion(review:{frozenSources:unknown},ref:string,version:string) {
 return Array.isArray(review.frozenSources)&&review.frozenSources.some(d=>d&&typeof d==="object"&&d.ref===ref&&d.version===version);
}
export async function economicExcludedAt(tx:Prisma.TransactionClient,projectId:string,ref:string,asOf:Date,version?:string) {
 const reviews=await tx.contractEconomicReview.findMany({where:{projectId,status:"confirmed",confirmedAt:{lte:asOf},OR:[{leftSourceRef:ref},{rightSourceRef:ref}]}});
 return latestEconomicReviews(version?reviews.filter(r=>reviewAppliesToVersion(r,ref,version)):reviews).reduce((sum,r)=>sum+excludedAmount(r,ref),0n);
}
