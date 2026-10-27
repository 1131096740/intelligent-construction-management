import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { Prisma, type ApprovalInstance } from "@prisma/client";
import { resolveEffectiveRoleKeys, type RoleKey } from "@jiangkong/shared-domain";
import { createHash, randomUUID } from "node:crypto";
import { PrismaService } from "../database/prisma.service";
import { frozenCandidateUserIds, isGovernedFrozenApprovalNode, resolveApprovalReviewIdentity, type FrozenApprovalNode, type ApprovalActorRoleScopes } from "./approval-review-identity";
import { assertOrdinaryApplicantCannotReview } from "./approval-self-review";
import { IndependentApprovalProgressService } from "./independent-approval-progress.service";
import { SpotProcurementPilotService } from "../spot-procurement/spot-procurement-pilot.service";
import { ApprovalSmsService } from "./approval-sms.service";

const ACTIVE = new Set(["in_progress", "approval_pending"]);
const COOLDOWN_MS = 10 * 60 * 1000;
const LABELS: Record<string, string> = {
  contract_version: "合同审批", settlement: "结算审批", payment_request: "付款审批",
  expense_claim: "费用审批", project_expense_request: "项目支出审批",
  spot_procurement_version: "零采申请审批", spot_procurement_payment: "零采付款审批",
  project_financing_quota: "垫资额度审批", project_settlement_exception_quota: "结算例外额度审批",
  general_procurement: "综合采购审批", company_transfer: "公司互转审批", fund_execution_case: "资金执行审批"
};
type Db = Prisma.TransactionClient;
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];

@Injectable()
export class ApprovalProgressService {
  constructor(private readonly prisma: PrismaService, private readonly sms: ApprovalSmsService, @Optional() private readonly independent?: IndependentApprovalProgressService, @Optional() private readonly pilot?: SpotProcurementPilotService) {}

  async list(actorId: string, cursor?: string, businessType?: string, businessId?: string) {
    if (this.independent && (cursor?.startsWith("independent-cursor:") || (businessType && this.independent.supports(businessType)))) {
      return this.independent.list(actorId, cursor, businessType, businessId);
    }
    const page = await this.listInstances(actorId, cursor, businessType, businessId);
    if (page.nextCursor || businessType || !this.independent) return page;
    const remaining = await this.independent.list(actorId, undefined, undefined, businessId, 30 - page.items.length);
    return { items: [...page.items, ...remaining.items], nextCursor: remaining.nextCursor };
  }

  private async listInstances(actorId: string, cursor?: string, businessType?: string, businessId?: string) {
    const items: Awaited<ReturnType<ApprovalProgressService["detail"]>>[] = [];
    let nextCursor = cursor;
    let scanned = 0;
    // Page in database order before authorization; continue scanning so unrelated rows never hide later matches.
    for (;;) {
      const rows = await this.prisma.approvalInstance.findMany({
        where: { flowType: { not: "formal_approval_evidence" }, ...(businessType ? { businessType } : {}), ...(businessId ? { businessId } : {}) },
        orderBy: { id: "asc" }, take: 100, ...(nextCursor ? { cursor: { id: nextCursor }, skip: 1 } : {})
      });
      if (!rows.length) return { items, nextCursor: null };
      for (const instance of rows) {
        nextCursor = instance.id;
        try { items.push(await this.detail(instance.id, actorId)); }
        catch (error) { if (!(error instanceof NotFoundException)) throw error; }
        if (items.length === 30 || ++scanned >= 200) return { items, nextCursor };
      }
      if (rows.length < 100) return { items, nextCursor: null };
    }
  }

  async canViewBusiness(businessType: string, businessId: string, actorId: string) {
    const result = await this.list(actorId, undefined, businessType, businessId);
    return result.items.length > 0;
  }

  async detail(id: string, actorId: string) {
    if (id.startsWith("independent:") && this.independent) return this.independent.detail(id, actorId);
    const evidenceId = this.independent ? await this.independentEvidenceId(id) : null;
    if (evidenceId) return this.independent!.detail(evidenceId, actorId);
    const context = await this.context(this.prisma, id, actorId);
    return this.project(context);
  }

