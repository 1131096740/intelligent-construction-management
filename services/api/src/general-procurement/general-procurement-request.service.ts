import { GENERAL_PROCUREMENT_REQUEST_ENTRY_DEFINITION } from "./general-procurement-entry.definition";
import { generalRequestEstimateText, generalRequestLineSummary } from "./general-procurement-request-facts";
import { GeneralProcurementRequestNotificationService } from "./general-procurement-request-notification.service";
import { AuthService } from "../auth/auth.service";
import { snapshotApprovalSignature, withApprovalIdentity } from "../approval/approval-signature-snapshot";
import { confirmApprovalSelfReview } from "../approval/approval-self-review";
import { activeApprovalNodeIndexes, isParallelApprovalRound } from "../approval/parallel-approval-protocol";
import { generalRequestActor, generalRequestCanRead, generalRequestDutyIdentity } from "./general-procurement-request-access";
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, type GeneralProcurement } from "@prisma/client";
import { createHash } from "node:crypto";
import { GENERAL_PROCUREMENT_CATEGORIES, GENERAL_PROCUREMENT_STATUS_LABELS, normalizeBusinessAmount, normalizeBusinessQuantity, type GeneralProcurementCategory, type GeneralProcurementRequestLine } from "@jiangkong/shared-domain";
import { PrismaService } from "../database/prisma.service";
import { ProjectVisibilityService } from "../auth/project-visibility.service";
import { BusinessNumberingService } from "../business-number/business-numbering.service";
import { AuditService } from "../audit/audit.service";
import { lockMasterDataRow } from "../master-data/master-data-lifecycle";
import type { CreateGeneralProcurementDto, GeneralProcurementDraftDto, ReviewGeneralProcurementDto } from "./general-procurement.dto";

@Injectable()
export class GeneralProcurementRequestService {
  constructor(private readonly prisma: PrismaService, private readonly visibility: ProjectVisibilityService,
    private readonly numbering: BusinessNumberingService, private readonly audit: AuditService, private readonly auth: AuthService, private readonly notifications: GeneralProcurementRequestNotificationService) {}

