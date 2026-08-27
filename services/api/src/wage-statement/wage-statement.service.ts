import { createHash, randomUUID } from "node:crypto";

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  canPerform,
  WAGE_COST_COMPONENT_CODES,
  WAGE_CREDITOR_CATEGORIES
} from "@jiangkong/shared-domain";

import { AuditService } from "../audit/audit.service";
import { CompanyRoleResolverService } from "../auth/company-role-resolver.service";
import { PrismaService } from "../database/prisma.service";
import {
  assertBalancedWageStatementDraft,
  type WagePersonLineInput
} from "./wage-statement.domain";
import type {
  ApprovedWagePersonDto,
  CreateApprovedWageSourceDto,
  CreateWageStatementDraftDto,
  ReturnWageStatementDto,
  WageStatementCommandDto
} from "./wage-statement.dto";

type Tx = Prisma.TransactionClient;

const SHA256 = /^[0-9a-f]{64}$/iu;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

// Aggregate reads select only category snapshots and allocation-row identifiers to
// derive counts. Employee identities, monetary values, attachments and source
// snapshots never enter these queries or their API projections.
const WAGE_AGGREGATE_SELECT = {
  id: true,
  employmentCompanyId: true,
  wageMonth: true,
  currentRevision: true,
  updatedAt: true,
  versions: {
    select: {
      revision: true,
      status: true,
      reviewDisposition: true,
      reviewReturnedAt: true,
      sourceVersion: { select: { externalReference: true, sourceVersion: true } },
      personLines: {
        select: {
          positionCategorySnapshot: true,
          projectAllocations: { select: { id: true } }
        }
      }
    }
  }
} satisfies Prisma.WageStatementSelect;

type WageAggregateStatement = Prisma.WageStatementGetPayload<{ select: typeof WAGE_AGGREGATE_SELECT }>;

