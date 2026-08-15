import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PROJECT_OPERATING_TAKEOVER_STATUSES } from "@jiangkong/shared-domain";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../database/prisma.service";
import { translateOperatingProfileConstraint } from "./project-operating-constraint";

export interface UpdateProjectOperatingProfileInput {
  operatingLedgerEffectiveDate?: string | null;
  takeoverCompletedDate?: string | null;
  takeoverStatus?: string;
}

export interface AddProjectParticipatingCompanyInput {
  companyEntityId: string;
  effectiveFrom: string;
  changeReason: string;
}

export interface DeactivateProjectParticipatingCompanyInput {
  endedOn: string;
  changeReason: string;
}

const PROFILE_SELECT = {
  id: true,
  operatingLedgerEffectiveDate: true,
  takeoverCompletedDate: true,
  takeoverStatus: true
} as const;

@Injectable()
export class ProjectOperatingProfileService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional()
    private readonly audit: AuditService = new AuditService()
  ) {}

  async listParticipatingCompanyOptions(projectId: string, actorUserId: string) {
    await this.assertProjectFinanceManager(this.prisma, actorUserId, projectId);
    return this.prisma.companyEntity.findMany({
      where: { isActive: true, dataStatus: "complete" },
      select: { id: true, name: true, unifiedSocialCreditCode: true },
      orderBy: [{ name: "asc" }, { id: "asc" }]
    });
  }

  async listConstructionEnterpriseOptions(projectId: string, actorUserId: string) {
    await this.assertProjectFinanceManager(this.prisma, actorUserId, projectId);
    const activeParties = await this.prisma.businessParty.findMany({
      where: { status: "active" },
      select: { id: true }
    });
    const versions = await this.prisma.businessPartyVersion.findMany({
      where: { businessPartyId: { in: activeParties.map((party) => party.id) } },
      select: { id: true, versionNo: true, snapshot: true },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }]
    });
    return versions.flatMap((version) => {
      const snapshot = version.snapshot as Record<string, unknown>;
      const name = typeof snapshot.name === "string" ? snapshot.name.trim() : "";
      if (!name) return [];
      return [{
        id: version.id,
        versionNo: version.versionNo,
        name,
        creditCode: typeof snapshot.unifiedSocialCreditCode === "string"
          ? snapshot.unifiedSocialCreditCode
          : null
      }];
    });
  }

  async getProfile(projectId: string, actorUserId: string) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId, isActive: true },
      select: {
        ...PROFILE_SELECT,
        constructionEnterpriseLockedAt: true
      }
    });
    if (!project) {
      throw new NotFoundException("项目不存在或已停用，请刷新后重试");
    }
    const [constructionEnterprise, participatingCompanies] = await Promise.all([
      this.prisma.projectAffiliateAssignment.findFirst({
        where: { projectId, endedAt: null },
        orderBy: { effectiveFrom: "desc" },
        select: {
          id: true,
          businessPartyId: true,
          businessPartyVersionId: true,
          affiliateNameSnapshot: true,
          affiliateCreditCodeSnapshot: true,
          effectiveFrom: true
        }
      }),
      this.prisma.projectParticipatingCompany.findMany({
        where: { projectId },
        orderBy: [{ endedAt: "asc" }, { effectiveFrom: "desc" }]
      })
    ]);
    const canManage = await this.isProjectFinanceManager(actorUserId, projectId);
    return {
      ...toProfileReadModel(project),
      canManage,
      constructionEnterprise: constructionEnterprise
        ? {
            assignmentId: constructionEnterprise.id,
            businessPartyId: constructionEnterprise.businessPartyId,
            businessPartyVersionId: constructionEnterprise.businessPartyVersionId,
            name: constructionEnterprise.affiliateNameSnapshot,
            creditCode: constructionEnterprise.affiliateCreditCodeSnapshot,
            effectiveFrom: dateOnly(constructionEnterprise.effectiveFrom),
            lockedAt: project.constructionEnterpriseLockedAt?.toISOString() ?? null,
            isLocked: Boolean(project.constructionEnterpriseLockedAt)
          }
        : null,
      participatingCompanies: participatingCompanies.map(toParticipatingCompanyReadModel)
    };
  }

  async updateProfile(
    projectId: string,
    actorUserId: string,
    input: UpdateProjectOperatingProfileInput
  ) {
    return translateOperatingProfileConstraint(
      this.prisma.$transaction((tx) =>
        this.updateProfileInTransaction(tx, projectId, actorUserId, input)
      )
    );
  }

  async updateProfileInTransaction(
    tx: Prisma.TransactionClient,
    projectId: string,
    actorUserId: string,
    input: UpdateProjectOperatingProfileInput
  ) {
    return translateOperatingProfileConstraint(
      this.updateProfileInTransactionRaw(tx, projectId, actorUserId, input)
    );
  }

  private async updateProfileInTransactionRaw(
    tx: Prisma.TransactionClient,
    projectId: string,
    actorUserId: string,
    input: UpdateProjectOperatingProfileInput
  ) {
    await this.assertProjectFinanceManager(tx, actorUserId, projectId);
    const current = await tx.project.findUnique({
      where: { id: projectId, isActive: true },
      select: PROFILE_SELECT
    });
    if (!current) {
      throw new NotFoundException("项目不存在或已停用，请刷新后重试");
    }

    const data: Prisma.ProjectUpdateInput = {};
    if (input.operatingLedgerEffectiveDate !== undefined) {
      data.operatingLedgerEffectiveDate = optionalDateOnly(
        input.operatingLedgerEffectiveDate,
        "经营账生效日"
      );
    }
    if (input.takeoverCompletedDate !== undefined) {
      data.takeoverCompletedDate = optionalDateOnly(
        input.takeoverCompletedDate,
        "经营接管完成日"
      );
    }
    if (input.takeoverStatus !== undefined) {
      if (
        !PROJECT_OPERATING_TAKEOVER_STATUSES.includes(
          input.takeoverStatus as (typeof PROJECT_OPERATING_TAKEOVER_STATUSES)[number]
        )
      ) {
        throw new BadRequestException("经营接管状态不受支持，请重新选择");
      }
      data.takeoverStatus = input.takeoverStatus;
    }
    if (!Object.keys(data).length) {
      throw new BadRequestException("请至少填写一项项目经营档案变更");
    }

    const updated = await tx.project.update({
      where: { id: projectId },
      data,
      select: PROFILE_SELECT
    });
    await this.audit.record(tx, {
      actorUserId,
      action: "project.operating_profile.update",
      businessType: "project",
      businessId: projectId,
      metadata: {
        operatingLedgerEffectiveDate:
          updated.operatingLedgerEffectiveDate?.toISOString().slice(0, 10) ?? null,
        takeoverCompletedDate:
          updated.takeoverCompletedDate?.toISOString().slice(0, 10) ?? null,
        takeoverStatus: updated.takeoverStatus
      }
    });
    return toProfileReadModel(updated);
  }

  async addParticipatingCompany(
    projectId: string,
    actorUserId: string,
    input: AddProjectParticipatingCompanyInput
  ) {
    const companyEntityId = requiredText(input.companyEntityId, "请选择我方参与公司");
    const effectiveFrom = requiredDateOnly(input.effectiveFrom, "参与公司生效日");
    const changeReason = requiredText(input.changeReason, "请填写参与公司加入原因");

    return translateOperatingProfileConstraint(this.prisma.$transaction(async (tx) => {
      await this.assertProjectFinanceManager(tx, actorUserId, projectId);
      await tx.$queryRaw(Prisma.sql`
        SELECT "id" FROM "Project" WHERE "id" = ${projectId} FOR UPDATE
      `);
      const project = await tx.project.findUnique({
        where: { id: projectId, isActive: true },
        select: { id: true, isActive: true }
      });
      if (!project) {
        throw new NotFoundException("项目不存在或已停用，请刷新后重试");
      }

      const company = await tx.companyEntity.findUnique({
        where: { id: companyEntityId },
        select: {
          id: true,
          name: true,
          unifiedSocialCreditCode: true,
          currentVersionNo: true,
          isActive: true,
          dataStatus: true
        }
      });
      if (!company?.isActive || company.dataStatus !== "complete") {
        throw new BadRequestException("所选我方公司不存在、资料不完整或已停用，不能加入项目");
      }
      const companyVersion = await tx.companyEntityVersion.findUnique({
        where: {
          companyEntityId_versionNo: {
            companyEntityId,
            versionNo: company.currentVersionNo
          }
        },
        select: {
          id: true,
          companyEntityId: true,
          versionNo: true,
          name: true,
          unifiedSocialCreditCode: true,
          isActive: true
        }
      });
      if (!companyVersion?.isActive) {
        throw new BadRequestException("所选我方公司缺少有效版本，请先维护公司资料");
      }

      const current = await tx.projectParticipatingCompany.findFirst({
        where: {
          projectId,
          companyEntityId,
          OR: [{ endedAt: null }, { endedAt: { gt: effectiveFrom } }]
        },
        select: { id: true }
      });
      if (current) {
        throw new BadRequestException("该公司已在本项目参与公司名单中");
      }

      const participant = await tx.projectParticipatingCompany.create({
        data: {
          projectId,
          companyEntityId,
          companyEntityVersionId: companyVersion.id,
          companyNameSnapshot: companyVersion.name,
          companyCreditCodeSnapshot: companyVersion.unifiedSocialCreditCode,
          effectiveFrom,
          changeReason,
          addedByUserId: actorUserId
        }
      });
      await this.audit.record(tx, {
        actorUserId,
        action: "project.participating_company.add",
        businessType: "project_participating_company",
        businessId: participant.id,
        metadata: { projectId, companyEntityId, effectiveFrom: input.effectiveFrom, changeReason }
      });
      return toParticipatingCompanyReadModel(participant);
    }));
  }

  async removeParticipatingCompany(
    projectId: string,
    participantId: string,
    actorUserId: string
  ) {
    return translateOperatingProfileConstraint(this.prisma.$transaction(async (tx) => {
      await this.assertProjectFinanceManager(tx, actorUserId, projectId);
      const [participant] = await tx.$queryRaw<
        Array<{
          id: string;
          projectId: string;
          companyEntityId: string;
          endedAt: Date | null;
        }>
      >(Prisma.sql`
        SELECT "id", "projectId", "companyEntityId", "endedAt"
        FROM "ProjectParticipatingCompany"
        WHERE "id" = ${participantId} AND "projectId" = ${projectId}
        FOR UPDATE
      `);
      if (!participant) {
        throw new NotFoundException("项目参与公司不存在，请刷新后重试");
      }

      const [formalFactResult] = await tx.$queryRaw<Array<{ hasFormalFacts: boolean }>>(
        Prisma.sql`
          SELECT (
            EXISTS (
              SELECT 1
              FROM "Contract" contract
              INNER JOIN "ContractVersion" version ON version."contractId" = contract."id"
              WHERE contract."projectId" = ${projectId}
                AND version."status" = 'effective'
                AND (
                  contract."companyEntityId" = ${participant.companyEntityId}
                  OR version."companyEntityIdSnapshot" = ${participant.companyEntityId}
                )
            )
            OR EXISTS (
              SELECT 1
              FROM "ProjectAffiliateCompanyContract" company_contract
              WHERE company_contract."projectId" = ${projectId}
                AND company_contract."companyEntityId" = ${participant.companyEntityId}
                AND company_contract."status" = 'confirmed'
            )
            OR EXISTS (
              SELECT 1
              FROM "ExpenseClaim" claim
              WHERE claim."projectId" = ${projectId}
                AND claim."voidedAt" IS NULL
                AND claim."status" IN (
                  'approved_pending_payment', 'partially_paid', 'paid',
                  'approved_pending_disbursement', 'partially_disbursed', 'disbursed',
                  'offset_completed'
                )
                AND (
                  claim."companyEntityId" = ${participant.companyEntityId}
                  OR claim."paymentSubjectCompanyEntityId" = ${participant.companyEntityId}
                )
            )
            OR EXISTS (
              SELECT 1
              FROM "PaymentExecution" execution
              INNER JOIN "PaymentExecutionAllocation" allocation
                ON allocation."paymentExecutionId" = execution."id"
              WHERE allocation."projectId" = ${projectId}
                AND execution."companyEntityIdSnapshot" = ${participant.companyEntityId}
            )
            OR EXISTS (
              SELECT 1
              FROM "SpotProcurementPayment" payment
              WHERE payment."projectId" = ${projectId}
                AND payment."invalidatedAt" IS NULL
                AND payment."status" IN ('approved_pending_payment', 'partially_paid', 'paid')
                AND payment."payerCompanyEntityId" = ${participant.companyEntityId}
            )
          ) AS "hasFormalFacts"
        `
      );
      if (formalFactResult?.hasFormalFacts) {
        throw new BadRequestException(
          "该公司已有正式经营事实，只能停止新增业务，不能删除"
        );
      }

      await tx.projectParticipatingCompany.delete({ where: { id: participant.id } });
      await this.audit.record(tx, {
        actorUserId,
        action: "project.participating_company.remove",
        businessType: "project_participating_company",
        businessId: participant.id,
        metadata: { projectId, companyEntityId: participant.companyEntityId }
      });
      return { removed: true, participantId: participant.id };
    }));
  }

  async deactivateParticipatingCompany(
    projectId: string,
    participantId: string,
    actorUserId: string,
    input: DeactivateProjectParticipatingCompanyInput
  ) {
    const endedAt = requiredDateOnly(input.endedOn, "停止新增业务日期");
    const changeReason = requiredText(input.changeReason, "请填写停止新增业务原因");

    return translateOperatingProfileConstraint(this.prisma.$transaction(async (tx) => {
      await this.assertProjectFinanceManager(tx, actorUserId, projectId);
      await tx.$queryRaw(Prisma.sql`
        SELECT "id" FROM "Project" WHERE "id" = ${projectId} FOR UPDATE
      `);
      const [participant] = await tx.$queryRaw<
        Array<{
          id: string;
          projectId: string;
          companyEntityId: string;
          effectiveFrom: Date;
          endedAt: Date | null;
        }>
      >(Prisma.sql`
        SELECT "id", "projectId", "companyEntityId", "effectiveFrom", "endedAt"
        FROM "ProjectParticipatingCompany"
        WHERE "id" = ${participantId} AND "projectId" = ${projectId}
        FOR UPDATE
      `);
      if (!participant) {
        throw new NotFoundException("项目参与公司不存在，请刷新后重试");
      }
      if (participant.endedAt) {
        throw new BadRequestException("该公司已经停止新增业务，请刷新后重试");
      }
      if (endedAt.getTime() < participant.effectiveFrom.getTime()) {
        throw new BadRequestException("停止新增业务日期不能早于参与公司生效日");
      }

      const [laterFact] = await tx.$queryRaw<Array<{ occurredAt: Date }>>(Prisma.sql`
        SELECT fact."occurredAt" FROM (
          SELECT COALESCE(version."effectiveAt", version."createdAt") AS "occurredAt"
            FROM "ContractVersion" version INNER JOIN "Contract" contract ON contract."id" = version."contractId"
            WHERE contract."projectId" = ${projectId} AND version."status" = 'effective'
              AND (contract."companyEntityId" = ${participant.companyEntityId} OR version."companyEntityIdSnapshot" = ${participant.companyEntityId})
          UNION ALL SELECT fact."signedAt" FROM "ProjectAffiliateCompanyContract" fact
            WHERE fact."projectId" = ${projectId} AND fact."companyEntityId" = ${participant.companyEntityId} AND fact."status" = 'confirmed'
          UNION ALL SELECT COALESCE(claim."approvedAt", claim."createdAt") FROM "ExpenseClaim" claim
            WHERE claim."projectId" = ${projectId} AND claim."voidedAt" IS NULL
              AND claim."status" IN ('approved_pending_payment','partially_paid','paid','approved_pending_disbursement','partially_disbursed','disbursed','offset_completed')
              AND (claim."companyEntityId" = ${participant.companyEntityId} OR claim."paymentSubjectCompanyEntityId" = ${participant.companyEntityId})
          UNION ALL SELECT execution."paidAt" FROM "PaymentExecutionAllocation" allocation
            INNER JOIN "PaymentExecution" execution ON execution."id" = allocation."paymentExecutionId"
            WHERE allocation."projectId" = ${projectId} AND execution."companyEntityIdSnapshot" = ${participant.companyEntityId}
          UNION ALL SELECT COALESCE(payment."approvedAt", payment."createdAt") FROM "SpotProcurementPayment" payment
            WHERE payment."projectId" = ${projectId} AND payment."payerCompanyEntityId" = ${participant.companyEntityId}
              AND payment."invalidatedAt" IS NULL AND payment."status" IN ('approved_pending_payment','partially_paid','paid')
        ) fact
        WHERE fact."occurredAt"::DATE >= ${endedAt}::DATE
        LIMIT 1
      `);
      if (laterFact) {
        throw new BadRequestException("停止日期当日或之后已有正式经营事实，不能截断参与期间");
      }

      const updated = await tx.projectParticipatingCompany.update({
        where: { id: participant.id },
        data: { endedAt, endedByUserId: actorUserId, changeReason }
      });
      await this.audit.record(tx, {
        actorUserId,
        action: "project.participating_company.deactivate",
        businessType: "project_participating_company",
        businessId: participant.id,
        metadata: {
          projectId,
          companyEntityId: participant.companyEntityId,
          endedOn: input.endedOn,
          changeReason
        }
      });
      return toParticipatingCompanyReadModel(updated);
    }));
  }

  private async assertProjectFinanceManager(
    tx: Prisma.TransactionClient,
    actorUserId: string,
    projectId: string
  ) {
    const allowed = await this.isProjectFinanceManager(actorUserId, projectId, tx);
    if (!allowed) {
      throw new ForbiddenException("只有当前项目财务人员可以维护项目经营档案");
    }
  }

  private async isProjectFinanceManager(
    actorUserId: string,
    projectId: string,
    client: Prisma.TransactionClient | PrismaService = this.prisma
  ) {
    const actor = await client.user.findUnique({
      where: { id: actorUserId },
      select: { id: true, isActive: true }
    });
    if (!actor?.isActive) {
      throw new ForbiddenException("当前账号不存在或已停用");
    }

    const [projectPositions, projectMembers] = await Promise.all([
      client.userPosition.findMany({
        where: { userId: actorUserId, projectId },
        select: { positionId: true }
      }),
      client.projectMember.findMany({
        where: { userId: actorUserId, projectId },
        select: { positionKey: true }
      })
    ]);
    const positionIds = [...new Set(projectPositions.map((row) => row.positionId))];
    const positions = positionIds.length
      ? await client.position.findMany({
          where: { id: { in: positionIds } },
          select: { key: true }
        })
      : [];
    return [...projectMembers.map((row) => row.positionKey), ...positions.map((row) => row.key)]
      .some((key) => key === "finance_staff" || key === "finance_director");
  }
}

