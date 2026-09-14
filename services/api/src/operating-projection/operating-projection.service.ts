import { createReadStream } from "node:fs";
import { mkdtemp, open, rm, type FileHandle } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  NotFoundException,
  PayloadTooLargeException
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  canPerform,
  operatingProjectionExportMatches,
  OPERATING_PROJECTION_ROW_STATUSES,
  OPERATING_PROJECTION_ROW_STATUS_LABELS,
  type OperatingProjectionExportFilters
} from "@jiangkong/shared-domain";

import { AuditService } from "../audit/audit.service";
import { AuthService } from "../auth/auth.service";
import { preflightProjectionWork } from "./projection-work-budget";
import {
  type OperatingProjectionExportKind
} from "./dto/operating-projection-export.dto";
import {
  ProjectVisibilityBudgetExceededError,
  ProjectVisibilityService
} from "../auth/project-visibility.service";
import { PROJECT_OVERVIEW_READ_POSITION_KEYS } from "../auth/ledger-read-positions";
import { ClearingReconciliationReaderService } from "../clearing/clearing-reconciliation-reader.service";
import { PrismaService } from "../database/prisma.service";
import {
  reduceOperatingProjection,
  ProjectionResourceBudgetExceededError,
  toOperatingProjectionAggregate,
  OperatingProjectionStreamAccumulator,
  projectionFactMatchesFilters,
  toOperatingProjectionPublicDetail,
  type OperatingProjectionAggregateView,
  type OperatingProjectionReadModel,
  type ProjectionFactInput,
  type ProjectionFilters,
  type ProjectionHolderAliasInput,
  type ProjectionRiskInput,
  type ProjectionRestrictionSourceInput,
  type ProjectionScopeInput
} from "./operating-projection.reducer";
import {
  OperatingProjectionCursorCodec,
  projectionContextFingerprint,
  projectionFingerprintsMatch,
  projectionScopeFingerprint,
  type OperatingProjectionCursorPosition
} from "./operating-projection-cursor";

const PROJECT_QUERY_BATCH_SIZE = 100;
const DATABASE_IN_BATCH_SIZE = 1_000;
const OPERATING_FACT_BATCH_SIZE = 500;
const OPERATING_IMPACT_BATCH_SIZE = 2_000;
const DETAIL_IMPACT_SCAN_BATCH_SIZE = 200;
const MAX_DETAIL_SCAN_SNAPSHOT_BYTES = 8 * 1024 * 1024;
const MAX_DETAIL_RESPONSE_BYTES = 8 * 1024 * 1024;
const MAX_EXPORT_BYTES = 8 * 1024 * 1024;
const CLEARING_CASE_BATCH_SIZE = 25;
const MAX_RESTRICTION_INTEGRITY_FACTS = 20_000;
const MAX_RESTRICTION_INTEGRITY_IMPACTS = 40_000;
const MAX_RESTRICTION_SOURCE_SNAPSHOT_BYTES = 8 * 1024 * 1024;
const MAX_PROJECT_SCOPE_SIZE = 500;
const MAX_HOLDER_ALIAS_COORDINATES = 20_000;
const MAX_HOLDER_BALANCE_COORDINATES = 20_000;
const MAX_SOURCE_REFERENCE_TOTALS = 20_000;
const MAX_CONCURRENT_READS_PER_ACTOR = 2;
const MAX_READS_PER_ACTOR_PER_MINUTE = 60;
const TRANSACTION_TIMEOUT_MS = 30_000;
const TRANSACTION_MAX_WAIT_MS = 5_000;
const STATEMENT_TIMEOUT_MS = 15_000;
const CLEARING_SOURCE_TYPE = "clearing_event_version";
const CLEARING_COST_CATEGORY_CODE = "construction_enterprise_deduction";

export interface ProjectProjectionQuery extends ProjectionFilters {
  projectId: string;
  asOf?: string;
}

export interface CompanyProjectionQuery extends ProjectionFilters {
  companyEntityId: string;
  asOf?: string;
}

export interface AsOfProjectionQuery extends ProjectionFilters {
  scopeKind: "project" | "company" | "projects";
  projectId?: string;
  projectIds?: string[];
  companyEntityId?: string;
  asOf?: string;
}

export interface ProjectionDetailPageQuery {
  cursor?: string;
  pageSize?: number | string;
}

export interface AsOfProjectionDetailQuery extends ProjectionFilters, ProjectionDetailPageQuery {
  scopeKind: string;
  projectId?: string;
  projectIds?: string | string[];
  companyEntityId?: string;
  asOf?: string;
}

type ProjectionReadContext = {
  readAt: Date;
  cutoffAt: Date;
  scope: ProjectionScopeInput;
  projectById: Map<string, { id: string; code: string; name: string }>;
  constructionEnterpriseSubjectIds?: string[];
  companyEntityVersionIds?: string[];
  affiliateAssignments: Array<{
    id: string;
    projectId: string;
    businessPartyId: string;
    businessPartyVersionId: string;
  }>;
  riskDetailsAllowed: boolean;
  moneyComplete: boolean;
  sourceReferenceTotals: OperatingProjectionReadModel["sourceReferenceTotals"];
  projectionContextFingerprint: string;
};

@Injectable()
export class OperatingProjectionService {
  private readonly detailCursor = new OperatingProjectionCursorCodec();
  private readonly readLimiter = new OperatingProjectionReadLimiter();

  constructor(
    private readonly prisma: PrismaService,
    private readonly projectVisibility: ProjectVisibilityService,
    private readonly clearingReconciliation: ClearingReconciliationReaderService,
    private readonly audit: AuditService,
    private readonly auth: AuthService
  ) {}

  acquireCompatibilityReadSlot(actorUserId: string): () => void {
    return this.readLimiter.acquire(actorUserId);
  }

  async getProjectView(
    actorUserId: string,
    input: ProjectProjectionQuery
  ): Promise<OperatingProjectionAggregateView> {
    const projectId = required(input.projectId, "项目标识不能为空");
    return toOperatingProjectionAggregate(await this.readProjection({
      actorUserId,
      scope: {
        kind: "project",
        projectId,
        filters: projectionFilters(input)
      },
      asOf: input.asOf
    }));
  }

  async getCompanyView(
    actorUserId: string,
    input: CompanyProjectionQuery
  ): Promise<OperatingProjectionAggregateView> {
    const companyEntityId = required(input.companyEntityId, "公司主体标识不能为空");
    return toOperatingProjectionAggregate(await this.readProjection({
      actorUserId,
      scope: {
        kind: "company",
        companyEntityId,
        filters: { ...projectionFilters(input), companyEntityId }
      },
      asOf: input.asOf
    }));
  }

  async getAsOfView(
    actorUserId: string,
    input: AsOfProjectionQuery
  ): Promise<OperatingProjectionAggregateView> {
    if (input.scopeKind === "project") {
      return this.getProjectView(actorUserId, {
        ...input,
        projectId: required(input.projectId, "项目标识不能为空")
      });
    }
    if (input.scopeKind === "company") {
      return this.getCompanyView(actorUserId, {
        ...input,
        companyEntityId: required(input.companyEntityId, "公司主体标识不能为空")
      });
    }
    return toOperatingProjectionAggregate(await this.readProjection({
      actorUserId,
      scope: {
        kind: "projects",
        projectIds: input.projectIds,
        filters: projectionFilters(input)
      },
      asOf: input.asOf
    }));
  }

  async getProjectDetailPage(
    actorUserId: string,
    input: ProjectProjectionQuery & ProjectionDetailPageQuery
  ) {
    const releaseReadSlot = this.readLimiter.acquire(actorUserId);
    try {
      const projectId = required(input.projectId, "项目标识不能为空");
      return await this.readDetailPageWithAcquiredSlot(actorUserId, {
        scope: { kind: "project", projectId, filters: projectionFilters(input) },
        asOf: input.asOf,
        cursor: input.cursor,
        pageSize: input.pageSize
      });
    } finally {
      releaseReadSlot();
    }
  }

  async getCompanyDetailPage(
    actorUserId: string,
    input: CompanyProjectionQuery & ProjectionDetailPageQuery
  ) {
    const releaseReadSlot = this.readLimiter.acquire(actorUserId);
    try {
      const companyEntityId = required(input.companyEntityId, "公司主体标识不能为空");
      return await this.readDetailPageWithAcquiredSlot(actorUserId, {
        scope: {
          kind: "company",
          companyEntityId,
          filters: { ...projectionFilters(input), companyEntityId }
        },
        asOf: input.asOf,
        cursor: input.cursor,
        pageSize: input.pageSize
      });
    } finally {
      releaseReadSlot();
    }
  }

  async getAsOfDetailPage(
    actorUserId: string,
    input: AsOfProjectionDetailQuery
  ) {
    const releaseReadSlot = this.readLimiter.acquire(actorUserId);
    try {
      const normalizedInput = normalizeAsOfProjectionDetailQuery(input);
      return await this.readDetailPageWithAcquiredSlot(actorUserId, {
        ...asOfProjectionInput(actorUserId, normalizedInput),
        cursor: input.cursor,
        pageSize: input.pageSize
      });
    } finally {
      releaseReadSlot();
    }
  }

