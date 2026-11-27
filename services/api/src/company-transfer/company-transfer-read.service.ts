import { isParallelApprovalRound } from "../approval/parallel-approval-protocol";
import { companyRepaymentApprovals } from "./company-transfer-repayment-approval";
import { approvalEvidenceMetadata } from "../approval/approval-evidence";
import { appendLegacyProxyBalances } from "./company-transfer-legacy-balances";
import { readLegacyTransferDebt, transferRepaymentUsage } from "./company-transfer-legacy";
import { summarizeCompanyTransfers } from "./company-transfer-summary";
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../database/prisma.service";
import { ProjectVisibilityService } from "../auth/project-visibility.service";
import { companyTransferRoles } from "./company-transfer.access";
import { TRANSFER_LABELS, transferTotals } from "./company-transfer.domain";
import { resolveApprovalReviewIdentity } from "../approval/approval-review-identity";
import type { RoleKey } from "@jiangkong/shared-domain";

@Injectable()
export class CompanyTransferReadService {
  constructor(private readonly prisma: PrismaService, private readonly visibility: ProjectVisibilityService) { }
  private today() {
    return new Date().toLocaleDateString("en-CA", {timeZone: "Asia/Shanghai"});
  }

  async detail(actor: string, id: string) {
    const missing = () => new NotFoundException("互转记录不存在或当前账号无权查看");
    if (!/^[A-Za-z0-9_-]{1,128}$/u.test(id)) throw missing();
    try {
      const { rows } = await this.list(actor, {transferId: id});
      const row = rows.find(item => item.id === id);
      if (!row) throw missing();
      return row;
    } catch (error) {
      if (error instanceof ForbiddenException) throw missing();
      throw error;
    }
  }
  async list(actor: string, query: { projectId?: string; companyId?: string; asOf?: string; projectsOnly?: string; page?: string; transferId?: string; originalSource?: string } = {}, allRows = false) {
return this.prisma.$transaction(async tx => {
      const global = await companyTransferRoles(tx, actor), finance = global.some(r => ["finance_staff", "finance_director"].includes(r)), leader = global.some(r => ["chairman", "general_manager"].includes(r));
      const visible = await this.visibility.visibleProjectIdsInTransaction(tx, actor), scopes = await this.visibility.effectiveRoleKeysByProjectInTransaction(tx, actor, visible), allowed = visible.filter(p => (scopes.get(p) ?? []).some(r => ["finance_staff", "finance_director", "project_manager", "contract_staff", "contract_director"].includes(r)));
      const comprehensive = global.includes("comprehensive_director");
      const ordinaryAllowed = [...allowed];
      if (comprehensive) allowed.push(...visible.filter(projectId => !allowed.includes(projectId)));
      const scopedProxyRows: Prisma.CompanyTransferWhereInput[] = comprehensive ? [{
        kind: "repayment", requiresParallelRepaymentApproval: true, AND: [
          { sourceProjectId: { in: visible }, destinationProjectId: { in: visible } },
          { OR: [{originalProxyId:{not:null}}, {originalFundMovementRelationshipId:{not:null}}, {originalInterEntityRelationshipId:{not:null}}, {originalOperationalPaymentId:{not:null}}] },
        ],
      }] : [];
      const all = finance || leader, projectsOnly = query.projectsOnly === "true"; const authorizedProjects = all ? visible : allowed; if (!all && !allowed.length) throw new ForbiddenException("无权读取公司互转台账");
      if (query.projectId && !all && !allowed.includes(query.projectId)) throw new ForbiddenException("无权读取该项目互转");
      const date = query.asOf ?? this.today(), until = new Date(`${date}T23:59:59.999+08:00`), page = Number(query.page ?? 1);
      if (!/^\d{4}-\d{2}-\d{2}$/u.test(date) || Number.isNaN(until.getTime()) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date || !Number.isSafeInteger(page) || page < 1) throw new BadRequestException("台账基准日或页码无效");
      const originalSource = typeof query.originalSource === "string"
        ? query.originalSource.match(/^(proxy|inter_entity|movement|operational):([A-Za-z0-9_-]{1,128})$/u) : null;
      if (query.originalSource !== undefined && !originalSource) throw new BadRequestException("原往来筛选无效");
      if (query.transferId !== undefined && (typeof query.transferId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/u.test(query.transferId))) {
        throw new BadRequestException("互转记录筛选无效");
      }
      const transferred = originalSource ? await tx.companyTransferOriginalDebtCorrection.findMany({
        where: { targetOriginalSource: originalSource[0], status: "confirmed" },
        select: { outgoingEvent: { select: { transferId: true } } },
      }) : [];
      const matchingTransfers: Prisma.CompanyTransferWhereInput[] = originalSource ? [{ OR: [
        originalSource[1] === "proxy" ? { originalProxyId: originalSource[2] }
          : originalSource[1] === "inter_entity" ? { originalInterEntityRelationshipId: originalSource[2] }
          : originalSource[1] === "operational" ? { originalOperationalPaymentId: originalSource[2] }
          : { originalFundMovementRelationshipId: originalSource[2] },
        { id: { in: transferred.map(row => row.outgoingEvent.transferId) } },
      ] }] : [];
      const occurred = await tx.companyTransferEvent.findMany({ where: { occurredAt: { lte: until } }, select: { transferId: true } });
      const rows = await tx.companyTransfer.findMany({ where: { AND: [...matchingTransfers, ...(query.transferId ? [{ id: query.transferId }] : []), { OR: [{ createdAt: { lte: until } }, { id: { in: occurred.map(e => e.transferId) } }] }, ...(!all || projectsOnly ? [{ OR: [{ sourceProjectId: { in: all ? authorizedProjects : ordinaryAllowed } }, { destinationProjectId: { in: all ? authorizedProjects : ordinaryAllowed } }, ...scopedProxyRows] }] : []), ...(query.projectId ? [{ OR: [{ sourceProjectId: query.projectId }, { destinationProjectId: query.projectId }] }] : []), ...(query.companyId ? [{ OR: [{ sourceCompanyId: query.companyId }, { destinationCompanyId: query.companyId }, { repaymentDebtorCompanyId: query.companyId }] }] : [])] }, orderBy: [{ createdAt: "desc" }, { id: "asc" }] });
      const events = await tx.companyTransferEvent.findMany({ where: { transferId: { in: rows.map(r => r.id) }, occurredAt: { lte: until } } });
      const correctedEvents = finance ? await tx.companyTransferOriginalDebtCorrection.findMany({
        where: { outgoingEventId: { in: events.filter(event => event.kind === "outgoing").map(event => event.id) }, status: "confirmed" },
        select: { outgoingEventId: true, targetOriginalSource: true },
      }) : [];
      const correctedSourceByEvent = new Map(correctedEvents.map(row => [row.outgoingEventId, row.targetOriginalSource]));
      const approvalActions = await tx.approvalActionLog.findMany({ where: { approvalInstanceId: { in: rows.flatMap(r => r.approvalInstanceId ? [r.approvalInstanceId] : []) } }, orderBy: { createdAt: "asc" } });
      const actionActors = await tx.user.findMany({ where: { id: { in: approvalActions.map(a => a.actorUserId) } }, select: { id: true, name: true } });
      const approvals = await tx.approvalInstance.findMany({ where: { id: { in: rows.flatMap(r => r.approvalInstanceId ? [r.approvalInstanceId] : []) } } });
      const projects = await tx.project.findMany({ where: { id: { in: all ? visible : allowed } }, select: { id: true, name: true } });
      const participants = all ? [] : await tx.projectParticipatingCompany.findMany({ where: { projectId: { in: allowed }, effectiveFrom: { lte: new Date() }, OR: [{ endedAt: null }, { endedAt: { gt: new Date() } }] }, select: { companyEntityId: true } });
      const companies = await tx.companyEntity.findMany({ where: { ...(!all ? { id: { in: [...new Set([...participants.map(p => p.companyEntityId), ...rows.map(r => r.repaymentDebtorCompanyId).filter((id): id is string => !!id)])] } } : {}) }, select: { id: true, name: true } });
      const payerCompanies = await tx.companyEntity.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } });
      const permittedSide = (p: string | null) => all || !!p && allowed.includes(p);
      const result = await Promise.all(rows.map(async r => {
        const own = events.filter(e => e.transferId === r.id), totals = transferTotals(own), parties = r.frozenParties as { source: { name: string }; destination: { name: string } };
        const approval = approvals.find(a => a.id === r.approvalInstanceId), identity = approval ? resolveApprovalReviewIdentity({ node: (approval.frozenNodes as Prisma.JsonArray)[0] as object, actorUserId: actor, actorRoleKeys: global as RoleKey[] }) : null;
        const parallel = !!approval && r.requiresParallelRepaymentApproval && isParallelApprovalRound(approval.frozenNodes);
        const approvalDuties = parallel && r.status === "submitted" && approval?.status === "in_progress" && isParallelApprovalRound(approval.frozenNodes) && r.sourceProjectId
          ? (await companyRepaymentApprovals(tx, this.visibility, actor, r.sourceProjectId, r.applicantUserId, approval.frozenNodes, approval.currentNodeIndex))
            .map(({nodeIndex, roleKeys, requiresSelfPassword}) => ({nodeIndex, roleKeys, requiresSelfPassword}))
          : [];
        const canReconcile = finance || [r.sourceProjectId, r.destinationProjectId].every(p => !!p && (scopes.get(p) ?? []).some(role => ["finance_staff", "finance_director"].includes(role)));
        const scopedComprehensive = parallel && comprehensive && !!r.sourceProjectId && visible.includes(r.sourceProjectId);
        const canExecute = canReconcile || scopedComprehensive;
        const canReadEvidence = all || canReconcile || approvalDuties.length > 0 ||
          scopedComprehensive && (r.status === "approved" || r.applicantUserId === actor);
        const repaymentDebtorCompanyId = r.repaymentDebtorCompanyId ?? r.sourceCompanyId;
        const onBehalfRepayment = r.kind === "repayment" && repaymentDebtorCompanyId !== r.sourceCompanyId;
        const originalSourceId = r.originalProxyId ? `proxy:${r.originalProxyId}`
          : r.originalInterEntityRelationshipId ? `inter_entity:${r.originalInterEntityRelationshipId}`
          : r.originalFundMovementRelationshipId ? `movement:${r.originalFundMovementRelationshipId}`
          : r.originalOperationalPaymentId ? `operational:${r.originalOperationalPaymentId}` : null;
        return { canReadOriginalDebtCorrections: finance && parallel, originalSource: permittedSide(r.sourceProjectId) && permittedSide(r.destinationProjectId) ? originalSourceId : null, approvalFlow: parallel ? "proxy_repayment_parallel" as const : "standard" as const, approvalDuties, approvalActions: all || canExecute ? approvalActions.filter(a => a.approvalInstanceId === r.approvalInstanceId).map(a => ({ action: a.action, actorName: typeof approvalEvidenceMetadata(a.metadata).approverName === "string" ? approvalEvidenceMetadata(a.metadata).approverName as string : actionActors.find(u => u.id === a.actorUserId)?.name ?? "原审批人", roleKey: a.approvedRoleKey, at: a.createdAt.toISOString(), comment: a.comment, signed: !!a.signatureVersionIdSnapshot })) : [], id: r.id, code: r.code, kind: r.kind, kindLabel: TRANSFER_LABELS[r.kind as keyof typeof TRANSFER_LABELS], sourceCompanyId: r.sourceCompanyId, destinationCompanyId: r.destinationCompanyId, repaymentDebtorCompanyId, repaymentDebtorCompany: companies.find(c => c.id === repaymentDebtorCompanyId)?.name ?? (parties as { debtor?: { name: string } }).debtor?.name ?? "原债务公司", onBehalfRepayment, sourceCompany: parties.source.name, destinationCompany: parties.destination.name, sourceProjectId: permittedSide(r.sourceProjectId) ? r.sourceProjectId : null, destinationProjectId: permittedSide(r.destinationProjectId) ? r.destinationProjectId : null, sourceScope: r.sourceProjectId ? (projects.find(p => p.id === r.sourceProjectId)?.name ?? "其他项目") : "公司自有资金", destinationScope: r.destinationProjectId ? (projects.find(p => p.id === r.destinationProjectId)?.name ?? "其他项目") : "公司自有资金", sourceAccountLast4: all || canExecute ? r.sourceAccountLast4 : null, destinationAccountLast4: all || canExecute ? r.destinationAccountLast4 : null, originalReference: r.originalTransferId ? rows.find(x => x.id === r.originalTransferId)?.code ?? "原公司借款" : r.originalProxyId ? "原公司间合同代付" : r.originalFundMovementRelationshipId ? "原资金移动往来" : r.originalInterEntityRelationshipId ? "原跨主体代付往来" : r.originalOperationalPaymentId ? "原业务代付" : null, approvedAt: r.approvedAt?.toISOString() ?? null, approvedByUserId: r.approvedByUserId, amountCents: r.amountCents.toString(), sentCents: totals.sent.toString(), receivedCents: totals.received.toString(), returnedCents: totals.returned.toString(), inTransitCents: totals.inTransit.toString(), status: r.status, statusLabel: r.status === "approved" ? (totals.inTransit > 0n ? "已出款待到账" : totals.sent === r.amountCents ? (totals.returned === totals.sent ? "款项已退回" : "执行完成") : totals.sent > 0n ? "部分执行" : "已批准待出款") : r.status === "submitted" ? (parallel ? "待四职责审批" : "待领导终审") : r.status === "rejected" ? "已退回" : "已撤回", reason: canReadEvidence ? r.reason : "项目关联资金互转", evidenceFileId: canReadEvidence ? r.evidenceFileId : null, canApprove: r.status === "submitted" && (parallel ? approvalDuties.length > 0 : r.applicantUserId !== actor && !!identity), canWithdraw: r.status === "submitted" && r.applicantUserId === actor && (!parallel || comprehensive), canExecute: r.status === "approved" && canExecute, events: own.filter(e => permittedSide(e.kind === "incoming" ? r.destinationProjectId : r.sourceProjectId)).map(e => ({ id: e.id,
          effectiveOriginalSource: correctedSourceByEvent.get(e.outgoingEventId ?? e.id),
          kind: e.returnedIncomingEventId ? "settled_return" : e.kind,
          amountCents: e.amountCents.toString(), occurredAt: e.occurredAt.toISOString(), outgoingEventId: e.outgoingEventId,
          canReconcile: e.kind === "outgoing" && e.recordedByUserId !== actor && canReconcile,
          canRefund: onBehalfRepayment && e.kind === "incoming" && canReconcile &&
            own.some(outgoing => outgoing.id === e.outgoingEventId && outgoing.recordedByUserId !== actor),
          remainingCents: (e.amountCents - own.filter(x => e.kind === "incoming"
            ? x.returnedIncomingEventId === e.id
            : x.outgoingEventId === e.id && !x.returnedIncomingEventId).reduce((a, x) => a + x.amountCents, 0n)).toString() })) };
      }));
      const financeProjects = ordinaryAllowed.filter(p => (scopes.get(p) ?? []).some(r => ["finance_staff", "finance_director"].includes(r)));
      const proxyProjects = comprehensive ? visible : financeProjects;
      const proxyRows = finance || proxyProjects.length ? await tx.contractProxyExecution.findMany({ where: { entryKind: "payment", status: "confirmed", ...(!finance ? { projectId: { in: proxyProjects } } : {}) }, select: { id: true, projectId: true, amountCents: true, frozenSource: true } }) : [];
      const loanOptions = []; for (const r of result.filter(r => r.kind === "loan" && BigInt(r.receivedCents) > 0n)) { const usage = await transferRepaymentUsage(tx, { originalTransferId: r.id }, until), currentReceipts = await tx.companyTransferEvent.aggregate({ where: { transferId: r.id, kind: "incoming" }, _sum: { amountCents: true } }); loanOptions.push({ ...r, remainingCents: (BigInt(r.receivedCents) - usage.received).toString(), availableCents: ((currentReceipts._sum.amountCents ?? 0n) - usage.reserved).toString() }); }
      const legacyOptions = [];
      if (finance || proxyProjects.length) {
        const movement = await tx.fundMovementRelationshipEntry.findMany({ where: { status: "confirmed", direction: "increase", adjustsEntryId: null, ...(!finance ? { sourceProjectId: { in: proxyProjects }, beneficiaryProjectId: { in: proxyProjects } } : {}) }, select: { id: true, debtorCompanyEntityId: true, creditorCompanyEntityId: true } });
        const inter = await tx.interEntityRelationshipEntry.findMany({ where: { status: "confirmed", entryKind: "proxy_payment", direction: "increase", adjustsEntryId: null, projectId: finance ? { not: null } : { in: proxyProjects } }, select: { id: true, originalDebtorCompanyId: true, creditorCompanyId: true } });
        const operational = await tx.registeredOperationalPayment.findMany({ where: {
          actualPayerCompanyId: { not: null },
          ...(!finance ? { projectId: { in: proxyProjects } } : {}),
          ...(query.projectId ? { projectId: query.projectId } : {}),
          ...(query.companyId ? { OR: [{ originalDebtorCompanyId: query.companyId }, { actualPayerCompanyId: query.companyId }] } : {}),
        }, select: { id: true, originalDebtorCompanyId: true, actualPayerCompanyId: true } });
        for (const ref of [...operational.filter(row => row.originalDebtorCompanyId !== row.actualPayerCompanyId).map(row => ({ originalOperationalPaymentId: row.id })), ...movement.filter(r => r.debtorCompanyEntityId !== r.creditorCompanyEntityId).map(r => ({ originalFundMovementRelationshipId: r.id })), ...inter.filter(r => r.originalDebtorCompanyId !== r.creditorCompanyId).map(r => ({ originalInterEntityRelationshipId: r.id }))]) { const debt = await readLegacyTransferDebt(tx, ref); if (!debt || comprehensive && !finance && !financeProjects.includes(debt.sourceProjectId) && (debt.sourceProjectId !== debt.destinationProjectId || debt.kind !== "proxy_payment") || projectsOnly && ![debt.sourceProjectId,debt.destinationProjectId].some(p => authorizedProjects.includes(p)) || query.projectId && ![debt.sourceProjectId, debt.destinationProjectId].includes(query.projectId) || query.companyId && ![debt.sourceCompanyId, debt.destinationCompanyId].includes(query.companyId)) continue; const usage = await transferRepaymentUsage(tx, ref, until), datedDebt = await readLegacyTransferDebt(tx, ref, until); if (!datedDebt || datedDebt.occurredAt > until) continue; legacyOptions.push({ ...ref, ...debt, approvalFlow: debt.sourceProjectId === debt.destinationProjectId && debt.kind === "proxy_payment" ? "proxy_repayment_parallel" as const : "standard" as const, amountCents: debt.amountCents.toString(), remainingCents: (datedDebt.remainingCents - usage.received).toString(), availableCents: (debt.remainingCents - usage.reserved).toString() }); }
      }
      const originalProxies = [];
      for (const row of proxyRows) {
        if (query.projectId && row.projectId !== query.projectId || projectsOnly && !authorizedProjects.includes(row.projectId) ||
            originalSource && (originalSource[1] !== "proxy" || originalSource[2] !== row.id)) continue;
        const source = row.frozenSource as {
          debtor?: { kind: string; id: string; name?: string };
          actualPayer?: { kind: string; id: string; name?: string };
          reference?: string;
        };
        if (source.debtor?.kind !== "participating_company" || source.actualPayer?.kind !== "participating_company" ||
            source.debtor.id === source.actualPayer.id || query.companyId && ![source.debtor.id, source.actualPayer.id].includes(query.companyId)) continue;
        const [usage, existing] = await Promise.all([
          transferRepaymentUsage(tx, { originalProxyId: row.id }, until),
          tx.contractProxyExecution.aggregate({ where: { originalId: row.id, status: { in: ["pending_confirm", "confirmed"] } }, _sum: { amountCents: true } }),
        ]);
        originalProxies.push({ id: row.id, projectId: row.projectId, amountCents: row.amountCents.toString(),
          remainingCents: (row.amountCents - usage.received - (existing._sum.amountCents ?? 0n)).toString(),
          availableCents: (row.amountCents - usage.reserved - (existing._sum.amountCents ?? 0n)).toString(),
          approvalFlow: "proxy_repayment_parallel" as const,
          source: finance || financeProjects.includes(row.projectId) ? row.frozenSource : {
            debtor: { id: source.debtor.id, name: source.debtor.name },
            actualPayer: { id: source.actualPayer.id, name: source.actualPayer.name },
            reference: source.reference,
          } });
      }
      const matchingLegacy = originalSource
        ? legacyOptions.filter(row => row.legacyType === originalSource[1] && row.id === originalSource[2])
        : legacyOptions;
      const canRequestProxyRepayment = comprehensive && visible.length > 0;
      const canCreateOrdinary = finance || [...scopes.values()].some(rs => rs.some(r => ["finance_staff", "finance_director"].includes(r)));
      const originalSourceFound = originalSource ? originalProxies.length + matchingLegacy.length > 0 : undefined;
      const canCreate = originalSource ? (
        originalProxies.some(row => comprehensive && visible.includes(row.projectId) && BigInt(row.availableCents) > 0n) ||
        matchingLegacy.some(row => BigInt(row.availableCents) > 0n && (row.approvalFlow === "proxy_repayment_parallel"
          ? comprehensive && visible.includes(row.sourceProjectId)
          : finance || [row.sourceProjectId, row.destinationProjectId].every(projectId => financeProjects.includes(projectId))))
      ) : canCreateOrdinary;
      return { legacyOptions: matchingLegacy, asOf: date, page, pageSize: 50, total: result.length,
        rows: allRows || query.transferId ? result : result.slice((page - 1) * 50, page * 50), companies, payerCompanies, projects,
        canRequestProxyRepayment, canCreate, originalSourceFound, canDecide: result.some(r=>r.canApprove||r.canWithdraw),
        canExecute: result.some(r=>r.canExecute), canReadEvidence: result.some(r=>!!r.evidenceFileId),
        canUseOwnFunds: finance, originalLoans: loanOptions, originalProxies, balances: (await appendLegacyProxyBalances(tx, summarizeCompanyTransfers(rows, events, { projectIds: query.projectId && (all || ordinaryAllowed.includes(query.projectId)) ? [query.projectId] : projectsOnly && all ? authorizedProjects : all ? undefined : ordinaryAllowed, includeOwn: all && !query.projectId && !projectsOnly, companyId: query.companyId }), until, { projectIds: query.projectId && (all || ordinaryAllowed.includes(query.projectId)) ? [query.projectId] : projectsOnly && all ? authorizedProjects : all ? undefined : ordinaryAllowed, companyId: query.companyId })).map(b => ({ ...b, projectName: b.projectId ? projects.find(p => p.id === b.projectId)?.name ?? "项目资金" : "公司自有资金" })), notice: "互转资金变动及本类借款未清额；公司完整银行余额须结合全部资金事实和期初核对。未清额按基准日，可申请额按当前已占用额度计算。转存不形成项目收入成本，已归还代付款在原代付往来核销。" };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 30000 });
}
  async banks(actor: string, id: string, kind: string) {
return this.prisma.$transaction(async tx => {
      if (!["outgoing", "incoming", "returned", "settled_return"].includes(kind)) throw new BadRequestException("资金动作无效"); const row = await tx.companyTransfer.findUniqueOrThrow({ where: { id } });
      const roles = await companyTransferRoles(tx, actor);
      const canRegisterProxyOutgoing = kind === "outgoing" && row.status === "approved" && row.requiresParallelRepaymentApproval &&
        roles.includes("comprehensive_director") &&
        (await this.visibility.visibleProjectIdsInTransaction(tx, actor)).includes(row.sourceProjectId!);
      if (!canRegisterProxyOutgoing && !roles.some(r => ["finance_staff", "finance_director"].includes(r))) { const p = [row.sourceProjectId, row.destinationProjectId]; const by = await this.visibility.effectiveRoleKeysByProjectInTransaction(tx, actor, p.filter((x): x is string => !!x)); if (p.some(x => !x || !(by.get(x) ?? []).some(r => ["finance_staff", "finance_director"].includes(r)))) throw new ForbiddenException("无权办理本次互转"); }
      const incoming = kind === "incoming"; const requests = await tx.contractBankVerificationRequest.findMany({ where: { status: "confirmed", projectId: incoming ? row.destinationProjectId : row.sourceProjectId, companyEntityId: incoming ? row.destinationCompanyId : row.sourceCompanyId, accountHash: incoming ? row.destinationAccountHash : row.sourceAccountHash, direction: kind === "outgoing" ? "outflow" : "inflow" }, select: { observationId: true, bankReference: true } });
      const claims = [...await tx.bankTransactionClaim.findMany({ select: { observationId: true } }), ...await tx.contractProxyBankClaim.findMany({ select: { observationId: true } }), ...await tx.contractBankEventClaim.findMany({ select: { observationId: true } }), ...await tx.companyTransferBankClaim.findMany({ select: { observationId: true } })];
      return (await tx.verifiedBankTransactionObservation.findMany({ where: { id: { in: requests.flatMap(r => r.observationId ? [r.observationId] : []), notIn: claims.map(c => c.observationId) } }, orderBy: { occurredAt: "desc" } })).map(o => ({ value: o.id, label: `${requests.find(r => r.observationId === o.id)?.bankReference} · ${o.amountCents / 100n}.${(o.amountCents % 100n).toString().padStart(2, "0")} 元 · ${o.occurredAt.toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" })}` }));
    });
}
}
