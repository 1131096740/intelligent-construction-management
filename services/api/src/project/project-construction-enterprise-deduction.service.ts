import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional
} from "@nestjs/common";
import { Prisma, type ProjectUpstreamFundFact } from "@prisma/client";
import { canPerform, type RoleKey } from "@jiangkong/shared-domain";
import { createHash } from "node:crypto";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../database/prisma.service";
import { moneyCentsToApi } from "../money/decimal-money";
import { readAffiliateSnapshot } from "../operating-ledger/formal-operating-source.helpers";
import { ProjectUpstreamFundBusinessEntryService } from "./project-upstream-fund-business-entry.service";
import type { RecordProjectConstructionEnterpriseDeductionDto } from "./dto/record-project-construction-enterprise-deduction.dto";

const DEDUCTION_FACT_TYPE = "affiliate_deduction";
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

function missingUpstreamFundBusinessEntryService(): ProjectUpstreamFundBusinessEntryService {
  return {
    freeze: async () => {
      throw new Error("上游资金统一录入快照服务未配置");
    }
  } as unknown as ProjectUpstreamFundBusinessEntryService;
}

function requiredText(value: string | undefined, message: string): string {
  const trimmed = value?.trim();
  if (!trimmed) throw new BadRequestException(message);
  return trimmed;
}

function optionalText(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function positiveMoney(value: string, message: string): bigint {
  const trimmed = value?.trim();
  if (!trimmed || !/^[1-9][0-9]*$/u.test(trimmed)) {
    throw new BadRequestException(message);
  }
  return BigInt(trimmed);
}

function parseDeductionDate(value: string): Date {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequestException("扣费发生日期格式不正确，请重新选择");
  }
  if (parsed.getTime() > Date.now()) {
    throw new BadRequestException("扣费发生日期不能晚于当前时间，请核对实际日期后重试");
  }
  return parsed;
}

function fingerprint(value: Record<string, unknown>): string {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

async function loadActorRoleKeys(
  tx: Prisma.TransactionClient,
  actorUserId: string,
  projectId: string
): Promise<RoleKey[]> {
  const [globalPositions, projectPositions, projectMembers] = await Promise.all([
    tx.userPosition.findMany({ where: { userId: actorUserId, projectId: null } }),
    tx.userPosition.findMany({ where: { userId: actorUserId, projectId } }),
    tx.projectMember.findMany({ where: { userId: actorUserId, projectId } })
  ]);
  const positionIds = [
    ...new Set(
      [...globalPositions, ...projectPositions].map((position) => position.positionId)
    )
  ];
  const positions = positionIds.length
    ? await tx.position.findMany({ where: { id: { in: positionIds } } })
    : [];
  return [
    ...new Set([
      ...positions.map((position) => position.key as RoleKey),
      ...projectMembers.map((member) => member.positionKey as RoleKey)
    ])
  ];
}

function signedAmount(fact: { effectDirection: string; amountCents: bigint }): bigint {
  return fact.effectDirection === "decrease" ? -fact.amountCents : fact.amountCents;
}

function toDeductionReadModel(fact: ProjectUpstreamFundFact) {
  return {
    id: fact.id,
    projectId: fact.projectId,
    feeName: fact.description ?? "",
    occurredAt: fact.occurredAt.toISOString(),
    amountCents: moneyCentsToApi(fact.amountCents),
    direction: fact.effectDirection,
    entryKind: fact.entryKind,
    adjustsFactId: fact.adjustsFactId,
    status: fact.status,
    basisType: fact.basisType,
    evidenceFileId: fact.evidenceFileId,
    deductionCategory: fact.deductionCategory,
    counterpartyName: fact.counterpartyName,
    confirmedAt: fact.confirmedAt?.toISOString() ?? null,
    createdAt: fact.createdAt.toISOString()
  };
}

function encodeCursor(position: { occurredAt: string; id: string }): string {
  return Buffer.from(JSON.stringify({ v: 1, ...position }), "utf8").toString(
    "base64url"
  );
}

function decodeCursor(cursor: string): { occurredAt: string; id: string } {
  try {
    const parsed = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8")
    ) as { v?: unknown; occurredAt?: unknown; id?: unknown };
    if (
      parsed.v !== 1 ||
      typeof parsed.occurredAt !== "string" ||
      typeof parsed.id !== "string" ||
      !parsed.id ||
      Number.isNaN(Date.parse(parsed.occurredAt))
    ) {
      throw new Error("游标内容错误");
    }
    return { occurredAt: parsed.occurredAt, id: parsed.id };
  } catch {
    throw new BadRequestException("扣费明细游标无效或与当前查询不匹配");
  }
}

