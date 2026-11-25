import { isRetiredWageOutflow } from "../fund-execution/fund-execution-wage-retirement";
import { isLegacySettlementApproval } from "../settlement/legacy-settlement-approval";
import { isRetiredProjectEmployeeLoan } from "../project-expense/project-employee-loan-retirement";
import { resolveContractOriginators } from "../contract/contract-originators";
import { CONTRACT_PARALLEL_DUTY_RESOURCE, contractParallelDutyId, contractParallelDutyIdentity, contractRoundSubmissionSnapshot } from "../contract/contract-parallel-duty-access";
import { isLegacyContractParallelRound } from "../contract/contract-approval-cutover";
import { isLiveOrdinaryPaymentDelegation, isOrdinaryPaymentParallelRound, paymentParallelRoundEvidence, resolveOrdinaryPaymentDuty } from "../payment/ordinary-payment-parallel";
import { EXPENSE_CURRENT_ROLE_SCOPE, supportsExpenseParallelApproval, resolveExpenseParallelDutyIdentity } from "../expense-claim/expense-claim-parallel-approval";
import { companyTransferReminderIntent, contractReminderIntent, expenseReminderIntent, paymentReminderIntent, spotApplicationReminderIntent, spotPaymentReminderIntent } from "./approval-reminder-business-intent";
import { generalProcurementDutySmsIntent } from "../general-procurement/general-procurement-request-facts";
import { GENERAL_REQUEST_DUTY_RESOURCE, generalRequestDutyId, generalRequestDutyIdentity, generalRequestActor, generalRequestCanRead } from "../general-procurement/general-procurement-request-access";
import { ProjectVisibilityService } from "../auth/project-visibility.service";
import {SPOT_APPROVAL_DUTY_RESOURCE, spotApprovalDutyId} from "./spot-approval-duty-access";
import { activeApprovalNodeIndexes, isParallelApprovalRound, isApprovalDutyComplete, isParallelDutyNotificationEvent } from "./parallel-approval-protocol";
import { BadRequestException, ConflictException, ForbiddenException, GoneException, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { Prisma, type ApprovalInstance } from "@prisma/client";
import { resolveEffectiveRoleKeys, type RoleKey } from "@jiangkong/shared-domain";
import { createHash, randomUUID } from "node:crypto";
import { PrismaService } from "../database/prisma.service";
import { frozenCandidateUserIds, isGovernedFrozenApprovalNode, resolveApprovalReviewIdentity, type FrozenApprovalNode, type ApprovalActorRoleScopes } from "./approval-review-identity";
import { assertOrdinaryApplicantCannotReview } from "./approval-self-review";
import { IndependentApprovalProgressService } from "./independent-approval-progress.service";
import { SpotProcurementPilotService } from "../spot-procurement/spot-procurement-pilot.service";
import { ApprovalSmsService, approvalDutyRichTemplateEnabled } from "./approval-sms.service";
import { FileService } from "../file/file.service";

const ACTIVE = new Set(["in_progress", "approval_pending"]);
const COOLDOWN_MS = 60_000;
const LABELS: Record<string, string> = {
  contract_version: "合同审批", settlement: "结算审批", payment_request: "付款审批",
  expense_claim: "费用审批", project_expense_request: "项目支出审批",
  spot_procurement_version: "零采申请审批", spot_procurement_payment: "零采付款审批",
  project_financing_quota: "垫资额度审批", project_settlement_exception_quota: "结算例外额度审批",
  general_procurement: "综合采购审批", company_transfer: "公司互转审批", fund_execution_case: "资金执行审批",
  contract_work_completion: "履约确认审批"
};
type Db = Prisma.TransactionClient;
const ROUND_BOUNDARY_ACTIONS = new Set(["submit", "resubmit", "reject", "return_to_applicant", "withdraw", "terminate", "void", "payer_changed_reapproval"]);
/** 审批单与签字只取最近一次提交/驳回/退回之后的当前轮，旧轮签字不得补入新轮。 */
function currentApprovalRoundApprovals<T extends { action: string }>(logs: readonly T[]): T[] {
  let boundary = -1;
  logs.forEach((log, index) => { if (ROUND_BOUNDARY_ACTIONS.has(log.action)) boundary = index; });
  return logs.slice(boundary + 1).filter(log => log.action === "approve");
}
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];

@Injectable()
export class ApprovalProgressService {
  constructor(private readonly prisma: PrismaService, private readonly sms: ApprovalSmsService, @Optional() private readonly independent?: IndependentApprovalProgressService, @Optional() private readonly pilot?: SpotProcurementPilotService, @Optional() private readonly files?: FileService) {}

  async list(actorId: string, cursor?: string, businessType?: string, businessId?: string, view: "participant" | "viewable" = "participant") {
    const viewable = view === "viewable";
    if (!viewable && this.independent && (cursor?.startsWith("independent-cursor:") || (businessType && this.independent.supports(businessType)))) {
      return this.independent.list(actorId, cursor, businessType, businessId);
    }
    const page = await this.listInstances(actorId, cursor, businessType, businessId, viewable);
    if (viewable || page.nextCursor || businessType || !this.independent) return page;
    const remaining = await this.independent.list(actorId, undefined, undefined, businessId, 30 - page.items.length);
    return { items: [...page.items, ...remaining.items], nextCursor: remaining.nextCursor };
  }