  private async readDetailPageWithAcquiredSlot(
    actorUserId: string,
    input: {
      scope: Omit<ProjectionScopeInput, "projectIds"> & { projectIds?: string[] };
      asOf?: string;
      cursor?: string;
      pageSize?: number | string;
    }
  ) {
    const pageSize = projectionDetailPageSize(input.pageSize);
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 200) {
      throw new BadRequestException("经营投影明细每页条数必须是 1 到 200 的整数");
    }
    const requestScope = projectionCursorRequestScope(input.scope);
    const cursor = input.cursor
      ? this.detailCursor.read(input.cursor, {
          actorUserId,
          scope: requestScope,
          pageSize,
          asOf: input.asOf
        })
      : null;
    const bundle = await this.readProjectionBundleWithAcquiredSlot({
      actorUserId,
      scope: input.scope,
      asOf: input.asOf,
      requireDetailPermission: true,
      fixedReadAt: cursor ? new Date(cursor.readAt) : undefined,
      fixedCutoffAt: cursor ? new Date(cursor.cutoffAt) : undefined
    }, async (tx, _projectIds, context, projection) => {
      if (cursor && cursor.scopeFingerprint !== projectionScopeFingerprint(context.scope)) {
        throw new BadRequestException("经营投影明细游标范围与当前可见项目不一致");
      }
      if (
        cursor &&
        !projectionFingerprintsMatch(
          cursor.projectionContextFingerprint,
          context.projectionContextFingerprint
        )
      ) {
        throw new BadRequestException("经营投影明细上下文已变化，请重新读取首屏");
      }
      const position = cursor?.position ?? null;
      let detailPage = position?.phase === "risks"
        ? await this.readRiskDetailPageInTransaction(tx, context, position, pageSize)
        : position?.phase === "done"
          ? { items: [], nextPosition: null }
          : await readFactDetailPageInTransaction(tx, context, position, pageSize);
      if (
        detailPage.items.length === 0 &&
        detailPage.nextPosition?.phase === "risks"
      ) {
        detailPage = await this.readRiskDetailPageInTransaction(
          tx,
          context,
          detailPage.nextPosition,
          pageSize
        );
      }
      const nextCursor = detailPage.nextPosition
        ? this.detailCursor.issue({
            actorUserId,
            requestedAsOf: input.asOf?.trim() || null,
            requestScope,
            scope: context.scope,
            projectionContextFingerprint: context.projectionContextFingerprint,
            readAt: context.readAt.toISOString(),
            cutoffAt: context.cutoffAt.toISOString(),
            pageSize,
            position: detailPage.nextPosition
          })
        : null;
      const response = {
        projection: toOperatingProjectionAggregate(projection),
        items: detailPage.items,
        page: {
          pageSize,
          readAt: projection.asOf.readAt,
          nextCursor
        }
      };
      assertDetailResponseWithinBudget(response);
      return response;
    });
    return bundle.additional;
  }

  private async readRiskDetailPageInTransaction(
    tx: Prisma.TransactionClient,
    context: ProjectionReadContext,
    position: Extract<OperatingProjectionCursorPosition, { phase: "risks" }>,
    pageSize: number,
    includeExportMetadata = false
  ): Promise<{ items: Array<Record<string, unknown>>; nextPosition: OperatingProjectionCursorPosition | null }> {
    if (!context.riskDetailsAllowed) return { items: [], nextPosition: null };
    const filters = context.scope.filters;
    if (
      (filters?.sourceType && filters.sourceType !== CLEARING_SOURCE_TYPE) ||
      (filters?.costCategoryCode && filters.costCategoryCode !== CLEARING_COST_CATEGORY_CODE) ||
      filters?.companyEntityId ||
      filters?.counterpartyId
    ) {
      return { items: [], nextPosition: null };
    }
    const items: Array<Record<string, unknown>> = [];
    const projectIds = [...context.scope.projectIds].sort();
    const firstProjectIndex = position.projectId
      ? Math.max(0, projectIds.indexOf(position.projectId))
      : 0;
    for (let projectIndex = firstProjectIndex; projectIndex < projectIds.length; projectIndex += 1) {
      const projectId = projectIds[projectIndex]!;
      const assignmentIds = filters?.constructionEnterpriseId
        ? context.affiliateAssignments
            .filter((assignment) => assignment.projectId === projectId && [
              assignment.id,
              assignment.businessPartyId,
              assignment.businessPartyVersionId
            ].includes(filters.constructionEnterpriseId!))
            .map((assignment) => assignment.id)
        : undefined;
      if (filters?.constructionEnterpriseId && !assignmentIds?.length) continue;
      let afterCaseId = projectId === position.projectId ? position.clearingCaseId : undefined;
      let includeAfterCase = Boolean(afterCaseId && (position.itemOffset ?? 0) > 0);
      for (;;) {
        const cases = await tx.clearingCase.findMany({
          where: {
            projectId,
            ...(assignmentIds
              ? { constructionEnterpriseAssignmentId: { in: assignmentIds } }
              : {}),
            ...(afterCaseId
              ? { id: includeAfterCase ? { gte: afterCaseId } : { gt: afterCaseId } }
              : {})
          },
          select: { id: true },
          orderBy: { id: "asc" },
          take: CLEARING_CASE_BATCH_SIZE
        });
        includeAfterCase = false;
        if (!cases.length) break;
        for (const clearingCase of cases) {
          const risk = await this.clearingReconciliation
            .readClearingReconciliationRiskInTransaction(tx, {
              projectId,
              asOf: context.cutoffAt,
              readAt: context.readAt,
              clearingCaseIds: [clearingCase.id]
            });
          const rows = publicRiskDetailRows(
            projectId,
            context.projectById.get(projectId),
            risk,
            includeExportMetadata
          );
          const offset = projectId === position.projectId &&
            clearingCase.id === position.clearingCaseId
            ? position.itemOffset ?? 0
            : 0;
          for (let index = offset; index < rows.length; index += 1) {
            if (items.length === pageSize) {
              return {
                items,
                nextPosition: {
                  phase: "risks",
                  projectId,
                  clearingCaseId: clearingCase.id,
                  itemOffset: index
                }
              };
            }
            items.push(rows[index]!);
          }
          afterCaseId = clearingCase.id;
        }
        if (cases.length < CLEARING_CASE_BATCH_SIZE) break;
      }
    }
    return { items, nextPosition: null };
  }

  async exportView(
    actorUserId: string,
    input: AsOfProjectionQuery & OperatingProjectionExportFilters,
    confirmationPassword: string,
    exportKind: OperatingProjectionExportKind
  ) {
    await this.auth.confirmPassword(
      actorUserId,
      required(confirmationPassword, "导出经营投影前必须输入当前登录密码")
    );
    const headers = [
      "项目编号",
      "项目名称",
      "来源类型",
      "来源业务编号",
      "事实类型",
      "证据等级",
      "金额口径",
      "业务状态",
      "业务发生时间",
      "确认时间",
      "经营影响",
      "方向",
      "金额（元）",
      "成本分类",
      "资金用途",
      "主体/往来方",
      "待核对状态",
      "历史接管来源"
    ];
    const output = await BoundedProjectionCsvFile.create(headers);
    try {
      const auditContext = await this.readExportProjection(
        actorUserId,
        input,
        exportKind,
        output
      );
      const fileName = `${EXPORT_KIND_FILE_NAMES[exportKind]}_${auditContext.businessDate}.csv`;
      const auditScope: Prisma.InputJsonObject = {
        kind: input.scopeKind,
        projectIds: auditContext.projectIds,
        ...(input.scopeKind === "project" && auditContext.projectIds[0]
          ? { projectId: auditContext.projectIds[0] }
          : {}),
        ...(input.scopeKind === "company" && input.companyEntityId
          ? { companyEntityId: input.companyEntityId.trim() }
          : {})
      };
      const auditFilters = Object.fromEntries(
        Object.entries({ ...projectionFilters(input), ...auditContext.exportFilters })
      ) as Prisma.InputJsonObject;
      await this.audit.record(this.prisma, {
        actorUserId,
        action: "operating_projection.export",
        businessType: "operating_projection",
        metadata: {
          exportKind,
          scope: auditScope,
          filters: auditFilters,
          effectiveRoleKeysByProject: auditContext.effectiveRoleKeysByProject,
          businessDate: auditContext.businessDate,
          readAt: auditContext.readAt,
          rowCount: auditContext.rowCount,
          fileName
        }
      });
      return {
        fileName,
        contentType: "text/csv; charset=utf-8",
        stream: await output.openReadStream()
      };
    } catch (error) {
      await output.dispose();
      throw error;
    }
  }

  private async readExportProjection(
    actorUserId: string,
    input: AsOfProjectionQuery & OperatingProjectionExportFilters,
    exportKind: OperatingProjectionExportKind,
    output: BoundedProjectionCsvFile
  ) {
    const bundle = await this.readProjectionBundle(
      { ...asOfProjectionInput(actorUserId, input), requireDetailPermission: true },
      async (tx, projectIds, context, projection) => {
        const exportFilters = normalizeProjectionExportFilters(input,
          projection.asOf.businessDate);
        const effectiveRoleKeysByProject =
          await this.projectVisibility.effectiveRoleKeysByProjectInTransaction(
            tx,
            actorUserId,
            projectIds
          );
        let rowCount = 0;
        let position: OperatingProjectionCursorPosition | null = null;
        for (;;) {
          const detailPage: ProjectionDetailPageResult = position?.phase === "risks"
            ? await this.readRiskDetailPageInTransaction(
                tx,
                context,
                position,
                DETAIL_IMPACT_SCAN_BATCH_SIZE,
                true
              )
            : position?.phase === "done"
              ? { items: [], nextPosition: null }
              : await readFactDetailPageInTransaction(
                  tx,
                  context,
                  position,
                  DETAIL_IMPACT_SCAN_BATCH_SIZE,
                  true
                );
          for (const item of detailPage.items) {
            const csvRow = projectionExportCsvRow(item, exportKind, exportFilters);
            if (!csvRow) continue;
            await output.writeRow(csvRow);
            rowCount += 1;
          }
          if (!detailPage.nextPosition) break;
          position = detailPage.nextPosition;
        }
        return {
          projectIds,
          effectiveRoleKeysByProject: Object.fromEntries(
            Array.from(effectiveRoleKeysByProject.entries())
          ),
          businessDate: projection.asOf.businessDate,
          exportFilters,
          readAt: projection.asOf.readAt,
          rowCount
        };
      }
    );
    return bundle.additional;
  }

  async readProjectCompatibilitySnapshot<T>(
    actorUserId: string,
    input: ProjectProjectionQuery,
    readAdditional: (tx: Prisma.TransactionClient, projectIds: string[]) => Promise<T>
  ): Promise<{
    projection: OperatingProjectionAggregateView;
    additional: T;
    canExportDetail: boolean;
  }> {
    const projectId = required(input.projectId, "项目标识不能为空");
    const bundle = await this.readProjectionBundle({
      actorUserId,
      scope: {
        kind: "project",
        projectId,
        filters: projectionFilters(input)
      },
      asOf: input.asOf
    }, async (tx, projectIds) => {
      const effectiveRoleKeysByProject =
        await this.projectVisibility.effectiveRoleKeysByProjectInTransaction(
          tx,
          actorUserId,
          projectIds
        );
      const additional = await readAdditional(tx, projectIds);
      return {
        additional,
        canExportDetail: projectIds.every((currentProjectId) =>
          canPerform(
            "operating_projection.detail.read",
            effectiveRoleKeysByProject.get(currentProjectId) ?? []
          )
        )
      };
    });
    return {
      projection: toOperatingProjectionAggregate(bundle.projection),
      additional: bundle.additional.additional,
      canExportDetail: bundle.additional.canExportDetail
    };
  }

  async readFundsCompatibilitySnapshot<T>(
    actorUserId: string,
    input: { projectIds?: string[] },
    readAdditional: (
      tx: Prisma.TransactionClient,
      projectIds: string[],
      context: ProjectionReadContext
    ) => Promise<T>
  ): Promise<{
    integrity: OperatingProjectionReadModel["integrity"];
    sourceReferenceTotals: OperatingProjectionReadModel["sourceReferenceTotals"];
    additional: T;
  }> {
    const bundle = await this.readProjectionBundle({
      actorUserId,
      scope: {
        kind: "projects",
        projectIds: input.projectIds,
        filters: {}
      },
      collectSourceReferenceTotals: true
    }, readAdditional);
    return {
      integrity: bundle.projection.integrity,
      sourceReferenceTotals: bundle.projection.sourceReferenceTotals,
      additional: bundle.additional
    };
  }

  private async readProjection(input: {
    actorUserId: string;
    scope: Omit<ProjectionScopeInput, "projectIds"> & { projectIds?: string[] };
    asOf?: string;
    requireDetailPermission?: boolean;
  }): Promise<OperatingProjectionReadModel> {
    return (await this.readProjectionBundle({
      ...input,
      requireOverviewPermission: true
    })).projection;
  }

  private async readProjectionBundle<T = undefined>(input: {
    actorUserId: string;
    scope: Omit<ProjectionScopeInput, "projectIds"> & { projectIds?: string[] };
    asOf?: string;
    requireDetailPermission?: boolean;
    requireOverviewPermission?: boolean;
    collectSourceReferenceTotals?: boolean;
    fixedReadAt?: Date;
    fixedCutoffAt?: Date;
  }, readAdditional?: (
    tx: Prisma.TransactionClient,
    projectIds: string[],
    context: ProjectionReadContext,
    projection: OperatingProjectionReadModel
  ) => Promise<T>): Promise<{
    projection: OperatingProjectionReadModel;
    additional: T;
  }> {
    const releaseReadSlot = this.readLimiter.acquire(input.actorUserId);
    try {
      return await this.readProjectionBundleWithAcquiredSlot(input, readAdditional);
    } finally {
      releaseReadSlot();
    }
  }

  private async readProjectionBundleWithAcquiredSlot<T = undefined>(input: {
    actorUserId: string;
    scope: Omit<ProjectionScopeInput, "projectIds"> & { projectIds?: string[] };
    asOf?: string;
    requireDetailPermission?: boolean;
    requireOverviewPermission?: boolean;
    collectSourceReferenceTotals?: boolean;
    fixedReadAt?: Date;
    fixedCutoffAt?: Date;
  }, readAdditional?: (
    tx: Prisma.TransactionClient,
    projectIds: string[],
    context: ProjectionReadContext,
    projection: OperatingProjectionReadModel
  ) => Promise<T>): Promise<{
    projection: OperatingProjectionReadModel;
    additional: T;
  }> {
    try {
      return await this.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
      const databaseReadAt = (await tx.$queryRaw<Array<{ readAt: Date }>>(Prisma.sql`
        SELECT CURRENT_TIMESTAMP AS "readAt",
          set_config('statement_timeout', ${String(STATEMENT_TIMEOUT_MS)}, true)
      `))[0]?.readAt;
      if (!databaseReadAt) throw new BadRequestException("数据库未返回经营投影读取时点");
      if (input.fixedReadAt && input.fixedReadAt.getTime() > databaseReadAt.getTime()) {
        throw new BadRequestException("经营投影游标读取时点晚于当前数据库时点");
      }
      const readAt = input.fixedReadAt ?? databaseReadAt;
      const cutoffAt = input.fixedCutoffAt ?? projectionCutoff(input.asOf, readAt);
      const requestedProjectIds = input.scope.kind === "project"
        ? [required(input.scope.projectId, "项目标识不能为空")]
        : input.scope.kind === "company"
          ? await this.readCompanyProjectIdsInTransaction(
              tx,
              required(input.scope.companyEntityId, "公司主体标识不能为空"),
              cutoffAt,
              readAt
            )
          : input.scope.projectIds === undefined
            ? undefined
            : Array.from(new Set(input.scope.projectIds));
      if (requestedProjectIds && requestedProjectIds.length > MAX_PROJECT_SCOPE_SIZE) {
        throw new ProjectionResourceBudgetExceededError();
      }
      const visibleProjectIds = requestedProjectIds
        ? await this.projectVisibility.visibleRequestedProjectIdsInTransaction(
            tx,
            input.actorUserId,
            requestedProjectIds
          )
        : await this.projectVisibility.visibleProjectIdsWithinBudgetInTransaction(
            tx,
            input.actorUserId,
            MAX_PROJECT_SCOPE_SIZE
          );
      const effectiveRequestedProjectIds = input.scope.kind === "company"
        ? visibleProjectIds
        : requestedProjectIds ?? visibleProjectIds;
      const visibleProjectIdSet = new Set(visibleProjectIds);
      if (effectiveRequestedProjectIds.some((projectId) => !visibleProjectIdSet.has(projectId))) {
        throw new ForbiddenException(
          input.scope.kind === "project"
            ? "无权读取该项目经营投影"
            : "经营投影包含无权读取的项目"
        );
      }
      const projectIds = input.scope.kind === "company"
        ? effectiveRequestedProjectIds
        : await this.resolveProjectIdsInTransaction(tx, {
            ...input.scope,
            projectIds: effectiveRequestedProjectIds
          }, cutoffAt, readAt);
      if (projectIds.length > MAX_PROJECT_SCOPE_SIZE) {
        throw new ProjectionResourceBudgetExceededError();
      }
      if (!projectIds.length && input.scope.kind === "project") {
        throw new NotFoundException("项目不存在或已停用");
      }
      if (input.requireDetailPermission || input.requireOverviewPermission) {
        const roleKeysByProject =
          await this.projectVisibility.effectiveRoleKeysByProjectInTransaction(
            tx,
            input.actorUserId,
            projectIds
          );
        if (input.requireDetailPermission) {
          if (projectIds.some((projectId) =>
            !canPerform(
              "operating_projection.detail.read",
              roleKeysByProject.get(projectId) ?? []
            )
          )) {
            throw new ForbiddenException("当前岗位无权读取经营投影明细");
          }
        } else if (projectIds.some((projectId) =>
          !PROJECT_OVERVIEW_READ_POSITION_KEYS.some((position) =>
            (roleKeysByProject.get(projectId) ?? []).includes(position)
          )
        )) {
          throw new ForbiddenException("经营投影包含当前岗位无权读取概览的项目");
        }
      }
      const projects = await collectInBatches(
        projectIds,
        PROJECT_QUERY_BATCH_SIZE,
        (ids) => tx.project.findMany({
          where: { id: { in: ids }, isActive: true },
          select: { id: true, code: true, name: true }
        })
      );
      const projectById = new Map(projects.map((project) => [project.id, project]));
      const companyEntityId = input.scope.filters?.companyEntityId;
      const companyEntityVersions = companyEntityId
        ? await tx.companyEntityVersion.findMany({
            where: { companyEntityId, createdAt: { lte: readAt } },
            select: {
              id: true,
              name: true,
              unifiedSocialCreditCode: true,
              isActive: true,
              action: true,
              createdAt: true
            },
            orderBy: { id: "asc" },
            take: MAX_HOLDER_ALIAS_COORDINATES + 1
          })
        : null;
      if ((companyEntityVersions?.length ?? 0) > MAX_HOLDER_ALIAS_COORDINATES) {
        throw new ProjectionResourceBudgetExceededError();
      }
      const companyEntityVersionIds = companyEntityVersions
        ? new Set(companyEntityVersions.map((version) => version.id))
        : null;
      const [affiliateAssignments, participatingCompanies] = await Promise.all([
        collectInBatchesWithBudget(
          projectIds,
          PROJECT_QUERY_BATCH_SIZE,
          MAX_HOLDER_ALIAS_COORDINATES,
          (ids, remaining) => tx.projectAffiliateAssignment.findMany({
            where: {
              projectId: { in: ids },
              effectiveFrom: { lte: cutoffAt },
              createdAt: { lte: readAt },
              OR: [{ endedAt: null }, { endedAt: { gt: cutoffAt } }]
            },
            select: {
              id: true,
              projectId: true,
              businessPartyId: true,
              businessPartyVersionId: true,
              affiliateNameSnapshot: true,
              affiliateCreditCodeSnapshot: true,
              effectiveFrom: true,
              endedAt: true,
              createdAt: true
            },
            orderBy: { id: "asc" },
            take: remaining + 1
          })
        ),
        collectInBatchesWithBudget(
          projectIds,
          PROJECT_QUERY_BATCH_SIZE,
          MAX_HOLDER_ALIAS_COORDINATES,
          (ids, remaining) => tx.projectParticipatingCompany.findMany({
            where: {
              projectId: { in: ids },
              createdAt: { lte: readAt }
            },
            select: {
              id: true,
              projectId: true,
              companyEntityId: true,
              companyEntityVersionId: true,
              companyNameSnapshot: true,
              companyCreditCodeSnapshot: true,
              effectiveFrom: true,
              endedAt: true,
              createdAt: true
            },
            orderBy: { id: "asc" },
            take: remaining + 1
          })
        )
      ]);
      const filterAffiliateAssignments = input.scope.filters?.constructionEnterpriseId
        ? await collectInBatchesWithBudget(
            projectIds,
            PROJECT_QUERY_BATCH_SIZE,
            MAX_HOLDER_ALIAS_COORDINATES,
            (ids, remaining) => tx.projectAffiliateAssignment.findMany({
              where: {
                projectId: { in: ids },
                effectiveFrom: { lte: cutoffAt },
                createdAt: { lte: readAt }
              },
              select: {
                id: true,
                projectId: true,
                businessPartyId: true,
                businessPartyVersionId: true,
                affiliateNameSnapshot: true,
                affiliateCreditCodeSnapshot: true,
                effectiveFrom: true,
                endedAt: true,
                createdAt: true
              },
              orderBy: { id: "asc" },
              take: remaining + 1
            })
          )
        : affiliateAssignments;
      const scope: ProjectionScopeInput = { ...input.scope, projectIds };
      const contextFingerprint = projectionContextFingerprint({
        projects: projects
          .map((project) => ({ id: project.id, code: project.code, name: project.name }))
          .sort((left, right) => left.id.localeCompare(right.id)),
        companyEntityVersions: (companyEntityVersions ?? []).map((version) => ({
          ...version,
          createdAt: dateFingerprintCoordinate(version.createdAt)
        })),
        affiliateAssignments: canonicalAffiliateAssignments(affiliateAssignments),
        filterAffiliateAssignments: canonicalAffiliateAssignments(filterAffiliateAssignments),
        participatingCompanies: participatingCompanies.map((company) => ({
          ...company,
          effectiveFrom: dateFingerprintCoordinate(company.effectiveFrom),
          endedAt: dateFingerprintCoordinate(company.endedAt),
          createdAt: dateFingerprintCoordinate(company.createdAt)
        })).sort((left, right) => String(left.id).localeCompare(String(right.id)))
      });
      const holderAliases: ProjectionHolderAliasInput[] = [
        ...affiliateAssignments.flatMap((assignment) => [
          assignment.id,
          assignment.businessPartyId,
          assignment.businessPartyVersionId
        ].map((id) => ({
          projectId: assignment.projectId,
          kind: "construction_enterprise" as const,
          id,
          canonicalId: assignment.businessPartyVersionId
        }))),
        ...participatingCompanies.flatMap((company) => [
          {
            projectId: company.projectId,
            kind: "participating_company" as const,
            id: company.companyEntityId,
            canonicalId: company.companyEntityId
          },
          {
            projectId: company.projectId,
            kind: "participating_company" as const,
            id: company.companyEntityVersionId,
            canonicalId: company.companyEntityId
          }
        ])
      ];
      const constructionEnterpriseSubjectIds = input.scope.filters?.constructionEnterpriseId
        ? Array.from(new Set(filterAffiliateAssignments
            .filter((assignment) => [
              assignment.id,
              assignment.businessPartyId,
              assignment.businessPartyVersionId
            ].includes(input.scope.filters!.constructionEnterpriseId!))
            .flatMap((assignment) => [
              assignment.id,
              assignment.businessPartyId,
              assignment.businessPartyVersionId
            ])))
        : undefined;
      const accumulator = new OperatingProjectionStreamAccumulator({
        scope,
        cutoffAt: cutoffAt.toISOString(),
        collectSourceReferenceTotals: input.collectSourceReferenceTotals,
        constructionEnterpriseSubjectIds,
        companyEntityVersionIds: companyEntityVersionIds
          ? Array.from(companyEntityVersionIds)
          : undefined,
        holderAliases,
        maxIntegrityFacts: MAX_RESTRICTION_INTEGRITY_FACTS,
        maxIntegrityImpacts: MAX_RESTRICTION_INTEGRITY_IMPACTS,
        maxHolderAliases: MAX_HOLDER_ALIAS_COORDINATES,
        maxHolderCoordinates: MAX_HOLDER_BALANCE_COORDINATES,
        maxSourceReferenceTotals: MAX_SOURCE_REFERENCE_TOTALS
      });
      await preflightRestrictionResources(
        tx,
        projectIds,
        cutoffAt,
        readAt,
        input.scope.filters,
        constructionEnterpriseSubjectIds,
        companyEntityVersionIds ? Array.from(companyEntityVersionIds) : undefined
      );
      await readOperatingFactsInBatches(tx, projectIds, cutoffAt, readAt, {
        startFacts: (facts) => {
          const mapped = facts.map((fact) => projectionFactFromStored(fact, projectById));
          accumulator.startFacts(mapped);
        },
        addImpacts: (impacts) => accumulator.addImpacts(
          impacts.map((impact) => ({ ...projectionImpactFromStored(impact), factId: impact.factId }))
        ),
        finishFacts: () => accumulator.finishFacts()
      });
      const streamed = accumulator.result();
      const reserveEntryIds = new Set(
        streamed.integrityFacts
          .filter((fact) => fact.sourceType === "project_necessary_expense_reserve_entry")
          .map((fact) => fact.sourceBusinessId)
      );
      const disputeEntryIds = new Set(
        streamed.integrityFacts
          .filter((fact) => fact.sourceType === "project_fund_dispute_entry")
          .map((fact) => fact.sourceBusinessId)
      );
      const [reserveSources, disputeSources] = await Promise.all([
        collectInBatches([...reserveEntryIds], DATABASE_IN_BATCH_SIZE, (ids) =>
          tx.projectNecessaryExpenseReserveEntry.findMany({
                  where: { id: { in: ids } },
                  select: {
                    id: true,
                    draftRevision: true,
                    entryKind: true,
                    adjustsEntryId: true,
                    amountCents: true,
                    evidenceLevel: true,
                    status: true,
                    fingerprint: true,
                    confirmedAt: true,
                    reserve: {
                      select: {
                        id: true,
                        projectId: true,
                        businessCode: true,
                        economicIdentityKey: true,
                        sourceIdentityKey: true,
                        fundHolderKind: true,
                        fundHolderId: true
                      }
                    }
                  }
                })
        ),
        collectInBatches([...disputeEntryIds], DATABASE_IN_BATCH_SIZE, (ids) =>
          tx.projectFundDisputeEntry.findMany({
                  where: { id: { in: ids } },
                  select: {
                    id: true,
                    draftRevision: true,
                    entryKind: true,
                    adjustsEntryId: true,
                    amountCents: true,
                    evidenceLevel: true,
                    status: true,
                    fingerprint: true,
                    confirmedAt: true,
                    dispute: {
                      select: {
                        id: true,
                        projectId: true,
                        businessCode: true,
                        economicIdentityKey: true,
                        sourceIdentityKey: true,
                        fundHolderKind: true,
                        fundHolderId: true
                      }
                    }
                  }
                })
        )
      ]);
      const reserveReplacements = await collectInBatchesWithBudget(
        [...reserveEntryIds],
        DATABASE_IN_BATCH_SIZE,
        MAX_RESTRICTION_INTEGRITY_IMPACTS,
        (ids, remaining) => tx.projectNecessaryExpenseReserveReplacement.findMany({
          where: { reserveEntryId: { in: ids } },
          select: {
            reserveEntryId: true,
            operatingImpactEntryId: true,
            amountCents: true
          },
          orderBy: { id: "asc" },
          take: remaining + 1
        })
      );
      const disputeReplacements = await collectInBatchesWithBudget(
        [...disputeEntryIds],
        DATABASE_IN_BATCH_SIZE,
        MAX_RESTRICTION_INTEGRITY_IMPACTS - reserveReplacements.length,
        (ids, remaining) => tx.projectFundDisputeReplacement.findMany({
          where: { disputeEntryId: { in: ids } },
          select: {
            disputeEntryId: true,
            operatingImpactEntryId: true,
            amountCents: true
          },
          orderBy: { id: "asc" },
          take: remaining + 1
        })
      );
      const reserveReplacementsByEntryId = groupReplacementRows(
        reserveReplacements,
        "reserveEntryId"
      );
      const disputeReplacementsByEntryId = groupReplacementRows(
        disputeReplacements,
        "disputeEntryId"
      );
      const riskByProject = (await this.readRiskByProjectInBatches(
        tx,
        projectIds,
        cutoffAt,
        readAt,
        input.scope.filters,
        filterAffiliateAssignments
      )).map((risk) => ({
        ...risk,
        projectCode: projectById.get(risk.projectId)?.code ?? "未知项目",
        projectName: projectById.get(risk.projectId)?.name ?? "未知项目"
      }));
      const restrictionSources: ProjectionRestrictionSourceInput[] = [
        ...reserveSources.map((entry) => ({
          sourceType: "project_necessary_expense_reserve_entry" as const,
          entryId: entry.id,
          projectId: entry.reserve.projectId,
          status: entry.status,
          sourceVersion: entry.draftRevision,
          entryKind: entry.entryKind,
          adjustsEntryId: entry.adjustsEntryId,
          amountCents: entry.amountCents,
          evidenceLevel: entry.evidenceLevel,
          fingerprint: entry.fingerprint,
          confirmedAt: entry.confirmedAt?.toISOString() ?? null,
          rootId: entry.reserve.id,
          businessCode: entry.reserve.businessCode,
          economicIdentityKey: entry.reserve.economicIdentityKey,
          sourceIdentityKey: entry.reserve.sourceIdentityKey,
          fundHolderKind: entry.reserve.fundHolderKind,
          fundHolderId: entry.reserve.fundHolderId,
          replacements: reserveReplacementsByEntryId.get(entry.id) ?? []
        })),
        ...disputeSources.map((entry) => ({
          sourceType: "project_fund_dispute_entry" as const,
          entryId: entry.id,
          projectId: entry.dispute.projectId,
          status: entry.status,
          sourceVersion: entry.draftRevision,
          entryKind: entry.entryKind,
          adjustsEntryId: entry.adjustsEntryId,
          amountCents: entry.amountCents,
          evidenceLevel: entry.evidenceLevel,
          fingerprint: entry.fingerprint,
          confirmedAt: entry.confirmedAt?.toISOString() ?? null,
          rootId: entry.dispute.id,
          businessCode: entry.dispute.businessCode,
          economicIdentityKey: entry.dispute.economicIdentityKey,
          sourceIdentityKey: entry.dispute.sourceIdentityKey,
          fundHolderKind: entry.dispute.fundHolderKind,
          fundHolderId: entry.dispute.fundHolderId,
          replacements: disputeReplacementsByEntryId.get(entry.id) ?? []
        }))
      ];
      const replacementImpactIds = Array.from(new Set(
        restrictionSources.flatMap((source) =>
          source.replacements.map((replacement) => replacement.operatingImpactEntryId)
        )
      ));
      if (replacementImpactIds.length > MAX_RESTRICTION_INTEGRITY_IMPACTS) {
        throw new ProjectionResourceBudgetExceededError();
      }
      const replacementImpacts = await collectInBatches(
        replacementImpactIds,
        DATABASE_IN_BATCH_SIZE,
        (ids) => tx.operatingImpactEntry.findMany({ where: { id: { in: ids } } })
      );
      const replacementFacts = await collectInBatches(
        Array.from(new Set(replacementImpacts.map((impact) => impact.factId))),
        DATABASE_IN_BATCH_SIZE,
        (ids) => tx.operatingFact.findMany({ where: { id: { in: ids } } })
      );
      const replacementImpactsByFactId = new Map<string, StoredOperatingImpact[]>();
      for (const impact of replacementImpacts) {
        const values = replacementImpactsByFactId.get(impact.factId) ?? [];
        values.push(impact);
        replacementImpactsByFactId.set(impact.factId, values);
      }
      const projection = reduceOperatingProjection({
        scope,
        readAt: readAt.toISOString(),
        cutoffAt: cutoffAt.toISOString(),
        constructionEnterpriseSubjectIds,
        companyEntityVersionIds: companyEntityVersionIds
          ? Array.from(companyEntityVersionIds)
          : undefined,
        facts: [],
        aggregateSeed: streamed.aggregateSeed,
        integrityFacts: [
          ...streamed.integrityFacts,
          ...replacementFacts.map((fact) => projectionReplacementTargetFromStored(
            fact,
            replacementImpactsByFactId.get(fact.id) ?? []
          ))
        ],
        restrictionCashContext: streamed.restrictionCashContext,
        riskByProject,
        holderAliases,
        restrictionSources
      });
      const riskDetailsAllowed = projection.restrictions.relationshipCompleteness !==
          "integrity_conflict" &&
        projection.restrictions.relationshipCompleteness !== "legacy_unmodeled" &&
        projection.restrictions.openPendingReconciliationGrossCents !== null &&
        projection.restrictions.openCoveredReconciliationCents !== null &&
        projection.restrictions.openUncoveredReconciliationCents !== null &&
        projection.restrictions.continuedWithheldRetainedCents !== null;
      const additional = readAdditional
        ? await readAdditional(tx, projectIds, {
            readAt,
            cutoffAt,
            scope,
            projectById,
            constructionEnterpriseSubjectIds,
            companyEntityVersionIds: companyEntityVersionIds
              ? Array.from(companyEntityVersionIds)
              : undefined,
            affiliateAssignments: filterAffiliateAssignments,
            riskDetailsAllowed,
            moneyComplete: projection.integrity.moneyComplete,
            sourceReferenceTotals: projection.sourceReferenceTotals,
            projectionContextFingerprint: contextFingerprint
          }, projection)
        : undefined as T;
      return { projection, additional };
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      maxWait: TRANSACTION_MAX_WAIT_MS,
      timeout: TRANSACTION_TIMEOUT_MS
      });
    } catch (error) {
      if (
        error instanceof ProjectionResourceBudgetExceededError ||
        error instanceof ProjectVisibilityBudgetExceededError
      ) {
        throw new PayloadTooLargeException(
          "经营投影完整性数据超出安全预算，请收窄项目或主体筛选"
        );
      }
      throw error;
    }
  }

  private async readRiskByProjectInBatches(
    tx: Prisma.TransactionClient,
    projectIds: string[],
    cutoffAt: Date,
    readAt: Date,
    filters: ProjectionFilters | undefined,
    affiliateAssignments: Array<{
      id: string;
      projectId: string;
      businessPartyId: string;
      businessPartyVersionId: string;
    }>
  ): Promise<ProjectionRiskInput[]> {
    if (
      (filters?.sourceType && filters.sourceType !== CLEARING_SOURCE_TYPE) ||
      (filters?.costCategoryCode &&
        filters.costCategoryCode !== CLEARING_COST_CATEGORY_CODE) ||
      filters?.companyEntityId ||
      filters?.counterpartyId
    ) {
      return projectIds.map(zeroClearingRisk);
    }
    const results: ProjectionRiskInput[] = [];
    for (const projectId of projectIds) {
      const assignmentIds = filters?.constructionEnterpriseId
        ? affiliateAssignments
            .filter((assignment) =>
              assignment.projectId === projectId &&
              [
                assignment.id,
                assignment.businessPartyId,
                assignment.businessPartyVersionId
              ].includes(filters.constructionEnterpriseId!)
            )
            .map((assignment) => assignment.id)
        : undefined;
      if (filters?.constructionEnterpriseId && !assignmentIds?.length) {
        results.push(zeroClearingRisk(projectId));
        continue;
      }
      let summary = zeroClearingRisk(projectId);
      let afterCaseId: string | undefined;
      let caseCount = 0;
      for (;;) {
        const cases = await tx.clearingCase.findMany({
          where: {
            projectId,
            ...(assignmentIds
              ? { constructionEnterpriseAssignmentId: { in: assignmentIds } }
              : {}),
            ...(afterCaseId ? { id: { gt: afterCaseId } } : {})
          },
          select: { id: true },
          orderBy: { id: "asc" },
          take: CLEARING_CASE_BATCH_SIZE
        });
        if (!cases.length) break;
        caseCount += cases.length;
        const risk = await this.clearingReconciliation
          .readClearingReconciliationRiskInTransaction(tx, {
            projectId,
            asOf: cutoffAt,
            readAt,
            clearingCaseIds: cases.map((item) => item.id)
          });
        summary = mergeRiskSummary(summary, summarizeRisk(projectId, risk));
        afterCaseId = cases.at(-1)!.id;
        if (cases.length < CLEARING_CASE_BATCH_SIZE) break;
      }
      if (caseCount === 0) {
        results.push(zeroClearingRisk(projectId));
        continue;
      }
      results.push(summary);
    }
    return results;
  }

  private async resolveProjectIdsInTransaction(
    tx: Prisma.TransactionClient,
    scope: ProjectionScopeInput,
    cutoffAt: Date,
    readAt: Date
  ): Promise<string[]> {
    if (scope.kind !== "company") return scope.projectIds;
    const rows = await collectInBatches(
      scope.projectIds,
      PROJECT_QUERY_BATCH_SIZE,
      (ids) => tx.projectParticipatingCompany.findMany({
        where: {
          projectId: { in: ids },
          companyEntityId: scope.companyEntityId,
          effectiveFrom: { lte: cutoffAt },
          createdAt: { lte: readAt },
          OR: [{ endedAt: null }, { endedAt: { gt: cutoffAt } }]
        },
        select: { projectId: true }
      })
    );
    return Array.from(new Set(rows.map((row) => row.projectId)));
  }

  private async readCompanyProjectIdsInTransaction(
    tx: Prisma.TransactionClient,
    companyEntityId: string,
    cutoffAt: Date,
    readAt: Date
  ): Promise<string[]> {
    const projects = await tx.$queryRaw<Array<{ projectId: string }>>(Prisma.sql`
      SELECT DISTINCT membership."projectId"
      FROM "ProjectParticipatingCompany" AS membership
      INNER JOIN "Project" project
        ON project.id = membership."projectId"
       AND project."isActive" = TRUE
      WHERE membership."companyEntityId" = ${companyEntityId}
        AND membership."effectiveFrom" <= ${cutoffAt}
        AND membership."createdAt" <= ${readAt}
        AND (membership."endedAt" IS NULL OR membership."endedAt" > ${cutoffAt})
      ORDER BY membership."projectId" ASC
      LIMIT ${MAX_PROJECT_SCOPE_SIZE + 1}
    `);
    if (projects.length > MAX_PROJECT_SCOPE_SIZE) {
      throw new ProjectionResourceBudgetExceededError();
    }
    return projects.map((project) => project.projectId);
  }
}