/**
 * #414 / OPS-08：施工企业扣费简单登记。
 *
 * - 复用 ProjectUpstreamFundFact（factType=affiliate_deduction），零迁移；
 * - 只要求费用名称 + 实际金额 + 发生日期，已有书面依据可附；
 * - 扣费只减少施工企业持有资金：经营来源适配器只产
 *   construction_enterprise_funds_decrease，不产 confirmed_cost，
 *   也不进入施工企业已付（#413 已明确剔除扣费）；
 * - 登记先落 pending_confirm，沿用上游资金既有确认链路；实际确认后才进入口径；
 * - 重复登记按“同费用名称 + 同金额 + 同日期 + 未反向”拒绝；
 * - 更正复用 #413 的两段式（反转 + 重登），见 ProjectConstructionPaymentCorrectionService。
 */
@Injectable()
export class ProjectConstructionEnterpriseDeductionService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly audit: AuditService = new AuditService(),
    @Optional()
    private readonly businessEntry: ProjectUpstreamFundBusinessEntryService =
      missingUpstreamFundBusinessEntryService()
  ) {}

  async getCapability(projectId: string, actorUserId: string) {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, isActive: true },
      select: { id: true }
    });
    if (!project) throw new NotFoundException("项目不存在或已停用，请刷新后重试");
    const roleKeys = await loadActorRoleKeys(
      this.prisma as unknown as Prisma.TransactionClient,
      actorUserId,
      projectId
    );
    return {
      projectId,
      availableActions: canPerform("project.upstream_fund_fact.record", roleKeys)
        ? ["record_construction_enterprise_deduction"]
        : []
    };
  }

  async recordDeduction(
    projectId: string,
    actorUserId: string,
    input: RecordProjectConstructionEnterpriseDeductionDto
  ) {
    const feeName = requiredText(input.feeName, "请填写费用名称");
    const amountCents = positiveMoney(input.amountCents, "扣费金额必须大于零");
    const occurredAt = parseDeductionDate(input.occurredAt);
    const evidenceFileId = optionalText(input.evidenceFileId);
    const idempotencyKey = requiredText(input.idempotencyKey, "请提供扣费登记幂等键");
    const requestFingerprint = fingerprint({
      projectId,
      actorUserId,
      feeName,
      amountCents: amountCents.toString(),
      occurredAt: occurredAt.toISOString(),
      evidenceFileId: evidenceFileId ?? null
    });

    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw(
          Prisma.sql`SELECT "id" FROM "Project" WHERE "id" = ${projectId} FOR UPDATE`
        );
        const existing = await tx.projectUpstreamFundFact.findUnique({
          where: { idempotencyKey }
        });
        if (existing) {
          if (
            existing.projectId !== projectId ||
            existing.recordedByUserId !== actorUserId ||
            existing.requestFingerprint !== requestFingerprint
          ) {
            throw new ConflictException("扣费登记幂等键已用于不同请求");
          }
          return toDeductionReadModel(existing);
        }

        const project = await tx.project.findFirst({
          where: { id: projectId, isActive: true },
          select: { id: true }
        });
        if (!project) {
          throw new NotFoundException("项目不存在或已停用，请刷新后重试");
        }
        const roleKeys = await loadActorRoleKeys(tx, actorUserId, projectId);
        if (!canPerform("project.upstream_fund_fact.record", roleKeys)) {
          throw new ForbiddenException(
            "只有综合部主管、财务人员或财务主管可以登记施工企业扣费"
          );
        }

        const duplicate = await tx.projectUpstreamFundFact.findFirst({
          where: {
            projectId,
            factType: DEDUCTION_FACT_TYPE,
            entryKind: "original",
            occurredAt,
            amountCents,
            description: feeName,
            status: { in: ["pending_confirm", "confirmed"] }
          },
          select: { id: true }
        });
        if (duplicate) {
          const reversal = await tx.projectUpstreamFundFact.findFirst({
            where: {
              projectId,
              adjustsFactId: duplicate.id,
              entryKind: "reversal",
              status: { in: ["pending_confirm", "confirmed"] }
            },
            select: { id: true }
          });
          if (!reversal) {
            throw new ConflictException(
              "相同费用名称、金额和日期的施工企业扣费已登记，请核对后使用更正"
            );
          }
        }

        const affiliate = await readAffiliateSnapshot(tx, {
          projectId,
          occurredAt
        });
        const evidence = evidenceFileId
          ? await tx.fileObject.findUnique({
              where: { id: evidenceFileId },
              select: {
                id: true,
                uploadedByUserId: true,
                storageStatus: true,
                contentSha256: true
              }
            })
          : null;
        if (evidenceFileId && !evidence) {
          throw new NotFoundException("扣费依据文件不存在，请重新上传");
        }
        if (evidence && evidence.uploadedByUserId !== actorUserId) {
          throw new BadRequestException("只能使用本人上传的扣费依据文件");
        }
        if (
          evidence &&
          (evidence.storageStatus !== "active" ||
            typeof evidence.contentSha256 !== "string" ||
            evidence.contentSha256.length !== 64)
        ) {
          throw new BadRequestException("扣费依据文件尚未完成有效性校验");
        }

        const recordedByRoleKey = roleKeys.includes("finance_director")
          ? "finance_director"
          : roleKeys.includes("finance_staff")
            ? "finance_staff"
            : "comprehensive_director";
        const created = await tx.projectUpstreamFundFact.create({
          data: {
            projectId,
            factType: DEDUCTION_FACT_TYPE,
            entryKind: "original",
            effectDirection: "increase",
            occurredAt,
            amountCents,
            counterpartyName: affiliate.name,
            basisType: evidence ? "written" : "oral",
            deductionCategory: "other",
            affiliateAssignmentId: affiliate.assignmentId,
            affiliateBusinessPartyVersionId: affiliate.businessPartyVersionId,
            affiliateNameSnapshot: affiliate.name,
            description: feeName,
            evidenceFileId: evidence?.id ?? null,
            documentVersion: 1,
            fileContentSha256Snapshot: evidence?.contentSha256 ?? null,
            idempotencyKey,
            requestFingerprint,
            recordedByUserId: actorUserId,
            recordedByRoleKey,
            status: "pending_confirm"
          }
        });

        await this.businessEntry.freeze(tx, actorUserId, created);
        await this.audit.record(tx, {
          actorUserId,
          action: "project.construction_enterprise_deduction.record",
          businessType: "project_upstream_fund_fact",
          businessId: created.id,
          metadata: {
            projectId,
            factType: DEDUCTION_FACT_TYPE,
            feeName,
            amountCents: moneyCentsToApi(amountCents),
            occurredAt: occurredAt.toISOString(),
            basisType: created.basisType,
            evidenceFileId: created.evidenceFileId,
            fileContentSha256Snapshot: created.fileContentSha256Snapshot,
            affiliateAssignmentId: created.affiliateAssignmentId,
            affiliateBusinessPartyVersionId: created.affiliateBusinessPartyVersionId,
            idempotencyKey
          }
        });
        return toDeductionReadModel(created);
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const existing = await this.prisma.projectUpstreamFundFact.findUnique({
          where: { idempotencyKey }
        });
        if (
          existing?.projectId === projectId &&
          existing.recordedByUserId === actorUserId &&
          existing.requestFingerprint === requestFingerprint
        ) {
          return toDeductionReadModel(existing);
        }
        throw new ConflictException("扣费登记已由其他请求写入，请刷新后核对");
      }
      throw error;
    }
  }

  async listDeductions(
    projectId: string,
    input: { cursor?: string; pageSize?: number } = {}
  ) {
    const pageSize = input.pageSize ?? DEFAULT_PAGE_SIZE;
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE) {
      throw new BadRequestException("扣费明细每页条数必须是 1 到 200 的整数");
    }
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, isActive: true },
      select: { id: true }
    });
    if (!project) throw new NotFoundException("项目不存在或已停用，请刷新后重试");
    const position = input.cursor ? decodeCursor(input.cursor) : null;
    const cursorAt = position ? new Date(position.occurredAt) : null;
    const where: Prisma.ProjectUpstreamFundFactWhereInput = {
      projectId,
      factType: DEDUCTION_FACT_TYPE,
      ...(position && cursorAt
        ? {
            OR: [
              { occurredAt: { lt: cursorAt } },
              { occurredAt: cursorAt, id: { lt: position.id } }
            ]
          }
        : {})
    };
    const [facts, confirmedIncrease, confirmedDecrease, pending] = await Promise.all([
      this.prisma.projectUpstreamFundFact.findMany({
        where,
        orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
        take: pageSize + 1
      }),
      this.prisma.projectUpstreamFundFact.aggregate({
        _sum: { amountCents: true },
        where: {
          projectId,
          factType: DEDUCTION_FACT_TYPE,
          status: "confirmed",
          effectDirection: "increase"
        }
      }),
      this.prisma.projectUpstreamFundFact.aggregate({
        _sum: { amountCents: true },
        where: {
          projectId,
          factType: DEDUCTION_FACT_TYPE,
          status: "confirmed",
          effectDirection: "decrease"
        }
      }),
      this.prisma.projectUpstreamFundFact.aggregate({
        _sum: { amountCents: true },
        where: {
          projectId,
          factType: DEDUCTION_FACT_TYPE,
          status: "pending_confirm"
        }
      })
    ]);
    const hasNext = facts.length > pageSize;
    const page = hasNext ? facts.slice(0, pageSize) : facts;
    const originalIds = page
      .filter((fact) => fact.entryKind === "original")
      .map((fact) => fact.id);
    const reversals = originalIds.length
      ? await this.prisma.projectUpstreamFundFact.findMany({
          where: {
            projectId,
            adjustsFactId: { in: originalIds },
            entryKind: "reversal",
            status: { in: ["pending_confirm", "confirmed"] }
          },
          select: { adjustsFactId: true }
        })
      : [];
    const reversedOriginalIds = new Set(
      reversals
        .map((reversal) => reversal.adjustsFactId)
        .filter((id): id is string => Boolean(id))
    );
    return {
      projectId,
      items: page.map((fact) => ({
        ...toDeductionReadModel(fact),
        signedAmountCents: moneyCentsToApi(signedAmount(fact)),
        hasReversal: reversedOriginalIds.has(fact.id),
        correctable:
          fact.entryKind === "original" &&
          fact.status === "confirmed" &&
          !reversedOriginalIds.has(fact.id)
      })),
      summary: {
        deductedCents: moneyCentsToApi(
          (confirmedIncrease._sum.amountCents ?? 0n) -
            (confirmedDecrease._sum.amountCents ?? 0n)
        ),
        pendingCents: moneyCentsToApi(pending._sum.amountCents ?? 0n)
      },
      nextCursor:
        hasNext && page.length > 0
          ? encodeCursor({
              occurredAt: page[page.length - 1].occurredAt.toISOString(),
              id: page[page.length - 1].id
            })
          : null
    };
  }
}