function optionalDateOnly(value: string | null, label: string): Date | null {
  if (value === null) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new BadRequestException(`${label}格式不正确，请重新选择`);
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new BadRequestException(`${label}格式不正确，请重新选择`);
  }
  return date;
}

function requiredDateOnly(value: string, label: string): Date {
  return optionalDateOnly(requiredText(value, `请选择${label}`), label) as Date;
}

function requiredText(value: unknown, message: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new BadRequestException(message);
  }
  return value.trim();
}

function toProfileReadModel(profile: {
  id: string;
  operatingLedgerEffectiveDate: Date | null;
  takeoverCompletedDate: Date | null;
  takeoverStatus: string;
}) {
  return {
    projectId: profile.id,
    operatingLedgerEffectiveDate:
      profile.operatingLedgerEffectiveDate?.toISOString().slice(0, 10) ?? null,
    takeoverCompletedDate:
      profile.takeoverCompletedDate?.toISOString().slice(0, 10) ?? null,
    takeoverStatus: profile.takeoverStatus
  };
}

function toParticipatingCompanyReadModel(participant: {
  id: string;
  companyEntityId: string;
  companyNameSnapshot: string;
  companyCreditCodeSnapshot: string | null;
  effectiveFrom: Date;
  endedAt: Date | null;
  changeReason: string;
}) {
  const today = businessDateOnly();
  const effectiveFrom = dateOnly(participant.effectiveFrom);
  const endedAt = participant.endedAt ? dateOnly(participant.endedAt) : null;
  return {
    id: participant.id,
    companyEntityId: participant.companyEntityId,
    companyName: participant.companyNameSnapshot,
    companyCreditCode: participant.companyCreditCodeSnapshot,
    effectiveFrom,
    endedAt,
    changeReason: participant.changeReason,
    status: effectiveFrom > today
      ? "scheduled_active"
      : !endedAt
        ? "active"
        : endedAt <= today
          ? "inactive"
          : "scheduled_inactive"
  };
}

function dateOnly(value: Date) {
  return value.toISOString().slice(0, 10);
}

function businessDateOnly(now = new Date()) {
  const values = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(now).map((part) => [part.type, part.value])
  );
  return `${values.year}-${values.month}-${values.day}`;
}