  private async listInstances(actorId: string, cursor?: string, businessType?: string, businessId?: string, viewableOnly = false) {
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
        try {
          const item = await this.detail(instance.id, actorId, viewableOnly);
          if (!viewableOnly || item.viewerOnly) items.push(item);
        }
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

  async detail(id: string, actorId: string, allowViewer = false) {
    if (!allowViewer && id.startsWith("independent:") && this.independent) return this.independent.detail(id, actorId);
    const evidenceId = !allowViewer && this.independent ? await this.independentEvidenceId(id) : null;
    if (evidenceId) return this.independent!.detail(evidenceId, actorId);
    const context = await this.context(this.prisma, id, actorId, allowViewer);
    return this.project(context, actorId);
  }

  async remindBusiness(businessType: string, businessId: string, actorId: string) {
    if (businessType === "payment_request") {
      const payment = await this.prisma.paymentRequest.findFirst({ where: { OR: [{ id: businessId }, { code: businessId }] }, select: { id: true } });
      if (!payment) throw new NotFoundException("审批流程不存在或无权查看");
      businessId = payment.id;
    }
    const instance = await this.prisma.approvalInstance.findFirst({ where: { businessType, businessId, status: { in: [...ACTIVE] } }, orderBy: { createdAt: "desc" } });
    if (!instance) throw new NotFoundException("审批流程不存在或无权查看");
    const progress = await this.detail(instance.id, actorId, true);
    return this.remind(instance.id, actorId, randomUUID(), progress.reminderToken);
  }

  async remind(id: string, actorId: string, requestId: string, expectedToken: string, selectedRecipientIds?: string[]) {
    if (id.startsWith("independent:") && this.independent) return this.independent.remind(id, actorId, requestId, expectedToken, selectedRecipientIds);
    const evidenceId = this.independent ? await this.independentEvidenceId(id) : null;
    if (evidenceId) return this.independent!.remind(evidenceId, actorId, requestId, expectedToken, selectedRecipientIds);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) {
      throw new BadRequestException("催办请求无效，请刷新后重试");
    }
    // Reserve durably before crossing the SMS boundary. A lost reply/crash must never automatically resend.
    const reservation = await this.prisma.$transaction(async tx => {
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "ApprovalInstance" WHERE "id" = ${id} FOR UPDATE`);
      const context = await this.context(tx, id, actorId, true);
      const existing = context.logs.find(l => l.id === requestId);
      if (existing) {
        const metadata = object(existing.metadata);
        if (existing.actorUserId !== actorId || metadata.kind !== "sms_request") throw new ConflictException("催办请求已被使用，请刷新后重试");
        if (context.retiredWageReminder && selectedRecipientIds !== undefined &&
            JSON.stringify([...selectedRecipientIds].sort()) !== JSON.stringify(strings(metadata.recipientIds).sort())) {
          throw new ConflictException("催办请求已绑定不同接收人，请核对原记录");
        }
        return null;
      }
      if (context.retiredReminderReason) throw new GoneException(context.retiredReminderReason);
      const progress = this.project(context, actorId);
      if (expectedToken !== progress.reminderToken) throw new ConflictException("审批进度或待审批人已变化，请刷新后重新确认催办对象");
      if (!progress.canRemind) throw new ConflictException(progress.reminderUnavailableReason ?? "当前不能催办");
      const recipientIds = selectedRecipientIds ?? progress.remindableRecipients.map(user => user.id);
      if (!recipientIds.length || recipientIds.some(userId => !progress.remindableRecipients.some(user => user.id === userId))) {
        throw new ConflictException("待审批人已变化或刚刚已催办，请刷新后重新选择");
      }
      const dutyIndexes = progress.nodes.flatMap((node, index) => node.pending.some(user => recipientIds.includes(user.id)) ? [index] : []);
      const reimbursementDuties = context.expensePendingByDuty && new Map(recipientIds.map(userId => [
        userId, dutyIndexes.filter(index => progress.nodes[index].pending.some(person => person.id === userId))
      ]));
      await tx.approvalActionLog.create({ data: {
        id: requestId, approvalInstanceId: id, actorUserId: actorId, action: "remind",
        metadata: {
          kind: "sms_request", currentNodeIndex: context.instance.currentNodeIndex, dutyIndexes, recipientIds,
          ...(reimbursementDuties ? { reimbursementDutiesByRecipient: Object.fromEntries(reimbursementDuties) } : {})
        }
      } });
      return { nodeIndex: context.instance.currentNodeIndex, dutyIndexes, recipientIds, reimbursementDuties };
    });
    if (!reservation) return this.detail(id, actorId, true);
    const results: Array<{ userId: string; status: string; message: string }> = [];
    for (const userId of reservation.recipientIds) {
      const message = await this.prisma.$transaction(async tx => {
        await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "ApprovalInstance" WHERE "id" = ${id} FOR UPDATE`);
        const context = await this.context(tx, id, actorId, true);
        const user = context.pending.find(u => u.id === userId);
        if (!user || context.instance.currentNodeIndex !== reservation.nodeIndex) return null;
        const reservedDuties = reservation.reimbursementDuties?.get(userId) ?? reservation.dutyIndexes;
        const duties = this.project(context, actorId).nodes.filter((node, index) =>
          reservedDuties.includes(index) && node.pending.some(person => person.id === userId));
        if (!duties.length) return null;
        const label = LABELS[context.instance.businessType];
        const dutyName = duties.map(duty=>duty.name).join("、");
        const legacy = [user.phone ?? "",label,dutyName,
          "code" in context.business ? context.business.code ?? undefined : `${context.project?.name ?? "项目"}额度申请`] as const;
        const rich = approvalDutyRichTemplateEnabled() ? await this.reminderIntent(tx,context,label,dutyName) : null;
        return {legacy,rich};
      });
      let outcome: { status: string; message: string };
      if (message) {
        try { outcome = message.rich ? await this.sms.sendDutyIntent(message.legacy[0],message.rich) : await this.sms.send(...message.legacy); }
        catch { outcome = { status: "unknown", message: "短信发送结果待确认，请勿重复发送" }; }
      } else {
        outcome = { status: "cancelled", message: "节点或待审批人已变化，本次未发送" };
      }
      const result = { userId, status: outcome.status, message: outcome.message };
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
    return this.detail(id, actorId, true);
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