@Injectable()
export class WageStatementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly companyRoles: CompanyRoleResolverService,
    private readonly audit: AuditService = new AuditService()
  ) {}

  async listWorkbench(actorUserId: string) {
    await this.assertReadAuthority(actorUserId);
    const statements = await this.prisma.wageStatement.findMany({
      select: WAGE_AGGREGATE_SELECT,
      orderBy: [{ wageMonth: "desc" }, { updatedAt: "desc" }, { id: "asc" }]
    });
    const companyNames = await this.companyNames(statements.map((statement) => statement.employmentCompanyId));
    return {
      capabilities: await this.capabilities(actorUserId),
      items: statements.map((statement) => {
        const aggregate = this.aggregate(statement, companyNames);
        return {
          statementId: statement.id,
          employmentCompanyName: aggregate.employmentCompanyName,
          wageMonth: statement.wageMonth,
          status: aggregate.status,
          statusLabel: aggregate.statusLabel,
          revision: statement.currentRevision,
          sourceLabel: aggregate.sourceLabel,
          personLineCount: aggregate.personLineCount,
          positionCategoryCount: aggregate.positionCategoryCount,
          projectAllocationCount: aggregate.projectAllocationCount,
          latestReviewReturn: aggregate.latestReviewReturn,
          updatedAt: statement.updatedAt.toISOString()
        };
      })
    };
  }

  async readSummary(actorUserId: string, statementId: string) {
    await this.assertReadAuthority(actorUserId);
    const statement = await this.aggregateStatement(statementId);
    const aggregate = this.aggregate(statement, await this.companyNames([statement.employmentCompanyId]));
    return {
      capabilities: await this.capabilities(actorUserId),
      employmentCompanyName: aggregate.employmentCompanyName,
      wageMonth: statement.wageMonth,
      statusLabel: aggregate.statusLabel,
      revision: statement.currentRevision,
      sourceLabel: aggregate.sourceLabel,
      personLineCount: aggregate.personLineCount,
      positionCategoryCount: aggregate.positionCategoryCount,
      projectAllocationCount: aggregate.projectAllocationCount,
      latestReviewReturn: aggregate.latestReviewReturn,
      categories: aggregate.categories
    };
  }

  async readImportPreview(actorUserId: string, statementId: string) {
    await this.assertReadAuthority(actorUserId);
    const statement = await this.aggregateStatement(statementId);
    const aggregate = this.aggregate(statement, await this.companyNames([statement.employmentCompanyId]));
    return {
      employmentCompanyName: aggregate.employmentCompanyName,
      wageMonth: statement.wageMonth,
      sourceLabel: aggregate.sourceLabel,
      sourceStatusLabel: "已冻结外部批准来源",
      personLineCount: aggregate.personLineCount,
      positionCategoryCount: aggregate.positionCategoryCount,
      projectAllocationCount: aggregate.projectAllocationCount
    };
  }

  async createApprovedSource(actorUserId: string, input: CreateApprovedWageSourceDto) {
    await this.assertPrepareAuthority(actorUserId);
    const normalized = normalizeApprovedSource(input);
    const fingerprintValue = sourceCommandFingerprint(normalized, actorUserId);
    return this.executeWithReceiptReplay(normalized.idempotencyKey, fingerprintValue, "approved_source", async () => this.serializable(async (tx) => {
      const replay = await this.replayApprovedSource(tx, normalized.idempotencyKey, fingerprintValue);
      if (replay) return replay;
      const [company, evidence, employees, projects] = await Promise.all([
        tx.companyEntity.findUnique({
          where: { id: normalized.employmentCompanyId, isActive: true },
          select: { id: true, name: true }
        }),
        tx.fileObject.findUnique({
          where: { id: normalized.evidenceFileId },
          select: { id: true, storageStatus: true, contentSha256: true }
        }),
        this.activeEmployees(tx, normalized.approvedPersonLines),
        this.activeProjects(tx, normalized.approvedPersonLines)
      ]);
      if (!company) throw new NotFoundException("承担工资的我方公司不存在或已停用");
      if (
        !evidence ||
        evidence.storageStatus !== "active" ||
        typeof evidence.contentSha256 !== "string" ||
        !SHA256.test(evidence.contentSha256)
      ) {
        throw new BadRequestException("外部批准工资资料不存在、不可用或缺少内容校验值");
      }
      employeeMap(normalized.approvedPersonLines, employees);
      projectMap(normalized.approvedPersonLines, projects);
      assertServiceEvidenceBound(normalized.approvedPersonLines, evidence.contentSha256);
      const sourceSnapshot = {
        employmentCompany: { id: company.id, name: company.name },
        wageMonth: normalized.wageMonth,
        periodStart: normalized.periodStart,
        periodEnd: normalized.periodEnd,
        externalReference: normalized.externalReference,
        sourceVersion: normalized.sourceVersion,
        basisDate: normalized.basisDate,
        evidence: { fileId: evidence.id, sha256: evidence.contentSha256 },
        // 外部批准资料本身是劳动关系、岗位、成本、债权和服务分摊的唯一权威载荷；
        // 系统只冻结其私有附件哈希和规范化的事实，不伪造独立 HR 主数据。
        approvedPersonLines: normalized.approvedPersonLines
      };
      const sourceFingerprint = fingerprint(sourceSnapshot);
      try {
        const created = await tx.wageApprovedSourceVersion.create({
          data: {
            employmentCompanyId: normalized.employmentCompanyId,
            wageMonth: normalized.wageMonth,
            periodStart: dateOnly(normalized.periodStart),
            periodEnd: dateOnly(normalized.periodEnd),
            sourceType: "external_approved_wage",
            externalReference: normalized.externalReference,
            sourceVersion: normalized.sourceVersion,
            basisDate: dateOnly(normalized.basisDate),
            evidenceFileId: evidence.id,
            evidenceSha256: evidence.contentSha256,
            sourceFingerprint,
            sourceSnapshot: jsonValue(sourceSnapshot),
            createdByUserId: actorUserId
          }
        });
        for (const binding of serviceBasisDefinitions(normalized.approvedPersonLines, evidence.contentSha256)) {
          await tx.wageServiceBasisBinding.create({
            data: {
              sourceVersionId: created.id,
              projectId: binding.projectId,
              serviceSnapshotId: binding.serviceSnapshotId,
              serviceMonth: binding.serviceMonth,
              evidenceSha256: binding.evidenceSha256,
              authorityFingerprint: fingerprint({
                sourceVersionId: created.id,
                projectId: binding.projectId,
                serviceSnapshotId: binding.serviceSnapshotId,
                serviceMonth: binding.serviceMonth,
                evidenceSha256: binding.evidenceSha256
              })
            }
          });
        }
        const result = { id: created.id };
        await this.approvedSourceReceipt(tx, normalized, "wage_statement.approved_source.create", created.id, fingerprintValue, actorUserId, result);
        await this.audit.record(tx, {
          actorUserId,
          action: "wage_statement.approved_source.create",
          businessType: "wage_approved_source",
          businessId: created.id,
          metadata: jsonValue({ employmentCompanyId: normalized.employmentCompanyId, wageMonth: normalized.wageMonth, sourceFingerprint })
        });
        return result;
      } catch (error) {
        if (prismaCode(error) === "P2002") throw new ConflictException("该我方公司的外部工资来源版本已存在");
        throw error;
      }
    }));
  }

  async createDraft(actorUserId: string, input: CreateWageStatementDraftDto) {
    await this.assertPrepareAuthority(actorUserId);
    validateDraftInput(input);
    assertBalancedWageStatementDraft(input);
    const fingerprintValue = commandFingerprint("wage_statement.draft.create", "new", input, actorUserId);
    return this.executeWithReceiptReplay(input.idempotencyKey, fingerprintValue, "statement", async () => this.serializable(async (tx) => {
      const replay = await this.replay(tx, input.idempotencyKey, fingerprintValue);
      if (replay) return replay;
      const source = await tx.wageApprovedSourceVersion.findUnique({
        where: { id: required(input.sourceVersionId, "外部批准工资来源不能为空") }
      });
      if (!source) throw new NotFoundException("外部批准工资来源不存在，请刷新后重试");
      if (source.wageMonth !== input.wageMonth) throw new BadRequestException("工资承担单月份必须与外部批准来源一致");
      const sourceLines = sourcePersonLines(source.sourceSnapshot);
      assertSourceFacts(input.personLines, sourceLines, source.employmentCompanyId, source.wageMonth, source.periodStart, source.periodEnd);
      const [company, evidence, employees, projects, serviceBasisBindings] = await Promise.all([
        tx.companyEntity.findUnique({
          where: { id: source.employmentCompanyId, isActive: true },
          select: { id: true }
        }),
        tx.fileObject.findUnique({
          where: { id: source.evidenceFileId },
          select: { id: true, storageStatus: true, contentSha256: true }
        }),
        this.activeEmployees(tx, sourceLines),
        this.activeProjects(tx, sourceLines),
        tx.wageServiceBasisBinding.findMany({
          where: { sourceVersionId: source.id },
          select: { id: true, projectId: true, serviceSnapshotId: true, serviceMonth: true, evidenceSha256: true, authorityFingerprint: true }
        })
      ]);
      if (!company) throw new BadRequestException("承担工资的我方公司不存在或已停用");
      assertSourceEvidenceActive(source, evidence);
      employeeMap(sourceLines, employees);
      const projectById = projectMap(sourceLines, projects);
      const serviceBindingByKey = serviceBasisBindingMap(source.id, sourceLines, serviceBasisBindings, source.evidenceSha256);
      let statement: { id: string };
      try {
        statement = await tx.wageStatement.create({
          data: {
            employmentCompanyId: source.employmentCompanyId,
            wageMonth: source.wageMonth,
            currentRevision: 1,
            createdByUserId: actorUserId
          },
          select: { id: true }
        });
      } catch (error) {
        if (prismaCode(error) === "P2002") {
          throw new ConflictException("该我方公司本月工资承担单已存在，请通过后续修订流程处理");
        }
        throw error;
      }
      const revision = 1;
      const version = await tx.wageStatementVersion.create({
        data: {
          statementId: statement.id,
          revision,
          kind: "base",
          status: "draft",
          sourceVersionId: source.id,
          sourceSnapshot: jsonValue(source.sourceSnapshot),
          createdByUserId: actorUserId,
          lastEditedByUserId: actorUserId
        },
        select: { id: true }
      });
      for (const line of sourceLines) {
        const person = await tx.wagePersonLine.create({
          data: {
            statementVersionId: version.id,
            employeeId: line.employeeId,
            employmentSnapshotId: line.employmentSnapshotId,
            employeeSnapshot: jsonValue({ employeeId: line.employeeId }),
            employmentSnapshot: jsonValue({ id: line.employmentSnapshotId, companyId: line.employmentCompanyId }),
            periodSnapshot: jsonValue({ wageMonth: source.wageMonth, periodStart: line.employmentPeriodStart, periodEnd: line.employmentPeriodEnd }),
            positionCategorySnapshot: jsonValue({ category: line.positionCategory }),
            approvedAmountCents: BigInt(line.approvedAmountCents)
          },
          select: { id: true }
        });
        await Promise.all([
          tx.wageCostComponent.createMany({ data: line.costComponents.map((component) => ({
            personLineId: person.id,
            componentCode: component.componentCode,
            amountCents: BigInt(component.amountCents),
            sourceSnapshot: jsonValue(component)
          })) }),
          tx.wageCreditorBreakdown.createMany({ data: line.creditorBreakdowns.map((creditor) => ({
            personLineId: person.id,
            creditorSubjectId: creditor.creditorSubjectId,
            creditorCategory: creditor.creditorCategory,
            amountCents: BigInt(creditor.amountCents),
            sourceSnapshot: jsonValue(creditor)
          })) }),
          tx.wageProjectAllocation.createMany({ data: line.projectAllocations.map((allocation) => ({
            personLineId: person.id,
            projectId: allocation.projectId,
            serviceSnapshotId: allocation.serviceSnapshotId,
            serviceBasisBindingId: serviceBindingByKey.get(serviceBasisKey(allocation))!.id,
            serviceSnapshot: jsonValue({
              ...allocation,
              project: projectById.get(allocation.projectId)
            }),
            amountCents: BigInt(allocation.amountCents)
          })) })
        ]);
      }
      await this.audit.record(tx, {
        actorUserId,
        action: "wage_statement.draft.create",
        businessType: "wage_statement_version",
        businessId: version.id,
        metadata: jsonValue({ statementId: statement.id, revision, sourceVersionId: source.id })
      });
      const result = { statementId: statement.id, versionId: version.id, revision };
      await this.receipt(tx, input, "wage_statement.draft.create", statement.id, fingerprintValue, actorUserId, result);
      return result;
    }));
  }

  async submit(actorUserId: string, statementId: string, input: WageStatementCommandDto) {
    await this.assertAction(actorUserId, "wage_statement.submit", "当前公司岗位无权提交工资承担单");
    validateCommand(input);
    const id = required(statementId, "工资承担单不能为空");
    const fingerprintValue = commandFingerprint("wage_statement.submit", id, input, actorUserId);
    return this.executeWithReceiptReplay(input.idempotencyKey, fingerprintValue, "statement", async () => this.serializable(async (tx) => {
      const replay = await this.replay(tx, input.idempotencyKey, fingerprintValue);
      if (replay) return replay;
      const statement = await this.lockStatement(tx, id);
      assertRevision(statement.currentRevision, input.expectedRevision);
      const version = await this.currentVersion(tx, statement.id, statement.currentRevision);
      if (version.status !== "draft") throw new ConflictException("只有草稿工资承担单可以提交");
      await tx.wageStatementVersion.update({
        where: { id: version.id },
        data: { status: "submitted", submittedByUserId: actorUserId, submittedAt: new Date(), lastEditedByUserId: actorUserId }
      });
      const result = { statementId: id, versionId: version.id, revision: statement.currentRevision, status: "submitted" };
      await this.receipt(tx, input, "wage_statement.submit", id, fingerprintValue, actorUserId, result);
      await this.audit.record(tx, { actorUserId, action: "wage_statement.submit", businessType: "wage_statement_version", businessId: version.id, metadata: jsonValue({ statementId: id, expectedRevision: input.expectedRevision }) });
      return result;
    }));
  }

  async returnForReview(actorUserId: string, statementId: string, input: ReturnWageStatementDto) {
    await this.assertAction(actorUserId, "wage_statement.return", "当前公司岗位无权退回工资承担单");
    validateCommand(input);
    const reason = required(input.reason, "退回原因不能为空");
    const id = required(statementId, "工资承担单不能为空");
    const fingerprintValue = commandFingerprint("wage_statement.return", id, input, actorUserId);
    return this.executeWithReceiptReplay(input.idempotencyKey, fingerprintValue, "statement", async () => this.serializable(async (tx) => {
      const replay = await this.replay(tx, input.idempotencyKey, fingerprintValue);
      if (replay) return replay;
      const statement = await this.lockStatement(tx, id);
      assertRevision(statement.currentRevision, input.expectedRevision);
      const submitted = await tx.wageStatementVersion.findUnique({
        where: { statementId_revision: { statementId: statement.id, revision: statement.currentRevision } },
        include: { personLines: { include: { costComponents: true, creditorBreakdowns: true, projectAllocations: true } } }
      });
      if (!submitted) throw new ConflictException("工资承担单当前版本缺失，请停止操作并复核数据");
      if (submitted.status !== "submitted") throw new ConflictException("只有已提交工资承担单可以退回");
      const nextRevision = statement.currentRevision + 1;
      // The returned submitted revision remains an immutable, superseded audit
      // record; the replacement draft carries the next editable revision.
      await tx.wageStatementVersion.update({ where: { id: submitted.id }, data: { status: "superseded", reviewDisposition: "review_returned", reviewReturnedByUserId: actorUserId, reviewReturnedAt: new Date(), reviewReturnReason: reason, supersededAt: new Date() } });
      const replacement = await tx.wageStatementVersion.create({
        data: {
          id: randomUUID(), statementId: id, revision: nextRevision, kind: "base", status: "draft", sourceVersionId: submitted.sourceVersionId,
          sourceSnapshot: jsonValue(submitted.sourceSnapshot), createdByUserId: actorUserId, lastEditedByUserId: actorUserId,
          personLines: { create: submitted.personLines.map((line) => ({
            employeeId: line.employeeId, employmentSnapshotId: line.employmentSnapshotId, employeeSnapshot: jsonValue(line.employeeSnapshot), employmentSnapshot: jsonValue(line.employmentSnapshot), periodSnapshot: jsonValue(line.periodSnapshot), positionCategorySnapshot: jsonValue(line.positionCategorySnapshot), approvedAmountCents: line.approvedAmountCents,
            costComponents: { create: line.costComponents.map((component) => ({ componentCode: component.componentCode, amountCents: component.amountCents, sourceSnapshot: jsonValue(component.sourceSnapshot) })) },
            creditorBreakdowns: { create: line.creditorBreakdowns.map((creditor) => ({ creditorSubjectId: creditor.creditorSubjectId, creditorCategory: creditor.creditorCategory, amountCents: creditor.amountCents, sourceSnapshot: jsonValue(creditor.sourceSnapshot) })) },
            projectAllocations: { create: line.projectAllocations.map((allocation) => ({ projectId: allocation.projectId, serviceSnapshotId: allocation.serviceSnapshotId, serviceBasisBindingId: allocation.serviceBasisBindingId, serviceSnapshot: jsonValue(allocation.serviceSnapshot), amountCents: allocation.amountCents })) }
          })) }
        }, select: { id: true }
      });
      await tx.wageStatement.update({ where: { id }, data: { currentRevision: nextRevision } });
      const result = { statementId: id, versionId: replacement.id, revision: nextRevision, status: "draft" };
      await this.receipt(tx, input, "wage_statement.return", id, fingerprintValue, actorUserId, result);
      await this.audit.record(tx, { actorUserId, action: "wage_statement.return", businessType: "wage_statement_version", businessId: submitted.id, metadata: jsonValue({ statementId: id, expectedRevision: input.expectedRevision, nextRevision, reason }) });
      return result;
    }));
  }

  async confirm(actorUserId: string, statementId: string, input: WageStatementCommandDto) {
    await this.assertAction(actorUserId, "wage_statement.confirm", "当前公司岗位无权确认工资承担单");
    validateCommand(input);
    const id = required(statementId, "工资承担单不能为空");
    const fingerprintValue = commandFingerprint("wage_statement.confirm", id, input, actorUserId);
    return this.executeWithReceiptReplay(input.idempotencyKey, fingerprintValue, "statement", async () => this.serializable(async (tx) => {
      const replay = await this.replay(tx, input.idempotencyKey, fingerprintValue);
      if (replay) return replay;
      const statement = await this.lockStatement(tx, id);
      assertRevision(statement.currentRevision, input.expectedRevision);
      const version = await this.currentVersion(tx, statement.id, statement.currentRevision);
      if (version.status !== "submitted") throw new ConflictException("只有已提交工资承担单可以确认");
      if ([version.createdByUserId, version.lastEditedByUserId, version.submittedByUserId].includes(actorUserId)) throw new ConflictException("职责分离冲突：确认人不得为编制人、编辑人或提交人");
      await tx.wageStatementVersion.update({ where: { id: version.id }, data: { status: "confirmed", confirmedByUserId: actorUserId, confirmedAt: new Date() } });
      const result = { statementId: id, versionId: version.id, revision: statement.currentRevision, status: "confirmed" };
      await this.receipt(tx, input, "wage_statement.confirm", id, fingerprintValue, actorUserId, result);
      await this.audit.record(tx, { actorUserId, action: "wage_statement.confirm", businessType: "wage_statement_version", businessId: version.id, metadata: jsonValue({ statementId: id, expectedRevision: input.expectedRevision }) });
      return result;
    }));
  }

  private async assertPrepareAuthority(actorUserId: string) {
    const roles = await this.companyRoles.resolveActiveRoleScopes(actorUserId);
    if (!canPerform("wage_statement.prepare", roles)) {
      throw new ForbiddenException("当前公司岗位无权编制工资承担单");
    }
  }

  private async assertReadAuthority(actorUserId: string) {
    const roles = await this.companyRoles.resolveActiveRoleScopes(actorUserId);
    if (!canPerform("wage_statement.prepare", roles)) {
      throw new ForbiddenException("当前公司岗位无权查看工资汇总");
    }
  }

  /**
   * Returns only action booleans derived from the canonical active-role resolver.
   * It is deliberately a separate read seam so clients can re-check immediately
   * before an irreversible command instead of treating aggregate-read hints as authority.
   */
  async capabilities(actorUserId: string) {
    const roles = await this.companyRoles.resolveActiveRoleScopes(actorUserId);
    return {
      canPrepare: canPerform("wage_statement.prepare", roles),
      canSubmit: canPerform("wage_statement.submit", roles),
      canReturn: canPerform("wage_statement.return", roles),
      canConfirm: canPerform("wage_statement.confirm", roles)
    };
  }

  private async aggregateStatement(statementId: string) {
    const id = required(statementId, "工资承担单不能为空");
    const statement = await this.prisma.wageStatement.findUnique({
      where: { id },
      select: WAGE_AGGREGATE_SELECT
    });
    if (!statement) throw new NotFoundException("工资承担单不存在，请刷新后重试");
    return statement;
  }

  private async companyNames(companyIds: string[]) {
    const ids = [...new Set(companyIds)];
    const companies = ids.length
      ? await this.prisma.companyEntity.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })
      : [];
    const names = new Map(companies.map((company) => [company.id, company.name]));
    if (names.size !== ids.length) {
      throw new ConflictException("工资承担单关联公司缺失，请停止操作并复核数据");
    }
    return names;
  }

  private aggregate(statement: WageAggregateStatement, companyNames: Map<string, string>) {
    const version = statement.versions.find((candidate) => candidate.revision === statement.currentRevision);
    if (!version) throw new ConflictException("工资承担单当前版本缺失，请停止操作并复核数据");
    const positionCounts = new Map<string, { personLineCount: number; projectAllocationCount: number }>();
    let projectAllocationCount = 0;
    for (const line of version.personLines) {
      const category = positionCategoryKey(line.positionCategorySnapshot);
      const counts = positionCounts.get(category) ?? { personLineCount: 0, projectAllocationCount: 0 };
      counts.personLineCount += 1;
      counts.projectAllocationCount += line.projectAllocations.length;
      projectAllocationCount += line.projectAllocations.length;
      positionCounts.set(category, counts);
    }
    const categories = [...positionCounts.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([, counts], index) => ({
        // Upstream categories are free-text authority facts. This global workbench
        // exposes only a stable aggregate bucket, never the raw upstream value.
        positionCategoryLabel: `岗位类别 ${index + 1}`,
        personLineCount: counts.personLineCount,
        projectAllocationCount: counts.projectAllocationCount
      }));
    const returned = statement.versions
      .filter((candidate) => candidate.reviewDisposition === "review_returned" && candidate.reviewReturnedAt)
      .sort((left, right) => right.revision - left.revision)[0];
    return {
      employmentCompanyName: companyNames.get(statement.employmentCompanyId)!,
      status: workbenchStatus(version.status),
      statusLabel: workbenchStatusLabel(version.status),
      sourceLabel: `外部批准工资资料 ${version.sourceVersion.externalReference}（${version.sourceVersion.sourceVersion}）`,
      personLineCount: version.personLines.length,
      positionCategoryCount: categories.length,
      projectAllocationCount,
      categories,
      latestReviewReturn: returned
        ? { revision: returned.revision, returnedAt: returned.reviewReturnedAt!.toISOString() }
        : null
    };
  }

  private async assertAction(actorUserId: string, action: "wage_statement.submit" | "wage_statement.return" | "wage_statement.confirm", message: string) {
    const roles = await this.companyRoles.resolveActiveRoleScopes(actorUserId);
    if (!canPerform(action, roles)) throw new ForbiddenException(message);
  }

  private async lockStatement(tx: Tx, statementId: string) {
    const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT id FROM "WageStatement" WHERE id = ${statementId} FOR UPDATE`);
    if (!locked.length) throw new NotFoundException("工资承担单不存在，请刷新后重试");
    const statement = await tx.wageStatement.findUnique({ where: { id: statementId }, select: { id: true, currentRevision: true } });
    if (!statement) throw new NotFoundException("工资承担单不存在，请刷新后重试");
    return statement;
  }

  private async currentVersion(tx: Tx, statementId: string, revision: number) {
    const row = await tx.wageStatementVersion.findUnique({
      where: { statementId_revision: { statementId, revision } }
    });
    if (!row) throw new ConflictException("工资承担单当前版本缺失，请停止操作并复核数据");
    return row;
  }

  private async replay(tx: Tx, idempotencyKey: string, fingerprintValue: string) {
    validateIdempotencyKey(idempotencyKey);
    const receipt = await tx.wageCommandReceipt.findUnique({ where: { idempotencyKey } });
    if (!receipt) return null;
    if (receipt.fingerprint !== fingerprintValue) throw new ConflictException("同一幂等键不能用于不同工资承担单命令");
    return receipt.resultSnapshot;
  }

  private async replayApprovedSource(tx: Tx, idempotencyKey: string, fingerprintValue: string) {
    validateIdempotencyKey(idempotencyKey);
    const receipt = await tx.wageApprovedSourceCommandReceipt.findUnique({ where: { idempotencyKey } });
    if (!receipt) return null;
    if (receipt.fingerprint !== fingerprintValue) throw new ConflictException("同一幂等键不能用于不同外部工资来源命令");
    return receipt.resultSnapshot;
  }

  private async receipt(tx: Tx, input: WageStatementCommandDto, action: string, aggregateId: string, fingerprintValue: string, actorUserId: string, result: unknown) {
    try {
      return await tx.wageCommandReceipt.create({ data: { idempotencyKey: input.idempotencyKey, action, aggregateId, expectedRevision: input.expectedRevision, actorUserId, fingerprint: fingerprintValue, resultSnapshot: jsonValue(result) } });
    } catch (error) {
      if (prismaCode(error) === "P2002") throw new WageReceiptRaceError("statement");
      throw error;
    }
  }

  private async approvedSourceReceipt(tx: Tx, input: CreateApprovedWageSourceDto, action: string, aggregateId: string, fingerprintValue: string, actorUserId: string, result: unknown) {
    try {
      return await tx.wageApprovedSourceCommandReceipt.create({ data: { idempotencyKey: input.idempotencyKey, action, aggregateId, expectedRevision: input.expectedRevision, actorUserId, fingerprint: fingerprintValue, resultSnapshot: jsonValue(result) } });
    } catch (error) {
      if (prismaCode(error) === "P2002") throw new WageReceiptRaceError("approved_source");
      throw error;
    }
  }

  private activeEmployees(tx: Tx, lines: Array<Pick<ApprovedWagePersonDto, "employeeId">>) {
    const ids = [...new Set(lines.map((line) => required(line.employeeId, "人员不能为空")))];
    return tx.user.findMany({
      where: { id: { in: ids }, isActive: true },
      select: { id: true, name: true, departmentId: true }
    });
  }

  private activeProjects(tx: Tx, lines: WagePersonLineInput[]) {
    const ids = [...new Set(lines.flatMap((line) => line.projectAllocations.map((allocation) => required(allocation.projectId, "分摊项目不能为空"))))];
    return tx.project.findMany({
      where: { id: { in: ids }, isActive: true },
      select: { id: true, code: true, name: true }
    });
  }

  private serializable<T>(work: (tx: Tx) => Promise<T>) {
    return this.prisma.$transaction(work, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  // A receipt collision can only happen at the final write of the same command.
  // Its transaction is aborted, so a fresh read is required before returning the
  // winning durable snapshot. Other P2002 errors remain business conflicts.
  private async executeWithReceiptReplay<T>(
    idempotencyKey: string,
    fingerprintValue: string,
    kind: WageReceiptKind,
    work: () => Promise<T>
  ): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await work();
      } catch (error) {
        if (error instanceof WageReceiptRaceError) {
          if (error.kind !== kind) throw error;
          return this.readWinningReceipt<T>(idempotencyKey, fingerprintValue, kind);
        }
        if (prismaCode(error) === "P2034" && attempt < 2) continue;
        throw error;
      }
    }
    throw new ConflictException("工资承担单并发写入未能完成，请刷新后重试");
  }

  private async readWinningReceipt<T>(idempotencyKey: string, fingerprintValue: string, kind: WageReceiptKind): Promise<T> {
    const receipt = kind === "statement"
      ? await this.prisma.wageCommandReceipt.findUnique({ where: { idempotencyKey } })
      : await this.prisma.wageApprovedSourceCommandReceipt.findUnique({ where: { idempotencyKey } });
    if (!receipt) throw new ConflictException("工资承担单幂等命令仍在并发处理中，请使用同一幂等键重试");
    if (receipt.fingerprint !== fingerprintValue) {
      throw new ConflictException(kind === "statement" ? "同一幂等键不能用于不同工资承担单命令" : "同一幂等键不能用于不同外部工资来源命令");
    }
    return receipt.resultSnapshot as T;
  }
}

type WageReceiptKind = "statement" | "approved_source";

class WageReceiptRaceError extends Error {
  constructor(readonly kind: WageReceiptKind) {
    super("wage receipt unique-key race");
  }
}

function normalizeApprovedSource(input: CreateApprovedWageSourceDto) {
  validateIdempotencyKey(input.idempotencyKey);
  if (input.expectedRevision !== 0) throw new ConflictException("新建外部工资来源的 expectedRevision 必须为 0");
  const wageMonth = required(input.wageMonth, "工资月份不能为空");
  if (!/^\d{4}-(?:0[1-9]|1[0-2])$/u.test(wageMonth)) throw new BadRequestException("工资月份必须使用 YYYY-MM 格式");
  const periodStart = validDateOnly(input.periodStart, "工资期间开始日不正确");
  const periodEnd = validDateOnly(input.periodEnd, "工资期间结束日不正确");
  const [year, month] = wageMonth.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (periodStart !== `${wageMonth}-01` || periodEnd !== `${wageMonth}-${String(lastDay).padStart(2, "0")}`) {
    throw new BadRequestException("外部批准工资来源必须覆盖完整自然月");
  }
  const lines = input.approvedPersonLines;
  if (!Array.isArray(lines) || !lines.length) throw new BadRequestException("外部批准工资来源至少需要一条人员事实");
  const keys = new Set<string>();
  let total = 0n;
  const employmentCompanyId = required(input.employmentCompanyId, "我方公司不能为空");
  const approvedPersonLines = lines.map((line) => {
    const normalized = normalizeAuthorityPersonLine(line, {
      employmentCompanyId,
      periodStart,
      periodEnd,
      wageMonth
    });
    const employeeId = normalized.employeeId;
    const employmentSnapshotId = normalized.employmentSnapshotId;
    const key = `${employeeId}:${employmentSnapshotId}`;
    if (keys.has(key)) throw new BadRequestException("同一人员劳动关系快照不能重复");
    keys.add(key);
    const approvedAmountCents = BigInt(normalized.approvedAmountCents);
    total += approvedAmountCents;
    return normalized;
  });
  if (total === 0n) throw new BadRequestException("外部批准工资来源总额必须大于零");
  return {
    idempotencyKey: input.idempotencyKey,
    expectedRevision: input.expectedRevision,
    employmentCompanyId,
    wageMonth,
    periodStart,
    periodEnd,
    externalReference: required(input.externalReference, "外部批准资料编号不能为空"),
    sourceVersion: required(input.sourceVersion, "外部批准资料版本不能为空"),
    basisDate: validDateOnly(input.basisDate, "批准依据日期不正确"),
    evidenceFileId: required(input.evidenceFileId, "外部批准资料附件不能为空"),
    approvedPersonLines
  };
}

type AuthorityLine = ApprovedWagePersonDto;

function normalizeAuthorityPersonLine(
  line: ApprovedWagePersonDto,
  context: { employmentCompanyId: string; periodStart: string; periodEnd: string; wageMonth: string }
): AuthorityLine {
  const employeeId = required(line.employeeId, "人员不能为空");
  const employmentSnapshotId = required(line.employmentSnapshotId, "劳动关系快照不能为空");
  const employmentCompanyId = required(line.employmentCompanyId, "劳动关系公司不能为空");
  if (employmentCompanyId !== context.employmentCompanyId) {
    throw new BadRequestException("劳动关系公司必须与工资承担公司一致");
  }
  const employmentPeriodStart = validDateOnly(line.employmentPeriodStart, "劳动关系期间开始日不正确");
  const employmentPeriodEnd = validDateOnly(line.employmentPeriodEnd, "劳动关系期间结束日不正确");
  if (employmentPeriodStart !== context.periodStart || employmentPeriodEnd !== context.periodEnd) {
    throw new BadRequestException("劳动关系期间必须与工资月份期间一致");
  }
  const positionCategory = required(line.positionCategory, "岗位类别不能为空");
  const approvedAmountCents = cents(line.approvedAmountCents, "外部批准人员金额必须是非负整数分");
  const costComponents = normalizeCostComponents(line.costComponents);
  const creditorBreakdowns = normalizeCreditorBreakdowns(line.creditorBreakdowns, employeeId);
  const projectAllocations = normalizeProjectAllocations(line.projectAllocations, context.wageMonth);
  if (sumAmounts(costComponents, "成本组成") !== approvedAmountCents) {
    throw new BadRequestException("成本组成合计必须与外部批准人员金额逐分一致");
  }
  if (sumAmounts(creditorBreakdowns, "债权人拆分") !== approvedAmountCents) {
    throw new BadRequestException("债权人拆分合计必须与外部批准人员金额逐分一致");
  }
  if (sumAmounts(projectAllocations, "项目分摊") !== approvedAmountCents) {
    throw new BadRequestException("项目分摊合计必须与外部批准人员金额逐分一致");
  }
  return {
    employeeId,
    employmentSnapshotId,
    employmentCompanyId,
    employmentPeriodStart,
    employmentPeriodEnd,
    positionCategory,
    approvedAmountCents: approvedAmountCents.toString(),
    costComponents,
    creditorBreakdowns,
    projectAllocations
  };
}

function normalizeCostComponents(lines: ApprovedWagePersonDto["costComponents"]) {
  if (!Array.isArray(lines) || !lines.length) throw new BadRequestException("成本组成不能为空");
  const keys = new Set<string>();
  return lines.map((line) => {
    const componentCode = required(line.componentCode, "工资成本组成类别不正确");
    if (!WAGE_COST_COMPONENT_CODES.includes(componentCode as never)) throw new BadRequestException("工资成本组成类别不正确");
    if (keys.has(componentCode)) throw new BadRequestException("同一人员工资成本组成不能重复");
    keys.add(componentCode);
    return { componentCode, amountCents: cents(line.amountCents, "成本组成金额必须是非负整数分").toString() };
  }).sort((left, right) => left.componentCode.localeCompare(right.componentCode));
}

function normalizeCreditorBreakdowns(lines: ApprovedWagePersonDto["creditorBreakdowns"], employeeId: string) {
  if (!Array.isArray(lines) || !lines.length) throw new BadRequestException("债权人拆分不能为空");
  const keys = new Set<string>();
  let employeeNetPayCount = 0;
  const normalized = lines.map((line) => {
    const creditorSubjectId = required(line.creditorSubjectId, "工资债权人不能为空");
    const creditorCategory = required(line.creditorCategory, "工资债权人类别不正确");
    if (!WAGE_CREDITOR_CATEGORIES.includes(creditorCategory as never)) throw new BadRequestException("工资债权人类别不正确");
    if (creditorCategory === "employee_net_pay") {
      employeeNetPayCount += 1;
      if (creditorSubjectId !== employeeId) throw new BadRequestException("员工净付债权人必须绑定该员工");
    }
    const key = `${creditorSubjectId}:${creditorCategory}`;
    if (keys.has(key)) throw new BadRequestException("同一人员工资债权人拆分不能重复");
    keys.add(key);
    return { creditorSubjectId, creditorCategory, amountCents: cents(line.amountCents, "债权人拆分金额必须是非负整数分").toString() };
  }).sort((left, right) => `${left.creditorSubjectId}:${left.creditorCategory}`.localeCompare(`${right.creditorSubjectId}:${right.creditorCategory}`));
  if (employeeNetPayCount !== 1) throw new BadRequestException("每名员工必须且只能有一项员工净付债权人");
  return normalized;
}

function normalizeProjectAllocations(lines: ApprovedWagePersonDto["projectAllocations"], wageMonth: string) {
  if (!Array.isArray(lines) || !lines.length) throw new BadRequestException("项目分摊不能为空");
  const keys = new Set<string>();
  return lines.map((line) => {
    const projectId = required(line.projectId, "分摊项目不能为空");
    const serviceSnapshotId = required(line.serviceSnapshotId, "服务依据不能为空");
    const serviceMonth = required(line.serviceMonth, "服务依据月份不能为空");
    if (serviceMonth !== wageMonth) throw new BadRequestException("服务依据月份必须与工资月份一致");
    const serviceEvidenceSha256 = required(line.serviceEvidenceSha256, "服务依据校验值不能为空");
    if (!SHA256.test(serviceEvidenceSha256)) throw new BadRequestException("服务依据校验值必须为 SHA-256");
    const key = `${projectId}:${serviceSnapshotId}`;
    if (keys.has(key)) throw new BadRequestException("同一人员项目分摊不能重复");
    keys.add(key);
    return { projectId, serviceSnapshotId, serviceMonth, serviceEvidenceSha256: serviceEvidenceSha256.toLowerCase(), amountCents: cents(line.amountCents, "项目分摊金额必须是非负整数分").toString() };
  }).sort((left, right) => `${left.projectId}:${left.serviceSnapshotId}`.localeCompare(`${right.projectId}:${right.serviceSnapshotId}`));
}

function sumAmounts(lines: Array<{ amountCents: string }>, label: string) {
  return lines.reduce((total, line) => total + cents(line.amountCents, `${label}金额必须是非负整数分`), 0n);
}

function validateDraftInput(input: CreateWageStatementDraftDto) {
  validateCommand(input);
  if (input.expectedRevision !== 0) throw new ConflictException("新建工资承担单的 expectedRevision 必须为 0");
  required(input.sourceVersionId, "外部批准工资来源不能为空");
  const componentCodes = new Set<string>();
  const creditorKeys = new Set<string>();
  const allocationKeys = new Set<string>();
  for (const line of input.personLines ?? []) {
    componentCodes.clear();
    creditorKeys.clear();
    allocationKeys.clear();
    for (const component of line.costComponents ?? []) {
      if (!WAGE_COST_COMPONENT_CODES.includes(component.componentCode as never)) throw new BadRequestException("工资成本组成类别不正确");
      if (componentCodes.has(component.componentCode)) throw new BadRequestException("同一人员工资成本组成不能重复");
      componentCodes.add(component.componentCode);
    }
    for (const creditor of line.creditorBreakdowns ?? []) {
      required(creditor.creditorSubjectId, "工资债权人不能为空");
      if (!WAGE_CREDITOR_CATEGORIES.includes(creditor.creditorCategory as never)) throw new BadRequestException("工资债权人类别不正确");
      const key = `${creditor.creditorSubjectId}:${creditor.creditorCategory}`;
      if (creditorKeys.has(key)) throw new BadRequestException("同一人员工资债权人拆分不能重复");
      creditorKeys.add(key);
    }
    for (const allocation of line.projectAllocations ?? []) {
      required(allocation.projectId, "分摊项目不能为空");
      required(allocation.serviceSnapshotId, "服务快照不能为空");
      const key = `${allocation.projectId}:${allocation.serviceSnapshotId}`;
      if (allocationKeys.has(key)) throw new BadRequestException("同一人员项目分摊不能重复");
      allocationKeys.add(key);
    }
  }
}

function validateCommand(input: WageStatementCommandDto) {
  validateIdempotencyKey(input.idempotencyKey);
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) {
    throw new BadRequestException("expectedRevision 必须是非负整数");
  }
}

function validateIdempotencyKey(value: string) {
  if (!UUID_V4.test(value ?? "")) throw new BadRequestException("幂等键必须是 UUIDv4");
}

function assertRevision(actualRevision: number, expectedRevision: number) {
  if (actualRevision !== expectedRevision) throw new ConflictException("工资承担单版本已变化，请刷新后重试");
}

function sourcePersonLines(snapshot: unknown): AuthorityLine[] {
  if (!snapshot || typeof snapshot !== "object" || !Array.isArray((snapshot as { approvedPersonLines?: unknown }).approvedPersonLines)) {
    throw new ConflictException("外部批准工资来源快照不完整，不能创建工资承担单");
  }
  return (snapshot as { approvedPersonLines: unknown[] }).approvedPersonLines.map((line) => {
    if (!line || typeof line !== "object") throw new ConflictException("外部批准工资来源快照不完整，不能创建工资承担单");
    const value = line as Record<string, unknown>;
    try {
      return normalizeAuthorityPersonLine({
        employeeId: requiredJsonText(value.employeeId),
        employmentSnapshotId: requiredJsonText(value.employmentSnapshotId),
        employmentCompanyId: requiredJsonText(value.employmentCompanyId),
        employmentPeriodStart: requiredJsonText(value.employmentPeriodStart),
        employmentPeriodEnd: requiredJsonText(value.employmentPeriodEnd),
        positionCategory: requiredJsonText(value.positionCategory),
        approvedAmountCents: requiredJsonText(value.approvedAmountCents),
        costComponents: jsonArray(value.costComponents),
        creditorBreakdowns: jsonArray(value.creditorBreakdowns),
        projectAllocations: jsonArray(value.projectAllocations)
      }, {
        employmentCompanyId: requiredJsonText(value.employmentCompanyId),
        periodStart: requiredJsonText(value.employmentPeriodStart),
        periodEnd: requiredJsonText(value.employmentPeriodEnd),
        wageMonth: requiredJsonText((value.projectAllocations as Array<Record<string, unknown>>)[0]?.serviceMonth)
      });
    } catch {
      throw new ConflictException("外部批准工资来源快照不完整，不能创建工资承担单");
    }
  });
}

function assertSourceFacts(
  lines: WagePersonLineInput[],
  sourceLines: AuthorityLine[],
  employmentCompanyId: string,
  wageMonth: string,
  periodStart: Date,
  periodEnd: Date
) {
  const expectedStart = periodStart.toISOString().slice(0, 10);
  const expectedEnd = periodEnd.toISOString().slice(0, 10);
  const [year, month] = wageMonth.split("-").map(Number);
  const naturalMonthEnd = `${wageMonth}-${String(new Date(Date.UTC(year, month, 0)).getUTCDate()).padStart(2, "0")}`;
  if (!/^[0-9]{4}-(0[1-9]|1[0-2])$/u.test(wageMonth) || expectedStart !== `${wageMonth}-01` || expectedEnd !== naturalMonthEnd) {
    throw new ConflictException("外部批准工资来源公司、月份或期间不一致，不能创建工资承担单");
  }
  const expected = new Map(sourceLines.map((line) => {
    if (line.employmentCompanyId !== employmentCompanyId || line.employmentPeriodStart !== expectedStart || line.employmentPeriodEnd !== expectedEnd) {
      throw new ConflictException("外部批准工资来源公司、月份或期间不一致，不能创建工资承担单");
    }
    return [`${line.employeeId}:${line.employmentSnapshotId}`, stableJson(line)];
  }));
  if (expected.size !== lines.length) throw new BadRequestException("工资承担单人员事实必须与外部批准来源一致");
  for (const line of lines) {
    const key = `${line.employeeId}:${line.employmentSnapshotId}`;
    const actual = normalizeAuthorityPersonLine(line, { employmentCompanyId, periodStart: expectedStart, periodEnd: expectedEnd, wageMonth });
    if (expected.get(key) !== stableJson(actual)) {
      throw new BadRequestException("工资承担单人员事实必须与外部批准来源一致");
    }
  }
}

function jsonArray(value: unknown) {
  if (!Array.isArray(value)) throw new ConflictException("外部批准工资来源快照不完整，不能创建工资承担单");
  return value as never[];
}

function employeeMap(
  lines: Array<Pick<ApprovedWagePersonDto, "employeeId">>,
  employees: Array<{ id: string; name: string; departmentId: string | null }>
) {
  const ids = new Set(lines.map((line) => line.employeeId));
  const byId = new Map(employees.map((employee) => [employee.id, { id: employee.id, name: employee.name, departmentId: employee.departmentId }]));
  if (byId.size !== ids.size || [...ids].some((id) => !byId.has(id))) {
    throw new BadRequestException("工资人员不存在或已停用");
  }
  return byId;
}

function projectMap(
  lines: Array<Pick<ApprovedWagePersonDto, "projectAllocations">>,
  projects: Array<{ id: string; code: string; name: string }>
) {
  const ids = new Set(lines.flatMap((line) => line.projectAllocations.map((allocation) => allocation.projectId)));
  const byId = new Map(projects.map((project) => [project.id, project]));
  if (byId.size !== ids.size || [...ids].some((id) => !byId.has(id))) {
    throw new BadRequestException("分摊项目不存在或已停用");
  }
  return byId;
}

function assertServiceEvidenceBound(lines: AuthorityLine[], approvedSourceSha256: string) {
  for (const line of lines) {
    for (const allocation of line.projectAllocations) {
      if (allocation.serviceEvidenceSha256 !== approvedSourceSha256.toLowerCase()) {
        throw new BadRequestException("服务依据必须由同一外部批准工资资料校验值证明");
      }
    }
  }
}

type ServiceBasisBinding = {
  id: string;
  projectId: string;
  serviceSnapshotId: string;
  serviceMonth: string;
  evidenceSha256: string;
  authorityFingerprint: string;
};

function serviceBasisKey(allocation: Pick<AuthorityLine["projectAllocations"][number], "projectId" | "serviceSnapshotId">) {
  return `${allocation.projectId}:${allocation.serviceSnapshotId}`;
}

function serviceBasisDefinitions(lines: AuthorityLine[], evidenceSha256: string) {
  const definitions = new Map<string, { projectId: string; serviceSnapshotId: string; serviceMonth: string; evidenceSha256: string }>();
  for (const line of lines) {
    for (const allocation of line.projectAllocations) {
      const key = serviceBasisKey(allocation);
      const definition = {
        projectId: allocation.projectId,
        serviceSnapshotId: allocation.serviceSnapshotId,
        serviceMonth: allocation.serviceMonth,
        evidenceSha256: allocation.serviceEvidenceSha256
      };
      const existing = definitions.get(key);
      if (existing && stableJson(existing) !== stableJson(definition)) {
        throw new BadRequestException("同一服务依据不能在外部批准工资来源中漂移");
      }
      if (definition.evidenceSha256 !== evidenceSha256.toLowerCase()) {
        throw new BadRequestException("服务依据必须由同一外部批准工资资料校验值证明");
      }
      definitions.set(key, definition);
    }
  }
  return [...definitions.values()].sort((left, right) => serviceBasisKey(left).localeCompare(serviceBasisKey(right)));
}

function assertSourceEvidenceActive(
  source: { evidenceFileId: string; evidenceSha256: string },
  evidence: { id: string; storageStatus: string; contentSha256: string | null } | null
) {
  if (
    !evidence ||
    evidence.id !== source.evidenceFileId ||
    evidence.storageStatus !== "active" ||
    typeof evidence.contentSha256 !== "string" ||
    evidence.contentSha256.toLowerCase() !== source.evidenceSha256.toLowerCase()
  ) {
    throw new ConflictException("外部批准工资资料证据已失效或校验值漂移，不能创建工资承担单");
  }
}

function serviceBasisBindingMap(
  sourceVersionId: string,
  lines: AuthorityLine[],
  bindings: ServiceBasisBinding[],
  evidenceSha256: string
) {
  const expected = serviceBasisDefinitions(lines, evidenceSha256);
  const byKey = new Map(bindings.map((binding) => [serviceBasisKey(binding), binding]));
  if (byKey.size !== expected.length) {
    throw new ConflictException("外部批准工资来源的服务依据绑定不完整，不能创建工资承担单");
  }
  for (const definition of expected) {
    const binding = byKey.get(serviceBasisKey(definition));
    if (
      !binding ||
      binding.serviceMonth !== definition.serviceMonth ||
      binding.evidenceSha256.toLowerCase() !== definition.evidenceSha256 ||
      !SHA256.test(binding.authorityFingerprint) ||
      binding.authorityFingerprint !== fingerprint({
        sourceVersionId,
        projectId: binding.projectId,
        serviceSnapshotId: binding.serviceSnapshotId,
        serviceMonth: binding.serviceMonth,
        evidenceSha256: binding.evidenceSha256
      })
    ) {
      throw new ConflictException("外部批准工资来源的服务依据绑定已失效或漂移，不能创建工资承担单");
    }
  }
  return byKey;
}

function validDateOnly(value: string, message: string) {
  const text = required(value, message);
  const parsed = new Date(`${text}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(text) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text) throw new BadRequestException(message);
  return text;
}

