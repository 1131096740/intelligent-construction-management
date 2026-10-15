import { GENERAL_PROCUREMENT_ENTRY_DEFINITION } from "./general-procurement-entry.definition";
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, type GeneralProcurement } from "@prisma/client";
import type { RoleKey } from "@jiangkong/shared-domain";
import { AuthService } from "../auth/auth.service";
import { resolveApprovalReviewIdentity, type FrozenApprovalNode } from "../approval/approval-review-identity";
import { snapshotApprovalSignature } from "../approval/approval-signature-snapshot";
import { FileService } from "../file/file.service";
import { createHash } from "node:crypto";
import { GENERAL_PROCUREMENT_CATEGORIES, GENERAL_PROCUREMENT_STATUS_LABELS } from "@jiangkong/shared-domain";
import { AuditService } from "../audit/audit.service";
import { ProjectVisibilityService } from "../auth/project-visibility.service";
import { BusinessNumberingService } from "../business-number/business-numbering.service";
import { PrismaService } from "../database/prisma.service";
import { lockMasterDataRow } from "../master-data/master-data-lifecycle";
import { parseMoneyCentsInput } from "../money/decimal-money";
import { canReadGeneralProcurement, generalProcurementActor } from "./general-procurement-access";
import type { CreateGeneralProcurementDto, ReviewGeneralProcurementDto, UpdateGeneralProcurementDto, WithdrawGeneralProcurementDto, ArchiveGeneralProcurementDto } from "./general-procurement.dto";

@Injectable()
export class GeneralProcurementService {
  constructor(private readonly prisma: PrismaService, private readonly visibility: ProjectVisibilityService,
    private readonly numbering: BusinessNumberingService, private readonly audit: AuditService, private readonly auth: AuthService, private readonly files: FileService) {}

  async options(actorUserId: string) {
    const roles = await this.listRoles(actorUserId);
    const visible = await this.visibility.visibleProjectIds(actorUserId);
    const [projects, companies] = await Promise.all([
      this.prisma.project.findMany({ where: { id: { in: visible }, isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
      this.prisma.companyEntity.findMany({ where: { isActive: true, dataStatus: "complete" }, select: { id: true, name: true }, orderBy: { name: "asc" } })
    ]);
    return { entryDefinition: GENERAL_PROCUREMENT_ENTRY_DEFINITION, projects, companies, categories: GENERAL_PROCUREMENT_CATEGORIES,
      canCreate: roles.some((role) => role.key !== "super_admin") && projects.length > 0 && companies.length > 0 };
  }

  private async listRoles(actorUserId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: actorUserId }, select: { isActive: true } });
    if (!user?.isActive) throw new ForbiddenException("当前账号不存在或已停用");
    const [assignments, members] = await Promise.all([
      this.prisma.userPosition.findMany({ where: { userId: actorUserId }, select: { positionId: true, projectId: true } }),
      this.prisma.projectMember.findMany({ where: { userId: actorUserId }, select: { positionKey: true, projectId: true } })
    ]);
    const positions = await this.prisma.position.findMany({ where: { id: { in: assignments.map((item) => item.positionId) } }, select: { id: true, key: true } });
    return [...assignments.map((item) => ({ key: positions.find((position) => position.id === item.positionId)?.key ?? "", projectId: item.projectId })),
      ...members.map((item) => ({ key: item.positionKey, projectId: item.projectId }))];
  }

  async list(actorUserId: string) {
    const roles = await this.listRoles(actorUserId);
    const all = roles.some((role) => !role.projectId && ["chairman", "comprehensive_director"].includes(role.key));
    const financeGlobal = roles.some((role) => !role.projectId && ["finance_director", "finance_staff"].includes(role.key));
    const managedProjects = roles.filter((role) => role.key === "project_manager" && role.projectId).map((role) => role.projectId!);
    const financeProjects = roles.filter((role) => ["finance_director", "finance_staff"].includes(role.key) && role.projectId).map((role) => role.projectId!);
    const where: Prisma.GeneralProcurementWhereInput = all ? {} : { OR: [
      { applicantUserId: actorUserId }, { projectId: { in: managedProjects } },
      { status: "archived", ...(financeGlobal ? {} : { projectId: { in: financeProjects } }) }
    ] };
    const rows = await this.prisma.generalProcurement.findMany({ where, orderBy: { updatedAt: "desc" }, take: 200 });
    const projects = await this.prisma.project.findMany({ where: { id: { in: rows.map((row) => row.projectId) } }, select: { id: true, name: true } });
    return { items: rows.map((row) => ({ id: row.id, code: row.code, projectName: projects.find((item) => item.id === row.projectId)?.name ?? "所属项目",
      applicantName: row.applicantNameSnapshot, categoryLabel: GENERAL_PROCUREMENT_CATEGORIES.find((item) => item.key === row.category)?.label ?? "其他物资或服务",
      reason: row.reason, requestedAmountCents: row.requestedAmountCents.toString(), status: row.status, statusLabel: GENERAL_PROCUREMENT_STATUS_LABELS[row.status], updatedAt: row.updatedAt })),
      total: await this.prisma.generalProcurement.count({ where }) };
  }