type StoredOperatingFact = Prisma.OperatingFactGetPayload<Record<string, never>>;
type StoredOperatingImpact = Prisma.OperatingImpactEntryGetPayload<Record<string, never>>;
type DetailStoredFact = Pick<StoredOperatingFact,
  "id" |
  "projectId" |
  "sourceType" |
  "sourceBusinessId" |
  "sourceVersion" |
  "sourceBusinessCode" |
  "occurredAt" |
  "confirmedAt" |
  "affiliateBusinessPartyVersionId" |
  "affiliateNameSnapshot" |
  "factKind" |
  "operatingLevel" |
  "evidenceLevel" |
  "amountCents" |
  "direction" |
  "entryKind" |
  "adjustsFactId" |
  "debtorSubjectKind" |
  "debtorSubjectId" |
  "creditorSubjectKind" |
  "creditorSubjectId" |
  "approvedPayerSubjectKind" |
  "approvedPayerSubjectId" |
  "actualPayerSubjectKind" |
  "actualPayerSubjectId" |
  "payeeSubjectKind" |
  "payeeSubjectId" |
  "costBearingCompanySubjectKind" |
  "costBearingCompanySubjectId"
> & Partial<Pick<StoredOperatingFact, "sourceSnapshot" | "subjectSnapshot">>;
type DetailStoredImpact = Pick<StoredOperatingImpact,
  "id" |
  "impactKind" |
  "amountCents" |
  "direction" |
  "subjectKind" |
  "subjectId" |
  "costCategoryCode" |
  "fundPurpose"
