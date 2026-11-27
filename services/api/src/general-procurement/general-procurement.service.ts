import { generalRequestEstimateText } from "./general-procurement-request-facts";
import { GeneralProcurementRequestService } from "./general-procurement-request.service";
import { GENERAL_PROCUREMENT_ENTRY_DEFINITION, GENERAL_PROCUREMENT_REQUEST_ENTRY_DEFINITION } from "./general-procurement-entry.definition";
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, type GeneralProcurement } from "@prisma/client";
import type { RoleKey } from "@jiangkong/shared-domain";
import { AuthService } from "../auth/auth.service";
import { resolveApprovalReviewIdentity, type FrozenApprovalNode } from "../approval/approval-review-identity";
import { snapshotApprovalSignature , withApprovalIdentity } from "../approval/approval-signature-snapshot";
import { FileService } from "../file/file.service";
import { GENERAL_PROCUREMENT_CATEGORIES, GENERAL_PROCUREMENT_STATUS_LABELS, LEGACY_GENERAL_PROCUREMENT_CATEGORIES } from "@jiangkong/shared-domain";
import { AuditService } from "../audit/audit.service";
import { exportBusinessLedger } from "../core-flow/business-ledger-export";
import {
  LEDGER_DATE_FORMAT,
  LEDGER_MONEY_FORMAT,
  type LedgerExcelColumn
} from "../core-flow/ledger-excel";
import {
  normalizeLedgerExportQuery,
  type NormalizedLedgerExportQuery
} from "../core-flow/ledger-export-query";
import { ProjectVisibilityService } from "../auth/project-visibility.service";
import { BusinessNumberingService } from "../business-number/business-numbering.service";
import { PrismaService } from "../database/prisma.service";
import { lockMasterDataRow } from "../master-data/master-data-lifecycle";
import { formatMoneyCentsAsPlainYuan, parseMoneyCentsInput } from "../money/decimal-money";
import { canReadGeneralProcurement, generalProcurementActor } from "./general-procurement-access";
import type { ListGeneralProcurementDto, CreateGeneralProcurementDto, ReviewGeneralProcurementDto, UpdateGeneralProcurementDto, WithdrawGeneralProcurementDto, ArchiveGeneralProcurementDto } from "./general-procurement.dto";

@Injectable()
export class GeneralProcurementService {
  constructor(private readonly prisma: PrismaService, private readonly visibility: ProjectVisibilityService,
    _numbering: BusinessNumberingService, private readonly audit: AuditService, private readonly auth: AuthService, private readonly files: FileService, private readonly requests: GeneralProcurementRequestService) {}