  async create(actorUserId: string, input: CreateGeneralProcurementDto) {
    const amount = parseMoneyCentsInput(input.requestedAmountCents, "申请金额格式不正确");
    if (amount <= 0n) throw new BadRequestException("申请金额必须大于零");
    const fingerprint = createHash("sha256").update(JSON.stringify([input.projectId, input.companyEntityId, input.category, input.reason.trim(), amount.toString()])).digest("hex");
    return this.prisma.$transaction(async (tx) => {
      await lockMasterDataRow(tx, "Project", input.projectId);
      await lockMasterDataRow(tx, "CompanyEntity", input.companyEntityId);
      const actor = await generalProcurementActor(tx, this.visibility, actorUserId, input.projectId);
      const visible = await this.visibility.visibleRequestedProjectIdsInTransaction(tx, actorUserId, [input.projectId]);
      if (!visible.includes(input.projectId)) throw new ForbiddenException("当前账号无权为该项目申请采购");
      const company = await tx.companyEntity.findFirst({ where: { id: input.companyEntityId, isActive: true, dataStatus: "complete" } });
      if (!company) throw new BadRequestException("费用承担公司不存在、已停用或资料未补齐");
      const existing = await tx.generalProcurement.findUnique({ where: { requestKey: input.requestKey } });
      if (existing) {
        if (existing.applicantUserId !== actorUserId || existing.creationFingerprint !== fingerprint) throw new ConflictException("重复提交内容不一致，请刷新后核对");
        return { id: existing.id, code: existing.code, revision: existing.revision };
      }
      const row = await tx.generalProcurement.create({ data: {
        requestKey: input.requestKey, creationFingerprint: fingerprint, code: await this.numbering.allocateDaily(tx, "ZHCG"),
        projectId: input.projectId, companyEntityId: company.id, companyNameSnapshot: company.name,
        applicantUserId: actor.id, applicantNameSnapshot: actor.name, category: input.category, reason: input.reason.trim(), requestedAmountCents: amount
      } });
      await this.audit.record(tx, { actorUserId, action: "general_procurement.create", businessType: "general_procurement", businessId: row.id, metadata: { code: row.code } });
      return { id: row.id, code: row.code, revision: row.revision };
    });
  }

  async submit(id: string, actorUserId: string, revision: number) {
    return this.prisma.$transaction(async (tx) => {
      const row = await this.lock(tx, id, revision);
      await generalProcurementActor(tx, this.visibility, actorUserId, row.projectId);
      if (row.applicantUserId !== actorUserId) throw new ForbiddenException("只有申请人可以提交采购申请");
      if (!["draft", "returned"].includes(row.status)) throw new ConflictException("当前申请不能提交，请刷新页面");
      const visible = await this.visibility.visibleRequestedProjectIdsInTransaction(tx, actorUserId, [row.projectId]);
      if (!visible.includes(row.projectId)) throw new ForbiddenException("项目已停用或当前账号无权申请");
      const company = await tx.companyEntity.findFirst({ where: { id: row.companyEntityId, isActive: true, dataStatus: "complete" } });
      if (!company) throw new BadRequestException("费用承担公司已停用或资料未补齐");
      const nodes = await this.freezeNodes(tx, row.projectId);
      const instance = await tx.approvalInstance.create({ data: { flowType: "general_procurement.approve", businessType: "general_procurement", businessId: row.id,
        status: "in_progress", currentNodeIndex: 0, applicantUserId: actorUserId, frozenNodes: nodes as unknown as Prisma.InputJsonValue } });
      const snapshots = Array.isArray(row.submissions) ? row.submissions : [];
      const submittedAt = new Date().toISOString();
      const updated = await tx.generalProcurement.update({ where: { id }, data: { status: "approval_pending", revision: { increment: 1 }, approvalInstanceId: instance.id,
        companyNameSnapshot: company.name, submissions: [...snapshots, { approvalInstanceId: instance.id, submittedAt, definitionSnapshot: GENERAL_PROCUREMENT_ENTRY_DEFINITION as unknown as Prisma.InputJsonValue, category: row.category, reason: row.reason,
          requestedAmountCents: row.requestedAmountCents.toString(), projectId: row.projectId, companyEntityId: row.companyEntityId, companyName: company.name }] as Prisma.InputJsonValue } });
      await this.audit.record(tx, { actorUserId, action: "general_procurement.submit", businessType: "general_procurement", businessId: id, metadata: { approvalInstanceId: instance.id, revision: updated.revision } });
      return { id, status: updated.status, revision: updated.revision };
    });
  }