>;
type ProjectionExportMetadata = {
  sourceType: string;
  factKind: string;
  impactKind: string;
  factAmountCents: string;
  subjectLabels: string[];
};
type ProjectionDetailPageResult = {
  items: Array<Record<string, unknown>>;
  nextPosition: OperatingProjectionCursorPosition | null;
};
type ProjectionStoredFact = Omit<DetailStoredFact, "sourceSnapshot" | "subjectSnapshot"> &
  Pick<StoredOperatingFact, "sourceSnapshot" | "subjectSnapshot">;

type ReplacementCoordinate = {
  operatingImpactEntryId: string;
  amountCents: bigint;
};

function groupReplacementRows<
  K extends "reserveEntryId" | "disputeEntryId",
  T extends ReplacementCoordinate & Record<K, string>
>(rows: T[], key: K): Map<string, ReplacementCoordinate[]> {
  const result = new Map<string, ReplacementCoordinate[]>();
  for (const row of rows) {
    const values = result.get(row[key]) ?? [];
    values.push({
      operatingImpactEntryId: row.operatingImpactEntryId,
      amountCents: row.amountCents
    });
    result.set(row[key], values);
  }
  return result;
}

async function preflightRestrictionResources(
  tx: Prisma.TransactionClient,
  projectIds: string[],
  cutoffAt: Date,
  readAt: Date,
  filters: ProjectionFilters | undefined,
  constructionEnterpriseSubjectIds: string[] | undefined,
  companyEntityVersionIds: string[] | undefined
): Promise<void> {
  if (!projectIds.length) return;
  const impactFilterSql = restrictionPreflightFilterSql(
    filters,
    constructionEnterpriseSubjectIds,
    companyEntityVersionIds
  );
  const factFilterSql = restrictionPreflightFactFilterSql(
    filters,
    constructionEnterpriseSubjectIds,
    companyEntityVersionIds
  );
  const hasSubjectFilter = Boolean(
    filters?.constructionEnterpriseId ||
    filters?.companyEntityId ||
    filters?.counterpartyId
  );
  const [budget] = await tx.$queryRaw<Array<{
    replacementCount: bigint;
    snapshotBytes: bigint;
    maxSnapshotBytes: number;
  }>>(Prisma.sql`
    WITH candidate_facts AS (
      SELECT
        fact.id,
        fact."sourceType",
        fact."sourceBusinessId",
        GREATEST(
          pg_column_size(fact."sourceSnapshot"),
          octet_length(fact."sourceSnapshot"::text)
        ) AS "snapshotBytes"
      FROM "OperatingFact" AS fact
      WHERE fact."projectId" IN (${Prisma.join(projectIds)})
        AND fact.status = 'confirmed'
        AND fact."occurredAt" <= ${cutoffAt}
        AND fact."confirmedAt" <= ${readAt}
        AND fact."createdAt" <= ${readAt}
        AND fact."sourceType" IN (
          'project_necessary_expense_reserve_entry',
          'project_fund_dispute_entry'
        )
        AND ${hasSubjectFilter
          ? Prisma.sql`(
              (${factFilterSql}) OR EXISTS (
                SELECT 1
                FROM "OperatingImpactEntry" AS impact
                WHERE impact."factId" = fact.id
                  AND impact."createdAt" <= ${readAt}
                  AND ${impactFilterSql}
              )
            )`
          : Prisma.sql`TRUE`}
    ), candidate_sources AS (
      SELECT DISTINCT "sourceType", "sourceBusinessId"
      FROM candidate_facts
    ), replacement_rows AS (
      SELECT replacement.id
      FROM "ProjectNecessaryExpenseReserveReplacement" AS replacement
      JOIN candidate_sources AS fact
        ON fact."sourceType" = 'project_necessary_expense_reserve_entry'
       AND fact."sourceBusinessId" = replacement."reserveEntryId"
      UNION ALL
      SELECT replacement.id
      FROM "ProjectFundDisputeReplacement" AS replacement
      JOIN candidate_sources AS fact
        ON fact."sourceType" = 'project_fund_dispute_entry'
       AND fact."sourceBusinessId" = replacement."disputeEntryId"
    )
    SELECT
      (SELECT COUNT(*) FROM replacement_rows)::bigint AS "replacementCount",
      COALESCE((SELECT SUM("snapshotBytes") FROM candidate_facts), 0)::bigint AS "snapshotBytes",
      COALESCE((SELECT MAX("snapshotBytes") FROM candidate_facts), 0)::integer AS "maxSnapshotBytes"
  `);
  const replacementCount = BigInt(budget?.replacementCount ?? 0);
  const snapshotBytes = BigInt(budget?.snapshotBytes ?? 0);
  const maxSnapshotBytes = BigInt(budget?.maxSnapshotBytes ?? 0);
  if (
    replacementCount > BigInt(MAX_RESTRICTION_INTEGRITY_IMPACTS) ||
    snapshotBytes > BigInt(MAX_RESTRICTION_SOURCE_SNAPSHOT_BYTES) ||
    maxSnapshotBytes > BigInt(MAX_RESTRICTION_SOURCE_SNAPSHOT_BYTES)
  ) {
    throw new ProjectionResourceBudgetExceededError();
  }
  await preflightProjectionWork(tx, projectIds, cutoffAt, readAt,
    hasSubjectFilter ? Prisma.sql`((${factFilterSql}) OR EXISTS (
      SELECT 1 FROM "OperatingImpactEntry" impact WHERE impact."factId" = fact.id
        AND impact."createdAt" <= ${readAt} AND ${impactFilterSql}
    ))` : Prisma.sql`TRUE`);
}