  private async reminderIntent(tx: Db, context: Awaited<ReturnType<ApprovalProgressService["context"]>>,
      businessLabel:string,dutyName:string) {
    const {instance,business,project,byId} = context;
    const scope = {projectId:business.projectId,projectName:project?.name,applicantName:byId.get(instance.applicantUserId)?.name,businessLabel,dutyName};
    switch (instance.businessType) {
      case "contract_version": return contractReminderIntent(tx,instance.businessId,scope);
      case "payment_request": return paymentReminderIntent(tx,instance.businessId,scope);
      case "expense_claim": return expenseReminderIntent(tx,instance.businessId,scope);
      case "company_transfer": return instance.flowType === "company_transfer.approve"
        ? companyTransferReminderIntent(tx, instance.businessId, instance.id, instance.applicantUserId, scope) : null;
      case "spot_procurement_version": return instance.flowType === "spot_procurement.approve" ? spotApplicationReminderIntent(tx, instance.businessId, scope) : null;
      case "spot_procurement_payment": return instance.flowType === "spot_procurement.payment.approve" ? spotPaymentReminderIntent(tx, instance.businessId, scope) : null;
      case "general_procurement": {
        const row=await tx.generalProcurement.findUnique({where:{id:instance.businessId}});
        return row?.requestProtocolVersion===2 && row.approvalInstanceId===instance.id
          ? generalProcurementDutySmsIntent(row,project?.name,businessLabel,dutyName) : null;
      }
      default: return null;
    }
  }

  private async business(db: Db, instance: ApprovalInstance) {
    const id = instance.businessId;
    switch (instance.businessType) {
      case "contract_version": {
        const version = await db.contractVersion.findUnique({ where: { id }, select: {
          contractId: true, status: true, numericProtocolVersion: true, documentContentRevision: true, documentContentFingerprint: true
        } });
        const contract = version && await db.contract.findUnique({ where: { id: version.contractId }, select: { projectId: true, code: true, voidedAt: true } });
        return contract ? { ...contract, contractVersionStatus: version.status, numericProtocolVersion: version.numericProtocolVersion,
          documentContentRevision: version.documentContentRevision, documentContentFingerprint: version.documentContentFingerprint } : null;
      }
      case "general_procurement": return db.generalProcurement.findUnique({ where: { id }, select: { projectId: true, code: true, status: true, approvalInstanceId: true, requestProtocolVersion: true, scope: true, applicantUserId: true } });
      case "company_transfer": {
        const row = await db.companyTransfer.findUnique({ where: { id }, select: { code: true, status: true, approvalInstanceId: true } });
        return row ? { ...row, projectId: null } : null;
      }
      case "fund_execution_case": {
        const row = await db.fundExecutionCase.findFirst({ where: { caseKey: id }, orderBy: { revision: "desc" }, select: { status: true, approvalInstanceId: true, fundExecutionId: true } });
        return row ? { ...row, projectId: null, code: "资金执行申请" } : null;
      }
      case "settlement": return db.settlement.findUnique({ where: { id }, select: { projectId: true, code: true } });
      case "payment_request": return db.paymentRequest.findUnique({ where: { id }, select: { projectId: true, code: true } });
      case "contract_work_completion": {
        const completion = await db.contractWorkCompletion.findUnique({ where: { id }, select: { contractVersionId: true } });
        const version = completion ? await db.contractVersion.findUnique({ where: { id: completion.contractVersionId }, select: { contractId: true } }) : null;
        const contract = version ? await db.contract.findUnique({ where: { id: version.contractId }, select: { projectId: true, code: true } }) : null;
        return contract ? { projectId: contract.projectId, code: contract.code ?? "合同履约确认", contractVersionId: completion!.contractVersionId } : null;
      }
      case "project_expense_request": return db.projectExpenseRequest.findUnique({ where: { id }, select: { projectId: true, code: true, expenseType: true, expenseSubtype: true, status: true } });
      case "expense_claim": return db.expenseClaim.findUnique({ where: { id }, select: {
        projectId: true, code: true, applicantUserId: true, handledByUserId: true, status: true,
        approvalInstanceId: true, claimType: true, generalProcurementId: true, actualPurchaseBatchId: true
      } });
      case "spot_procurement_version": {
        const version = await db.spotProcurementVersion.findUnique({ where: { id }, select: { procurementId: true } });
        return version ? db.spotProcurement.findUnique({ where: { id: version.procurementId }, select: { projectId: true, code: true } }) : null;
      }
      case "spot_procurement_payment": return db.spotProcurementPayment.findUnique({ where: { id }, select: { projectId: true, code: true } });
      case "project_financing_quota": return db.projectFinancingQuota.findUnique({ where: { id }, select: { projectId: true, requestedByRoleKey: true, status: true } });
      case "project_settlement_exception_quota": return db.projectSettlementExceptionQuota.findUnique({ where: { id }, select: { projectId: true, status: true } });
      default: return null;
    }
  }

  async transitionSmsDuties(db: Db, id: string, correction: boolean) {
    const round = await db.approvalInstance.findUnique({ where: { id } });
    const flowTypes: Record<string, string> = {
      project_expense_request: "project_expense.approve",
      project_financing_quota: "project_financing_quota.approve",
      project_settlement_exception_quota: "settlement_exception_quota.approve",
      fund_execution_case: "fund_execution_case.approve"
    };
    if (!round || !Object.hasOwn(flowTypes, round.businessType) || flowTypes[round.businessType] !== round.flowType) return [];
    const fundExecution = round.businessType === "fund_execution_case";
    if (round.status !== (correction ? (fundExecution ? "returned_to_applicant" : "rejected") : "in_progress")) return [];
    const latest = await db.approvalInstance.findFirst({
      where: { businessId: round.businessId, businessType: round.businessType, flowType: round.flowType },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { id: true }
    });
    if (latest?.id !== id) return [];
    const ctx = await this.context(db, id, null, false, round);
    if (ctx.retiredReminderReason || !("status" in ctx.business) || (ctx.business.projectId && !ctx.project?.isActive)) return [];
    if (fundExecution) {
      if (!("approvalInstanceId" in ctx.business) || ctx.business.approvalInstanceId !== id ||
          !(correction ? ["submitted", "draft"].includes(ctx.business.status) : ctx.business.status === "submitted")) return [];
    } else if (ctx.business.status !== (correction ? "rejected" : "approval_pending")) {
      return [];
    }
    if (correction) {
      const action = fundExecution ? "return_to_applicant" : "reject";
      if (!ctx.logs.some(log => log.action === action)) return [];
      const applicant = ctx.byId.get(round.applicantUserId);
      return applicant?.isActive ? [{ duty: "correction", recipients: [applicant] }] : [];
    }
    return activeApprovalNodeIndexes(round.frozenNodes, round.currentNodeIndex).map(duty => ({
      duty, recipients: ctx.currentPendingByDuty?.[duty] ?? ctx.pending.filter(user => ctx.nodeIds[duty]?.includes(user.id))
    }));
  }