  private payload(input: GeneralProcurementDraftDto) {
    if (!input.scope || !["project", "company_daily"].includes(input.scope)) throw new BadRequestException("请选择项目采购或公司日常采购");
    if (input.scope === "project" && !input.projectId?.trim()) throw new BadRequestException("请选择所属项目");
    if (input.scope === "company_daily" && input.projectId != null) throw new BadRequestException("公司日常采购不应选择项目");
    if (!Array.isArray(input.lines) || !input.lines.length) throw new BadRequestException("请至少填写一项采购名称");
    const seen = new Set<string>();
    const lines: GeneralProcurementRequestLine[] = input.lines.map((line, index) => {
      if (!line.name?.trim()) throw new BadRequestException(`第${index + 1}行请填写采购名称`);
      const id = line.id.toLowerCase();
      if (seen.has(id)) throw new BadRequestException("采购清单存在重复行，请重新添加");
      seen.add(id);
      const decimal = (value: string | null | undefined, label: string, quantity = false) => {
        try { return quantity ? normalizeBusinessQuantity(value?.trim() || null) : normalizeBusinessAmount(value?.trim() || null); }
        catch (error) { throw new BadRequestException(`第${index + 1}行${label}：${error instanceof Error ? error.message : "请填写有效数值"}`); }
      };
      const date = line.requiredOn?.trim() || null;
      if (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date)) throw new BadRequestException(`第${index + 1}行到位日期无效`);
      return { id, name: line.name.trim(), specification: line.specification?.trim() || null, unit: line.unit?.trim() || null,
        quantity: decimal(line.quantity, "数量", true), unitPrice: decimal(line.unitPrice, "预计单价"), estimatedAmount: decimal(line.estimatedAmount, "预计总价"),
        requiredOn: date, note: line.note?.trim() || null };
    });
    if (input.requestedAmountCents != null) throw new BadRequestException("新申请请填写整单预计金额（元），不能使用历史申请金额字段");
    let estimatedAmount: string | null;
    try { estimatedAmount = normalizeBusinessAmount(input.estimatedAmount?.trim() || null); generalRequestLineSummary(lines); }
    catch (error) { throw new BadRequestException(`预计金额：${error instanceof Error ? error.message : "请填写有效数值"}`); }
    return { requestProtocolVersion: 2, scope: input.scope, projectId: input.scope === "project" ? input.projectId! : null,
      companyEntityId: input.companyEntityId ?? null, category: input.category, reason: input.reason?.trim() || "", requestedAmountCents: null, estimatedAmount,
      lines: lines as unknown as Prisma.InputJsonValue };
  }

  private async validateScope(tx: Prisma.TransactionClient, actorUserId: string, data: ReturnType<GeneralProcurementRequestService["payload"]>) {
    const actor = await tx.user.findUnique({ where: { id: actorUserId }, select: { id: true, name: true, isActive: true } });
    if (!actor?.isActive) throw new ForbiddenException("当前账号不存在或已停用");
    if (data.projectId) {
      await lockMasterDataRow(tx, "Project", data.projectId);
      const projects = await this.visibility.visibleRequestedProjectIdsInTransaction(tx, actorUserId, [data.projectId]);
      if (!projects.includes(data.projectId)) throw new ForbiddenException("当前账号无权为该项目申请采购");
    }
    let companyNameSnapshot: string | null = null;
    if (data.companyEntityId) {
      await lockMasterDataRow(tx, "CompanyEntity", data.companyEntityId);
      const company = await tx.companyEntity.findFirst({ where: { id: data.companyEntityId, isActive: true } });
      if (!company) throw new BadRequestException("费用承担公司不存在或已停用");
      companyNameSnapshot = company.name;
    }
    return { actor, companyNameSnapshot };
  }

  async create(actorUserId: string, input: CreateGeneralProcurementDto) {
    const data = this.payload(input);
    const fingerprint = createHash("sha256").update(JSON.stringify([actorUserId, data], (_key, value) => typeof value === "bigint" ? value.toString() : value)).digest("hex");
    return this.prisma.$transaction(async tx => {
      await tx.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`general-request:${input.requestKey}`}, 0))`);
      const { actor, companyNameSnapshot } = await this.validateScope(tx, actorUserId, data);
      const deleted = await tx.auditLog.findFirst({ where: { action: "general_procurement.draft.delete", metadata: { path: ["requestKey"], equals: input.requestKey } } });
      if (deleted) throw new ConflictException("此草稿已删除，请重新发起申请");
      const existing = await tx.generalProcurement.findUnique({ where: { requestKey: input.requestKey } });
      if (existing) {
        if (existing.applicantUserId !== actorUserId || existing.creationFingerprint !== fingerprint) throw new ConflictException("重复提交内容不一致，请刷新后核对");
        return { id: existing.id, code: existing.code, revision: existing.revision };
      }
      const row = await tx.generalProcurement.create({ data: { ...data, companyNameSnapshot, requestKey: input.requestKey,
        creationFingerprint: fingerprint, code: await this.numbering.allocateDaily(tx, "ZHCG"), applicantUserId: actor.id, applicantNameSnapshot: actor.name } });
      await this.audit.record(tx, { actorUserId, action: "general_procurement.create", businessType: "general_procurement", businessId: row.id, metadata: { code: row.code, requestProtocolVersion: 2 } });
      return { id: row.id, code: row.code, revision: row.revision };
    });
  }



  async deleteUnsubmittedDraft(id: string, actorUserId: string, revision: number) {
    return this.prisma.$transaction(async tx => {
      const source = await tx.generalProcurement.findUnique({ where: { id } });
      if (!source) throw new NotFoundException("采购草稿不存在或已删除");
      await tx.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`general-request:${source.requestKey}`}, 0))`);
      const row = await this.lock(tx, id, revision);
      await generalRequestActor(tx, this.visibility, actorUserId, row.projectId);
      if (row.applicantUserId !== actorUserId) throw new ForbiddenException("只有申请人可以删除采购草稿");
      if (row.status !== "draft" || row.approvalInstanceId || !Array.isArray(row.submissions) || row.submissions.length) throw new ConflictException("只能删除从未提交审批的采购草稿");
      const [result] = await tx.$queryRaw<Array<{ deleted: boolean }>>(Prisma.sql`SELECT public.jg_delete_unsubmitted_general_procurement(${id}, ${actorUserId}, ${revision}::integer) AS deleted`);
      if (!result?.deleted) throw new ConflictException("只能删除从未提交审批的采购草稿，请刷新后核对状态");
      return { id, deleted: true };
    });
  }

  async updateDraft(id: string, actorUserId: string, input: GeneralProcurementDraftDto & { revision: number }) {
    const data = this.payload(input);
    return this.prisma.$transaction(async tx => {
      const row = await this.lock(tx, id, input.revision);
      if (row.applicantUserId !== actorUserId) throw new ForbiddenException("只有申请人可以修改采购申请");
      if (!["draft", "returned"].includes(row.status)) throw new ConflictException("申请已提交，不可修改");
      const { companyNameSnapshot } = await this.validateScope(tx, actorUserId, data);
      const updated = await tx.generalProcurement.update({ where: { id }, data: { ...data, companyNameSnapshot, revision: { increment: 1 } } });
      await this.audit.record(tx, { actorUserId, action: "general_procurement.update", businessType: "general_procurement", businessId: id, metadata: { revision: updated.revision } });
      return { id, status: updated.status, revision: updated.revision };
    });
  }

  private async lock(tx: Prisma.TransactionClient, id: string, revision: number) {
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "GeneralProcurement" WHERE "id" = ${id} FOR UPDATE`);
    const row = await tx.generalProcurement.findUnique({ where: { id } });
    if (!row || row.requestProtocolVersion !== 2) throw new ConflictException("采购申请已变化，请刷新页面");
    if (row.revision !== revision) throw new ConflictException("申请已被更新，请刷新页面后重试");
    return row;
  }


  private async clearCurrentRoundSignatures(tx: Prisma.TransactionClient, roundId: string) {
    await tx.approvalActionLog.updateMany({ where: { approvalInstanceId: roundId, action: "approve" }, data: {
      signatureFileIdSnapshot: null, signatureSha256Snapshot: null, signatureVersionIdSnapshot: null } });
  }
  async withdraw(id: string, actorUserId: string, input: { revision: number; reason: string }) {
    return this.prisma.$transaction(async tx => {
      const row = await this.lock(tx, id, input.revision);
      await generalRequestActor(tx, this.visibility, actorUserId, row.projectId);
      if (row.applicantUserId !== actorUserId) throw new ForbiddenException("只有申请人可以撤回采购申请");
      if (row.status !== "approval_pending" || !row.approvalInstanceId) throw new ConflictException("当前申请不可撤回");
      const round = await tx.approvalInstance.findUniqueOrThrow({ where: { id: row.approvalInstanceId } });
      if (round.status !== "in_progress" || !isParallelApprovalRound(round.frozenNodes)) throw new ConflictException("审批状态已变化，请刷新页面");
      const nodes = round.frozenNodes.map(node => ({ ...node, approvedRoleKeys: [] }));
      await tx.approvalInstance.update({ where: { id: round.id }, data: { status: "withdrawn", frozenNodes: nodes as Prisma.InputJsonValue, currentNodeIndex: 0 } });
      await this.clearCurrentRoundSignatures(tx, round.id);
      await tx.approvalActionLog.create({ data: { approvalInstanceId: round.id, action: "withdraw", actorUserId, comment: input.reason.trim() } });
      const updated = await tx.generalProcurement.update({ where: { id }, data: { status: "returned", revision: { increment: 1 } } });
      await this.audit.record(tx, { actorUserId, action: "general_procurement.withdraw", businessType: "general_procurement", businessId: id, metadata: { reason: input.reason.trim(), revision: updated.revision } });
      return { id, status: updated.status, revision: updated.revision };
    });
  }

  async submit(id: string, actorUserId: string, revision: number) {
    const result = await this.prisma.$transaction(async tx => {
      const row = await this.lock(tx, id, revision);
      if (row.applicantUserId !== actorUserId) throw new ForbiddenException("只有申请人可以提交采购申请");
      if (!["draft", "returned"].includes(row.status)) throw new ConflictException("当前申请不能提交，请刷新页面");
      const input = { ...row, requestProtocolVersion: 2 as const, category: row.category as GeneralProcurementCategory, scope: row.scope as "project" | "company_daily", requestedAmountCents: null, estimatedAmount: generalRequestEstimateText(row.estimatedAmount),
        lines: row.lines as unknown as GeneralProcurementRequestLine[] };
      const data = this.payload(input);
      const { companyNameSnapshot } = await this.validateScope(tx, actorUserId, data);
      const nodes = [ { name: "综合部主管", mode: "any", roleKeys: ["comprehensive_director"], approvedRoleKeys: [], protocolVersion: 1, executionMode: "parallel" },
        ...(row.scope === "project" ? [{ name: "项目经理", mode: "any", roleKeys: ["project_manager"], approvedRoleKeys: [], protocolVersion: 1, executionMode: "parallel" }] : []) ];
      const round = await tx.approvalInstance.create({ data: { businessType: "general_procurement", flowType: "general_procurement.approve", businessId: id,
        applicantUserId: actorUserId, status: "in_progress", currentNodeIndex: 0, frozenNodes: nodes } });
      const snapshot = { approvalInstanceId: round.id, submittedAt: new Date().toISOString(),
        ...data, companyNameSnapshot, definitionSnapshot: GENERAL_PROCUREMENT_REQUEST_ENTRY_DEFINITION, lineSummary: generalRequestLineSummary(input.lines), requestedAmountCents: null };
      const updated = await tx.generalProcurement.update({ where: { id }, data: { status: "approval_pending", revision: { increment: 1 }, approvalInstanceId: round.id,
        companyNameSnapshot, submissions: [...(Array.isArray(row.submissions) ? row.submissions : []), snapshot] as unknown as Prisma.InputJsonValue } });
      await tx.approvalActionLog.create({ data: { approvalInstanceId: round.id, action: "submit", actorUserId,
        metadata: { requestProtocolVersion: 2, revision: updated.revision } } });
      await this.audit.record(tx, { actorUserId, action: "general_procurement.submit", businessType: "general_procurement", businessId: id,
        metadata: { approvalInstanceId: round.id, revision: updated.revision } });
      const finalRound = await tx.approvalInstance.findUniqueOrThrow({ where: { id: updated.approvalInstanceId! } });
      await this.notifications.queueInTransaction(tx, updated, finalRound);
      return { id, status: updated.status, revision: updated.revision };
    });
    await this.notifications.dispatchQueued().catch(() => undefined);
    return result;
  }

  async review(id: string, actorUserId: string, input: ReviewGeneralProcurementDto) {
    const result = await this.prisma.$transaction(async tx => {
      const row = await this.lock(tx, id, input.revision);
      if (row.status !== "approval_pending" || !row.approvalInstanceId) throw new ConflictException("当前申请不在审批中，请刷新页面");
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "ApprovalInstance" WHERE "id" = ${row.approvalInstanceId} FOR UPDATE`);
      const round = await tx.approvalInstance.findUnique({ where: { id: row.approvalInstanceId } });
      if (!round || round.status !== "in_progress" || round.businessId !== row.id || round.businessType !== "general_procurement" || !isParallelApprovalRound(round.frozenNodes)) throw new ConflictException("审批状态已变化，请刷新页面");
      const index = input.expectedNodeIndex;
      if (index === undefined || !activeApprovalNodeIndexes(round.frozenNodes, 0).includes(index)) throw new ConflictException("审批职责已变化，请刷新页面后重新选择");
      const identity = await generalRequestDutyIdentity(tx, this.visibility, row, round, index, actorUserId, true, true);
      if (!identity) throw new ForbiddenException("当前账号不是此职责的有效审批人");
      const actor = await generalRequestActor(tx, this.visibility, actorUserId, row.projectId);
      const selfReview = await confirmApprovalSelfReview({ applicantUserId: row.applicantUserId, actorUserId,
        actorRoleKeys: [...actor.globalRoleKeys, ...actor.projectRoleKeys, identity.approvedRoleKey], approvedRoleKey: identity.approvedRoleKey,
        selfReviewReason: input.selfReviewReason, confirmationPassword: input.confirmationPassword,
        confirmPassword: password => this.auth.confirmPassword(actorUserId, password, tx) });
      if (input.decision === "return" && !input.comment?.trim()) throw new BadRequestException("退回时请写明需要补充或修改的内容");
      const signature = input.decision === "approve" ? await snapshotApprovalSignature(tx, actorUserId, { required: true }) : null;
      const nodes = round.frozenNodes as Array<Record<string, unknown>>;
      const node = nodes[index];
      if (input.decision === "approve") nodes[index] = { ...node, approvedRoleKeys: [identity.approvedRoleKey] };
      if (input.decision === "return") {
        nodes.forEach(node => { node.approvedRoleKeys = []; });
        await this.clearCurrentRoundSignatures(tx, round.id);
      }
      const remaining = activeApprovalNodeIndexes(nodes, 0);
      const completed = input.decision === "approve" && remaining.length === 0;
      await tx.approvalActionLog.create({ data: await withApprovalIdentity(tx, { approvalInstanceId: round.id,
        action: input.decision === "return" ? "return_to_applicant" : "approve", actorUserId, approvedRoleKey: identity.approvedRoleKey,
        representedUserId: identity.representedUserId, comment: input.comment?.trim() || null,
        ...(signature ? { signatureFileIdSnapshot: signature.fileId, signatureSha256Snapshot: signature.sha256, signatureVersionIdSnapshot: signature.versionId } : {}),
        metadata: { nodeIndex: index, nodeName: String(node.name), ...(identity.delegationId ? { delegationId: identity.delegationId } : {}), ...selfReview.metadata }
      }, signature) });
      await tx.approvalInstance.update({ where: { id: round.id }, data: { frozenNodes: nodes as Prisma.InputJsonValue,
        currentNodeIndex: remaining[0] ?? nodes.length, status: input.decision === "return" ? "returned" : completed ? "approved" : "in_progress" } });
      const updated = await tx.generalProcurement.update({ where: { id }, data: { status: input.decision === "return" ? "returned" : completed ? "approved_pending_procurement" : "approval_pending", revision: { increment: 1 } } });
      await this.audit.record(tx, { actorUserId, action: `general_procurement.${input.decision}`, businessType: "general_procurement", businessId: id,
        metadata: { approvalInstanceId: round.id, nodeIndex: index, completed, revision: updated.revision } });
      const finalRound = await tx.approvalInstance.findUniqueOrThrow({ where: { id: updated.approvalInstanceId! } });
      await this.notifications.queueInTransaction(tx, updated, finalRound);
      return { id, status: updated.status, revision: updated.revision };
    });
    await this.notifications.dispatchQueued().catch(() => undefined);
    return result;
  }

  async detail(source: GeneralProcurement, actorUserId: string) {
    return this.prisma.$transaction(async tx => {
      const row = await tx.generalProcurement.findUniqueOrThrow({ where: { id: source.id } });
      const actor = await generalRequestActor(tx, this.visibility, actorUserId, row.projectId);
      const round = row.approvalInstanceId ? await tx.approvalInstance.findUnique({ where: { id: row.approvalInstanceId } }) : null;
      const reviewDuties: Array<{ nodeIndex: number; name: string }> = [];
      if (row.status === "approval_pending" && round?.status === "in_progress") {
        for (const index of activeApprovalNodeIndexes(round.frozenNodes, round.currentNodeIndex)) {
          if (await generalRequestDutyIdentity(tx, this.visibility, row, round, index, actorUserId))
            reviewDuties.push({ nodeIndex: index, name: String((round.frozenNodes as Array<Record<string, unknown>>)[index].name) });
        }
      }
      if (!generalRequestCanRead(row, actor) && !reviewDuties.length) throw new ForbiddenException("当前账号无权查看该采购申请");
      const actions = round ? await tx.approvalActionLog.findMany({ where: { approvalInstanceId: round.id }, orderBy: { createdAt: "asc" } }) : [];
      const actionUsers = actions.length ? await tx.user.findMany({ where: { id: { in: actions.map(action => action.actorUserId) } }, select: { id: true, name: true } }) : [];
      const project = row.projectId ? await tx.project.findUnique({ where: { id: row.projectId }, select: { name: true } }) : null;
      const canEdit = row.applicantUserId === actorUserId && ["draft", "returned"].includes(row.status);
      const latest = Array.isArray(row.submissions) ? row.submissions.at(-1) : null;
      const frozenDefinition = latest && typeof latest === "object" && !Array.isArray(latest) ? latest.definitionSnapshot : null;
      const entryDefinition = ["draft", "returned"].includes(row.status) ? GENERAL_PROCUREMENT_REQUEST_ENTRY_DEFINITION : frozenDefinition;
      if (!entryDefinition || typeof entryDefinition !== "object" || Array.isArray(entryDefinition) || entryDefinition.key !== "general_procurement.request" || entryDefinition.version !== 2) throw new ConflictException("提交字段定义已失效，请联系管理员核对");
      return { id: row.id, code: row.code, entryDefinition, requestProtocolVersion: 2, scope: row.scope, projectId: row.projectId, projectName: project?.name ?? "公司日常",
        companyEntityId: row.companyEntityId, companyName: row.companyNameSnapshot, applicantName: row.applicantNameSnapshot,
        category: row.category, categoryLabel: GENERAL_PROCUREMENT_CATEGORIES.find(item => item.key === row.category)?.label ?? "其他物资或服务",
        reason: row.reason, lines: row.lines, estimatedAmount: generalRequestEstimateText(row.estimatedAmount), lineSummary: generalRequestLineSummary(row.lines as unknown as GeneralProcurementRequestLine[]), requestedAmountCents: row.requestedAmountCents?.toString() ?? null, status: row.status,
        statusLabel: GENERAL_PROCUREMENT_STATUS_LABELS[row.status], revision: row.revision, canEdit, canSubmit: canEdit,
        canDeleteDraft: row.status === "draft" && row.applicantUserId === actorUserId && !row.approvalInstanceId,
        canReview: reviewDuties.length > 0, reviewDuties, canProcure: row.status === "approved_pending_procurement" && actor.globalRoleKeys.includes("comprehensive_director"), canWithdraw: row.applicantUserId === actorUserId && row.status === "approval_pending",
        canArchive: false, canRequestPayment: false, canCancelPayment: false, archive: null, payments: [],
        paymentSummary: { reservedAmountCents: null, availableAmountCents: null }, currentNodeName: row.status === "approval_pending" ? "并联审批" : null, requiresSelfReviewConfirmation: reviewDuties.length > 0 && row.applicantUserId === actorUserId,
        submissions: row.submissions, approvals: round ? [{ id: round.id, status: round.status, nodes: Array.isArray(round.frozenNodes) ? (round.frozenNodes as Array<Record<string, unknown>>).map(node => ({ name: String(node.name), approved: Array.isArray(node.approvedRoleKeys) && node.approvedRoleKeys.length > 0 })) : [], actions: actions.filter(action => ["approve", "return_to_applicant", "withdraw"].includes(action.action)).map(action => ({ action: action.action, actorName: actionUsers.find(user => user.id === action.actorUserId)?.name ?? "原办理人", comment: action.comment, createdAt: action.createdAt, signed: Boolean(action.signatureFileIdSnapshot) })) }] : [], createdAt: row.createdAt, updatedAt: row.updatedAt };
    });
  }

}
