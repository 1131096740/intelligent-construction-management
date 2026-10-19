import { upwardAmountRevisions } from "./upward-contract-amount.service";
import { excludedAmount, reviewAppliesToVersion, latestEconomicReviews } from "./contract-economic-coverage";
import { BadRequestException, ForbiddenException, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  CONTRACT_FULL_VIEW_GLOBAL_ROLE_KEYS, CONTRACT_FULL_VIEW_PROJECT_ROLE_KEYS,
  CONTRACT_RELATIONSHIP_LABELS, downstreamContractRelationship, isContractRelationship, operatingContractRelationship,
  type ContractRelationship, type ContractRelationshipLedger, type ContractRelationshipLedgerRow,
  type ContractLedgerSection, type RoleKey
} from "@jiangkong/shared-domain";
import { PrismaService } from "../database/prisma.service";
import { ProjectVisibilityService } from "../auth/project-visibility.service";

const FULL_ROLES = new Set<RoleKey>([...CONTRACT_FULL_VIEW_GLOBAL_ROLE_KEYS, ...CONTRACT_FULL_VIEW_PROJECT_ROLE_KEYS]);
const FORMAL_SETTLEMENT = ["effective", "partially_paid", "paid"];
const MAX_ROWS = 10000;
export interface RelationshipLedgerQuery { projectId?: string; section?: ContractLedgerSection; relationship?: ContractRelationship; companyEntityId?: string; asOf?: string }