function dateOnly(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

function cents(value: string, message: string) {
  if (!/^\d+$/u.test(value ?? "")) throw new BadRequestException(message);
  return BigInt(value);
}

function required(value: string | undefined | null, message: string) {
  if (!value?.trim()) throw new BadRequestException(message);
  return value.trim();
}

function requiredJsonText(value: unknown) {
  if (typeof value !== "string" || !value.trim()) throw new ConflictException("外部批准工资来源快照不完整，不能创建工资承担单");
  return value;
}

function positionCategoryKey(snapshot: unknown) {
  if (!snapshot || typeof snapshot !== "object") return "unknown";
  const category = (snapshot as { category?: unknown }).category;
  return typeof category === "string" && category.trim() ? category : "unknown";
}

function workbenchStatus(status: string): "draft" | "submitted" | "returned" | "confirmed" {
  if (status === "draft" || status === "submitted" || status === "confirmed") return status;
  return "returned";
}

function workbenchStatusLabel(status: string) {
  switch (status) {
    case "draft": return "草稿";
    case "submitted": return "待确认";
    case "confirmed": return "已确认";
    case "review_returned": return "已退回";
    case "superseded": return "已修订";
    default: return "状态待核对";
  }
}

function jsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function fingerprint(value: unknown) {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function commandFingerprint(action: string, aggregateId: string, input: unknown, actorUserId: string) {
  return fingerprint({ action, aggregateId, input, actorUserId });
}

function sourceCommandFingerprint(input: CreateApprovedWageSourceDto, actorUserId: string) {
  return fingerprint({
    action: "wage_statement.approved_source.create",
    aggregateId: "new",
    actorUserId,
    expectedRevision: input.expectedRevision,
    payload: {
      employmentCompanyId: input.employmentCompanyId,
      wageMonth: input.wageMonth,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      externalReference: input.externalReference,
      sourceVersion: input.sourceVersion,
      basisDate: input.basisDate,
      evidenceFileId: input.evidenceFileId,
      approvedPersonLines: input.approvedPersonLines
    }
  });
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function prismaCode(error: unknown) {
  return error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : undefined;
}