  async review(id: string, actorUserId: string, input: ReviewGeneralProcurementDto) {
    return this.prisma.$transaction(async (tx) => {
      const row = await this.lock(tx, id, input.revision);
      const actor = await generalProcurementActor(tx, this.visibility, actorUserId, row.projectId);
      if (row.status !== "approval_pending" || !row.approvalInstanceId) throw new ConflictException("当前申请不在审批中，请刷新页面");
      const instance = await tx.approvalInstance.findUnique({ where: { id: row.approvalInstanceId } });
      if (!instance || instance.status !== "in_progress" || !Array.isArray(instance.frozenNodes)) throw new ConflictException("审批状态已变化，请刷新页面");
      const nodes = instance.frozenNodes as unknown as ProcurementNode[];
      const node = nodes[instance.currentNodeIndex];
      const identity = node && resolveApprovalReviewIdentity({ node, actorUserId, actorRoleKeys: [...actor.globalRoleKeys, ...actor.projectRoleKeys], actorRoleScopes: actor });
      if (!identity || identity.viaAssignment) throw new ForbiddenException("尚未轮到你审批，或当前岗位不符合要求");
      const selfReview = row.applicantUserId === actorUserId;
      if (selfReview) {
        if (!input.selfReviewReason?.trim() || !input.confirmationPassword) throw new BadRequestException("审批自己的申请时，请填写自审原因并输入当前密码");
        await this.auth.confirmPassword(actorUserId, input.confirmationPassword);
      }
      if (input.decision === "return") {
        const reason = input.comment?.trim();
        if (!reason) throw new BadRequestException("退回时请写明需要补充或修改的内容");
        await tx.approvalInstance.update({ where: { id: instance.id }, data: { status: "returned" } });
        await tx.approvalActionLog.create({ data: { approvalInstanceId: instance.id, action: "return_to_applicant", actorUserId, approvedRoleKey: identity.approvedRoleKey,
          representedUserId: actorUserId, comment: reason, metadata: { nodeName: node.name, selfReview, ...(selfReview ? { selfReviewReason: input.selfReviewReason!.trim() } : {}) } } });
        const updated = await tx.generalProcurement.update({ where: { id }, data: { status: "returned", revision: { increment: 1 } } });
        await this.audit.record(tx, { actorUserId, action: "general_procurement.return", businessType: "general_procurement", businessId: id, metadata: { reason, revision: updated.revision } });
        return { id, status: updated.status, revision: updated.revision };
      }
      const signature = await snapshotApprovalSignature(tx, actorUserId, { required: true });
      const index = instance.currentNodeIndex + 1;
      const completed = index === nodes.length;
      nodes[instance.currentNodeIndex] = { ...node, approvedRoleKeys: [identity.approvedRoleKey] };
      await tx.approvalInstance.update({ where: { id: instance.id }, data: { currentNodeIndex: index, status: completed ? "approved" : "in_progress", frozenNodes: nodes as unknown as Prisma.InputJsonValue } });
      await tx.approvalActionLog.create({ data: { approvalInstanceId: instance.id, action: "approve", actorUserId, approvedRoleKey: identity.approvedRoleKey,
        representedUserId: actorUserId, comment: input.comment?.trim() || null,
        signatureFileIdSnapshot: signature.fileId, signatureSha256Snapshot: signature.sha256, signatureVersionIdSnapshot: signature.versionId,
        metadata: { nodeName: node.name, selfReview, ...(selfReview ? { selfReviewReason: input.selfReviewReason!.trim() } : {}) } } });
      const updated = await tx.generalProcurement.update({ where: { id }, data: { status: completed ? "approved_pending_archive" : "approval_pending", revision: { increment: 1 } } });
      await this.audit.record(tx, { actorUserId, action: "general_procurement.approve", businessType: "general_procurement", businessId: id, metadata: { nodeName: node.name, completed, revision: updated.revision } });
      return { id, status: updated.status, revision: updated.revision };
    });
  }