/** 分类台账只读取原业务事实，不复制单据，不以实付推算成本。 */
@Injectable()
export class ContractRelationshipLedgerService {
  constructor(private readonly prisma: PrismaService, private readonly visibility: ProjectVisibilityService) {}
  async list(actorUserId: string, query: RelationshipLedgerQuery = {}): Promise<ContractRelationshipLedger> {
    const section = query.section ?? "contracts";
    const businessDate = query.asOf ?? new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" });
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(businessDate)) throw new BadRequestException("统计基准日格式不正确");
    const cutoff = new Date(`${businessDate}T23:59:59.999+08:00`);
    if (Number.isNaN(cutoff.getTime()) || new Date(`${businessDate}T00:00:00Z`).toISOString().slice(0,10) !== businessDate) throw new BadRequestException("统计基准日无效");
    if (!["contracts", "settlements", "payments", "receipts"].includes(section)) throw new BadRequestException("台账种类不正确");
    if (query.relationship && !isContractRelationship(query.relationship)) throw new BadRequestException("合同分类不正确");
    return this.prisma.$transaction(async (tx) => {
      const visible = await this.visibility.visibleProjectIdsInTransaction(tx, actorUserId);
      if (query.projectId && !visible.includes(query.projectId)) throw new ForbiddenException("当前账号无权查看该项目台账");
      const selected = query.projectId ? [query.projectId] : visible;
      const roles = await this.visibility.effectiveRoleKeysByProjectInTransaction(tx, actorUserId, selected);
      const projectIds = selected.filter((id) => roles.get(id)?.some((role) => FULL_ROLES.has(role)));
      if (query.projectId && !projectIds.length) throw new ForbiddenException("当前岗位仅可查看合同摘要，不能读取金额台账");
      // A management receipt is not granted by contract handling authority.
      if (section === "receipts" && projectIds.some((id) => !roles.get(id)?.some((role) =>
        ["finance_staff", "finance_director", "chairman", "general_manager", "project_manager", "super_admin"].includes(role)))) {
        throw new ForbiddenException("当前岗位无权读取收款资金台账");
      }
      if (!projectIds.length) return {...summarizeRelationshipLedger([], section),asOf:businessDate};
      const scope = { projectId: { in: projectIds } };
      const [projects, contracts, external, upward, internalLinks] = await Promise.all([
        tx.project.findMany({ where: { id: { in: projectIds } }, select: { id: true, name: true } }),
        tx.contract.findMany({ where: scope, take: MAX_ROWS + 1 }),
        tx.projectAffiliateContractFact.findMany({ where: { ...scope, status: "confirmed", signedAt: { lte: cutoff } }, take: MAX_ROWS + 1 }),
        tx.projectAffiliateCompanyContract.findMany({ where: { ...scope, status: "confirmed", signedAt: { lte: cutoff } }, take: MAX_ROWS + 1 }),
        tx.projectAffiliateSettlementFact.findMany({ where: { ...scope, status: "confirmed", affiliateCompanyContractId: { not: null } }, select: { contractLedgerId: true }, take: MAX_ROWS + 1 })
      ]);
      assertBounded(contracts, external, upward, internalLinks);
      const versions = await tx.contractVersion.findMany({ where: { contractId: { in: contracts.map((c) => c.id) }, effectiveAt: { not: null, lte: cutoff } }, orderBy: { versionNo: "desc" }, take: MAX_ROWS + 1 });
      assertBounded(versions);
      const projectNames = new Map(projects.map((p) => [p.id, p.name]));
      const contractById = new Map(contracts.map((c) => [c.id, c]));
      const versionById = new Map(versions.map((v) => [v.id, v]));
      const upwardById = new Map(upward.map((c) => [c.id, c]));
      const externalByLedger = new Map(external.filter((c) => c.entryKind === "original").map((c) => [c.ledgerId, c]));
      const legacyInternal = new Set(internalLinks.map((s) => s.contractLedgerId));
      const involvedCompanies = new Map<string,string>();
      const base = (projectId: string, id: string, relationship: ContractRelationship): ContractRelationshipLedgerRow => ({
        id, projectId, projectName: projectNames.get(projectId) ?? "项目", section, relationship,
        relationshipLabel: CONTRACT_RELATIONSHIP_LABELS[relationship], reference: "", name: "", signingParty: "待核对",
        counterparty: "待核对", companyEntityId: null, actualPayer: null, amountCents: null,
        amountLabel: section === "contracts" ? "合同承诺" : section === "settlements" ? "确认结算" : section === "payments" ? "实际付款" : "实际到账",
        occurredAt: "", statusLabel: "已确认", accountingEffect: "", detailPath: "/项目经营"
      });
      const normal = (contractId: string, versionId: string, id: string) => {
        const c = contractById.get(contractId); const v = versionById.get(versionId);
        if (!c) return null;
        if (!v) return { ...base(c.projectId, id, "unclassified"), reference: c.code ?? c.name, name: c.name, counterparty: c.counterparty, detailPath: `/合同管理/${encodeURIComponent(c.id)}` };
        return { ...base(c.projectId, id, downstreamContractRelationship(v)), reference: c.code ?? c.temporaryCode ?? c.name,
          name: c.name, signingParty: v.signingSubjectType === "affiliate" ? v.affiliateNameSnapshot ?? "待核对施工企业" : v.companyEntityNameSnapshot ?? "待核对我方公司",
          counterparty: c.counterparty, companyEntityId: v.companyEntityIdSnapshot,
          detailPath: `/合同管理/${encodeURIComponent(c.id)}` };
      };
      let rows: ContractRelationshipLedgerRow[] = [];
      if (section === "contracts") {
        const seen = new Set<string>();
        for (const v of versions) {
          if (seen.has(v.contractId) || (contractById.get(v.contractId)?.voidedAt && contractById.get(v.contractId)!.voidedAt! <= cutoff)) continue;
          seen.add(v.contractId);
          const row = normal(v.contractId, v.id, v.id); if (!row) continue;
          rows.push({ ...row, amountCents: v.amountLimitType === "uncapped" ? null : v.amountCents.toString(), occurredAt: v.effectiveAt!.toISOString(), accountingEffect: "仅合同承诺；结算后确认成本" });
        }
        for (const c of externalByLedger.values()) {
          const facts = external.filter((f) => f.ledgerId === c.ledgerId);
          const classification = legacyInternal.has(c.ledgerId) ? "unclassified" : "outside";
          rows.push({ ...base(c.projectId, c.id, classification), reference: c.externalContractReference, name: c.externalContractReference,
            signingParty: c.affiliateNameSnapshot, counterparty: c.counterpartyName,
            amountCents: c.amountCents === null ? null : facts.reduce((sum, f) => sum + (f.effectDirection === "decrease" ? -1n : 1n) * (f.amountCents ?? 0n), 0n).toString(),
            occurredAt: c.signedAt.toISOString(), accountingEffect: classification === "unclassified" ? "存在旧对上关联，待核对；不并入下游合计" : "仅合同承诺；结算后确认成本" });
        }
        const upwardRevisions=await upwardAmountRevisions(tx,upward.map(c=>c.id),cutoff);
        for (const c of upward) {const revision=upwardRevisions.find(r=>r.contractId===c.id);rows.push({ ...base(c.projectId, c.id, "upward"), reference: c.contractReference, name: c.contractName,
          signingParty: c.affiliateNameSnapshot, counterparty: c.companyEntityNameSnapshot, companyEntityId: c.companyEntityId,
          amountCents: (revision?revision.amountCents:c.amountCents)?.toString() ?? null,documentAmountCents:c.amountCents?.toString(), occurredAt: c.signedAt.toISOString(), accountingEffect: revision?"按已确认修订后完整金额；原签文书保留，不新增收入成本":"对上往来依据；不并入下游合同额及项目成本" });}
        const owners = await tx.projectOwnerContract.findMany({ where: { ...scope, status: "confirmed", signedAt: { lte: cutoff }, OR: [{ voidedAt: null }, { voidedAt: { gt: cutoff } }] }, take: MAX_ROWS + 1 }); assertBounded(owners);
        for (const c of owners) rows.push({ ...base(c.projectId, c.id, "owner"), reference: c.contractCode, name: c.contractName,
          signingParty: c.ownerName, counterparty: c.affiliateNameSnapshot ?? "施工企业", amountCents: c.amountCents.toString(), occurredAt: c.signedAt.toISOString(), accountingEffect: "业主合同依据；结算确认项目收入" });
      } else if (section === "settlements") {
        const [settlements, externalSettlements, ownerSettlements] = await Promise.all([
          tx.settlement.findMany({ where: { ...scope, status: { in: FORMAL_SETTLEMENT } }, take: MAX_ROWS + 1 }),
          tx.projectAffiliateSettlementFact.findMany({ where: { ...scope, status: "confirmed" }, take: MAX_ROWS + 1 }),
          tx.projectUpstreamSettlement.findMany({ where: { ...scope, status: "confirmed", OR:[{voidedAt:null},{voidedAt:{gt:cutoff}}] }, take: MAX_ROWS + 1 })
        ]); assertBounded(settlements, externalSettlements, ownerSettlements);
        const settlementFacts=await tx.operatingFact.findMany({where:{...scope,sourceType:"settlement",status:"confirmed",sourceBusinessId:{in:settlements.map(s=>s.id)}}});
        const archives=await tx.settlementArchiveFile.findMany({where:{settlementId:{in:settlements.map(s=>s.id)},status:"confirmed"},orderBy:{confirmedAt:"asc"}});
        for (const s of settlements) { const row = normal(s.contractId, s.contractVersionId, s.id); if (row) rows.push({ ...row,
          reference: s.code, amountCents: s.amountCents.toString(), occurredAt: (settlementFacts.find(f=>f.sourceBusinessId===s.id)?.occurredAt??s.periodEnd??archives.find(a=>a.settlementId===s.id)?.confirmedAt??s.createdAt).toISOString(),
          accountingEffect: "确认下游成本；付款不再次计成本", detailPath: `/结算管理/${encodeURIComponent(s.id)}` }); }
        for (const s of externalSettlements) {
          const upper = s.affiliateCompanyContractId ? upwardById.get(s.affiliateCompanyContractId) : null;
          const relationship = s.affiliateCompanyContractId ? upper ? "upward" : "unclassified" : legacyInternal.has(s.contractLedgerId) ? "unclassified" : "outside";
          rows.push({ ...base(s.projectId, s.id, relationship), reference: s.periodLabel, name: s.periodLabel,
            signingParty: s.affiliateNameSnapshot, counterparty: s.counterpartyName, companyEntityId: upper?.companyEntityId ?? null,
            amountCents: signed(s.amountCents, s.effectDirection), occurredAt: s.settledAt.toISOString(), accountingEffect:
              relationship === "upward" ? "我方对上应收；项目整体不计收入或成本" : relationship === "outside" ? "确认表外下游成本" : "主体关系待核对" });
        }
        for (const s of ownerSettlements) rows.push({ ...base(s.projectId, s.id, "owner"), reference: s.periodLabel, name: s.periodLabel,
          signingParty: s.approvingPartyName, counterparty: s.affiliateNameSnapshot ?? "施工企业",
          amountCents: s.approvedAmountCents.toString(), occurredAt: s.settledAt.toISOString(), accountingEffect: "业主确认结算形成项目收入" });
      } else if (section === "payments") {
        const [proxyPayments, frozenPayments] = await Promise.all([
          tx.projectProxyPayment.findMany({ where: { ...scope, OR:[{voidedAt:null},{voidedAt:{gt:cutoff}}] }, take: MAX_ROWS + 1 }),
          tx.operatingFact.findMany({ where: { ...scope, status: "confirmed", sourceType: { in: ["project_proxy_payment", "payment_execution"] } },
            select: { sourceType: true, sourceBusinessId: true, sourceSnapshot: true, affiliateNameSnapshot: true }, take: MAX_ROWS + 1 })
        ]); assertBounded(proxyPayments, frozenPayments);
        const frozenBySource = new Map(frozenPayments.map((f) => [`${f.sourceType}:${f.sourceBusinessId}`, f]));
        // 旧代付记录未冻结合同版本，不能拿当前合同版本重算历史签约关系。
        for (const p of proxyPayments) {
          const frozen = frozenBySource.get(`project_proxy_payment:${p.id}`);
          const relationship = frozen ? operatingContractRelationship(frozen.sourceType, frozen.sourceSnapshot) : "unclassified";
          rows.push({ ...base(p.projectId, p.id, relationship), reference: "施工企业付款登记", name: p.description ?? "施工企业实际付款",
            signingParty: relationship === "outside" ? p.affiliateNameSnapshot ?? "待核对施工企业" : "待核对原债务主体",
            counterparty: p.paidTargetName, actualPayer: p.affiliateNameSnapshot ?? frozen?.affiliateNameSnapshot ?? "待核对实际付款方",
            amountCents: p.amountCents.toString(), occurredAt: p.paidAt.toISOString(),
            accountingEffect: relationship === "unclassified" ? "真实实付保留；签约关系待核对，不凭付款方判定分类" : "施工企业实际付款及核销；不再次确认成本" });
        }
        const requests = await tx.paymentRequest.findMany({ where: scope, take: MAX_ROWS + 1 }); assertBounded(requests);
        const requestById = new Map(requests.map((r) => [r.id, r]));
        const takeovers = await tx.contractTakeover.findMany({ where: { ...scope, activatedAt: { not: null } }, select: { id: true, contractId: true, contractVersionId: true }, take: MAX_ROWS + 1 }); assertBounded(takeovers);
        const historicalPayments = await tx.contractTakeoverHistoricalPayment.findMany({ where: { takeoverId: { in: takeovers.map((t) => t.id) }, status: "activated" }, take: MAX_ROWS + 1 }); assertBounded(historicalPayments);
        const takeoverById = new Map(takeovers.map((t) => [t.id, t]));
        for (const payment of historicalPayments) {
          const takeover = takeoverById.get(payment.takeoverId); if (!takeover) continue;
          const row = normal(takeover.contractId, takeover.contractVersionId, payment.id); if (!row) continue;
          rows.push({ ...row, actualPayer: payment.payerName ?? "待核对实际付款方", amountCents: payment.amountCents.toString(), occurredAt: payment.paidAt.toISOString(),
            accountingEffect: "已激活历史实付；不重复确认成本", detailPath: `/历史合同接管?projectId=${encodeURIComponent(row.projectId)}&takeoverId=${encodeURIComponent(takeover.id)}` });
        }
        const [executions, payments] = await Promise.all([
          tx.paymentExecution.findMany({ where: { paymentRequestId: { in: requests.map((r) => r.id) } }, include: { payerAttestation: true }, take: MAX_ROWS + 1 }),
          tx.projectAffiliatePaymentFact.findMany({ where: { ...scope, status: "confirmed" }, take: MAX_ROWS + 1 })
        ]); assertBounded(executions, payments);
        for (const e of executions) { const r = requestById.get(e.paymentRequestId); if (!r) continue;
          const row = normal(r.contractId, r.contractVersionId, e.id); if (!row) continue;
          const payerCompanyId=e.payerAttestation?.holderCompanyEntityId??e.companyEntityIdSnapshot,payerCompanyName=e.payerAttestation?.holderNameSnapshot??e.companyEntityNameSnapshot;
          if(payerCompanyId&&payerCompanyName)involvedCompanies.set(payerCompanyId,payerCompanyName);
          rows.push({ ...row, reference: r.code, involvedCompanyIds:[row.companyEntityId,e.payerAttestation?.holderCompanyEntityId??e.companyEntityIdSnapshot].filter((id):id is string=>!!id), actualPayer: e.payerAttestation?.holderNameSnapshot ?? (e.paymentSubjectType === "affiliate" ? frozenBySource.get(`payment_execution:${e.id}`)?.affiliateNameSnapshot ?? versionById.get(r.contractVersionId)?.affiliateNameSnapshot ?? "待核对施工企业" : e.companyEntityNameSnapshot), amountCents: e.amountCents.toString(),
            occurredAt: e.paidAt.toISOString(), accountingEffect: "实际资金流出及核销；不再次确认成本", detailPath: `/付款管理/${encodeURIComponent(r.id)}` }); }
        for (const s of payments) rows.push({ ...base(s.projectId, s.id, legacyInternal.has(s.contractLedgerId) ? "unclassified" : "outside"),
          reference: s.externalPaymentReference ?? externalByLedger.get(s.contractLedgerId)?.externalContractReference ?? "施工企业付款",
          signingParty: s.affiliateNameSnapshot, counterparty: s.counterpartyName, actualPayer: s.affiliateNameSnapshot,
          amountCents: signed(s.amountCents, s.effectDirection), occurredAt: s.paidAt.toISOString(), accountingEffect: "施工企业实际付款及核销；不再次确认成本" });
      } else {
        const bankReceipts=await tx.operatingFact.findMany({where:{...scope,sourceType:"fund_execution",direction:"inflow",status:"confirmed",occurredAt:{lte:cutoff},impacts:{some:{impactKind:"company_project_funds_increase",direction:"increase"}}},include:{impacts:true},take:MAX_ROWS+1});assertBounded(bankReceipts);
        const matches=await tx.upwardReceiptMatch.findMany({where:{...scope,status:"confirmed",occurredAt:{lte:cutoff}}});
        for(const bank of bankReceipts){
          const matched=matches.filter(m=>m.receiptFactId===bank.id).reduce((sum,m)=>sum+(m.originalId?-m.amountCents:m.amountCents),0n);
          const frozen=matches.find(m=>m.receiptFactId===bank.id)?.frozenSource as {companyName?:string}|undefined;
          const reversalFacts=await tx.operatingFact.findMany({where:{projectId:bank.projectId,sourceType:"fund_execution",occurredAt:{lte:cutoff},impacts:{some:{impactSnapshot:{path:["originalOperatingImpactEntryId"],equals:bank.impacts.find(i=>i.impactKind==="company_project_funds_increase"&&i.direction==="increase")?.id??""}}}},include:{impacts:true}});
          const reversed=reversalFacts.flatMap(f=>f.impacts).filter(i=>i.direction==="decrease").reduce((sum,i)=>sum+i.amountCents,0n);
          const available=bank.amountCents-reversed;
          for(const [relationship,value] of [["upward",matched],["unclassified",available-matched]] as const){
            if(value===0n)continue;
            rows.push({...base(bank.projectId,`${bank.id}:${relationship}`,relationship),reference:"银行实际到账",name:"公司项目到账",signingParty:bank.affiliateNameSnapshot??"待核对拨款方",counterparty:frozen?.companyName??"到账账户所属公司",companyEntityId:bank.payeeSubjectId,actualPayer:bank.affiliateNameSnapshot,amountCents:value.toString(),occurredAt:bank.occurredAt.toISOString(),accountingEffect:relationship==="upward"?"原到账已匹配对上应收；不重复确认现金或收入":"原实际到账待匹配；保留资金，不假定合同或确认收入",detailPath:`/资金执行案件?projectId=${encodeURIComponent(bank.projectId)}`});
          }
        }
        const receipts = await tx.projectUpstreamFundFact.findMany({ where: { ...scope, status: "confirmed", factType: { in: ["owner_payment_to_affiliate", "affiliate_remittance_to_company"] } }, take: MAX_ROWS + 1 }); assertBounded(receipts);
        for (const r of receipts) rows.push({ ...base(r.projectId, r.id, r.factType === "owner_payment_to_affiliate" ? "owner" : "upward"),
          reference: r.description ?? "收款登记", name: "实际到账", signingParty: r.affiliateNameSnapshot,
          counterparty: r.counterpartyName, companyEntityId: r.companyEntityId, actualPayer: r.factType === "owner_payment_to_affiliate" ? r.counterpartyName : r.affiliateNameSnapshot,
          amountCents: signed(r.amountCents, r.effectDirection), occurredAt: r.occurredAt.toISOString(),
          accountingEffect: r.factType === "owner_payment_to_affiliate" ? "业主实际付款，到账不等于确认收入" : "施工企业向我方拨款，项目内部资金移动" });
      }
      if (section === "payments") {
        const proxy = await tx.contractProxyExecution.findMany({where:{...scope,status:"confirmed",occurredAt:{lte:cutoff}},take:MAX_ROWS+1});assertBounded(proxy);
        for(const p of proxy){
          const frozen=p.frozenSource as unknown as import("./contract-proxy-source").ProxySource;
          const involved=[frozen.debtor,frozen.actualPayer].filter(p=>p.kind==="participating_company");for(const party of involved)involvedCompanies.set(party.id,party.name);
          const row={...base(p.projectId,p.id,frozen.contractRelationship),involvedCompanyIds:involved.map(p=>p.id),reference:frozen.reference,name:frozen.reference,signingParty:frozen.debtor.name,counterparty:frozen.counterparty,companyEntityId:frozen.companyEntityId,actualPayer:p.entryKind==="repayment"?frozen.debtor.name:p.entryKind==="refund"?frozen.payee.name:frozen.actualPayer.name,amountCents:(p.entryKind==="refund"?-p.amountCents:p.amountCents).toString(),occurredAt:p.occurredAt.toISOString(),accountingEffect:p.entryKind==="repayment"?"归还代付往来；不再核销下游欠款、不增加成本":p.entryKind==="refund"?"退款恢复应付和资金，冲回代付往来；不是收入":"代付核销原下游应付一次，形成主体往来；不改变原合同分类",detailPath:`/资金执行案件?projectId=${encodeURIComponent(p.projectId)}`};
          // 主体间归还单列说明，不加进对外下游实付小计。
          if(p.entryKind==="repayment") {row.amountLabel="主体间归还（不计对外付款）";row.amountCents="0";row.documentAmountCents=p.amountCents.toString();}
          rows.push(row);
        }
      }
      if (section === "contracts") {
        const reviews = await tx.contractEconomicReview.findMany({ where: { ...scope, status: "confirmed", confirmedAt: { lte: cutoff } } });
        for (const row of rows) {
          const version = versionById.get(row.id);
          const ext = external.find(c => c.id === row.id);
          const ref = version ? `contract:${version.contractId}` : ext ? `affiliate:${ext.ledgerId}` : null;
          if (!ref || row.amountCents === null) continue;
          const externalVersion=ext?`${ext.id}:${ext.documentVersion}:${external.filter(a=>a.ledgerId===ext.ledgerId&&a.id!==ext.id&&a.status==="confirmed"&&a.signedAt<=cutoff).map(a=>a.id).sort().join(",")}`:null;
          const applicable=reviews.filter(r=>reviewAppliesToVersion(r,ref,version?`${version.id}:${version.documentContentRevision}`:externalVersion!));
          const excluded = latestEconomicReviews(applicable).reduce((sum,r)=>sum+excludedAmount(r,ref),0n);
          if(excluded > 0n) {
            row.documentAmountCents = row.amountCents;
            row.amountCents = (BigInt(row.amountCents)-excluded).toString();
            row.accountingEffect = "按已确认履约复核排除重复范围；保留原文书金额，仅未覆盖部分可独立结算";
          }
        }
      }
      const companies = [...new Map(rows.filter((r) => r.companyEntityId).map((r) => [r.companyEntityId!, {
        id: r.companyEntityId!, name: r.relationship === "upward" ? r.counterparty : r.signingParty
      }])).values()];
      for(const [id,name] of involvedCompanies)if(!companies.some(c=>c.id===id))companies.push({id,name});
      rows = rows.filter((r) => new Date(r.occurredAt) <= cutoff && (!query.relationship || r.relationship === query.relationship) && (!query.companyEntityId || (r.companyEntityId === query.companyEntityId || r.involvedCompanyIds?.includes(query.companyEntityId))));
      rows.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt) || a.id.localeCompare(b.id));
      return { ...summarizeRelationshipLedger(rows, section), asOf: businessDate, companies };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 30000 });
  }
}
function signed(amount: bigint, direction: string) { return (direction === "decrease" ? -amount : amount).toString(); }
function assertBounded(...groups: unknown[][]) { if (groups.some((g) => g.length > MAX_ROWS)) throw new BadRequestException("台账范围过大，请选择具体项目；本次未返回不完整合计"); }
export function summarizeRelationshipLedger(rows: ContractRelationshipLedgerRow[], section: ContractLedgerSection): ContractRelationshipLedger {
  const groups = new Map<ContractRelationship, { relationship: ContractRelationship; label: string; knownAmountCents: bigint; unknownAmountCount: number; count: number }>();
  for (const row of rows) {
    const group = groups.get(row.relationship) ?? { relationship: row.relationship, label: row.relationshipLabel, knownAmountCents: 0n, unknownAmountCount: 0, count: 0 };
    group.count += 1; if (row.amountCents === null) group.unknownAmountCount += 1; else group.knownAmountCents += BigInt(row.amountCents);
    groups.set(row.relationship, group);
  }
  return { readAt: new Date().toISOString(), rows, totals: [...groups.values()].sort((a, b) => Object.keys(CONTRACT_RELATIONSHIP_LABELS).indexOf(a.relationship) - Object.keys(CONTRACT_RELATIONSHIP_LABELS).indexOf(b.relationship)).map((g) => ({ ...g, knownAmountCents: g.knownAmountCents.toString() })),
    notice: `按完整授权范围分项汇总${section === "contracts" ? "已确认/生效合同" : "已确认事实"}。对上、业主与下游分别列示，不相加；缺失金额不作为零。办理中的单据请查看下方原业务台账。` };
}
