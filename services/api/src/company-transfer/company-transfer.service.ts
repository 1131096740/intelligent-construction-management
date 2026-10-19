import { readLegacyTransferDebt } from "./company-transfer-legacy";
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, type CompanyTransfer } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import { PrismaService } from "../database/prisma.service";
import { AuthService } from "../auth/auth.service";
import { ProjectVisibilityService } from "../auth/project-visibility.service";
import { AuditService } from "../audit/audit.service";
import { snapshotApprovalSignature } from "../approval/approval-signature-snapshot";
import { resolveApprovalReviewIdentity } from "../approval/approval-review-identity";
import type { RoleKey } from "@jiangkong/shared-domain";
import { acquireFileBusinessBindingTransactionLock } from "../file/file-business-binding";
import { ProjectFundingAvailabilityService } from "../project-funding/project-funding-availability.service";
import { OperatingSourceReplayService } from "../operating-ledger/operating-source-replay.service";
import { companyTransferRoles } from "./company-transfer.access";
import { accountIdentity, TRANSFER_APPROVAL_NODES, transferScope, transferTotals } from "./company-transfer.domain";
export interface CreateCompanyTransfer { kind: "storage" | "loan" | "repayment"; sourceCompanyId: string; destinationCompanyId: string; sourceProjectId?: string | null; destinationProjectId?: string | null; sourceAccount: string; destinationAccount: string; amountCents: string; originalTransferId?: string; originalProxyId?: string; originalFundMovementRelationshipId?: string; originalInterEntityRelationshipId?: string; reason: string; evidenceFileId: string; confirmationPassword: string; idempotencyKey: string }
const hash = (s: unknown) => createHash("sha256").update(JSON.stringify(s)).digest("hex");
@Injectable()
export class CompanyTransferService {
  constructor(private readonly prisma: PrismaService, private readonly visibility: ProjectVisibilityService, private readonly auth: AuthService, private readonly audit: AuditService, private readonly funding: ProjectFundingAvailabilityService, private readonly replay: OperatingSourceReplayService) { }
  private async access(tx: Prisma.TransactionClient, actor: string, projects: Array<string | null>, write = false) {
    const roles = await companyTransferRoles(tx, actor); if (roles.some(r => (write ? ["finance_staff", "finance_director"] : ["finance_staff", "finance_director", "chairman", "general_manager"]).includes(r))) return roles;
    if (projects.some(p => !p)) throw new ForbiddenException("无权查看或办理公司自有资金互转");
    const visible = await this.visibility.visibleProjectIdsInTransaction(tx, actor); if (projects.some(p => !visible.includes(p!))) throw new ForbiddenException("无权访问本次互转项目");
    const byProject = await this.visibility.effectiveRoleKeysByProjectInTransaction(tx, actor, projects as string[]);
    if (projects.some(p => !(byProject.get(p!) ?? []).some(r => (write ? ["finance_staff", "finance_director"] : ["finance_staff", "finance_director", "project_manager"]).includes(r)))) throw new ForbiddenException("公司互转须由财务办理，项目负责人可查询所属项目"); return roles;
  }
  private async lock(tx: Prisma.TransactionClient, projects: Array<string | null>) { for (const p of [...new Set(projects.filter((p): p is string => !!p))].sort()) await this.funding.lockFundingContext(tx, p); await tx.$executeRaw`SELECT pg_advisory_xact_lock(190731,91)`; }
  private async company(tx: Prisma.TransactionClient, id: string, projectId: string | null, date = new Date(), existingDebt = false) {
    const c = await tx.companyEntity.findUnique({ where: { id } }); if (!c || (!existingDebt && !c.isActive) || !c.unifiedSocialCreditCode) throw new BadRequestException("请选择有完整法人档案的启用公司");
    if (projectId && !existingDebt && !await tx.projectParticipatingCompany.findFirst({ where: { projectId, companyEntityId: id, effectiveFrom: { lte: date }, OR: [{ endedAt: null }, { endedAt: { gt: date } }] } })) throw new BadRequestException("公司在资金发生日不属于该项目的有效参与公司"); return { id: c.id, name: c.name, creditCode: c.unifiedSocialCreditCode };
  }
  private async original(tx: Prisma.TransactionClient, input: Pick<CompanyTransfer, "kind" | "originalTransferId" | "originalProxyId" | "originalFundMovementRelationshipId" | "originalInterEntityRelationshipId" | "sourceCompanyId" | "destinationCompanyId" | "sourceProjectId" | "destinationProjectId">, excludeId?: string, at?: Date) {
    if (input.kind !== "repayment") { if (input.originalTransferId || input.originalProxyId || input.originalFundMovementRelationshipId || input.originalInterEntityRelationshipId) throw new BadRequestException("仅归还可以关联原往来"); return; }
    if ([input.originalTransferId, input.originalProxyId, input.originalFundMovementRelationshipId, input.originalInterEntityRelationshipId].filter(Boolean).length !== 1) throw new BadRequestException("归还必须选择一笔原借款或公司间代付");
    let limit = 0n;
    if (input.originalTransferId) { const r = await tx.companyTransfer.findUnique({ where: { id: input.originalTransferId } }); if (!r || r.kind !== "loan" || r.status !== "approved" || r.sourceCompanyId !== input.destinationCompanyId || r.destinationCompanyId !== input.sourceCompanyId || r.sourceProjectId !== input.destinationProjectId || r.destinationProjectId !== input.sourceProjectId) throw new BadRequestException("归还双方和资金归属必须与原借款相反"); limit = transferTotals(await tx.companyTransferEvent.findMany({ where: { transferId: r.id, ...(at ? { occurredAt: { lte: at } } : {}) } })).received; }
    else if (input.originalProxyId) {
const r = await tx.contractProxyExecution.findUnique({ where: { id: input.originalProxyId! } }); const s = r?.frozenSource as { debtor?: { kind: string; id: string }; actualPayer?: { kind: string; id: string } } | undefined;
      if (!r || r.status !== "confirmed" || r.entryKind !== "payment" || s?.debtor?.kind !== "participating_company" || s.actualPayer?.kind !== "participating_company" || s.debtor.id !== input.sourceCompanyId || s.actualPayer.id !== input.destinationCompanyId || r.projectId !== input.sourceProjectId || r.projectId !== input.destinationProjectId) throw new BadRequestException("请关联同项目、相反双方的已确认公司间代付");
      if (at && r.occurredAt > at) throw new BadRequestException("归还出款日期不能早于原代付");
      const old = await tx.contractProxyExecution.aggregate({ where: { originalId: r.id, status: { in: ["pending_confirm", "confirmed"] }, ...(at ? { occurredAt: { lte: at } } : {}) }, _sum: { amountCents: true } }); limit = r.amountCents - (old._sum.amountCents ?? 0n);
    }
    else { const legacy = await readLegacyTransferDebt(tx, input, at); if (!legacy || legacy.sourceCompanyId !== input.sourceCompanyId || legacy.destinationCompanyId !== input.destinationCompanyId || legacy.sourceProjectId !== input.sourceProjectId || legacy.destinationProjectId !== input.destinationProjectId) throw new BadRequestException("归还双方和资金归属须对应原往来"); if (at && legacy.occurredAt > at) throw new BadRequestException("归还日期不能早于原往来确认"); limit = legacy.remainingCents; }
    const requests = await tx.companyTransfer.findMany({ where: { id: { not: excludeId ?? "" }, originalTransferId: input.originalTransferId, originalProxyId: input.originalProxyId, originalFundMovementRelationshipId: input.originalFundMovementRelationshipId, originalInterEntityRelationshipId: input.originalInterEntityRelationshipId, status: { in: ["submitted", "approved"] } } });
    for (const r of requests) {
      if (at) { const totals = transferTotals(await tx.companyTransferEvent.findMany({ where: { transferId: r.id, occurredAt: { lte: at } } })); limit -= totals.sent - totals.returned; }
      else { const returned = await tx.companyTransferEvent.aggregate({ where: { transferId: r.id, kind: "returned" }, _sum: { amountCents: true } }); limit -= r.amountCents - (returned._sum.amountCents ?? 0n); }
    }
    return limit;
  }
  async create(actor: string, input: CreateCompanyTransfer) {
    if (!input || ![input.sourceCompanyId, input.destinationCompanyId, input.reason, input.evidenceFileId, input.idempotencyKey].every(v => typeof v === "string" && v.trim()) || input.reason.length > 2000 || !/^\d{1,16}$/u.test(input.amountCents) || BigInt(input.amountCents) <= 0n) throw new BadRequestException("请完整填写互转金额、用途和依据");
    if (input.sourceCompanyId === input.destinationCompanyId) throw new BadRequestException("公司互转须选择两家不同公司");
    const sourceProjectId = input.sourceProjectId || null, destinationProjectId = input.destinationProjectId || null; transferScope(input.kind, sourceProjectId, destinationProjectId);
    const source = accountIdentity(input.sourceAccount), destination = accountIdentity(input.destinationAccount), amount = BigInt(input.amountCents);
    const fingerprint = hash({ ...input, sourceAccount: source.hash, destinationAccount: destination.hash, confirmationPassword: undefined, actor }); await this.auth.confirmPassword(actor, input.confirmationPassword);
    return this.prisma.$transaction(async tx => {
      await this.access(tx, actor, [sourceProjectId, destinationProjectId], true); await this.lock(tx, [sourceProjectId, destinationProjectId]);
      const prior = await tx.companyTransfer.findUnique({ where: { idempotencyKey: input.idempotencyKey } }); if (prior) { if (prior.requestFingerprint !== fingerprint) throw new ConflictException("操作凭据已用于另一申请"); return { id: prior.id, code: prior.code, status: prior.status }; }
      const parties = { source: await this.company(tx, input.sourceCompanyId, sourceProjectId, new Date(), input.kind === "repayment"), destination: await this.company(tx, input.destinationCompanyId, destinationProjectId, new Date(), input.kind === "repayment") };
      const lineage = { kind: input.kind, sourceCompanyId: input.sourceCompanyId, destinationCompanyId: input.destinationCompanyId, sourceProjectId, destinationProjectId, originalTransferId: input.originalTransferId ?? null, originalProxyId: input.originalProxyId ?? null, originalFundMovementRelationshipId: input.originalFundMovementRelationshipId ?? null, originalInterEntityRelationshipId: input.originalInterEntityRelationshipId ?? null };
      const remaining = await this.original(tx, lineage); if (remaining !== undefined && amount > remaining) throw new ConflictException("归还超过原往来尚未清偿及未被申请占用的金额");
      await acquireFileBusinessBindingTransactionLock(tx); const evidence = await tx.fileObject.findUnique({ where: { id: input.evidenceFileId } }); if (!evidence || evidence.uploadedByUserId !== actor || evidence.storageStatus !== "active" || !evidence.contentSha256) throw new BadRequestException("请上传本人持有的有效互转申请依据");
      const id = randomUUID(), code = `HZ-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${id.slice(0, 8).toUpperCase()}`;
      const candidates = await tx.$queryRaw<Array<{ id: string; key: string }>>`SELECT u."id",p."key" FROM "User" u JOIN "UserPosition" up ON up."userId"=u."id" JOIN "Position" p ON p."id"=up."positionId" WHERE u."isActive"=TRUE AND up."projectId" IS NULL AND p."key" IN ('chairman','general_manager') AND u."id"<>${actor}`;
      if (!candidates.length) throw new ConflictException("尚无独立的董事长或总经理可审批，请先配置审批岗位");
      const nodes = TRANSFER_APPROVAL_NODES.map(n => ({ ...n, candidateUserIdsByRole: Object.fromEntries(n.roleKeys.map(role => [role, candidates.filter(c => c.key === role).map(c => c.id)])) }));
      const approval = await tx.approvalInstance.create({ data: { flowType: "company_transfer.approve", businessType: "company_transfer", businessId: id, status: "in_progress", currentNodeIndex: 0, frozenNodes: nodes, applicantUserId: actor } });
      const row = await tx.companyTransfer.create({ data: { id, code, ...lineage, sourceAccountHash: source.hash, sourceAccountLast4: source.last4, destinationAccountHash: destination.hash, destinationAccountLast4: destination.last4, amountCents: amount, reason: input.reason.trim(), evidenceFileId: evidence.id, evidenceSha256: evidence.contentSha256, frozenParties: parties, approvalInstanceId: approval.id, applicantUserId: actor, idempotencyKey: input.idempotencyKey, requestFingerprint: fingerprint } });
      await this.audit.record(tx, { actorUserId: actor, action: "company_transfer.submit", businessType: "company_transfer", businessId: id, metadata: { code, kind: input.kind } }); return { id, code, status: row.status };
    }, { timeout: 30000 });
  }
  async decide(actor: string, id: string, input: { action: "approve" | "reject" | "withdraw"; comment?: string; confirmationPassword: string }) {
    if (!input || !["approve", "reject", "withdraw"].includes(input.action)) throw new BadRequestException("审批动作不正确"); await this.auth.confirmPassword(actor, input.confirmationPassword);
    return this.prisma.$transaction(async tx => {
      const initial = await tx.companyTransfer.findUnique({ where: { id } }); if (!initial) throw new NotFoundException("互转申请不存在"); await this.access(tx, actor, [initial.sourceProjectId, initial.destinationProjectId]); await this.lock(tx, [initial.sourceProjectId, initial.destinationProjectId]);
      const row = await tx.companyTransfer.findUniqueOrThrow({ where: { id } }), approval = await tx.approvalInstance.findUniqueOrThrow({ where: { id: row.approvalInstanceId! } });
      if (row.status === "approved" && input.action === "approve" && row.approvedByUserId === actor) return { id, status: row.status };
      if (row.status !== "submitted" || approval.status !== "in_progress") throw new ConflictException("审批已结束，请刷新核对");
      const roles = await companyTransferRoles(tx, actor), identity = resolveApprovalReviewIdentity({ node: (approval.frozenNodes as Prisma.JsonArray)[0] as object, actorUserId: actor, actorRoleKeys: roles as RoleKey[] });
      if (input.action === "withdraw") { if (row.applicantUserId !== actor) throw new ForbiddenException("仅申请人可撤回未审批申请"); }
      else if (row.applicantUserId === actor || !identity) throw new ForbiddenException("须由独立的董事长或总经理终审");
      if (input.action !== "approve" && !input.comment?.trim()) throw new BadRequestException("请说明退回或撤回原因");
      const evidence = await tx.fileObject.findUnique({ where: { id: row.evidenceFileId } }); if (input.action === "approve" && (evidence?.storageStatus !== "active" || evidence.contentSha256 !== row.evidenceSha256)) throw new ConflictException("申请依据已变化，请退回重新申请");
      const signature = await snapshotApprovalSignature(tx, actor, { required: input.action === "approve" });
      const action = input.action === "reject" ? "return_to_applicant" : input.action; await tx.approvalActionLog.create({ data: { approvalInstanceId: approval.id, action, actorUserId: actor, approvedRoleKey: identity?.approvedRoleKey, comment: input.comment, signatureFileIdSnapshot: signature.fileId, signatureSha256Snapshot: signature.sha256, signatureVersionIdSnapshot: signature.versionId } });
      const status = input.action === "approve" ? "approved" : input.action === "reject" ? "rejected" : "withdrawn";
      await tx.approvalInstance.update({ where: { id: approval.id }, data: { status: input.action === "reject" ? "returned_to_applicant" : status, currentNodeIndex: input.action === "approve" ? 1 : 0 } });
      await tx.companyTransfer.update({ where: { id }, data: { status, ...(input.action === "approve" ? { approvedByUserId: actor, approvedAt: new Date() } : {}) } });
      await this.audit.record(tx, { actorUserId: actor, action: `company_transfer.${action}`, businessType: "company_transfer", businessId: id, metadata: { status } }); return { id, status };
    });
  }
  async execute(actor: string, id: string, input: { kind: "outgoing" | "incoming" | "returned"; outgoingEventId?: string; observationId: string; idempotencyKey: string; confirmationPassword: string }) {
    if (!input || !["outgoing", "incoming", "returned"].includes(input.kind) || !input.observationId || !input.idempotencyKey) throw new BadRequestException("请选择实际银行流水及收付动作"); await this.auth.confirmPassword(actor, input.confirmationPassword);
    return this.prisma.$transaction(async tx => {
      const initial = await tx.companyTransfer.findUnique({ where: { id } }); if (!initial) throw new NotFoundException("互转申请不存在"); await this.access(tx, actor, [initial.sourceProjectId, initial.destinationProjectId], true); await this.lock(tx, [initial.sourceProjectId, initial.destinationProjectId]);
      const row = await tx.companyTransfer.findUniqueOrThrow({ where: { id } }), fingerprint = hash({ ...input, confirmationPassword: undefined, id, actor });
      const prior = await tx.companyTransferEvent.findUnique({ where: { idempotencyKey: input.idempotencyKey } }); if (prior) { if (prior.requestFingerprint !== fingerprint) throw new ConflictException("操作凭据已用于其他收付"); return { id: prior.id }; }
      if (row.status !== "approved") throw new ConflictException("领导审批通过后才能登记实际互转");
      const project = input.kind === "incoming" ? row.destinationProjectId : row.sourceProjectId, companyId = input.kind === "incoming" ? row.destinationCompanyId : row.sourceCompanyId;
      const observation = await tx.verifiedBankTransactionObservation.findUnique({ where: { id: input.observationId } }); if (!observation) throw new BadRequestException("银行流水不存在");
      await this.company(tx, companyId, project, observation.occurredAt, row.kind === "repayment");
      const proof = await tx.contractBankVerificationRequest.findFirst({ where: { observationId: observation.id } });
      if (!proof || proof.status !== "confirmed" || proof.companyEntityId !== companyId || proof.projectId !== project || proof.accountHash !== (input.kind === "incoming" ? row.destinationAccountHash : row.sourceAccountHash) || observation.direction !== (input.kind === "outgoing" ? "outflow" : "inflow")) throw new BadRequestException("流水开户公司、资金归属、银行账号或方向与批准申请不一致");
      const events = await tx.companyTransferEvent.findMany({ where: { transferId: id } });
      if (input.kind === "outgoing") { const future = row.kind === "repayment" ? await tx.companyTransferEvent.findMany({ where: { kind: "outgoing", occurredAt: { gte: observation.occurredAt }, transferId: { in: (await tx.companyTransfer.findMany({ where: { originalTransferId: row.originalTransferId, originalProxyId: row.originalProxyId, originalFundMovementRelationshipId: row.originalFundMovementRelationshipId, originalInterEntityRelationshipId: row.originalInterEntityRelationshipId }, select: { id: true } })).map(r => r.id) } }, select: { occurredAt: true } }) : [];
        for (const at of [observation.occurredAt, ...future.map(e => e.occurredAt)]) { const available = await this.original(tx, row, row.id, at), own = transferTotals(events.filter(e => e.occurredAt <= at)); if (available !== undefined && own.sent - own.returned + observation.amountCents > available) throw new ConflictException("归还出款超过发生日或后续已登记日期的原往来额度"); } if (input.outgoingEventId || transferTotals(events).sent + observation.amountCents > row.amountCents) throw new ConflictException("出款超过批准额度或错误关联原出款"); }
      else { const original = events.find(e => e.id === input.outgoingEventId && e.kind === "outgoing"); if (!original || original.recordedByUserId === actor) throw new ForbiddenException("请选择原出款，并由另一位财务独立核对"); if (observation.occurredAt < original.occurredAt || events.filter(e => e.outgoingEventId === original.id).reduce((n, e) => n + e.amountCents, 0n) + observation.amountCents > original.amountCents) throw new ConflictException("到账或退回超过原出款剩余额度，或发生日期早于出款"); }
      const claimed = [await tx.bankTransactionClaim.count({ where: { observationId: observation.id } }), await tx.contractBankEventClaim.count({ where: { observationId: observation.id } }), await tx.contractProxyBankClaim.count({ where: { observationId: observation.id } }), await tx.companyTransferBankClaim.count({ where: { observationId: observation.id } })]; if (claimed.some(Boolean)) throw new ConflictException("银行流水已认领，不能重复登记");
      const secret = process.env.OPERATING_LEDGER_DB_WRITE_SECRET; if (!secret) throw new ForbiddenException("互转写入密钥未配置");
      const payload = JSON.stringify({ transferId: id, kind: input.kind, outgoingEventId: input.outgoingEventId ?? null, observationId: observation.id, amountCents: observation.amountCents.toString(), occurredAt: observation.occurredAt, recordedByUserId: actor, idempotencyKey: input.idempotencyKey, requestFingerprint: fingerprint });
      const [event] = await tx.$queryRaw<Array<{id: string; amountCents: bigint}>>`SELECT * FROM public.append_company_transfer_event(${payload}::jsonb, ${secret})`;
      await tx.companyTransferBankClaim.create({ data: { observationId: observation.id, eventId: event.id } });
      if (project) { await this.funding.assertPersistedProjectFundingLedgerCoverage(tx, project); await this.replay.appendConfirmedSourceIfEnabledInTransaction(tx, { projectId: project, sourceType: "company_transfer_event", sourceBusinessId: event.id }, actor); }
      if (input.kind === "incoming" && row.originalFundMovementRelationshipId) { const root = await tx.fundMovementRelationshipEntry.findUniqueOrThrow({ where: { id: row.originalFundMovementRelationshipId } }); for (const leg of await tx.fundMovementLeg.findMany({ where: { movementId: root.movementId } })) { await this.replay.appendConfirmedSourceIfEnabledInTransaction(tx, { projectId: leg.projectId, sourceType: "company_transfer_event", sourceBusinessId: `${event.id}:relationship:${leg.id}` }, actor); } }
      await this.audit.record(tx, { actorUserId: actor, action: `company_transfer.${input.kind}`, businessType: "company_transfer", businessId: id, metadata: { eventId: event.id, amountCents: event.amountCents.toString() } }); return { id: event.id };
    }, { timeout: 30000 });
  }
}