  private async context(db: Db, id: string, actorId: string | null, allowViewer = false, loadedRound?: ApprovalInstance) {
    const instance = loadedRound ?? await db.approvalInstance.findUnique({ where: { id } });
    if (!instance) throw new NotFoundException("审批流程不存在或无权查看");
    const business = await this.business(db, instance);
    if (!business) throw new NotFoundException("审批流程不存在或无权查看");
    const projectId = business.projectId;
    const parallelExpense = instance.businessType === "expense_claim" &&
      instance.flowType === "expense_claim.approve" && isParallelApprovalRound(instance.frozenNodes) &&
      "claimType" in business && supportsExpenseParallelApproval(business);
    const expenseUnavailable = parallelExpense && (
      business.status !== "approval_pending" || business.approvalInstanceId !== instance.id || instance.status !== "in_progress"
    );
    const parallelGeneral = instance.businessType === "general_procurement" && "requestProtocolVersion" in business && business.requestProtocolVersion === 2 && isParallelApprovalRound(instance.frozenNodes);
    const contractRound = instance.businessType === "contract_version" && instance.flowType === "contract.approve" &&
      instance.status === "in_progress" && "numericProtocolVersion" in business && business.numericProtocolVersion === 2;
    const contractSnapshot = contractRound ? contractRoundSubmissionSnapshot(instance.frozenNodes) : null;
    const contractDutyIndexes = contractSnapshot ? activeApprovalNodeIndexes(instance.frozenNodes, instance.currentNodeIndex) : [];
    const [users, positions, assignments, members, logs, delegations, project] = await Promise.all([
      db.user.findMany({ select: { id: true, name: true, phone: true, isActive: true } }),
      db.position.findMany({ select: { id: true, key: true } }),
      db.userPosition.findMany({ where: { OR: [{ projectId: null }, ...(projectId ? [{ projectId }] : [])] } }),
      projectId ? db.projectMember.findMany({ where: { projectId } }) : Promise.resolve([]),
      db.approvalActionLog.findMany({ where: { approvalInstanceId: id }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }),
      db.approvalDelegation.findMany({ where: { enabled: true, startsAt: { lte: new Date() }, endsAt: { gt: new Date() }, OR: [
        { actionKey: null, resourceType: null, resourceId: null },
        ...(instance.businessType === "spot_procurement_version" && isParallelApprovalRound(instance.frozenNodes) ? activeApprovalNodeIndexes(instance.frozenNodes, instance.currentNodeIndex).map(index => ({actionKey: "spot_procurement.approve", resourceType: SPOT_APPROVAL_DUTY_RESOURCE, resourceId: spotApprovalDutyId(instance.id, index)})) : []),
        ...(parallelGeneral ? activeApprovalNodeIndexes(instance.frozenNodes, instance.currentNodeIndex).map(index => ({ actionKey: "general_procurement.approve", resourceType: GENERAL_REQUEST_DUTY_RESOURCE, resourceId: generalRequestDutyId(instance.id, index) })) : []),
        ...contractDutyIndexes.map(index => ({ actionKey: "contract.approve", resourceType: CONTRACT_PARALLEL_DUTY_RESOURCE, resourceId: contractParallelDutyId(instance.id, index) })),
        ...(instance.businessType === "fund_execution_case" ? [{ actionKey: "fund_execution_case.approve", resourceType: "fund_execution_case", resourceId: instance.businessId }] : [])
      ] } }),
      projectId ? db.project.findUnique({ where: { id: projectId }, select: { name: true, isActive: true } }) : Promise.resolve(null)
    ]);
    const byId = new Map(users.map(u => [u.id, u]));
    if (actorId !== null && !byId.get(actorId)?.isActive) throw new NotFoundException("审批流程不存在或无权查看");
    const roles = new Map<string, ApprovalActorRoleScopes>();
    const positionKeys = new Map(positions.map(p => [p.id, p.key as RoleKey]));
    for (const user of users) roles.set(user.id, {
      globalRoleKeys: assignments.filter(a => a.userId === user.id && !a.projectId).flatMap(a => positionKeys.get(a.positionId) ? [positionKeys.get(a.positionId)!] : []),
      projectRoleKeys: [...assignments.filter(a => a.userId === user.id && a.projectId === projectId && projectId).flatMap(a => positionKeys.get(a.positionId) ? [positionKeys.get(a.positionId)!] : []), ...members.filter(m => m.userId === user.id).map(m => m.positionKey as RoleKey)]
    });
    const allRoles = (userId: string) => ["project_expense_request", "spot_procurement_version", "spot_procurement_payment"].includes(instance.businessType) ? resolveEffectiveRoleKeys(roles.get(userId)?.globalRoleKeys ?? [], roles.get(userId)?.projectRoleKeys ?? []) : [...(roles.get(userId)?.globalRoleKeys ?? []), ...(roles.get(userId)?.projectRoleKeys ?? [])];
    const legacyContractParallel = instance.businessType === "contract_version" && isLegacyContractParallelRound(instance.frozenNodes);
    const supportsGlobalDelegation = !legacyContractParallel &&
      ["contract_version", "settlement", "payment_request", "fund_execution_case", "contract_work_completion"].includes(instance.businessType);
    const parallelSpot = instance.businessType === "spot_procurement_version" && isParallelApprovalRound(instance.frozenNodes);
    const activeDelegatorsFor = (userId: string, nodeIndex = instance.currentNodeIndex) => supportsGlobalDelegation || parallelSpot ? delegations
      .filter(d => d.toUserId === userId && byId.get(d.fromUserId)?.isActive && (parallelSpot
        ? d.actionKey === "spot_procurement.approve" && d.resourceType === SPOT_APPROVAL_DUTY_RESOURCE && d.resourceId === spotApprovalDutyId(instance.id, nodeIndex)
        : ((d.actionKey == null && d.resourceType == null && d.resourceId == null) || (instance.businessType === "fund_execution_case" && d.actionKey === "fund_execution_case.approve" && d.resourceType === "fund_execution_case" && d.resourceId === instance.businessId))))
      .map(d => ({ userId: d.fromUserId, roleKeys: allRoles(d.fromUserId), roleScopes: roles.get(d.fromUserId) })) : [];
    const hasAssignmentReceipt = (assignment: Record<string, unknown>) => logs.some(log => {
      const metadata = object(log.metadata);
      return ["transfer", "delegate"].includes(log.action) &&
        (log.actorUserId === assignment.fromUserId || log.representedUserId === assignment.fromUserId) &&
        metadata.fromUserId === assignment.fromUserId && metadata.toUserId === assignment.toUserId && metadata.fromRoleKey === assignment.fromRoleKey;
    });
    const validAssignment = (node: FrozenApprovalNode, value: unknown) => {
      const assignment = object(value);
      if (legacyContractParallel || parallelExpense ||
          !["contract_version", "settlement", "payment_request", "expense_claim", "fund_execution_case", "contract_work_completion"].includes(instance.businessType)) return false;
      if (typeof assignment.fromUserId !== "string" || typeof assignment.toUserId !== "string" || typeof assignment.fromRoleKey !== "string") return false;
      if (!strings(node.roleKeys).includes(assignment.fromRoleKey)) return false;
      if (!isGovernedFrozenApprovalNode(node)) return allRoles(assignment.fromUserId).includes(assignment.fromRoleKey as RoleKey) || hasAssignmentReceipt(assignment);
      const identity = resolveApprovalReviewIdentity({
        node: { ...node, approvedRoleKeys: [], assignments: [assignment] }, actorUserId: assignment.toUserId, actorRoleKeys: []
      });
      return identity?.viaAssignment === true && identity.representedUserId === assignment.fromUserId;
    };
    const ordinaryParallelPayment = instance.businessType === "payment_request" && instance.flowType === "payment.approve" &&
      isOrdinaryPaymentParallelRound(instance.frozenNodes);
    const delegationPrincipals = ordinaryParallelPayment
      ? new Map(users.filter(user => user.isActive).map(user => [user.id, roles.get(user.id)])) : undefined;
    const activeOrdinaryDuties = ordinaryParallelPayment && ACTIVE.has(instance.status)
      ? activeApprovalNodeIndexes(instance.frozenNodes, instance.currentNodeIndex) : [];
    // Invalid assignment metadata must not create a new reader or SMS recipient.
    const rawNodes = Array.isArray(instance.frozenNodes) ? instance.frozenNodes.map((value, index) => {
      const node = object(value) as FrozenApprovalNode;
      const assignments = Array.isArray(node.assignments) ? node.assignments.filter(assignment =>
        (!ordinaryParallelPayment || object(assignment).kind !== "delegate" ||
          (delegationPrincipals && activeOrdinaryDuties.includes(index) &&
            isLiveOrdinaryPaymentDelegation(node, assignment, index, delegationPrincipals))) &&
        validAssignment(node, assignment)
      ) : [];
      return { ...node, assignments };
    }) : [];
    const legacyCandidates = (node: FrozenApprovalNode) => users.filter(u => u.isActive && resolveApprovalReviewIdentity({ node: { ...node, approvedRoleKeys: [] }, actorUserId: u.id, actorRoleKeys: allRoles(u.id), actorRoleScopes: roles.get(u.id), legacyContractRoute: instance.businessType === "contract_version" })).map(u => u.id);
    const generalNodeIds: string[][] = [];
    if (parallelGeneral && "scope" in business && "requestProtocolVersion" in business) {
      for (const [index, node] of rawNodes.entries()) {
        const ids: string[] = [];
        if (isApprovalDutyComplete(node as unknown as Record<string, unknown>)) ids.push(...logs.filter(log => log.action === "approve" && strings(node.roleKeys).includes(log.approvedRoleKey ?? "")).map(log => log.actorUserId));
        else for (const user of users) if (user.isActive && await generalRequestDutyIdentity(db as Prisma.TransactionClient, new ProjectVisibilityService(this.prisma),
          { projectId, scope: String(business.scope) }, instance, index, user.id)) ids.push(user.id);
        generalNodeIds.push([...new Set(ids)]);
      }
    }
    const effectiveApprovals = ordinaryParallelPayment
      ? (ACTIVE.has(instance.status) || instance.status === "approved"
        ? paymentParallelRoundEvidence(ACTIVE.has(instance.status) ? "approval_pending" : instance.status, instance.frozenNodes, logs, instance)
        : [])
      : null;
    const expenseActiveIndexes = parallelExpense && !expenseUnavailable
      ? activeApprovalNodeIndexes(instance.frozenNodes, instance.currentNodeIndex) : [];
    const expensePendingByDuty = parallelExpense ? rawNodes.map((node, index) => {
      if (!expenseActiveIndexes.includes(index)) return [];
      return users.filter(user => {
        const scopes = roles.get(user.id);
        return user.isActive && scopes &&
          Boolean(resolveExpenseParallelDutyIdentity({ node, actorUserId: user.id, actorRoleScopes: scopes }));
      });
    }) : null;
    const contractPendingByDuty = contractRound ? rawNodes.map(() => [] as typeof users) : null;
    if (contractPendingByDuty && projectId && project?.isActive && "contractVersionStatus" in business &&
        business.contractVersionStatus === "in_approval" && !business.voidedAt && contractSnapshot?.contractVersionId === instance.businessId &&
        contractSnapshot.documentContentRevision === business.documentContentRevision &&
        contractSnapshot.documentContentFingerprint === business.documentContentFingerprint) {
      const activeRounds = await db.approvalInstance.findMany({
        where: { businessType: "contract_version", businessId: instance.businessId, flowType: "contract.approve", status: "in_progress" },
        select: { id: true }, take: 2
      });
      const originators = activeRounds.length === 1 && activeRounds[0].id === instance.id
        ? await resolveContractOriginators(db, instance.businessId, instance.frozenNodes).catch(error => {
            if (error instanceof ConflictException) return null;
            throw error;
          })
        : null;
      if (originators) {
        for (const index of contractDutyIndexes) {
          const node = rawNodes[index];
          const resourceId = contractParallelDutyId(instance.id, index);
          const delegates = new Set(delegations.filter(d => d.actionKey === "contract.approve" &&
            d.resourceType === CONTRACT_PARALLEL_DUTY_RESOURCE && d.resourceId === resourceId).map(d => d.toUserId));
          for (const user of users) {
            const roleKeys = allRoles(user.id);
            if (!user.isActive || (!delegates.has(user.id) &&
                !strings(node.roleKeys).some(role => roleKeys.includes(role as RoleKey)))) continue;
            const identity = await contractParallelDutyIdentity(db, instance, projectId, user.id, index, false);
            const selfReview = instance.applicantUserId === user.id || originators.includes(user.id);
            if (identity && (!selfReview || identity.representedUserId === user.id)) contractPendingByDuty[index].push(user);
          }
        }
      }
    }
    const nodeIds = rawNodes.map((node, nodeIndex) => parallelGeneral ? generalNodeIds[nodeIndex] : isParallelApprovalRound(instance.frozenNodes) && isApprovalDutyComplete(node as unknown as Record<string, unknown>)
      ? [...new Set((effectiveApprovals ?? logs).filter(log => log.action === "approve" && strings(node.roleKeys).includes(log.approvedRoleKey ?? "")).map(log => log.actorUserId))]
      : contractPendingByDuty ? contractPendingByDuty[nodeIndex].map(user => user.id)
      : expensePendingByDuty && object(node).candidatePolicy === EXPENSE_CURRENT_ROLE_SCOPE
        ? expensePendingByDuty[nodeIndex].map(user => user.id)
        : [...new Set([
      ...(isGovernedFrozenApprovalNode(node) ? (typeof node.selectedUserId === "string" ? [node.selectedUserId] : frozenCandidateUserIds(node)) : legacyCandidates(node)),
      ...node.assignments.flatMap(a => [object(a).fromUserId, object(a).toUserId].filter((v): v is string => typeof v === "string")),
      ...users.filter(user => user.isActive && activeDelegatorsFor(user.id, nodeIndex).length > 0 && resolveApprovalReviewIdentity({
        node: { ...node, approvedRoleKeys: [] }, actorUserId: user.id, actorRoleKeys: allRoles(user.id), actorRoleScopes: roles.get(user.id),
        activeDelegators: activeDelegatorsFor(user.id, nodeIndex), legacyContractRoute: instance.businessType === "contract_version"
      })).map(user => user.id)
    ])]);
    const participants = new Set([instance.applicantUserId, ...nodeIds.flat(), ...logs.filter(l => ["approve", "reject", "reject_previous", "return_to_applicant", "transfer", "delegate"].includes(l.action)).map(l => l.actorUserId)]);
    // 实办人代表委托人/被转审人办理后，原委托人仍可查看本轮结果，事务内已记录 representedUserId。
    for (const log of logs) {
      if (log.action !== "approve" || typeof log.representedUserId !== "string" || log.representedUserId === log.actorUserId) continue;
      participants.add(log.representedUserId);
    }
    for (const log of logs) {
      if (!["transfer", "delegate"].includes(log.action)) continue;
      const assignment = object(log.metadata);
      if (ordinaryParallelPayment && assignment.ordinaryPaymentDelegation === true) continue;
      if (rawNodes.some(node => validAssignment(node, assignment))) {
        participants.add(String(assignment.fromUserId));
        participants.add(String(assignment.toUserId));
      }
    }
    if ("applicantUserId" in business && typeof business.applicantUserId === "string") participants.add(business.applicantUserId);
    if ("handledByUserId" in business && typeof business.handledByUserId === "string") participants.add(business.handledByUserId);
    if (actorId !== null && parallelGeneral && "applicantUserId" in business && typeof business.applicantUserId === "string") {
      const actor = await generalRequestActor(db as Prisma.TransactionClient, new ProjectVisibilityService(this.prisma), actorId, projectId);
      if (generalRequestCanRead({ applicantUserId: business.applicantUserId }, actor)) participants.add(actorId);
    }
    const participant = actorId !== null && participants.has(actorId);
    if (actorId !== null && !participant) {
      // 可见范围与可办理分离：管理查看人只读进度，不进入任何职责候选。
      const viewerAllowed = allowViewer && this.files
        ? await this.files.canViewApprovalFlow(instance.businessType, instance.businessId, actorId) : false;
      if (!viewerAllowed) throw new NotFoundException("审批流程不存在或无权查看");
    }
    const activeIndexes = activeApprovalNodeIndexes(instance.frozenNodes, instance.currentNodeIndex);
    const current = rawNodes[instance.currentNodeIndex];
    let legacyOriginators: string[] | null = null;
    if (legacyContractParallel && ACTIVE.has(instance.status) && instance.flowType === "contract.approve" &&
        "contractVersionStatus" in business && business.contractVersionStatus === "in_approval" &&
        business.numericProtocolVersion === 1 && !business.voidedAt) {
      const activeRounds = await db.approvalInstance.findMany({
        where: { businessType: "contract_version", businessId: instance.businessId, flowType: "contract.approve", status: "in_progress" },
        select: { id: true }, take: 2
      });
      if (activeRounds.length === 1 && activeRounds[0].id === instance.id) {
        try {
          legacyOriginators = await resolveContractOriginators(db, instance.businessId, instance.frozenNodes);
        } catch (error) {
          if (!(error instanceof ConflictException)) throw error;
        }
      }
    }
    const retiredExpenseApproval =
      (instance.businessType === "expense_claim" && "claimType" in business && business.claimType === "loan") ||
      (instance.businessType === "project_expense_request" && "expenseType" in business &&
        "expenseSubtype" in business && isRetiredProjectEmployeeLoan(business));
    const retiredWageReminder = instance.businessType === "fund_execution_case" && "fundExecutionId" in business &&
      isRetiredWageOutflow(await db.fundExecution.findUnique({
        where: { id: business.fundExecutionId },
        select: { executionKind: true, direction: true }
      }));
    const retiredApprovalReason = isLegacySettlementApproval(instance)
      ? "旧结算审批催办已停止办理"
      : retiredExpenseApproval ? "员工借款审批催办已停止办理" : null;
    const retiredReminderReason = retiredWageReminder ? "历史工资出款审批催办已停止办理" : retiredApprovalReason;
    const businessUnavailable = Boolean(retiredApprovalReason) || expenseUnavailable || (legacyContractParallel && !legacyOriginators) || (instance.businessType === "project_financing_quota" && project?.isActive !== true) || (["spot_procurement_version", "spot_procurement_payment"].includes(instance.businessType) && !this.pilot?.isEnabled(projectId)) ||
      (["general_procurement", "company_transfer", "fund_execution_case"].includes(instance.businessType) &&
        (!("status" in business) || business.status !== (instance.businessType === "general_procurement" ? "approval_pending" : "submitted") || !("approvalInstanceId" in business) || business.approvalInstanceId !== instance.id));
    const currentPendingByDuty = contractPendingByDuty ?? expensePendingByDuty;
    const currentPendingIds = currentPendingByDuty && new Set(currentPendingByDuty.flat().map(user => user.id));
    const pending = currentPendingIds ? users.filter(user => currentPendingIds.has(user.id))
      : !businessUnavailable && ACTIVE.has(instance.status) && current ? users.filter(user => {
      if (!user.isActive || (legacyContractParallel && roles.get(user.id)?.globalRoleKeys.includes("super_admin"))) return false;
      if (parallelGeneral) return activeIndexes.some(index => generalNodeIds[index]?.includes(user.id));
      const actorRoleKeys = allRoles(user.id);
      const identity = activeIndexes.map(index => {
        const userIdentity = { actorUserId: user.id, actorRoleKeys, actorRoleScopes: roles.get(user.id), activeDelegators: activeDelegatorsFor(user.id, index) };
        return ordinaryParallelPayment
          ? resolveOrdinaryPaymentDuty(rawNodes, index, { ...userIdentity, delegationPrincipals })
          : resolveApprovalReviewIdentity({ node: rawNodes[index], ...userIdentity, legacyContractRoute: instance.businessType === "contract_version" });
      }).find(Boolean);
      if (!identity || (instance.businessType === "general_procurement" && identity.viaAssignment)) return false;
      if (instance.businessType === "company_transfer" && instance.applicantUserId === user.id) return false;
      if (instance.businessType === "fund_execution_case" || parallelSpot) return true;
      const selfReview = instance.applicantUserId === user.id || legacyOriginators?.includes(user.id);
      if (!selfReview) return true;
      // Mirror each domain's existing self-review eligibility, without performing its confirmation step.
      if (["expense_claim", "general_procurement"].includes(instance.businessType)) return identity.representedUserId === user.id && !identity.viaAssignment;
      if (instance.businessType === "project_financing_quota") return "requestedByRoleKey" in business && business.requestedByRoleKey === "finance_director" && instance.currentNodeIndex === 0 && identity.approvedRoleKey === "finance_director";
      if (instance.businessType === "project_settlement_exception_quota") return true;
      try {
        assertOrdinaryApplicantCannotReview({
          applicantUserId: user.id, actorUserId: user.id, actorRoleKeys,
          approvedRoleKey: identity.approvedRoleKey, representedUserId: identity.representedUserId, viaAssignment: identity.viaAssignment,
          allowContractDirectorSelfReview: instance.businessType === "contract_version"
        });
        return true;
      } catch (error) {
        if (error instanceof ForbiddenException) return false;
        throw error;
      }
    }) : [];
    return { instance, business, project, rawNodes, nodeIds, byId, pending, logs, effectiveApprovals, businessUnavailable, retiredReminderReason, retiredWageReminder, participant, expensePendingByDuty, currentPendingByDuty };
  }