  async updateDraft(id: string, actorUserId: string, input: UpdateGeneralProcurementDto) {
    const amount = parseMoneyCentsInput(input.requestedAmountCents, "申请金额格式不正确");
    if (amount <= 0n) throw new BadRequestException("申请金额必须大于零");
    return this.prisma.$transaction(async (tx) => {
      await lockMasterDataRow(tx, "Project", input.projectId);
      await lockMasterDataRow(tx, "CompanyEntity", input.companyEntityId);
      const row = await this.lock(tx, id, input.revision);
      await generalProcurementActor(tx, this.visibility, actorUserId, input.projectId);
      if (row.applicantUserId !== actorUserId) throw new ForbiddenException("只有申请人可以修改采购申请");
      if (!["draft", "returned"].includes(row.status)) throw new ConflictException("申请已提交，不可修改");
      const visible = await this.visibility.visibleRequestedProjectIdsInTransaction(tx, actorUserId, [input.projectId]);
      if (!visible.includes(input.projectId)) throw new ForbiddenException("当前账号无权为该项目申请采购");
      const company = await tx.companyEntity.findFirst({ where: { id: input.companyEntityId, isActive: true, dataStatus: "complete" } });
      if (!company) throw new BadRequestException("费用承担公司不存在、已停用或资料未补齐");
      const updated = await tx.generalProcurement.update({ where: { id }, data: { projectId: input.projectId, companyEntityId: company.id,
        companyNameSnapshot: company.name, category: input.category, reason: input.reason.trim(), requestedAmountCents: amount, revision: { increment: 1 } } });
      await this.audit.record(tx, { actorUserId, action: "general_procurement.update", businessType: "general_procurement", businessId: id, metadata: { revision: updated.revision } });
      return { id, status: updated.status, revision: updated.revision };
    });
  }

  async withdraw(id: string, actorUserId: string, input: WithdrawGeneralProcurementDto) {
    return this.prisma.$transaction(async (tx) => {
      const row = await this.lock(tx, id, input.revision);
      await generalProcurementActor(tx, this.visibility, actorUserId, row.projectId);
      if (row.applicantUserId !== actorUserId) throw new ForbiddenException("只有申请人可以撤回采购申请");
      if (row.status !== "approval_pending" || !row.approvalInstanceId) throw new ConflictException("当前申请不可撤回");
      await tx.approvalInstance.update({ where: { id: row.approvalInstanceId }, data: { status: "withdrawn" } });
      await tx.approvalActionLog.create({ data: { approvalInstanceId: row.approvalInstanceId, action: "withdraw", actorUserId, comment: input.reason.trim() } });
      const updated = await tx.generalProcurement.update({ where: { id }, data: { status: "returned", revision: { increment: 1 } } });
      await this.audit.record(tx, { actorUserId, action: "general_procurement.withdraw", businessType: "general_procurement", businessId: id, metadata: { reason: input.reason.trim(), revision: updated.revision } });
      return { id, status: updated.status, revision: updated.revision };
    });
  }

  async archive(id: string, actorUserId: string, input: ArchiveGeneralProcurementDto) {
    return this.prisma.$transaction(async (tx) => {
      const row = await this.lock(tx, id, input.revision);
      const actor = await generalProcurementActor(tx, this.visibility, actorUserId, row.projectId);
      if (!actor.globalRoleKeys.includes("comprehensive_director")) throw new ForbiddenException("只有综合部主管可以归档采购申请");
      if (row.status !== "approved_pending_archive") throw new ConflictException("请先完成综合部、项目经理和董事长审批");
      const file = await this.files.assertFileHasNoBusinessBinding(tx, input.fileId);
      if (file.uploadedByUserId !== actorUserId) throw new ForbiddenException("请使用本人上传的归档依据");
      const updated = await tx.generalProcurement.update({ where: { id }, data: { status: "archived", archiveFileId: file.id, archivedAt: new Date(),
        archivedByUserId: actorUserId, archiveNote: input.note.trim(), revision: { increment: 1 } } });
      await this.audit.record(tx, { actorUserId, action: "general_procurement.archive", businessType: "general_procurement", businessId: id, metadata: { fileId: file.id, note: input.note.trim(), revision: updated.revision } });
      return { id, status: updated.status, revision: updated.revision };
    });
  }