function restrictionPreflightFilterSql(
  filters: ProjectionFilters | undefined,
  constructionEnterpriseSubjectIds: string[] | undefined,
  companyEntityVersionIds: string[] | undefined
): Prisma.Sql {
  const predicates: Prisma.Sql[] = [];
  if (filters?.constructionEnterpriseId) {
    predicates.push(restrictionSubjectSql(
      "construction_enterprise",
      [filters.constructionEnterpriseId, ...(constructionEnterpriseSubjectIds ?? [])],
      false
    ));
  }
  if (filters?.companyEntityId) {
    predicates.push(restrictionSubjectSql(
      "participating_company",
      [filters.companyEntityId, ...(companyEntityVersionIds ?? [])],
      false
    ));
  }
  if (filters?.counterpartyId) {
    predicates.push(restrictionSubjectSql(
      "counterparty",
      [filters.counterpartyId],
      true
    ));
  }
  return predicates.length ? Prisma.join(predicates, " AND ") : Prisma.sql`TRUE`;
}

function restrictionPreflightFactFilterSql(
  filters: ProjectionFilters | undefined,
  constructionEnterpriseSubjectIds: string[] | undefined,
  companyEntityVersionIds: string[] | undefined
): Prisma.Sql {
  const predicates: Prisma.Sql[] = [];
  if (filters?.constructionEnterpriseId) {
    predicates.push(restrictionFactSubjectSql(
      "construction_enterprise",
      [filters.constructionEnterpriseId, ...(constructionEnterpriseSubjectIds ?? [])],
      false
    ));
  }
  if (filters?.companyEntityId) {
    predicates.push(restrictionFactSubjectSql(
      "participating_company",
      [filters.companyEntityId, ...(companyEntityVersionIds ?? [])],
      false
    ));
  }
  if (filters?.counterpartyId) {
    predicates.push(restrictionFactSubjectSql(
      "counterparty",
      [filters.counterpartyId],
      true
    ));
  }
  return predicates.length ? Prisma.join(predicates, " AND ") : Prisma.sql`TRUE`;
}

function restrictionSubjectSql(
  kind: string,
  rawIds: string[],
  includeCounterpartyAliases: boolean
): Prisma.Sql {
  const ids = Array.from(new Set(rawIds.filter(Boolean)));
  if (!ids.length) return Prisma.sql`FALSE`;
  const kinds = includeCounterpartyAliases
    ? ["counterparty", "downstream_counterparty", "owner"]
    : [kind];
  const impactMatch = Prisma.sql`
    impact."subjectKind" IN (${Prisma.join(kinds)})
    AND impact."subjectId" IN (${Prisma.join(ids)})
  `;
  const directFactMatch = Prisma.sql`
    (fact."debtorSubjectKind" IN (${Prisma.join(kinds)}) AND fact."debtorSubjectId" IN (${Prisma.join(ids)})) OR
    (fact."creditorSubjectKind" IN (${Prisma.join(kinds)}) AND fact."creditorSubjectId" IN (${Prisma.join(ids)})) OR
    (fact."approvedPayerSubjectKind" IN (${Prisma.join(kinds)}) AND fact."approvedPayerSubjectId" IN (${Prisma.join(ids)})) OR
    (fact."actualPayerSubjectKind" IN (${Prisma.join(kinds)}) AND fact."actualPayerSubjectId" IN (${Prisma.join(ids)})) OR
    (fact."payeeSubjectKind" IN (${Prisma.join(kinds)}) AND fact."payeeSubjectId" IN (${Prisma.join(ids)})) OR
    (fact."costBearingCompanySubjectKind" IN (${Prisma.join(kinds)}) AND fact."costBearingCompanySubjectId" IN (${Prisma.join(ids)}))
  `;
  const frozenSubjectMatch = Prisma.sql`
    EXISTS (
      SELECT 1
      FROM jsonb_each(
        CASE WHEN jsonb_typeof(fact."subjectSnapshot") = 'object'
          THEN fact."subjectSnapshot" ELSE '{}'::jsonb END
      ) AS frozen_subject
      WHERE frozen_subject.value ->> 'kind' IN (${Prisma.join(kinds)})
        AND (
          frozen_subject.value ->> 'id' IN (${Prisma.join(ids)}) OR
          frozen_subject.value ->> 'businessPartyId' IN (${Prisma.join(ids)}) OR
          frozen_subject.value ->> 'businessPartyVersionId' IN (${Prisma.join(ids)}) OR
          frozen_subject.value ->> 'companyEntityId' IN (${Prisma.join(ids)}) OR
          frozen_subject.value ->> 'companyEntityVersionId' IN (${Prisma.join(ids)})
        )
    )
  `;
  const constructionEnterpriseMatch = kind === "construction_enterprise"
    ? Prisma.sql`OR fact."affiliateBusinessPartyVersionId" IN (${Prisma.join(ids)})`
    : Prisma.empty;
  const frozenCounterpartyMatch = includeCounterpartyAliases
    ? Prisma.sql`OR (
        fact."sourceType" = 'project_fund_dispute_entry'
        AND fact."sourceSnapshot" ->> 'schema' = 'project_fund_dispute_entry/V1'
        AND fact."sourceSnapshot" ->> 'entryId' = fact."sourceBusinessId"
        AND fact."sourceSnapshot" ->> 'counterpartyId' IN (${Prisma.join(ids)})
      )`
    : Prisma.empty;
  const fallbackGuard = includeCounterpartyAliases
    ? Prisma.sql`TRUE`
    : Prisma.sql`impact."subjectKind" IS NULL AND impact."subjectId" IS NULL`;
  return Prisma.sql`(
    (${impactMatch}) OR (
      ${fallbackGuard} AND (
        ${directFactMatch} OR ${frozenSubjectMatch}
        ${constructionEnterpriseMatch}
        ${frozenCounterpartyMatch}
      )
    )
  )`;
}

function restrictionFactSubjectSql(
  kind: string,
  rawIds: string[],
  includeCounterpartyAliases: boolean
): Prisma.Sql {
  const ids = Array.from(new Set(rawIds.filter(Boolean)));
  if (!ids.length) return Prisma.sql`FALSE`;
  const kinds = includeCounterpartyAliases
    ? ["counterparty", "downstream_counterparty", "owner"]
    : [kind];
  const directFactMatch = Prisma.sql`
    (fact."debtorSubjectKind" IN (${Prisma.join(kinds)}) AND fact."debtorSubjectId" IN (${Prisma.join(ids)})) OR
    (fact."creditorSubjectKind" IN (${Prisma.join(kinds)}) AND fact."creditorSubjectId" IN (${Prisma.join(ids)})) OR
    (fact."approvedPayerSubjectKind" IN (${Prisma.join(kinds)}) AND fact."approvedPayerSubjectId" IN (${Prisma.join(ids)})) OR
    (fact."actualPayerSubjectKind" IN (${Prisma.join(kinds)}) AND fact."actualPayerSubjectId" IN (${Prisma.join(ids)})) OR
    (fact."payeeSubjectKind" IN (${Prisma.join(kinds)}) AND fact."payeeSubjectId" IN (${Prisma.join(ids)})) OR
    (fact."costBearingCompanySubjectKind" IN (${Prisma.join(kinds)}) AND fact."costBearingCompanySubjectId" IN (${Prisma.join(ids)}))
  `;
  const frozenSubjectMatch = Prisma.sql`
    EXISTS (
      SELECT 1
      FROM jsonb_each(
        CASE WHEN jsonb_typeof(fact."subjectSnapshot") = 'object'
          THEN fact."subjectSnapshot" ELSE '{}'::jsonb END
      ) AS frozen_subject
      WHERE frozen_subject.value ->> 'kind' IN (${Prisma.join(kinds)})
        AND (
          frozen_subject.value ->> 'id' IN (${Prisma.join(ids)}) OR
          frozen_subject.value ->> 'businessPartyId' IN (${Prisma.join(ids)}) OR
          frozen_subject.value ->> 'businessPartyVersionId' IN (${Prisma.join(ids)}) OR
          frozen_subject.value ->> 'companyEntityId' IN (${Prisma.join(ids)}) OR
          frozen_subject.value ->> 'companyEntityVersionId' IN (${Prisma.join(ids)})
        )
    )
  `;
  const constructionEnterpriseMatch = kind === "construction_enterprise"
    ? Prisma.sql`OR fact."affiliateBusinessPartyVersionId" IN (${Prisma.join(ids)})`
    : Prisma.empty;
  const frozenCounterpartyMatch = includeCounterpartyAliases
    ? Prisma.sql`OR (
        fact."sourceType" = 'project_fund_dispute_entry'
        AND fact."sourceSnapshot" ->> 'schema' = 'project_fund_dispute_entry/V1'
        AND fact."sourceSnapshot" ->> 'entryId' = fact."sourceBusinessId"
        AND fact."sourceSnapshot" ->> 'counterpartyId' IN (${Prisma.join(ids)})
      )`
    : Prisma.empty;
  return Prisma.sql`(
    ${directFactMatch} OR ${frozenSubjectMatch}
    ${constructionEnterpriseMatch}
    ${frozenCounterpartyMatch}
  )`;
}