  private project(context: Awaited<ReturnType<ApprovalProgressService["context"]>>, actorId: string) {
    const { instance, rawNodes, nodeIds, byId, pending, logs, effectiveApprovals, business, project } = context;
    const person = (id: string) => ({ id, name: byId.get(id)?.name ?? "历史人员（姓名缺失）" });
    const requests = logs.filter(l => l.action === "remind" && object(l.metadata).kind === "sms_request");
    const active = ACTIVE.has(instance.status);
    const parallel = isParallelApprovalRound(instance.frozenNodes);
    // 当前轮有效签字：旧轮（驳回/重提之前）的签字不得继续展示或计入完成数。
    const roundApprovals = effectiveApprovals ?? currentApprovalRoundApprovals(logs);
    const signaturesFor = (node: FrozenApprovalNode) => roundApprovals
      .filter(log => strings(node.roleKeys).includes(log.approvedRoleKey ?? ""))
      .map(log => ({
        id: log.id,
        name: (() => { const frozen = object(log.metadata).approverName;
          return typeof frozen === "string" && frozen.trim() ? frozen : person(log.actorUserId).name; })(),
        role: log.approvedRoleKey ?? "",
        signedAt: log.createdAt.toISOString()
      }));
    const pendingByDuty = context.currentPendingByDuty ?? nodeIds.map((ids, index) =>
      (parallel || index === instance.currentNodeIndex) && (!parallel || !isApprovalDutyComplete(rawNodes[index] as unknown as Record<string, unknown>))
        ? pending.filter(user => ids.includes(user.id)) : []);
    const now = Date.now();
    const cooldowns = new Map<number, number>();
    for (const request of requests) {
      const expiry = request.createdAt.getTime() + COOLDOWN_MS;
      if (expiry <= now) continue;
      const metadata = object(request.metadata);
      const duties = Array.isArray(metadata.dutyIndexes) ? metadata.dutyIndexes : [metadata.currentNodeIndex];
      for (const index of duties) {
        if (typeof index === "number" && pendingByDuty[index]?.length) cooldowns.set(index, Math.max(expiry, cooldowns.get(index) ?? 0));
      }
    }
    const remindableRecipients = context.retiredReminderReason ? [] : pending.filter(user => !pendingByDuty.some((people, index) =>
      cooldowns.has(index) && people.some(person => person.id === user.id))).map(user => person(user.id));
    const nextRemindAt = cooldowns.size ? new Date(Math.min(...cooldowns.values())).toISOString() : null;
    return {
      id: instance.id, businessType: instance.businessType, businessId: instance.businessId,
      title: LABELS[instance.businessType], businessCode: "code" in business ? business.code : "额度申请",
      projectName: project?.name ?? "非项目费用", applicant: person(instance.applicantUserId), status: instance.status,
      createdAt: instance.createdAt.toISOString(), currentNodeIndex: instance.currentNodeIndex,
      currentNodeName: active ? (parallel ? "并联审批" : String(rawNodes[instance.currentNodeIndex]?.name ?? "待核对审批节点")) : "流程已结束",
      nodes: rawNodes.map((node, index) => {
        const signatures = signaturesFor(node);
        // 以实际职责签字判断已通过，不再用“第N节点以前都已通过”的序号推断。
        const status = parallel
          ? (isApprovalDutyComplete(node as unknown as Record<string, unknown>) ? "已通过" : !active ? "已结束" : nodeIds[index].length ? (pendingByDuty[index].length ? "处理中" : "待其他有权人员") : "待配置")
          : signatures.length > 0 ? "已通过"
            : index === instance.currentNodeIndex ? (active ? "处理中" : instance.status === "rejected" ? "已驳回" : "已结束")
              : (active ? "未开始" : "未执行");
        return {
          name: typeof node.name === "string" ? node.name : "审批节点", mode: node.mode === "all" ? "会签" : "或签",
          status, signatures,
          participants: nodeIds[index].map(id => {
            const evidence = parallel && isApprovalDutyComplete(node as unknown as Record<string, unknown>)
              ? roundApprovals.find(log => log.action === "approve" && log.actorUserId === id && strings(node.roleKeys).includes(log.approvedRoleKey ?? "")) : null;
            const frozenName = object(evidence?.metadata).approverName;
            return {id, name: typeof frozenName === "string" && frozenName.trim() ? frozenName : person(id).name};
          }), legacyRoster: !parallel && !isGovernedFrozenApprovalNode(node),
          pending: pendingByDuty[index].map(u => person(u.id))
        };
      }),
      pendingRecipients: pending.map(u => person(u.id)),
      parallelCompletion: parallel
        ? { completed: rawNodes.filter(node => isApprovalDutyComplete(node as unknown as Record<string, unknown>)).length, total: rawNodes.length }
        : undefined,
      viewerOnly: !context.participant,
      canHandle: active && pending.some(user => user.id === actorId),
      remindableRecipients,
      canRemind: active && remindableRecipients.length > 0 && this.sms.available(),
      reminderUnavailableReason: !active ? "流程已结束" : context.retiredReminderReason ?? (context.businessUnavailable ? (["spot_procurement_version", "spot_procurement_payment"].includes(instance.businessType) ? "本项目尚未启用零采试点，暂不能催办" : "当前业务未处于可审批状态，暂不能催办") : !pending.length ? "当前没有有效待审批人" : !this.sms.available() ? "短信服务尚未启用" : !remindableRecipients.length ? "刚刚已催办，请稍后再试" : null),
      nextRemindAt,
      reminderToken: createHash("sha256").update(JSON.stringify([
        instance.id, instance.status, instance.currentNodeIndex, instance.updatedAt.toISOString(),
        context.currentPendingByDuty ? pendingByDuty.map(users => users.map(user => user.id).sort()) : pending.map(user => user.id).sort()
      ])).digest("hex"),
      history: logs.filter(log => !["sms_result", "sms_recipient_result"].includes(String(object(log.metadata).kind)) &&
        !(isParallelDutyNotificationEvent(log) && ["queued", "dispatch_claimed"].includes(String(object(log.metadata).event)))).map(log => ({ id: log.id,
        actor: isParallelDutyNotificationEvent(log) ? {id: "system", name: "系统"} : person(log.actorUserId), action: isParallelDutyNotificationEvent(log)
          ? ({accepted: "已提交审批通知", failed: "审批通知发送失败", unknown: "审批通知结果待核对", cancelled: "审批通知已取消"} as Record<string, string>)[String(object(log.metadata).event)] ?? "审批通知" : ({ approve: "同意", reject: "驳回", reject_previous: "退回上一节点", return_to_applicant: "退回申请人", withdraw: "撤回", transfer: "转审", delegate: "委托", remind: "催办", node_skipped: "节点跳过" } as Record<string, string>)[log.action] ?? "流程记录", comment: isParallelDutyNotificationEvent(log) ? `${String(object(log.metadata).dutyName)} · ${person(String(object(log.metadata).recipientId)).name}` : log.comment, createdAt: log.createdAt.toISOString() })),
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