  async cancelPayment(id: string, claimId: string, actorUserId: string, reason: string) {
    return this.prisma.$transaction(async (tx) => {
      const source = await tx.generalProcurement.findUnique({ where: { id } });
      if (!source) throw new NotFoundException("采购申请不存在");
      const actor = await generalProcurementActor(tx, this.visibility, actorUserId, source.projectId);
      if (!actor.globalRoleKeys.includes("comprehensive_director")) throw new ForbiddenException("只有综合部主管可以撤销付款草稿");
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "ExpenseClaim" WHERE "id" = ${claimId} FOR UPDATE`);
      const claim = await tx.expenseClaim.findUnique({ where: { id: claimId } });
      if (!claim || claim.generalProcurementId !== id) throw new NotFoundException("此付款申请不属于当前采购申请");
      if (claim.status !== "draft") throw new ConflictException("付款已提交或已撤销，不能撤销草稿");
      await tx.expenseClaim.update({ where: { id: claimId }, data: { status: "rejected" } });
      await this.audit.record(tx, { actorUserId, action: "general_procurement.payment_draft.cancel", businessType: "expense_claim", businessId: claimId, metadata: { generalProcurementId: id, reason: reason.trim() } });
      return { id: claimId, status: "rejected" };
    });
  }

  private async lock(tx: Prisma.TransactionClient, id: string, revision: number): Promise<GeneralProcurement> {
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "GeneralProcurement" WHERE "id" = ${id} FOR UPDATE`);
    const row = await tx.generalProcurement.findUnique({ where: { id } });
    if (!row) throw new NotFoundException("采购申请不存在或当前账号无权查看");
    if (row.revision !== revision) throw new ConflictException("申请已被更新，请刷新页面后重试");
    return row;
  }

  private async freezeNodes(tx: Prisma.TransactionClient, projectId: string): Promise<ProcurementNode[]> {
    const definitions: Array<{ name: string; role: RoleKey; scope: "global" | "project" }> = [
      { name: "综合部主管", role: "comprehensive_director", scope: "global" },
      { name: "项目经理", role: "project_manager", scope: "project" },
      { name: "董事长", role: "chairman", scope: "global" }
    ];
    const nodes: ProcurementNode[] = [];
    for (const definition of definitions) {
      const position = await tx.position.findUnique({ where: { key: definition.role }, select: { id: true } });
      const assignments = position ? await tx.userPosition.findMany({ where: { positionId: position.id, projectId: definition.scope === "global" ? null : projectId }, select: { userId: true } }) : [];
      const members = definition.scope === "project" ? await tx.projectMember.findMany({ where: { projectId, positionKey: definition.role }, select: { userId: true } }) : [];
      const users = await tx.user.findMany({ where: { id: { in: [...assignments, ...members].map((item) => item.userId) }, isActive: true }, select: { id: true } });
      const ids = users.map((user) => user.id).sort();
      if (!ids.length) throw new BadRequestException(`尚未配置有效${definition.name}，请先在组织管理中设置岗位`);
      nodes.push({ name: definition.name, mode: "any", roleKeys: [definition.role], candidateUserIds: ids,
        candidateUserIdsByRole: { [definition.role]: ids }, roleScopesByRole: { [definition.role]: definition.scope } });
    }
    return nodes;
  }

  async detail(id: string, actorUserId: string) {
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.generalProcurement.findUnique({ where: { id } });
      if (!row) throw new NotFoundException("采购申请不存在或当前账号无权查看");
      const actor = await generalProcurementActor(tx, this.visibility, actorUserId, row.projectId);
      if (!canReadGeneralProcurement(row, actor)) throw new ForbiddenException("当前账号无权查看该采购申请");
      const project = await tx.project.findUnique({ where: { id: row.projectId }, select: { name: true } });
      const instances = await tx.approvalInstance.findMany({ where: { businessType: "general_procurement", businessId: id }, orderBy: { createdAt: "asc" } });
      const actions = await tx.approvalActionLog.findMany({ where: { approvalInstanceId: { in: instances.map((item) => item.id) } }, orderBy: { createdAt: "asc" } });
      const users = await tx.user.findMany({ where: { id: { in: actions.map((item) => item.actorUserId) } }, select: { id: true, name: true } });
      const names = new Map(users.map((item) => [item.id, item.name]));
      const current = instances.find((item) => item.id === row.approvalInstanceId && item.status === "in_progress");
      const nodes = current?.frozenNodes as unknown as ProcurementNode[] | undefined;
      const node = nodes?.[current!.currentNodeIndex];
      const identity = node && resolveApprovalReviewIdentity({ node, actorUserId, actorRoleKeys: [...actor.globalRoleKeys, ...actor.projectRoleKeys], actorRoleScopes: actor });
      const archiveFile = row.archiveFileId ? await tx.fileObject.findUnique({ where: { id: row.archiveFileId }, select: { id: true, originalName: true } }) : null;
      const payments = await tx.expenseClaim.findMany({ where: { generalProcurementId: id }, orderBy: { createdAt: "asc" }, select: { id: true, code: true, status: true, requestedAmountCents: true, fundedAmountCents: true } });
      const reserved = payments.filter((payment) => payment.status !== "rejected").reduce((sum, payment) => sum + payment.requestedAmountCents, 0n);
      const canEdit = row.applicantUserId === actorUserId && ["draft", "returned"].includes(row.status);
      return { id: row.id, code: row.code, projectId: row.projectId, projectName: project?.name ?? "所属项目",
        companyEntityId: row.companyEntityId, companyName: row.companyNameSnapshot, applicantName: row.applicantNameSnapshot,
        category: row.category, categoryLabel: GENERAL_PROCUREMENT_CATEGORIES.find((item) => item.key === row.category)?.label ?? "其他物资或服务",
        reason: row.reason, requestedAmountCents: row.requestedAmountCents.toString(), status: row.status,
        statusLabel: GENERAL_PROCUREMENT_STATUS_LABELS[row.status], revision: row.revision,
        archive: archiveFile ? { fileId: archiveFile.id, fileName: archiveFile.originalName, note: row.archiveNote, archivedAt: row.archivedAt } : null,
        canCancelPayment: actor.globalRoleKeys.includes("comprehensive_director") && payments.some((payment) => payment.status === "draft"), canEdit, canSubmit: canEdit, canReview: Boolean(identity && !identity.viaAssignment), canWithdraw: row.applicantUserId === actorUserId && row.status === "approval_pending",
        canArchive: row.status === "approved_pending_archive" && actor.globalRoleKeys.includes("comprehensive_director"),
        payments: payments.map((payment) => ({ ...payment,
          canOpen: actor.globalRoleKeys.some((role) => ["chairman", "comprehensive_director", "finance_staff", "finance_director"].includes(role)) || actor.projectRoleKeys.some((role) => ["project_manager", "finance_staff", "finance_director"].includes(role)),
          canCancel: payment.status === "draft" && actor.globalRoleKeys.includes("comprehensive_director"), requestedAmountCents: payment.requestedAmountCents.toString(), fundedAmountCents: payment.fundedAmountCents.toString() })),
        paymentSummary: { reservedAmountCents: reserved.toString(), availableAmountCents: (row.requestedAmountCents - reserved).toString() },
        canRequestPayment: row.status === "archived" && actor.globalRoleKeys.includes("comprehensive_director") && reserved < row.requestedAmountCents,
        currentNodeName: node?.name ?? null, requiresSelfReviewConfirmation: Boolean(identity && row.applicantUserId === actorUserId), submissions: row.submissions,
        approvals: instances.map((item) => ({ id: item.id, status: item.status, nodes: (item.frozenNodes as unknown as ProcurementNode[]).map((entry) => ({ name: entry.name, approved: Boolean(entry.approvedRoleKeys?.length) })),
          actions: actions.filter((action) => action.approvalInstanceId === item.id).map((action) => ({ action: action.action, actorName: names.get(action.actorUserId) ?? "原审批人", comment: action.comment, createdAt: action.createdAt })) })),
        createdAt: row.createdAt, updatedAt: row.updatedAt };
    });
  }
}

interface ProcurementNode extends FrozenApprovalNode {
  name: string;
  mode: "any";
  roleKeys: RoleKey[];
  candidateUserIds: string[];
  candidateUserIdsByRole: Partial<Record<RoleKey, string[]>>;
  roleScopesByRole: Partial<Record<RoleKey, "global" | "project">>;
  approvedRoleKeys?: RoleKey[];
}