async function preflightDetailSnapshotPageResources(
  tx: Prisma.TransactionClient,
  context: ProjectionReadContext,
  after: Extract<OperatingProjectionCursorPosition, { phase: "facts" }> | null
): Promise<void> {
  if (!context.scope.projectIds.length) return;
  const afterSql = after
    ? Prisma.sql`AND (
        fact."occurredAt" < ${new Date(after.occurredAt)} OR
        (fact."occurredAt" = ${new Date(after.occurredAt)} AND impact.id > ${after.impactId})
      )`
    : Prisma.empty;
  const result = (await tx.$queryRaw<Array<{ snapshotBytes: bigint }>>(Prisma.sql`
    SELECT COALESCE(SUM(candidate."snapshotBytes"), 0)::bigint AS "snapshotBytes"
    FROM (
      SELECT
        COALESCE(octet_length(fact."sourceSnapshot"::text), 0) +
        COALESCE(octet_length(fact."subjectSnapshot"::text), 0) AS "snapshotBytes"
      FROM "OperatingImpactEntry" impact
      INNER JOIN "OperatingFact" fact ON fact.id = impact."factId"
      WHERE impact."createdAt" <= ${context.readAt}
        AND fact."projectId" IN (${Prisma.join(context.scope.projectIds)})
        AND fact.status = 'confirmed'
        AND fact."occurredAt" <= ${context.cutoffAt}
        AND fact."confirmedAt" <= ${context.readAt}
        AND fact."createdAt" <= ${context.readAt}
        ${afterSql}
      ORDER BY fact."occurredAt" DESC, impact.id ASC
      LIMIT ${DETAIL_IMPACT_SCAN_BATCH_SIZE}
    ) candidate
  `))[0];
  if ((result?.snapshotBytes ?? 0n) > BigInt(MAX_DETAIL_SCAN_SNAPSHOT_BYTES)) {
    throw new ProjectionResourceBudgetExceededError();
  }
}

async function readFactDetailPageInTransaction(
  tx: Prisma.TransactionClient,
  context: ProjectionReadContext,
  position: Extract<OperatingProjectionCursorPosition, { phase: "facts" }> | null,
  pageSize: number,
  includeExportMetadata = false
): Promise<{ items: Array<Record<string, unknown>>; nextPosition: OperatingProjectionCursorPosition | null }> {
  const items: Array<Record<string, unknown>> = [];
  const needsSubjectSnapshots = includeExportMetadata || Boolean(
    context.scope.filters?.constructionEnterpriseId ||
      context.scope.filters?.companyEntityId ||
      context.scope.filters?.counterpartyId
  );
  let after = position;
  for (;;) {
    if (needsSubjectSnapshots) {
      await preflightDetailSnapshotPageResources(tx, context, after);
    }
    const rows = await tx.operatingImpactEntry.findMany({
      where: {
        createdAt: { lte: context.readAt },
        fact: {
          projectId: { in: context.scope.projectIds },
          status: "confirmed",
          occurredAt: { lte: context.cutoffAt },
          confirmedAt: { lte: context.readAt },
          createdAt: { lte: context.readAt }
        },
        ...(after ? {
          OR: [
            { fact: { occurredAt: { lt: new Date(after.occurredAt) } } },
            {
              fact: { occurredAt: new Date(after.occurredAt) },
              id: { gt: after.impactId }
            }
          ]
        } : {})
      },
      select: {
        id: true,
        impactKind: true,
        amountCents: true,
        direction: true,
        subjectKind: true,
        subjectId: true,
        costCategoryCode: true,
        fundPurpose: true,
        fact: {
          select: {
            id: true,
            projectId: true,
            sourceType: true,
            sourceBusinessId: true,
            sourceVersion: true,
            sourceBusinessCode: true,
            occurredAt: true,
            confirmedAt: true,
            affiliateBusinessPartyVersionId: true,
            affiliateNameSnapshot: true,
            factKind: true,
            operatingLevel: true,
            evidenceLevel: true,
            amountCents: true,
            direction: true,
            entryKind: true,
            adjustsFactId: true,
            debtorSubjectKind: true,
            debtorSubjectId: true,
            creditorSubjectKind: true,
            creditorSubjectId: true,
            approvedPayerSubjectKind: true,
            approvedPayerSubjectId: true,
            actualPayerSubjectKind: true,
            actualPayerSubjectId: true,
            payeeSubjectKind: true,
            payeeSubjectId: true,
            costBearingCompanySubjectKind: true,
            costBearingCompanySubjectId: true,
            ...(needsSubjectSnapshots
              ? { sourceSnapshot: true, subjectSnapshot: true }
              : {})
          }
        }
      },
      orderBy: [{ fact: { occurredAt: "desc" } }, { id: "asc" }],
      take: DETAIL_IMPACT_SCAN_BATCH_SIZE
    });
    if (!rows.length) break;
    for (const row of rows) {
      const fact = projectionFactFromDetailStored(
        row.fact,
        context.projectById
      );
      const impact = projectionImpactFromDetailStored(row);
      after = {
        phase: "facts",
        occurredAt: fact.occurredAt,
        impactId: impact.id
      };
      if (!projectionFactMatchesFilters(
        fact,
        impact,
        context.scope.filters,
        context.constructionEnterpriseSubjectIds,
        context.companyEntityVersionIds
      )) continue;
      if (items.length === pageSize) {
        const lastReturned = items.at(-1) as Record<string, unknown> & {
          _cursor?: { occurredAt: string; impactId: string };
        };
        const nextPosition = lastReturned._cursor;
        for (const item of items) delete item._cursor;
        return {
          items,
          nextPosition: nextPosition
            ? { phase: "facts", ...nextPosition }
            : { phase: "risks" }
        };
      }
      const publicDetail = toOperatingProjectionPublicDetail(
        fact,
        impact,
        context.cutoffAt.toISOString()
      );
      items.push({
        ...publicDetail,
        ...(includeExportMetadata ? {
          _export: {
            sourceType: fact.sourceType,
            factKind: fact.factKind,
            impactKind: impact.impactKind,
            factAmountCents: fact.amountCents.toString(),
            subjectLabels: exportSubjectDisplayLabels(row.fact.subjectSnapshot)
          } satisfies ProjectionExportMetadata
        } : {}),
        _cursor: { occurredAt: fact.occurredAt, impactId: impact.id }
      });
    }
    if (rows.length < DETAIL_IMPACT_SCAN_BATCH_SIZE) break;
  }
  for (const item of items) delete item._cursor;
  return {
    items,
    nextPosition: riskFiltersEligible(context.scope.filters)
      ? { phase: "risks" }
      : null
  };
}

function riskFiltersEligible(filters: ProjectionFilters | undefined): boolean {
  return !(
    (filters?.sourceType && filters.sourceType !== CLEARING_SOURCE_TYPE) ||
    (filters?.costCategoryCode && filters.costCategoryCode !== CLEARING_COST_CATEGORY_CODE) ||
    filters?.companyEntityId ||
    filters?.counterpartyId
  );
}

function publicRiskDetailRows(
  projectId: string,
  project: { code: string; name: string } | undefined,
  risk: Pick<ProjectionRiskInput,
    "relationshipCompleteness" |
    "openPendingGrossCents" |
    "openCoveredCents" |
    "openUncoveredCents" |
    "continuedWithheldRetainedCents" |
    "coveredWithheldSources" |
    "items">,
  includeExportMetadata = false
): Array<Record<string, unknown>> {
  const summary = summarizeRisk(projectId, risk);
  const moneyKnown = summary.breakdownConsistent &&
    !["legacy_unmodeled", "integrity_conflict"].includes(risk.relationshipCompleteness) &&
    risk.openPendingGrossCents !== null &&
    risk.openCoveredCents !== null &&
    risk.openUncoveredCents !== null &&
    risk.continuedWithheldRetainedCents !== null;
  if (!moneyKnown) return [];
  const base = {
    projectCode: project?.code ?? "未知项目",
    projectName: project?.name ?? "未知项目",
    sourceTypeLabel: "施工企业清分",
    factKindLabel: "待核对关系",
    evidenceLevel: null,
    occurredAt: null,
    confirmedAt: null,
    confirmedAfterAsOf: false,
    directionLabel: "限制",
    costCategoryCode: CLEARING_COST_CATEGORY_CODE,
    fundPurpose: null
  };
  return [
    ...risk.items.map((item) => ({
      ...base,
      sourceBusinessCode: "待核对清分风险",
      impactKindLabel: "待核对未结金额",
      signedImpactCents: item.openAmountCents.toString(),
      reconciliationRisk: {
        openPendingGrossCents: item.openAmountCents.toString(),
        openCoveredCents: item.openCoveredCents.toString(),
        openUncoveredCents: item.openUncoveredCents.toString(),
        continuedWithheldRetainedCents: "0",
        statusLabel: riskStatusLabel(item.status)
      },
      ...(includeExportMetadata ? {
        _export: {
          sourceType: CLEARING_SOURCE_TYPE,
          factKind: "clearing_reconciliation_risk",
          impactKind: "clearing_open_reconciliation_risk",
          factAmountCents: item.openAmountCents.toString(),
          subjectLabels: []
        } satisfies ProjectionExportMetadata
      } : {})
    })),
    ...risk.coveredWithheldSources
      .filter((source) => source.continuedRetainedCents > 0n)
      .map((source) => ({
        ...base,
        sourceBusinessCode: "继续暂扣风险",
        impactKindLabel: "继续暂扣保留金额",
        signedImpactCents: source.continuedRetainedCents.toString(),
        reconciliationRisk: {
          openPendingGrossCents: null,
          openCoveredCents: source.openCoveredCents.toString(),
          openUncoveredCents: null,
          continuedWithheldRetainedCents: source.continuedRetainedCents.toString(),
          statusLabel: "继续暂扣"
        },
        ...(includeExportMetadata ? {
          _export: {
            sourceType: CLEARING_SOURCE_TYPE,
            factKind: "clearing_reconciliation_risk",
            impactKind: "clearing_continued_withheld_risk",
            factAmountCents: source.continuedRetainedCents.toString(),
            subjectLabels: []
          } satisfies ProjectionExportMetadata
        } : {})
      }))
  ];
}

function riskStatusLabel(value: ProjectionRiskInput["items"][number]["status"]): string {
  if (value === "open") return "待核对";
  if (value === "partially_resolved") return "部分已核定";
  if (value === "resolved") return "已核定";
  return "定义反向待纠正";
}
async function readOperatingFactsInBatches(
  tx: Prisma.TransactionClient,
  projectIds: string[],
  cutoffAt: Date,
  readAt: Date,
  consumer: {
    startFacts: (facts: StoredOperatingFact[]) => void;
    addImpacts: (impacts: StoredOperatingImpact[]) => void;
    finishFacts: () => void;
  }
): Promise<void> {
  for (const projectBatch of batches(projectIds, PROJECT_QUERY_BATCH_SIZE)) {
    let cursorId: string | undefined;
    for (;;) {
      const page = await tx.operatingFact.findMany({
        where: {
          projectId: { in: projectBatch },
          status: "confirmed",
          occurredAt: { lte: cutoffAt },
          confirmedAt: { lte: readAt },
          createdAt: { lte: readAt }
        },
        orderBy: { id: "asc" },
        take: OPERATING_FACT_BATCH_SIZE,
        ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {})
      });
      if (page.length === 0) break;
      consumer.startFacts(page);
      for (const factBatch of batches(page.map((fact) => fact.id), DATABASE_IN_BATCH_SIZE)) {
        let impactCursorId: string | undefined;
        for (;;) {
          const impacts = await tx.operatingImpactEntry.findMany({
            where: { factId: { in: factBatch }, createdAt: { lte: readAt } },
            orderBy: { id: "asc" },
            take: OPERATING_IMPACT_BATCH_SIZE,
            ...(impactCursorId ? { cursor: { id: impactCursorId }, skip: 1 } : {})
          });
          consumer.addImpacts(impacts);
          if (impacts.length < OPERATING_IMPACT_BATCH_SIZE) break;
          impactCursorId = impacts.at(-1)!.id;
        }
      }
      consumer.finishFacts();
      if (page.length < OPERATING_FACT_BATCH_SIZE) break;
      cursorId = page.at(-1)!.id;
    }
  }
}

function projectionFactFromStored(
  fact: ProjectionStoredFact,
  projectById: Map<string, { id: string; code: string; name: string }>,
  impacts: StoredOperatingImpact[] = []
): ProjectionFactInput {
  const project = projectById.get(fact.projectId);
  return {
    id: fact.id,
    projectId: fact.projectId,
    projectCode: project?.code ?? "未知项目",
    projectName: project?.name ?? "未知项目",
    sourceType: fact.sourceType,
    sourceBusinessId: fact.sourceBusinessId,
    sourceVersion: fact.sourceVersion,
    sourceBusinessCode: fact.sourceBusinessCode,
    occurredAt: fact.occurredAt.toISOString(),
    confirmedAt: fact.confirmedAt.toISOString(),
    affiliateBusinessPartyVersionId: fact.affiliateBusinessPartyVersionId,
    affiliateNameSnapshot: fact.affiliateNameSnapshot,
    factKind: fact.factKind,
    operatingLevel: fact.operatingLevel,
    evidenceLevel: fact.evidenceLevel,
    amountCents: fact.amountCents,
    direction: fact.direction,
    sourceSnapshot: fact.sourceSnapshot,
    entryKind: fact.entryKind,
    adjustsFactId: fact.adjustsFactId,
    subjectReferences: projectionFactSubjectReferences(fact),
    impacts: impacts.map(projectionImpactFromStored)
  };
}