  async options(actorUserId: string) {
    await this.listRoles(actorUserId);
    const visible = await this.visibility.visibleProjectIds(actorUserId);
    const [projects, companies] = await Promise.all([
      this.prisma.project.findMany({ where: { id: { in: visible }, isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
      this.prisma.companyEntity.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } })
    ]);
    return { entryDefinition: GENERAL_PROCUREMENT_ENTRY_DEFINITION, requestEntryDefinition: GENERAL_PROCUREMENT_REQUEST_ENTRY_DEFINITION, projects, companies, categories: GENERAL_PROCUREMENT_CATEGORIES,
      canCreate: true, canCreateCompanyDaily: true };
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

  async list(actorUserId: string, query: ListGeneralProcurementDto) {
    const normalized = normalizeLedgerExportQuery(query as unknown as Record<string, unknown>);
    const where = await this.ledgerWhere(actorUserId, query, normalized);
    const orderBy = this.ledgerOrderBy(normalized);
    const rows = await this.prisma.generalProcurement.findMany({
      where,
      orderBy,
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize
    });
    const items = await this.toLedgerItems(rows);
    return {
      items,
      total: await this.prisma.generalProcurement.count({ where }),
      page: query.page,
      pageSize: query.pageSize,
      filters: {
        projectId: normalized.projectId ?? null,
        dateFrom: normalized.dateFrom ?? null,
        dateTo: normalized.dateTo ?? null,
        status: normalized.status ?? null,
        keyword: normalized.keyword ?? null,
        sort: normalized.sortField
          ? `${normalized.sortField}:${normalized.sortDirection}`
          : null
      },
      columns: GENERAL_PROCUREMENT_LEDGER_COLUMNS.map((column) => ({
        key: String(column.key),
        header: column.header,
        required: Boolean(column.required)
      }))
    };
  }

  /**
   * 综合采购台账导出：与列表共用 `ledgerWhere`（同一访问范围）与
   * `toLedgerItems`，导出全部筛选后的可见记录；不是当前页。
   */
  async exportLedger(
    actorUserId: string,
    rawQuery?: Record<string, unknown>
  ): Promise<{ buffer: Buffer; fileName: string }> {
    const normalized = normalizeLedgerExportQuery(rawQuery);
    const query = {
      page: 1,
      pageSize: 1,
      search: normalized.keyword,
      status: normalized.status ?? "all"
    } as ListGeneralProcurementDto;
    const where = await this.ledgerWhere(actorUserId, query, normalized);
    const rows = await this.prisma.generalProcurement.findMany({
      where,
      orderBy: this.ledgerOrderBy(normalized)
    });
    const items = await this.toLedgerItems(rows);
    return exportBusinessLedger({
      prisma: this.prisma,
      audit: this.audit,
      actorUserId,
      action: "general_procurement.ledger.export",
      businessType: "general_procurement_ledger",
      scope: "all_filtered_visible_general_procurements",
      sheetName: "综合采购台账",
      fileNamePrefix: "综合采购台账",
      columns: GENERAL_PROCUREMENT_LEDGER_COLUMNS,
      rows: items.map((item) => ({
        ...item,
        projectName: item.projectName,
        estimatedAmountYuan: generalLedgerAmountYuan(item),
        actualAmountYuan: item.actualAmountCents === null
          ? null
          : formatMoneyCentsAsPlainYuan(BigInt(item.actualAmountCents)),
        updatedAtIso: item.updatedAt,
        createdAtIso: item.createdAt
      })),
      columnKeys: normalized.columnKeys,
      filters: normalized,
      visibleProjectCount: 0
    });
  }

  private async ledgerWhere(
    actorUserId: string,
    query: ListGeneralProcurementDto,
    normalized: NormalizedLedgerExportQuery
  ): Promise<Prisma.GeneralProcurementWhereInput> {
    const roles = await this.listRoles(actorUserId);
    const all = roles.some((role) => !role.projectId && ["chairman", "general_manager", "comprehensive_director"].includes(role.key));
    const financeGlobal = roles.some((role) => !role.projectId && ["general_manager", "finance_director", "finance_staff"].includes(role.key));
    const managedProjects = roles.filter((role) => role.key === "project_manager" && role.projectId).map((role) => role.projectId!);
    const comprehensiveProjects = roles.filter(role => role.key === "comprehensive_director" && role.projectId).map(role => role.projectId!);
    const financeProjects = roles.filter((role) => ["finance_director", "finance_staff"].includes(role.key) && role.projectId).map((role) => role.projectId!);
    const access: Prisma.GeneralProcurementWhereInput = all ? {} : { OR: [
      { applicantUserId: actorUserId }, { projectId: { in: managedProjects } }, { requestProtocolVersion: 2, projectId: { in: comprehensiveProjects } },
      { status: "archived", ...(financeGlobal ? {} : { projectId: { in: financeProjects } }) }
    ] };
    const search = normalized.keyword?.trim() ?? query.search?.trim();
    const matchedProjects = search ? await this.prisma.project.findMany({ where: { name: { contains: search, mode: "insensitive" } }, select: { id: true } }) : [];
    const status = query.status && query.status !== "all" ? query.status : undefined;
    return {
      AND: [
        access,
        ...(normalized.projectId ? [{ projectId: normalized.projectId }] : []),
        ...(status ? [{ status: status === "drafts" ? { in: ["draft", "returned"] } : status }] : []),
        ...(normalized.dateFrom || normalized.dateTo
          ? [{
              updatedAt: {
                ...(normalized.dateFrom
                  ? { gte: new Date(`${normalized.dateFrom}T00:00:00+08:00`) }
                  : {}),
                ...(normalized.dateTo
                  ? { lte: new Date(`${normalized.dateTo}T23:59:59.999+08:00`) }
                  : {})
              }
            }]
          : []),
        ...(search
          ? [{
              OR: [
                { code: { contains: search, mode: "insensitive" as const } },
                { reason: { contains: search, mode: "insensitive" as const } },
                { applicantNameSnapshot: { contains: search, mode: "insensitive" as const } },
                { companyNameSnapshot: { contains: search, mode: "insensitive" as const } },
                { projectId: { in: matchedProjects.map((project) => project.id) } }
              ]
            }]
          : [])
      ]
    };
  }

  private ledgerOrderBy(
    normalized: NormalizedLedgerExportQuery
  ): Prisma.GeneralProcurementOrderByWithRelationInput[] {
    const direction = normalized.sortDirection;
    switch (normalized.sortField) {
      case "createdAt":
        return [{ createdAt: direction }, { id: "desc" }];
      case "estimatedAmount":
        return [{ estimatedAmount: direction }, { id: "desc" }];
      case "code":
        return [{ code: direction }, { id: "desc" }];
      default:
        return [{ updatedAt: "desc" }, { id: "desc" }];
    }
  }

  private async toLedgerItems(rows: GeneralProcurement[]) {
    if (!rows.length) return [];
    const projectIds = rows.flatMap((row) => row.projectId ? [row.projectId] : []);
    const [projects, batches] = await Promise.all([
      this.prisma.project.findMany({
        where: { id: { in: projectIds } },
        select: { id: true, name: true }
      }),
      this.prisma.actualPurchaseBatch.findMany({
        where: { procurementId: { in: rows.map((row) => row.id) } },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: {
          procurementId: true,
          supplierName: true,
          effectiveTotalAmountCents: true
        }
      })
    ]);
    const projectNameById = new Map(projects.map((project) => [project.id, project.name]));
    const batchByProcurementId = new Map<string, (typeof batches)[number]>();
    for (const batch of batches) {
      if (!batchByProcurementId.has(batch.procurementId)) {
        batchByProcurementId.set(batch.procurementId, batch);
      }
    }
    return rows.map((row) => {
      const batch = batchByProcurementId.get(row.id);
      return {
        id: row.id,
        code: row.code,
        projectId: row.projectId,
        projectName: row.projectId
          ? projectNameById.get(row.projectId) ?? "待确定"
          : "公司日常",
        companyName: row.companyNameSnapshot ?? "待确定",
        applicantName: row.applicantNameSnapshot,
        categoryLabel:
          GENERAL_PROCUREMENT_CATEGORIES.find((item) => item.key === row.category)?.label ??
          "其他物资或服务",
        reason: row.reason,
        requestProtocolVersion: row.requestProtocolVersion,
        estimatedAmount: generalRequestEstimateText(row.estimatedAmount),
        requestedAmountCents: row.requestedAmountCents?.toString() ?? null,
        supplierName: batch?.supplierName ?? "待确定",
        actualAmountCents: batch ? batch.effectiveTotalAmountCents.toString() : null,
        status: row.status,
        statusLabel: GENERAL_PROCUREMENT_STATUS_LABELS[row.status],
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString()
      };
    });
  }

  async create(actorUserId: string, input: CreateGeneralProcurementDto) {
    return this.requests.create(actorUserId, input);
  }

  async deleteUnsubmittedDraft(id: string, actorUserId: string, revision: number) {
    const current = await this.prisma.generalProcurement.findUnique({ where: { id } });
    if (current?.requestProtocolVersion === 2) return this.requests.deleteUnsubmittedDraft(id, actorUserId, revision);
    return this.prisma.$transaction(async (tx) => {
      // Same parent lock order as creation: an old create retry cannot resurrect deletion.
      const source = await tx.generalProcurement.findUnique({ where: { id }, select: { projectId: true, companyEntityId: true } });
      if (!source) throw new NotFoundException("采购草稿不存在或已删除");
      if (source.projectId) await lockMasterDataRow(tx, "Project", source.projectId);
      if (source.companyEntityId) await lockMasterDataRow(tx, "CompanyEntity", source.companyEntityId);
      const row = await this.lock(tx, id, revision);
      await generalProcurementActor(tx, this.visibility, actorUserId, row.projectId);
      if (row.applicantUserId !== actorUserId) throw new ForbiddenException("只有申请人可以删除采购草稿");
      const [result] = await tx.$queryRaw<Array<{ deleted: boolean }>>(Prisma.sql`
        SELECT public.jg_delete_unsubmitted_general_procurement(${id}, ${actorUserId}, ${revision}::integer) AS deleted
      `);
      if (!result?.deleted) throw new ConflictException("只能删除从未提交审批的采购草稿，请刷新后核对状态");
      return { id, deleted: true };
    });
  }

  async submit(id: string, actorUserId: string, revision: number) {
    const source = await this.prisma.generalProcurement.findUnique({ where: { id } });
    if (source?.requestProtocolVersion === 2) return this.requests.submit(id, actorUserId, revision);
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
          requestedAmountCents: row.requestedAmountCents?.toString() ?? null, projectId: row.projectId, companyEntityId: row.companyEntityId, companyName: company.name }] as Prisma.InputJsonValue } });
      await this.audit.record(tx, { actorUserId, action: "general_procurement.submit", businessType: "general_procurement", businessId: id, metadata: { approvalInstanceId: instance.id, revision: updated.revision } });
      return { id, status: updated.status, revision: updated.revision };
    });
  }

  async review(id: string, actorUserId: string, input: ReviewGeneralProcurementDto) {
    const source = await this.prisma.generalProcurement.findUnique({ where: { id } });
    if (source?.requestProtocolVersion === 2) return this.requests.review(id, actorUserId, input);
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
      await tx.approvalActionLog.create({ data: await withApprovalIdentity(tx, { approvalInstanceId: instance.id, action: "approve", actorUserId, approvedRoleKey: identity.approvedRoleKey,
        representedUserId: actorUserId, comment: input.comment?.trim() || null,
        signatureFileIdSnapshot: signature.fileId, signatureSha256Snapshot: signature.sha256, signatureVersionIdSnapshot: signature.versionId,
        metadata: { nodeName: node.name, selfReview, ...(selfReview ? { selfReviewReason: input.selfReviewReason!.trim() } : {}) } }, signature) });
      const updated = await tx.generalProcurement.update({ where: { id }, data: { status: completed ? "approved_pending_archive" : "approval_pending", revision: { increment: 1 } } });
      await this.audit.record(tx, { actorUserId, action: "general_procurement.approve", businessType: "general_procurement", businessId: id, metadata: { nodeName: node.name, completed, revision: updated.revision } });
      return { id, status: updated.status, revision: updated.revision };
    });
  }

  async updateDraft(id: string, actorUserId: string, input: UpdateGeneralProcurementDto) {
    const source = await this.prisma.generalProcurement.findUnique({ where: { id } });
    if (source?.requestProtocolVersion === 2) return this.requests.updateDraft(id, actorUserId, input);
    assertLegacyDraft(input);
    if (!LEGACY_GENERAL_PROCUREMENT_CATEGORIES.some(item => item.key === input.category)) throw new BadRequestException("此历史申请请沿用原费用类别");
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
    const source = await this.prisma.generalProcurement.findUnique({ where: { id } });
    if (source?.requestProtocolVersion === 2) return this.requests.withdraw(id, actorUserId, input);
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
      if (row.status !== "approved_pending_archive") throw new ConflictException("请先完成综合部主管、项目经理、董事长/总经理或签审批");
      const file = await this.files.assertFileHasNoBusinessBinding(tx, input.fileId, undefined, {
        procurementId: row.id, projectId: row.projectId, actorUserId, revision: row.revision
      });
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
      assertLegacyProcurement(source);
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

  private async lock(tx: Prisma.TransactionClient, id: string, revision: number): Promise<LegacyProcurement> {
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "GeneralProcurement" WHERE "id" = ${id} FOR UPDATE`);
    const row = await tx.generalProcurement.findUnique({ where: { id } });
    if (!row) throw new NotFoundException("采购申请不存在或当前账号无权查看");
    if (row.revision !== revision) throw new ConflictException("申请已被更新，请刷新页面后重试");
    assertLegacyProcurement(row);
    return row;
  }

  private async freezeNodes(tx: Prisma.TransactionClient, projectId: string): Promise<ProcurementNode[]> {
    const definitions: Array<{ name: string; roles: RoleKey[]; scope: "global" | "project" }> = [
      { name: "综合部主管", roles: ["comprehensive_director"], scope: "global" },
      { name: "项目经理", roles: ["project_manager"], scope: "project" },
      { name: "董事长/总经理", roles: ["chairman", "general_manager"], scope: "global" }
    ];
    const nodes: ProcurementNode[] = [];
    for (const definition of definitions) {
      const candidateUserIdsByRole: Partial<Record<RoleKey, string[]>> = {};
      for (const role of definition.roles) {
        const position = await tx.position.findUnique({ where: { key: role }, select: { id: true } });
        const assignments = position ? await tx.userPosition.findMany({ where: { positionId: position.id, projectId: definition.scope === "global" ? null : projectId }, select: { userId: true } }) : [];
        const members = definition.scope === "project" ? await tx.projectMember.findMany({ where: { projectId, positionKey: role }, select: { userId: true } }) : [];
        const users = await tx.user.findMany({ where: { id: { in: [...assignments, ...members].map(item => item.userId) }, isActive: true }, select: { id: true } });
        candidateUserIdsByRole[role] = users.map(user => user.id).sort();
      }
      const ids = [...new Set(Object.values(candidateUserIdsByRole).flat())].sort();
      if (!ids.length) throw new BadRequestException(`尚未配置有效${definition.name}，请先在组织管理中设置岗位`);
      nodes.push({ name: definition.name, mode: "any", roleKeys: definition.roles, candidateUserIds: ids,
        candidateUserIdsByRole, roleScopesByRole: Object.fromEntries(definition.roles.map(role => [role, definition.scope])) });
    }
    return nodes;
  }

  async detail(id: string, actorUserId: string) {
    const current = await this.prisma.generalProcurement.findUnique({ where: { id } });
    if (current?.requestProtocolVersion === 2) return this.requests.detail(current, actorUserId);
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.generalProcurement.findUnique({ where: { id } });
      if (!row) throw new NotFoundException("采购申请不存在或当前账号无权查看");
      assertLegacyProcurement(row);
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
        reason: row.reason, requestedAmountCents: row.requestedAmountCents?.toString() ?? null, status: row.status,
        statusLabel: GENERAL_PROCUREMENT_STATUS_LABELS[row.status], revision: row.revision,
        archive: archiveFile ? { fileId: archiveFile.id, fileName: archiveFile.originalName, note: row.archiveNote, archivedAt: row.archivedAt } : null,
        canDeleteDraft: canEdit && row.status === "draft" && !row.approvalInstanceId && instances.length === 0 && Array.isArray(row.submissions) && row.submissions.length === 0,
        canCancelPayment: actor.globalRoleKeys.includes("comprehensive_director") && payments.some((payment) => payment.status === "draft"), canEdit, canSubmit: canEdit, canReview: Boolean(identity && !identity.viaAssignment), canWithdraw: row.applicantUserId === actorUserId && row.status === "approval_pending",
        canArchive: row.status === "approved_pending_archive" && actor.globalRoleKeys.includes("comprehensive_director"),
        payments: payments.map((payment) => ({ ...payment,
          canOpen: actor.globalRoleKeys.some((role) => ["chairman", "general_manager", "comprehensive_director", "finance_staff", "finance_director"].includes(role)) || actor.projectRoleKeys.some((role) => ["project_manager", "finance_staff", "finance_director"].includes(role)),
          canCancel: payment.status === "draft" && actor.globalRoleKeys.includes("comprehensive_director"), requestedAmountCents: payment.requestedAmountCents.toString(), fundedAmountCents: payment.fundedAmountCents.toString() })),
        paymentSummary: { reservedAmountCents: reserved.toString(), availableAmountCents: (row.requestedAmountCents - reserved).toString() },
        canRequestPayment: row.status === "archived" && actor.globalRoleKeys.includes("comprehensive_director"),
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

type LegacyProcurement = GeneralProcurement & { projectId: string; companyEntityId: string; companyNameSnapshot: string; requestedAmountCents: bigint };
function assertLegacyProcurement(row: GeneralProcurement): asserts row is LegacyProcurement {
  if (row.requestProtocolVersion !== 1 || row.projectId == null || row.companyEntityId == null || row.companyNameSnapshot == null || row.requestedAmountCents == null)
    throw new ConflictException("请从当前综合采购申请入口办理");
}

function assertLegacyDraft(input: UpdateGeneralProcurementDto): asserts input is UpdateGeneralProcurementDto & { projectId: string; companyEntityId: string; reason: string; requestedAmountCents: string } {
  if (!input.projectId || !input.companyEntityId || !input.reason?.trim() || input.requestedAmountCents == null) throw new BadRequestException("请填齐项目、费用承担公司、用途和申请金额");
}


const GENERAL_PROCUREMENT_LEDGER_COLUMNS: LedgerExcelColumn<Record<string, unknown>>[] = [
  { header: "采购编号", key: "code", width: 18, required: true },
  { header: "项目", key: "projectName", width: 24, required: true },
  { header: "采购单位", key: "companyName", width: 24, required: true },
  { header: "申请人", key: "applicantName", width: 14 },
  { header: "费用类别", key: "categoryLabel", width: 16 },
  { header: "采购内容与用途", key: "reason", width: 32 },
  { header: "供应商", key: "supplierName", width: 22 },
  {
    header: "预计金额（元）",
    key: "estimatedAmountYuan",
    width: 18,
    kind: "number",
    numFmt: LEDGER_MONEY_FORMAT,
    align: "right",
    total: "sum"
  },
  {
    header: "实际采购金额（元）",
    key: "actualAmountYuan",
    width: 18,
    kind: "number",
    numFmt: LEDGER_MONEY_FORMAT,
    align: "right",
    total: "sum"
  },
  { header: "状态", key: "statusLabel", width: 16 },
  { header: "更新时间", key: "updatedAtIso", width: 16, kind: "date", numFmt: LEDGER_DATE_FORMAT }
];

/** 预计金额采用业务协议原值，历史申请按原整数分转换。 */
function generalLedgerAmountYuan(item: {
  estimatedAmount: string | null;
  requestedAmountCents: string | null;
  requestProtocolVersion: number;
}): string | null {
  if (item.requestProtocolVersion === 2) return item.estimatedAmount;
  return item.requestedAmountCents === null
    ? null
    : formatMoneyCentsAsPlainYuan(BigInt(item.requestedAmountCents));
}