  async remindBusiness(businessType: string, businessId: string, actorId: string) {
    if (businessType === "payment_request") {
      const payment = await this.prisma.paymentRequest.findFirst({ where: { OR: [{ id: businessId }, { code: businessId }] }, select: { id: true } });
      if (!payment) throw new NotFoundException("审批流程不存在或无权查看");
      businessId = payment.id;
    }
    const instance = await this.prisma.approvalInstance.findFirst({ where: { businessType, businessId, status: { in: [...ACTIVE] } }, orderBy: { createdAt: "desc" } });
    if (!instance) throw new NotFoundException("审批流程不存在或无权查看");
    const progress = await this.detail(instance.id, actorId);
    return this.remind(instance.id, actorId, randomUUID(), progress.reminderToken);
  }

  async remind(id: string, actorId: string, requestId: string, expectedToken: string) {
    if (id.startsWith("independent:") && this.independent) return this.independent.remind(id, actorId, requestId, expectedToken);
    const evidenceId = this.independent ? await this.independentEvidenceId(id) : null;
    if (evidenceId) return this.independent!.remind(evidenceId, actorId, requestId, expectedToken);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) {
      throw new BadRequestException("催办请求无效，请刷新后重试");
    }
    // Reserve durably before crossing the SMS boundary. A lost reply/crash must never automatically resend.
    const reservation = await this.prisma.$transaction(async tx => {
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "ApprovalInstance" WHERE "id" = ${id} FOR UPDATE`);
      const context = await this.context(tx, id, actorId);
      const existing = context.logs.find(l => l.id === requestId);
      if (existing) {
        if (existing.actorUserId !== actorId || object(existing.metadata).kind !== "sms_request") throw new ConflictException("催办请求已被使用，请刷新后重试");
        return null;
      }
      const progress = this.project(context);
      if (expectedToken !== progress.reminderToken) throw new ConflictException("审批进度或待审批人已变化，请刷新后重新确认催办对象");
      if (!progress.canRemind) throw new ConflictException(progress.reminderUnavailableReason ?? "当前不能催办");
      await tx.approvalActionLog.create({ data: {
        id: requestId, approvalInstanceId: id, actorUserId: actorId, action: "remind",
        metadata: { kind: "sms_request", currentNodeIndex: context.instance.currentNodeIndex, recipientIds: context.pending.map(u => u.id) }
      } });
      return { nodeIndex: context.instance.currentNodeIndex, recipientIds: context.pending.map(u => u.id) };
    });
    if (!reservation) return this.detail(id, actorId);
    const results: Array<{ userId: string; status: string; message: string }> = [];
    for (const userId of reservation.recipientIds) {
      // Recheck each recipient at dispatch time, holding the same instance lock used by reviewers.
      const result = await this.prisma.$transaction(async tx => {
        await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "ApprovalInstance" WHERE "id" = ${id} FOR UPDATE`);
        const context = await this.context(tx, id, actorId);
        const user = context.pending.find(u => u.id === userId);
        if (!user || context.instance.currentNodeIndex !== reservation.nodeIndex) return { userId, status: "cancelled", message: "节点或待审批人已变化，本次未发送" };
        const outcome = await this.sms.send(user.phone ?? "", LABELS[context.instance.businessType], String(context.rawNodes[reservation.nodeIndex]?.name ?? "审批"), "code" in context.business ? context.business.code : `${context.project?.name ?? "项目"}额度申请`);
        return { userId, status: outcome.status, message: outcome.message };
      }, { timeout: 15000 });
      results.push(result);
      // Append per-recipient receipts; if the process stops, completed recipients remain traceable.
      await this.prisma.approvalActionLog.create({ data: {
        approvalInstanceId: id, actorUserId: actorId, action: "remind",
        metadata: { kind: "sms_recipient_result", requestId, ...result }
      } });
    }
    await this.prisma.approvalActionLog.create({ data: {
      approvalInstanceId: id, actorUserId: actorId, action: "remind", metadata: { kind: "sms_result", requestId, results }
    } });
    return this.detail(id, actorId);
  }

  // Formal evidence is an artifact of an existing review, not a second workflow or a new pending task.
  private async independentEvidenceId(id: string) {
    const instance = await this.prisma.approvalInstance.findUnique({ where: { id } });
    if (!instance || instance.flowType !== "formal_approval_evidence") return null;
    const aliases: Record<string,string> = {
      contract_tax_fact_revision: "tax_fact_review", contract_takeover_correction: "takeover_correction",
      contract_company_correction: "takeover_correction", contract_takeover_batch: "takeover_batch_review",
      no_invoice_confirmation: "no_invoice", invoice_exception_confirmation: "invoice_exception",
      spot_procurement_receipt: "receipt_review"
    };
    const kind = aliases[instance.businessType] ?? instance.businessType;
    if (!this.independent?.supports(kind)) throw new NotFoundException("审批流程不存在或无权查看");
    let businessId = instance.businessId;
    if (instance.businessType === "contract_seal") {
      const task = await this.prisma.contractSealTask.findUnique({ where: { id: businessId }, select: { contractVersionId: true } });
      if (!task) throw new NotFoundException("审批流程不存在或无权查看");
      businessId = task.contractVersionId;
    } else if (instance.businessType === "spot_procurement_receipt") {
      const review = await this.prisma.spotProcurementReceiptReview.findUnique({ where: { id: businessId }, select: { receiptId: true } });
      if (!review) throw new NotFoundException("审批流程不存在或无权查看");
      businessId = review.receiptId;
    }
    return `independent:${kind}:${businessId}`;
  }

  private async business(db: Db, instance: ApprovalInstance) {
    const id = instance.businessId;
    switch (instance.businessType) {
      case "contract_version": {
        const version = await db.contractVersion.findUnique({ where: { id }, select: { contractId: true } });
        return version ? db.contract.findUnique({ where: { id: version.contractId }, select: { projectId: true, code: true } }) : null;
      }
      case "general_procurement": return db.generalProcurement.findUnique({ where: { id }, select: { projectId: true, code: true, status: true, approvalInstanceId: true } });
      case "company_transfer": {
        const row = await db.companyTransfer.findUnique({ where: { id }, select: { code: true, status: true, approvalInstanceId: true } });
        return row ? { ...row, projectId: null } : null;
      }
      case "fund_execution_case": {
        const row = await db.fundExecutionCase.findFirst({ where: { caseKey: id }, orderBy: { revision: "desc" }, select: { status: true, approvalInstanceId: true } });
        return row ? { ...row, projectId: null, code: "资金执行申请" } : null;
      }
      case "settlement": return db.settlement.findUnique({ where: { id }, select: { projectId: true, code: true } });
      case "payment_request": return db.paymentRequest.findUnique({ where: { id }, select: { projectId: true, code: true } });
      case "project_expense_request": return db.projectExpenseRequest.findUnique({ where: { id }, select: { projectId: true, code: true } });
      case "expense_claim": return db.expenseClaim.findUnique({ where: { id }, select: { projectId: true, code: true, applicantUserId: true, handledByUserId: true } });
      case "spot_procurement_version": {
        const version = await db.spotProcurementVersion.findUnique({ where: { id }, select: { procurementId: true } });
        return version ? db.spotProcurement.findUnique({ where: { id: version.procurementId }, select: { projectId: true, code: true } }) : null;
      }
      case "spot_procurement_payment": return db.spotProcurementPayment.findUnique({ where: { id }, select: { projectId: true, code: true } });
      case "project_financing_quota": return db.projectFinancingQuota.findUnique({ where: { id }, select: { projectId: true, requestedByRoleKey: true } });
      case "project_settlement_exception_quota": return db.projectSettlementExceptionQuota.findUnique({ where: { id }, select: { projectId: true } });
      default: return null;
    }
  }

  private async context(db: Db, id: string, actorId: string) {
    const instance = await db.approvalInstance.findUnique({ where: { id } });
    if (!instance) throw new NotFoundException("审批流程不存在或无权查看");
    const business = await this.business(db, instance);
    if (!business) throw new NotFoundException("审批流程不存在或无权查看");
    const projectId = business.projectId;
    const [users, positions, assignments, members, logs, delegations, project] = await Promise.all([
      db.user.findMany({ select: { id: true, name: true, phone: true, isActive: true } }),
      db.position.findMany({ select: { id: true, key: true } }),
      db.userPosition.findMany({ where: { OR: [{ projectId: null }, ...(projectId ? [{ projectId }] : [])] } }),
      projectId ? db.projectMember.findMany({ where: { projectId } }) : Promise.resolve([]),
      db.approvalActionLog.findMany({ where: { approvalInstanceId: id }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }),
      db.approvalDelegation.findMany({ where: { enabled: true, startsAt: { lte: new Date() }, endsAt: { gt: new Date() }, OR: [
        { actionKey: null, resourceType: null, resourceId: null },
        ...(instance.businessType === "fund_execution_case" ? [{ actionKey: "fund_execution_case.approve", resourceType: "fund_execution_case", resourceId: instance.businessId }] : [])
      ] } }),
      projectId ? db.project.findUnique({ where: { id: projectId }, select: { name: true, isActive: true } }) : Promise.resolve(null)
    ]);
    const byId = new Map(users.map(u => [u.id, u]));
    if (!byId.get(actorId)?.isActive) throw new NotFoundException("审批流程不存在或无权查看");
    const roles = new Map<string, ApprovalActorRoleScopes>();
    const positionKeys = new Map(positions.map(p => [p.id, p.key as RoleKey]));
    for (const user of users) roles.set(user.id, {
      globalRoleKeys: assignments.filter(a => a.userId === user.id && !a.projectId).flatMap(a => positionKeys.get(a.positionId) ? [positionKeys.get(a.positionId)!] : []),
      projectRoleKeys: [...assignments.filter(a => a.userId === user.id && a.projectId === projectId && projectId).flatMap(a => positionKeys.get(a.positionId) ? [positionKeys.get(a.positionId)!] : []), ...members.filter(m => m.userId === user.id).map(m => m.positionKey as RoleKey)]
    });
    const allRoles = (userId: string) => ["project_expense_request", "spot_procurement_version", "spot_procurement_payment"].includes(instance.businessType) ? resolveEffectiveRoleKeys(roles.get(userId)?.globalRoleKeys ?? [], roles.get(userId)?.projectRoleKeys ?? []) : [...(roles.get(userId)?.globalRoleKeys ?? []), ...(roles.get(userId)?.projectRoleKeys ?? [])];
    const supportsGlobalDelegation = ["contract_version", "settlement", "payment_request", "fund_execution_case"].includes(instance.businessType);
    const activeDelegatorsFor = (userId: string) => supportsGlobalDelegation ? delegations
      .filter(d => d.toUserId === userId && ((d.actionKey == null && d.resourceType == null && d.resourceId == null) || (instance.businessType === "fund_execution_case" && d.actionKey === "fund_execution_case.approve" && d.resourceType === "fund_execution_case" && d.resourceId === instance.businessId)) && byId.get(d.fromUserId)?.isActive)
      .map(d => ({ userId: d.fromUserId, roleKeys: allRoles(d.fromUserId), roleScopes: roles.get(d.fromUserId) })) : [];
    const hasAssignmentReceipt = (assignment: Record<string, unknown>) => logs.some(log => {
      const metadata = object(log.metadata);
      return ["transfer", "delegate"].includes(log.action) &&
        (log.actorUserId === assignment.fromUserId || log.representedUserId === assignment.fromUserId) &&
        metadata.fromUserId === assignment.fromUserId && metadata.toUserId === assignment.toUserId && metadata.fromRoleKey === assignment.fromRoleKey;
    });
    const validAssignment = (node: FrozenApprovalNode, value: unknown) => {
      const assignment = object(value);
      if (!["contract_version", "settlement", "payment_request", "expense_claim", "fund_execution_case"].includes(instance.businessType)) return false;
      if (typeof assignment.fromUserId !== "string" || typeof assignment.toUserId !== "string" || typeof assignment.fromRoleKey !== "string") return false;
      if (!strings(node.roleKeys).includes(assignment.fromRoleKey)) return false;
      if (!isGovernedFrozenApprovalNode(node)) return allRoles(assignment.fromUserId).includes(assignment.fromRoleKey as RoleKey) || hasAssignmentReceipt(assignment);
      const identity = resolveApprovalReviewIdentity({
        node: { ...node, approvedRoleKeys: [], assignments: [assignment] }, actorUserId: assignment.toUserId, actorRoleKeys: []
      });
      return identity?.viaAssignment === true && identity.representedUserId === assignment.fromUserId;
    };
    // Invalid assignment metadata must not create a new reader or SMS recipient.
    const rawNodes = Array.isArray(instance.frozenNodes) ? instance.frozenNodes.map(value => {
      const node = object(value) as FrozenApprovalNode;
      return { ...node, assignments: Array.isArray(node.assignments) ? node.assignments.filter(assignment => validAssignment(node, assignment)) : [] };
    }) : [];
    const legacyCandidates = (node: FrozenApprovalNode) => users.filter(u => u.isActive && resolveApprovalReviewIdentity({ node: { ...node, approvedRoleKeys: [] }, actorUserId: u.id, actorRoleKeys: allRoles(u.id), actorRoleScopes: roles.get(u.id), legacyContractRoute: instance.businessType === "contract_version" })).map(u => u.id);
    const nodeIds = rawNodes.map(node => [...new Set([
      ...(isGovernedFrozenApprovalNode(node) ? (typeof node.selectedUserId === "string" ? [node.selectedUserId] : frozenCandidateUserIds(node)) : legacyCandidates(node)),
      ...node.assignments.flatMap(a => [object(a).fromUserId, object(a).toUserId].filter((v): v is string => typeof v === "string")),
      ...users.filter(user => user.isActive && activeDelegatorsFor(user.id).length > 0 && resolveApprovalReviewIdentity({
        node: { ...node, approvedRoleKeys: [] }, actorUserId: user.id, actorRoleKeys: allRoles(user.id), actorRoleScopes: roles.get(user.id),
        activeDelegators: activeDelegatorsFor(user.id), legacyContractRoute: instance.businessType === "contract_version"
      })).map(user => user.id)
    ])]);
    const participants = new Set([instance.applicantUserId, ...nodeIds.flat(), ...logs.filter(l => ["approve", "reject", "reject_previous", "return_to_applicant", "transfer", "delegate"].includes(l.action)).map(l => l.actorUserId)]);
    for (const log of logs) {
      if (!["transfer", "delegate"].includes(log.action)) continue;
      const assignment = object(log.metadata);
      if (rawNodes.some(node => validAssignment(node, assignment))) {
        participants.add(String(assignment.fromUserId));
        participants.add(String(assignment.toUserId));
      }
    }
    if ("applicantUserId" in business && typeof business.applicantUserId === "string") participants.add(business.applicantUserId);
    if ("handledByUserId" in business && typeof business.handledByUserId === "string") participants.add(business.handledByUserId);
    if (!participants.has(actorId)) throw new NotFoundException("审批流程不存在或无权查看");
    const current = rawNodes[instance.currentNodeIndex];
    const businessUnavailable = (instance.businessType === "project_financing_quota" && project?.isActive !== true) || (["spot_procurement_version", "spot_procurement_payment"].includes(instance.businessType) && !this.pilot?.isEnabled(projectId)) ||
      (["general_procurement", "company_transfer", "fund_execution_case"].includes(instance.businessType) &&
        (!("status" in business) || business.status !== (instance.businessType === "general_procurement" ? "approval_pending" : "submitted") || !("approvalInstanceId" in business) || business.approvalInstanceId !== instance.id));
    const pending = !businessUnavailable && ACTIVE.has(instance.status) && current ? users.filter(user => {
      if (!user.isActive) return false;
      const actorRoleKeys = allRoles(user.id);
      const identity = resolveApprovalReviewIdentity({
        node: current, actorUserId: user.id, actorRoleKeys, actorRoleScopes: roles.get(user.id), legacyContractRoute: instance.businessType === "contract_version",
        activeDelegators: activeDelegatorsFor(user.id)
      });
      if (!identity || (instance.businessType === "general_procurement" && identity.viaAssignment)) return false;
      if (instance.businessType === "company_transfer" && instance.applicantUserId === user.id) return false;
      if (instance.businessType === "fund_execution_case") return true;
      if (instance.applicantUserId !== user.id) return true;
      // Mirror each domain's existing self-review eligibility, without performing its confirmation step.
      if (["expense_claim", "general_procurement"].includes(instance.businessType)) return identity.representedUserId === user.id && !identity.viaAssignment;
      if (instance.businessType === "project_financing_quota") return "requestedByRoleKey" in business && business.requestedByRoleKey === "finance_director" && instance.currentNodeIndex === 0 && identity.approvedRoleKey === "finance_director";
      if (instance.businessType === "project_settlement_exception_quota") return true;
      try {
        assertOrdinaryApplicantCannotReview({
          applicantUserId: instance.applicantUserId, actorUserId: user.id, actorRoleKeys,
          approvedRoleKey: identity.approvedRoleKey, representedUserId: identity.representedUserId, viaAssignment: identity.viaAssignment,
          allowContractDirectorSelfReview: instance.businessType === "contract_version"
        });
        return true;
      } catch (error) {
        if (error instanceof ForbiddenException) return false;
        throw error;
      }
    }) : [];
    return { instance, business, project, rawNodes, nodeIds, byId, pending, logs, businessUnavailable };
  }

  private project(context: Awaited<ReturnType<ApprovalProgressService["context"]>>) {
    const { instance, rawNodes, nodeIds, byId, pending, logs, business, project } = context;
    const person = (id: string) => ({ id, name: byId.get(id)?.name ?? "历史人员（姓名缺失）" });
    const requests = logs.filter(l => l.action === "remind" && object(l.metadata).kind === "sms_request");
    const last = requests.at(-1);
    const nextRemindAt = last ? new Date(last.createdAt.getTime() + COOLDOWN_MS).toISOString() : null;
    const active = ACTIVE.has(instance.status);
    return {
      id: instance.id, businessType: instance.businessType, businessId: instance.businessId,
      title: LABELS[instance.businessType], businessCode: "code" in business ? business.code : "额度申请",
      projectName: project?.name ?? "非项目费用", applicant: person(instance.applicantUserId), status: instance.status,
      createdAt: instance.createdAt.toISOString(), currentNodeIndex: instance.currentNodeIndex,
      currentNodeName: active ? String(rawNodes[instance.currentNodeIndex]?.name ?? "待核对审批节点") : "流程已结束",
      nodes: rawNodes.map((node, index) => ({
        name: typeof node.name === "string" ? node.name : "审批节点", mode: node.mode === "all" ? "会签" : "或签",
        status: index < instance.currentNodeIndex || instance.status === "approved" ? "已通过" : index === instance.currentNodeIndex ? (active ? "处理中" : instance.status === "rejected" ? "已驳回" : "已结束") : (active ? "未开始" : "未执行"),
        participants: nodeIds[index].map(person), legacyRoster: !isGovernedFrozenApprovalNode(node),
        pending: index === instance.currentNodeIndex ? pending.map(u => person(u.id)) : []
      })),
      pendingRecipients: pending.map(u => person(u.id)),
      canRemind: active && pending.length > 0 && this.sms.available() && (!nextRemindAt || Date.parse(nextRemindAt) <= Date.now()),
      reminderUnavailableReason: !active ? "流程已结束" : context.businessUnavailable ? (["spot_procurement_version", "spot_procurement_payment"].includes(instance.businessType) ? "本项目尚未启用零采试点，暂不能催办" : "当前业务未处于可审批状态，暂不能催办") : !pending.length ? "当前没有有效待审批人" : !this.sms.available() ? "短信服务尚未启用" : nextRemindAt && Date.parse(nextRemindAt) > Date.now() ? "刚刚已催办，请稍后再试" : null,
      nextRemindAt,
      reminderToken: createHash("sha256").update(JSON.stringify([instance.id, instance.status, instance.currentNodeIndex, instance.updatedAt.toISOString(), pending.map(user => user.id).sort()])).digest("hex"),
      history: logs.filter(log => !["sms_result", "sms_recipient_result"].includes(String(object(log.metadata).kind))).map(log => ({ id: log.id, actor: person(log.actorUserId), action: ({ approve: "同意", reject: "驳回", reject_previous: "退回上一节点", return_to_applicant: "退回申请人", withdraw: "撤回", transfer: "转审", delegate: "委托", remind: "催办", node_skipped: "节点跳过" } as Record<string, string>)[log.action] ?? "流程记录", comment: log.comment, createdAt: log.createdAt.toISOString() })),
      reminders: requests.map(request => {
        const result = logs.find(log => log.action === "remind" && object(log.metadata).kind === "sms_result" && object(log.metadata).requestId === request.id);
        const partial = logs.filter(log => object(log.metadata).kind === "sms_recipient_result" && object(log.metadata).requestId === request.id).map(log => {
          const receipt = object(log.metadata);
          return { userId: String(receipt.userId), status: String(receipt.status), message: String(receipt.message) };
        });
        return { id: request.id, actor: person(request.actorUserId), createdAt: request.createdAt.toISOString(), recipients: strings(object(request.metadata).recipientIds).map(person), results: Array.isArray(object(result?.metadata).results) ? object(result?.metadata).results as unknown as Array<{ userId: string; status: string; message: string }> : partial, pending: !result };
      })
    };
  }
}