function projectionFactFromDetailStored(
  fact: DetailStoredFact,
  projectById: Map<string, { id: string; code: string; name: string }>
): ProjectionFactInput {
  return projectionFactFromStored({
    ...fact,
    sourceSnapshot: fact.sourceSnapshot ?? {},
    subjectSnapshot: fact.subjectSnapshot ?? {}
  }, projectById);
}

function projectionReplacementTargetFromStored(
  fact: StoredOperatingFact,
  impacts: StoredOperatingImpact[]
): ProjectionFactInput {
  return {
    id: fact.id,
    projectId: fact.projectId,
    projectCode: "",
    projectName: "",
    sourceType: fact.sourceType,
    sourceBusinessId: fact.sourceBusinessId,
    sourceVersion: fact.sourceVersion,
    sourceBusinessCode: "",
    occurredAt: fact.occurredAt.toISOString(),
    confirmedAt: fact.confirmedAt.toISOString(),
    affiliateBusinessPartyVersionId: "",
    affiliateNameSnapshot: "",
    factKind: fact.factKind,
    operatingLevel: fact.operatingLevel,
    evidenceLevel: fact.evidenceLevel,
    amountCents: fact.amountCents,
    direction: fact.direction,
    sourceSnapshot: {},
    entryKind: fact.entryKind,
    adjustsFactId: fact.adjustsFactId,
    impacts: impacts.map((impact) => ({
      id: impact.id,
      impactKind: impact.impactKind,
      amountCents: impact.amountCents,
      direction: impact.direction
    }))
  };
}

function projectionImpactFromStored(
  impact: StoredOperatingImpact
): ProjectionFactInput["impacts"][number] {
  return {
    id: impact.id,
    impactKind: impact.impactKind,
    amountCents: impact.amountCents,
    direction: impact.direction,
    subjectRole: impact.subjectRole,
    subjectKind: impact.subjectKind,
    subjectId: impact.subjectId,
    costCategoryCode: impact.costCategoryCode,
    fundPurpose: impact.fundPurpose,
    description: impact.description,
    impactSnapshot: impact.impactSnapshot
  };
}

function projectionImpactFromDetailStored(
  impact: DetailStoredImpact
): ProjectionFactInput["impacts"][number] {
  return {
    id: impact.id,
    impactKind: impact.impactKind,
    amountCents: impact.amountCents,
    direction: impact.direction,
    subjectKind: impact.subjectKind,
    subjectId: impact.subjectId,
    costCategoryCode: impact.costCategoryCode,
    fundPurpose: impact.fundPurpose
  };
}

function batches<T>(values: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

async function collectInBatches<T, R>(
  values: readonly T[],
  size: number,
  read: (batch: T[]) => Promise<R[]>
): Promise<R[]> {
  const result: R[] = [];
  for (const batch of batches(values, size)) result.push(...await read(batch));
  return result;
}

async function collectInBatchesWithBudget<T, R>(
  values: readonly T[],
  size: number,
  maxRows: number,
  read: (batch: T[], remaining: number) => Promise<R[]>
): Promise<R[]> {
  const result: R[] = [];
  for (const batch of batches(values, size)) {
    const remaining = maxRows - result.length;
    const rows = await read(batch, remaining);
    if (rows.length > remaining) throw new ProjectionResourceBudgetExceededError();
    result.push(...rows);
  }
  return result;
}

export class OperatingProjectionReadLimiter {
  private readonly states = new Map<string, {
    active: number;
    startedAt: number[];
  }>();

  constructor(
    private readonly maxConcurrent = MAX_CONCURRENT_READS_PER_ACTOR,
    private readonly maxPerMinute = MAX_READS_PER_ACTOR_PER_MINUTE
  ) {}

  acquire(actorUserId: string, now = Date.now()): () => void {
    const cutoff = now - 60_000;
    let state = this.states.get(actorUserId);
    if (!state) {
      if (this.states.size >= 10_000) {
        for (const [userId, candidate] of this.states) {
          if (candidate.active === 0 && (candidate.startedAt.at(-1) ?? 0) <= cutoff) {
            this.states.delete(userId);
          }
        }
      }
      if (this.states.size >= 10_000) {
        throw new HttpException("经营投影读取繁忙，请稍后重试", 429);
      }
      state = { active: 0, startedAt: [] };
      this.states.set(actorUserId, state);
    }
    state.startedAt = state.startedAt.filter((startedAt) => startedAt > cutoff);
    if (state.active >= this.maxConcurrent || state.startedAt.length >= this.maxPerMinute) {
      throw new HttpException("经营投影读取过于频繁，请稍后重试", 429);
    }
    state.active += 1;
    state.startedAt.push(now);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      state!.active = Math.max(0, state!.active - 1);
    };
  }
}

function zeroClearingRisk(projectId: string): ProjectionRiskInput {
  return {
    projectId,
    relationshipCompleteness: "complete",
    openPendingGrossCents: 0n,
    openCoveredCents: 0n,
    openUncoveredCents: 0n,
    continuedWithheldRetainedCents: 0n,
    coveredWithheldSources: [],
    items: [],
    breakdownConsistent: true,
    riskItemCount: 0,
    riskItemGrossCents: 0n,
    retainedSourceCount: 0,
    retainedSourceCents: 0n
  };
}

function summarizeRisk(
  projectId: string,
  risk: Pick<ProjectionRiskInput,
    "relationshipCompleteness" |
    "openPendingGrossCents" |
    "openCoveredCents" |
    "openUncoveredCents" |
    "continuedWithheldRetainedCents" |
    "coveredWithheldSources" |
    "items">
): ProjectionRiskInput {
  const items = risk.items ?? [];
  const sources = risk.coveredWithheldSources ?? [];
  const itemTotals = items.reduce((totals, item) => ({
    gross: totals.gross + item.openAmountCents,
    covered: totals.covered + item.openCoveredCents,
    uncovered: totals.uncovered + item.openUncoveredCents,
    consistent: totals.consistent &&
      item.openAmountCents === item.openCoveredCents + item.openUncoveredCents
  }), { gross: 0n, covered: 0n, uncovered: 0n, consistent: true });
  const sourceCovered = sources.reduce((sum, source) => sum + source.openCoveredCents, 0n);
  const retained = sources.reduce((sum, source) => sum + source.continuedRetainedCents, 0n);
  const valuesKnown = risk.openPendingGrossCents !== null &&
    risk.openCoveredCents !== null &&
    risk.openUncoveredCents !== null &&
    risk.continuedWithheldRetainedCents !== null;
  const breakdownConsistent = valuesKnown
    ? itemTotals.consistent &&
      itemTotals.gross === risk.openPendingGrossCents &&
      itemTotals.covered === risk.openCoveredCents &&
      itemTotals.uncovered === risk.openUncoveredCents &&
      sourceCovered === risk.openCoveredCents &&
      retained === risk.continuedWithheldRetainedCents
    : items.length === 0 && sources.length === 0;
  const retainedSources = sources.filter((source) => source.continuedRetainedCents > 0n);
  return {
    projectId,
    relationshipCompleteness: risk.relationshipCompleteness,
    openPendingGrossCents: risk.openPendingGrossCents,
    openCoveredCents: risk.openCoveredCents,
    openUncoveredCents: risk.openUncoveredCents,
    continuedWithheldRetainedCents: risk.continuedWithheldRetainedCents,
    coveredWithheldSources: [],
    items: [],
    breakdownConsistent,
    riskItemCount: items.length,
    riskItemGrossCents: itemTotals.gross,
    retainedSourceCount: retainedSources.length,
    retainedSourceCents: retainedSources.reduce(
      (sum, source) => sum + source.continuedRetainedCents,
      0n
    )
  };
}

function mergeRiskSummary(
  left: ProjectionRiskInput,
  right: ProjectionRiskInput
): ProjectionRiskInput {
  const sumNullable = (a: bigint | null, b: bigint | null) =>
    a === null || b === null ? null : a + b;
  return {
    projectId: left.projectId,
    relationshipCompleteness: mergeRiskCompleteness(
      left.relationshipCompleteness,
      right.relationshipCompleteness
    ),
    openPendingGrossCents: sumNullable(
      left.openPendingGrossCents,
      right.openPendingGrossCents
    ),
    openCoveredCents: sumNullable(left.openCoveredCents, right.openCoveredCents),
    openUncoveredCents: sumNullable(left.openUncoveredCents, right.openUncoveredCents),
    continuedWithheldRetainedCents: sumNullable(
      left.continuedWithheldRetainedCents,
      right.continuedWithheldRetainedCents
    ),
    coveredWithheldSources: [],
    items: [],
    breakdownConsistent: (left.breakdownConsistent ?? false) &&
      (right.breakdownConsistent ?? false),
    riskItemCount: (left.riskItemCount ?? 0) + (right.riskItemCount ?? 0),
    riskItemGrossCents: (left.riskItemGrossCents ?? 0n) +
      (right.riskItemGrossCents ?? 0n),
    retainedSourceCount: (left.retainedSourceCount ?? 0) +
      (right.retainedSourceCount ?? 0),
    retainedSourceCents: (left.retainedSourceCents ?? 0n) +
      (right.retainedSourceCents ?? 0n)
  };
}

function mergeRiskCompleteness(
  left: ProjectionRiskInput["relationshipCompleteness"],
  right: ProjectionRiskInput["relationshipCompleteness"]
): ProjectionRiskInput["relationshipCompleteness"] {
  const order = ["complete", "coverage_incomplete", "legacy_unmodeled", "integrity_conflict"] as const;
  return order[Math.max(order.indexOf(left), order.indexOf(right))]!;
}

function canonicalAffiliateAssignments(assignments: Array<{
  id: string;
  projectId: string;
  businessPartyId: string;
  businessPartyVersionId: string;
  affiliateNameSnapshot?: string;
  affiliateCreditCodeSnapshot?: string | null;
  effectiveFrom?: Date;
  endedAt?: Date | null;
  createdAt?: Date;
}>) {
  return assignments.map((assignment) => ({
    ...assignment,
    effectiveFrom: dateFingerprintCoordinate(assignment.effectiveFrom),
    endedAt: dateFingerprintCoordinate(assignment.endedAt),
    createdAt: dateFingerprintCoordinate(assignment.createdAt)
  })).sort((left, right) => left.id.localeCompare(right.id));
}

function dateFingerprintCoordinate(value: Date | null | undefined): string | null {
  return value instanceof Date ? value.toISOString() : null;
}

function normalizeAsOfProjectionDetailQuery(
  input: AsOfProjectionDetailQuery
): AsOfProjectionQuery {
  if (!["project", "company", "projects"].includes(input.scopeKind)) {
    throw new BadRequestException("经营投影范围必须是单项目、公司或多项目");
  }
  const projectIds = Array.isArray(input.projectIds)
    ? input.projectIds
    : input.projectIds
      ?.split(",")
      .map((value) => value.trim())
      .filter(Boolean);
  return {
    ...input,
    scopeKind: input.scopeKind as AsOfProjectionQuery["scopeKind"],
    projectIds
  };
}

function projectionDetailPageSize(value: number | string | undefined): number {
  if (typeof value === "string" && !/^(?:[1-9]|[1-9]\d|1\d\d|200)$/.test(value)) {
    throw new BadRequestException("经营投影明细每页条数必须是 1 到 200 的十进制整数");
  }
  const pageSize = value === undefined ? 50 : Number(value);
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 200) {
    throw new BadRequestException("经营投影明细每页条数必须是 1 到 200 的整数");
  }
  return pageSize;
}

function asOfProjectionInput(
  actorUserId: string,
  input: AsOfProjectionQuery
): {
  actorUserId: string;
  scope: Omit<ProjectionScopeInput, "projectIds"> & { projectIds?: string[] };
  asOf?: string;
} {
  if (input.scopeKind === "project") {
    return {
      actorUserId,
      scope: {
        kind: "project",
        projectId: required(input.projectId, "项目标识不能为空"),
        filters: projectionFilters(input)
      },
      asOf: input.asOf
    };
  }
  if (input.scopeKind === "company") {
    const companyEntityId = required(input.companyEntityId, "公司主体标识不能为空");
    return {
      actorUserId,
      scope: {
        kind: "company",
        companyEntityId,
        filters: { ...projectionFilters(input), companyEntityId }
      },
      asOf: input.asOf
    };
  }
  return {
    actorUserId,
    scope: {
      kind: "projects",
      projectIds: input.projectIds,
      filters: projectionFilters(input)
    },
    asOf: input.asOf
  };
}

function projectionCursorRequestScope(
  scope: Omit<ProjectionScopeInput, "projectIds"> & { projectIds?: string[] }
): ProjectionScopeInput {
  return {
    ...scope,
    projectIds: scope.kind === "project"
      ? [required(scope.projectId, "项目标识不能为空")]
      : scope.kind === "projects"
        ? [...(scope.projectIds ?? [])].sort()
        : []
  };
}

function required(value: string | undefined, message: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new BadRequestException(message);
  return normalized;
}

function projectionFilters(input: ProjectionFilters): ProjectionFilters {
  return Object.fromEntries(Object.entries({
    constructionEnterpriseId: input.constructionEnterpriseId?.trim(),
    companyEntityId: input.companyEntityId?.trim(),
    counterpartyId: input.counterpartyId?.trim(),
    costCategoryCode: input.costCategoryCode?.trim(),
    sourceType: input.sourceType?.trim()
  }).filter(([, value]) => Boolean(value)));
}

export function normalizeProjectionExportFilters(
  input: OperatingProjectionExportFilters,
  businessDate: string
): OperatingProjectionExportFilters {
  const result: OperatingProjectionExportFilters = {};
  for (const key of ["occurredFrom", "occurredTo"] as const) {
    const value = input[key];
    if (value === undefined) continue;
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      throw new BadRequestException("导出期间必须是 YYYY-MM-DD 日期");
    }
    // Validate the calendar independently of the query cutoff (from-only may yield no rows).
    projectionCutoff(value, new Date("9999-12-31T23:59:59.999Z"));
    result[key] = value;
  }
  if (result.occurredFrom && result.occurredTo && result.occurredFrom > result.occurredTo) {
    throw new BadRequestException("导出期间起日不得晚于止日");
  }
  if (result.occurredTo && result.occurredTo > businessDate) {
    throw new BadRequestException("导出期间止日不得晚于查询基准日");
  }
  if (input.rowStatus !== undefined) {
    if (typeof input.rowStatus !== "string" || !OPERATING_PROJECTION_ROW_STATUSES.includes(input.rowStatus)) {
      throw new BadRequestException("导出业务状态无效");
    }
    result.rowStatus = input.rowStatus;
  }
  return result;
}

function projectionCutoff(value: string | undefined, readAt: Date): Date {
  if (value === undefined) return readAt;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new BadRequestException("经营投影日期必须是 YYYY-MM-DD");
  }
  const [year, month, day] = value.split("-").map(Number);
  const validation = new Date(Date.UTC(year!, month! - 1, day!));
  if (
    validation.getUTCFullYear() !== year ||
    validation.getUTCMonth() !== month! - 1 ||
    validation.getUTCDate() !== day
  ) {
    throw new BadRequestException("经营投影日期不是有效日历日期");
  }
  const parsed = new Date(`${value}T23:59:59.999+08:00`);
  if (parsed.getTime() > readAt.getTime()) {
    const readBusinessDate = new Date(readAt.getTime() + 8 * 60 * 60 * 1_000)
      .toISOString()
      .slice(0, 10);
    if (value === readBusinessDate) return readAt;
    throw new BadRequestException("经营投影日期不得晚于数据库读取时点");
  }
  return parsed;
}

function assertDetailResponseWithinBudget(response: unknown): void {
  if (Buffer.byteLength(JSON.stringify(response), "utf8") > MAX_DETAIL_RESPONSE_BYTES) {
    throw new PayloadTooLargeException("经营投影明细响应超出 8 MiB 安全预算，请缩小每页条数或筛选范围");
  }
}

export function projectionFactSubjectReferences(fact: {
  sourceType: string;
  sourceBusinessId: string;
  sourceSnapshot: unknown;
  debtorSubjectKind: string | null;
  debtorSubjectId: string | null;
  creditorSubjectKind: string | null;
  creditorSubjectId: string | null;
  approvedPayerSubjectKind: string | null;
  approvedPayerSubjectId: string | null;
  actualPayerSubjectKind: string | null;
  actualPayerSubjectId: string | null;
  payeeSubjectKind: string | null;
  payeeSubjectId: string | null;
  costBearingCompanySubjectKind: string | null;
  costBearingCompanySubjectId: string | null;
  subjectSnapshot: unknown;
}) {
  const values = [
    [fact.debtorSubjectKind, fact.debtorSubjectId],
    [fact.creditorSubjectKind, fact.creditorSubjectId],
    [fact.approvedPayerSubjectKind, fact.approvedPayerSubjectId],
    [fact.actualPayerSubjectKind, fact.actualPayerSubjectId],
    [fact.payeeSubjectKind, fact.payeeSubjectId],
    [fact.costBearingCompanySubjectKind, fact.costBearingCompanySubjectId]
  ];
  const direct = values
    .filter((value): value is [string, string] => Boolean(value[0] && value[1]))
    .map(([kind, id]) => ({ kind, id }));
  const snapshots = jsonRecord(fact.subjectSnapshot);
  const aliases = Object.values(snapshots).flatMap((value) => {
    const snapshot = jsonRecord(value);
    const kind = typeof snapshot.kind === "string" ? snapshot.kind : null;
    if (!kind) return [];
    return [
      snapshot.id,
      snapshot.businessPartyId,
      snapshot.businessPartyVersionId,
      snapshot.companyEntityId,
      snapshot.companyEntityVersionId
    ].flatMap((id) => typeof id === "string" && id ? [{ kind, id }] : []);
  });
  const source = jsonRecord(fact.sourceSnapshot);
  const frozenCounterparty = fact.sourceType === "project_fund_dispute_entry" &&
    source.schema === "project_fund_dispute_entry/V1" &&
    source.entryId === fact.sourceBusinessId &&
    typeof source.counterpartyId === "string" && source.counterpartyId
      ? [{ kind: "counterparty", id: source.counterpartyId }]
      : [];
  return Array.from(
    new Map([...direct, ...aliases, ...frozenCounterparty]
      .map((value) => [`${value.kind}\u0000${value.id}`, value])).values()
  );
}

function jsonRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function csvCell(value: string): string {
  const formulaSafe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${formulaSafe.replaceAll('"', '""')}"`;
}

const EXPORT_KIND_FILE_NAMES: Record<OperatingProjectionExportKind, string> = {
  project_operating_ledger_detail: "项目经营台账明细",
  construction_enterprise_funds_reconciliation: "施工企业资金核对",
  company_project_funds_subledger: "公司项目资金分户账",
  receivable_payable_cashflow_detail: "应收应付现金流明细",
  takeover_coverage_evidence_gap: "历史接管覆盖与证据缺口"
};


function projectionExportCsvRow(
  item: Record<string, unknown>,
  exportKind: OperatingProjectionExportKind,
  filters: OperatingProjectionExportFilters
): string[] | null {
  const metadata = jsonRecord(item._export) as Partial<ProjectionExportMetadata>;
  const sourceType = stringValue(metadata.sourceType);
  const factKind = stringValue(metadata.factKind);
  const impactKind = stringValue(metadata.impactKind);
  const evidenceLevel = stringValue(item.evidenceLevel);
  const matches = operatingProjectionExportMatches(exportKind, sourceType, factKind,
    impactKind, evidenceLevel);
  if (matches === null) {
    throw new ConflictException("经营投影存在未识别的来源或经营影响，已拒绝导出");
  }
  if (!matches) return null;
  const risk = jsonRecord(item.reconciliationRisk);
  const rowStatus = item.confirmedAfterAsOf === true ? "retroactive_confirmation"
    : risk.statusLabel ? "pending_reconciliation" : "confirmed";
  if (filters.rowStatus && filters.rowStatus !== rowStatus) return null;
  if (filters.occurredFrom || filters.occurredTo) {
    const occurredAt = nullableStringValue(item.occurredAt);
    if (!occurredAt) return null;
    const time = new Date(occurredAt).getTime();
    if (!Number.isFinite(time)) throw new ConflictException("经营事实日期无效，已拒绝导出");
    if (filters.occurredFrom && time < new Date(`${filters.occurredFrom}T00:00:00.000+08:00`).getTime()) return null;
    if (filters.occurredTo && time > new Date(`${filters.occurredTo}T23:59:59.999+08:00`).getTime()) return null;
  }
  const signedImpactCents = nullableStringValue(item.signedImpactCents);
  const factAmountCents = stringValue(metadata.factAmountCents);
  const amountCents = signedImpactCents ?? (evidenceLevel === "C" ? factAmountCents : null);
  const amountYuan = amountCents === null ? "不适用" : centsAsYuan(amountCents);
  const amountBasis = evidenceLevel === "C"
    ? "C级证据缺口"
    : impactKind === "estimated_clearing_expense"
      ? "预计金额"
      : "正式事实";
  const subjectLabels = Array.isArray(metadata.subjectLabels)
    ? metadata.subjectLabels.filter((value): value is string => typeof value === "string")
    : [];
  return [
    stringValue(item.projectCode),
    stringValue(item.projectName),
    stringValue(item.sourceTypeLabel),
    stringValue(item.sourceBusinessCode),
    stringValue(item.factKindLabel),
    evidenceLevel ?? "待核对",
    amountBasis,
    OPERATING_PROJECTION_ROW_STATUS_LABELS[rowStatus],
    nullableStringValue(item.occurredAt) ?? "",
    nullableStringValue(item.confirmedAt) ?? "",
    stringValue(item.impactKindLabel),
    stringValue(item.directionLabel),
    amountYuan,
    nullableStringValue(item.costCategoryCode) ?? "",
    nullableStringValue(item.fundPurpose) ?? "",
    subjectLabels.join("；"),
    nullableStringValue(risk.statusLabel) ?? "",
    ["operating_takeover", "contract_takeover_historical_payment"].includes(sourceType)
      ? "是"
      : "否"
  ];
}


function exportSubjectDisplayLabels(value: unknown): string[] {
  const roleLabels: Record<string, string> = {
    debtor: "债务主体",
    creditor: "债权主体",
    approvedPayer: "批准付款主体",
    actualPayer: "实际付款主体",
    payee: "收款主体",
    costBearingCompany: "成本承担公司",
    fundHolder: "资金持有主体"
  };
  const labels = Object.entries(jsonRecord(value)).flatMap(([role, snapshotValue]) => {
    const snapshot = jsonRecord(snapshotValue);
    const name = nullableStringValue(snapshot.name);
    return name ? [`${roleLabels[role] ?? "业务主体"}：${name}`] : [];
  });
  return Array.from(new Set(labels));
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function nullableStringValue(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

class BoundedProjectionCsvFile {
  private byteLength = 0;
  private handle: FileHandle | null;
  private disposed = false;

  private constructor(
    private readonly directory: string,
    private readonly path: string,
    handle: FileHandle
  ) {
    this.handle = handle;
  }

  static async create(headers: string[]): Promise<BoundedProjectionCsvFile> {
    const directory = await mkdtemp(join(tmpdir(), "jiangkong-pol108-export-"));
    const path = join(directory, "projection.csv");
    try {
      const handle = await open(path, "wx", 0o600);
      const file = new BoundedProjectionCsvFile(directory, path, handle);
      await file.writeChunk(`\uFEFF${headers.map(csvCell).join(",")}\n`);
      return file;
    } catch (error) {
      await rm(directory, { recursive: true, force: true });
      throw error;
    }
  }

  async writeRow(row: string[]): Promise<void> {
    await this.writeChunk(`${row.map(csvCell).join(",")}\n`);
  }

  async openReadStream() {
    if (!this.handle || this.disposed) throw new Error("经营投影导出临时文件不可用");
    await this.handle.sync();
    await this.handle.close();
    this.handle = null;
    const stream = createReadStream(this.path);
    let cleaned = false;
    const cleanup = async () => {
      if (cleaned) return;
      cleaned = true;
      this.disposed = true;
      await rm(this.directory, { recursive: true, force: true });
    };
    stream.once("close", () => void cleanup());
    stream.once("error", () => void cleanup());
    return stream;
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    if (this.handle) {
      await this.handle.close();
      this.handle = null;
    }
    await rm(this.directory, { recursive: true, force: true });
  }

  private async writeChunk(chunk: string): Promise<void> {
    if (!this.handle || this.disposed) throw new Error("经营投影导出临时文件不可用");
    const nextBytes = Buffer.byteLength(chunk, "utf8");
    if (this.byteLength + nextBytes > MAX_EXPORT_BYTES) {
      throw new PayloadTooLargeException("经营投影导出文件超出 8 MiB 安全预算，请收窄项目或筛选范围");
    }
    await this.handle.write(chunk);
    this.byteLength += nextBytes;
  }
}

function centsAsYuan(cents: string): string {
  if (!/^-?(?:0|[1-9]\d*)$/.test(cents)) {
    throw new ConflictException("经营投影存在无效金额，已拒绝导出");
  }
  const amount = BigInt(cents);
  const negative = amount < 0n;
  const absolute = negative ? -amount : amount;
  return `${negative ? "-" : ""}${absolute / 100n}.${(absolute % 100n).toString().padStart(2, "0")}`;
}
