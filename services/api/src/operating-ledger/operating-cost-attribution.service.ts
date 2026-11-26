import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { canPerform, chinaDateOnly, type RoleKey } from "@jiangkong/shared-domain";
import { AuditService } from "../audit/audit.service";
import { AuthService } from "../auth/auth.service";
import { ProjectVisibilityService } from "../auth/project-visibility.service";
import { PrismaService } from "../database/prisma.service";
import { isPostgresSerializationFailure } from "../project/project-operating-constraint";
import {
  settlementDedupKey,
  settlementEconomicIdentity
} from "./settlement-source-dedup";

import {
  expenseCashCostAvailable, expenseCashCostEligibility, expenseCashCostEvidenceSelect, lockExpenseCashCostEvidence
} from "./expense-cash-cost-attribution";

export interface CostAttributionCandidate {
  factId: string;
  expenseCashCostLinkId?: string;
  sourceType: string;
  sourceBusinessCode: string;
  occurredAt: string;
  amountCents: string;
  description: string | null;
  companyName: string;
  activeConfirmationId: string | null;
  activeStatus: string | null;
  cashEvidenceChanged?: boolean;
}

export interface CostAttributionReadModel {
  id: string;
  factId: string;
  expenseCashCostLinkId?: string;
  attributedAmountCents?: string;
  factCode: string;
  status: string;
  statusLabel: string;
  companyEntityId: string;
  companyEntityVersionId: string;
  companyName: string;
  reason: string;
  requestedByUserId: string;
  requestedAt: string;
  reviewedByUserId: string | null;
  reviewedAt: string | null;
  reviewReason: string | null;
  revision: number;
}

const STATUS_LABELS: Record<string, string> = {
  pending_review: "待财务主管确认",
  confirmed: "已确认归属",
  returned: "已退回"
};

const ROLE_KEYS = {
  request: "operating_cost_attribution.request",
  review: "operating_cost_attribution.review"
} as const;

function expenseCashCostDay(at: Date): Date {
  return new Date(`${chinaDateOnly(at)}T00:00:00.000Z`);
}

function translateExpenseCashCostConflict(error: unknown): never {
  const target = error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002" ? error.meta?.target : null;
  const duplicate = Array.isArray(target) && (target.includes("idempotencyKey") ||
    (target.includes("operatingFactId") && target.includes("activeKey")));
  if (duplicate || isPostgresSerializationFailure(error)) {
    throw new ConflictException("公共现金归属记录或实付净额已有变化，请刷新后重试", { cause: error });
  }
  throw error;
}

@Injectable()
export class OperatingCostAttributionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly visibility: ProjectVisibilityService,
    private readonly audit: AuditService,
    private readonly auth: AuthService
  ) {}

  async list(projectId: string, actor: string) {
    const roles = await this.requireProject(this.prisma, projectId, actor);
    if (
      !canPerform("operating_cost_attribution.request", roles) &&
      !canPerform("operating_cost_attribution.review", roles)
    ) {
      throw new ForbiddenException("当前岗位无权处理公共现金成本归属");
    }
    return this.prisma.$transaction(async (tx) => ({
      candidates: [
        ...await this.readCandidates(tx, projectId),
        ...await this.readExpenseCashCostCandidates(tx, projectId)
      ],
      confirmations: (
        await tx.operatingCostAttributionConfirmation.findMany({
          where: { projectId },
          orderBy: [{ requestedAt: "desc" }, { id: "asc" }]
        })
      ).map((row) => this.readModel(row))
    }));
  }

  async request(
    projectId: string,
    factId: string,
    input: {
      companyEntityId: string;
      reason: string;
      idempotencyKey: string;
      expenseCashCostLinkId?: string;
    },
    actor: string
  ) {
    const reason = input.reason?.trim();
    if (!reason) throw new BadRequestException("请填写归属确认原因");
    const companyEntityId = input.companyEntityId?.trim();
    if (!companyEntityId) throw new BadRequestException("请选择成本承担公司");
    const idempotencyKey = input.idempotencyKey?.trim();
    if (!idempotencyKey) throw new BadRequestException("缺少幂等键");
    const operation = this.prisma.$transaction(
      async (tx) => {
        const roles = await this.requireProject(tx, projectId, actor);
        if (!canPerform(ROLE_KEYS.request, roles)) {
          throw new ForbiddenException("仅综合部主管或财务可以发起成本归属确认");
        }
        const existing = await tx.operatingCostAttributionConfirmation.findUnique({
          where: { idempotencyKey }
        });
        if (existing) {
          if (
            existing.projectId !== projectId ||
            existing.operatingFactId !== factId ||
            (existing.expenseCashCostLinkId ?? undefined) !== input.expenseCashCostLinkId ||
            (input.expenseCashCostLinkId && (existing.companyEntityId !== companyEntityId &&
              existing.companyEntityVersionId !== companyEntityId || existing.reason !== reason ||
              existing.requestedByUserId !== actor))
          ) {
            throw new ConflictException("幂等键已用于其他成本归属确认");
          }
          return this.readModel(existing);
        }
        if (input.expenseCashCostLinkId) {
          const { evidence, amount } = await lockExpenseCashCostEvidence(tx, projectId, factId, input.expenseCashCostLinkId);
          const company = await this.resolveCompanyAtFactDate(tx, projectId, companyEntityId, expenseCashCostDay(evidence.costImpact.fact.occurredAt));
          const activeKey = `cash:${evidence.id}`;
          const active = await tx.operatingCostAttributionConfirmation.findFirst({
            where: { projectId, operatingFactId: factId, activeKey }, select: { id: true }
          });
          if (active) throw new ConflictException("这笔原费用现金分摊已有归属确认");
          const created = await tx.operatingCostAttributionConfirmation.create({
            data: {
              projectId, operatingFactId: factId, operatingFactProjectId: projectId,
              expenseCashCostLinkId: evidence.id, attributedAmountCents: amount, status: "pending_review", activeKey,
              companyEntityId: company.companyEntityId, companyEntityVersionId: company.companyEntityVersionId,
              companyNameSnapshot: company.companyNameSnapshot, companyCreditCodeSnapshot: company.companyCreditCodeSnapshot,
              reason, requestedByUserId: actor, idempotencyKey
            }
          });
          await this.audit.record(tx, {
            actorUserId: actor, action: "operating_cost_attribution.requested", businessType: "operating_fact", businessId: factId,
            metadata: { confirmationId: created.id, companyEntityId: company.companyEntityId,
              expenseCashCostLinkId: evidence.id, attributedAmountCents: amount.toString() }
          });
          return this.readModel(created);
        }
        const fact = await tx.operatingFact.findFirst({
          where: {
            id: factId,
            projectId,
            status: "confirmed",
            evidenceLevel: { not: "C" },
            actualPayerSubjectKind: "public_cash",
            actualPayerSubjectId: "public_cash",
            costBearingCompanySubjectKind: null,
            costBearingCompanySubjectId: null
          },
          select: {
            id: true,
            projectId: true,
            sourceType: true,
            sourceBusinessId: true,
            sourceBusinessCode: true,
            sourceSnapshot: true,
            occurredAt: true,
            amountCents: true,
            impacts: {
              where: { impactKind: "confirmed_cost" },
              select: { amountCents: true, direction: true, description: true }
            }
          }
        });
        if (!fact) {
          throw new ConflictException(
            "该事实不是待归属的公共现金成本事实，可能已确认归属或金额资料不完整"
          );
        }
        const cashImpact = await tx.operatingImpactEntry.findFirst({
          where: {
            factId,
            projectId,
            impactKind: "public_cash_funds_decrease"
          },
          select: { id: true }
        });
        if (!cashImpact) {
          throw new ConflictException("该事实缺少公共现金支付分录，不能确认成本归属");
        }
        if (!fact.impacts.length) {
          throw new ConflictException("该事实没有已确认成本，不能确认归属");
        }
        const company = await this.resolveCompanyAtFactDate(
          tx,
          projectId,
          companyEntityId,
          fact.occurredAt
        );
        const identity = settlementEconomicIdentity(
          fact.sourceType,
          fact.sourceSnapshot
        );
        const sourceDedupKey = identity ? settlementDedupKey(identity) : null;
        if (sourceDedupKey) {
          const duplicate = await tx.operatingCostAttributionConfirmation.findFirst({
            where: {
              projectId,
              sourceDedupKey,
              status: "confirmed",
              operatingFactId: { not: factId }
            },
            select: { id: true }
          });
          if (duplicate) {
            throw new ConflictException(
              "同一合同版本的同一结算期次已确认归属到其他成本事实，请先核对"
            );
          }
        }
        const created = await tx.operatingCostAttributionConfirmation.create({
          data: {
            projectId,
            operatingFactId: factId,
            operatingFactProjectId: projectId,
            sourceDedupKey,
            status: "pending_review",
            activeKey: "active",
            companyEntityId: company.companyEntityId,
            companyEntityVersionId: company.companyEntityVersionId,
            companyNameSnapshot: company.companyNameSnapshot,
            companyCreditCodeSnapshot: company.companyCreditCodeSnapshot,
            reason,
            requestedByUserId: actor,
            idempotencyKey
          }
        });
        await this.audit.record(tx, {
          actorUserId: actor,
          action: "operating_cost_attribution.requested",
          businessType: "operating_fact",
          businessId: factId,
          metadata: {
            confirmationId: created.id,
            companyEntityId: company.companyEntityId,
            sourceDedupKey
          }
        });
        return this.readModel(created);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
    return input.expenseCashCostLinkId ? operation.catch(translateExpenseCashCostConflict) : operation;
  }

  async review(
    projectId: string,
    confirmationId: string,
    input: {
      decision: "confirm" | "return";
      revision: number;
      reason?: string;
      password?: string;
    },
    actor: string
  ) {
    let linked = false;
    return this.prisma.$transaction(
      async (tx) => {
        const roles = await this.requireProject(tx, projectId, actor);
        if (!canPerform(ROLE_KEYS.review, roles)) {
          throw new ForbiddenException("仅财务主管可以确认成本归属");
        }
        const row = await tx.operatingCostAttributionConfirmation.findFirst({
          where: { id: confirmationId, projectId }
        });
        if (!row) throw new NotFoundException("成本归属确认不存在");
        linked = Boolean(row.expenseCashCostLinkId);
        if (row.status === "confirmed") {
          if (row.expenseCashCostLinkId && (input.decision !== "confirm" || actor !== row.reviewedByUserId ||
              input.revision !== row.revision - 1 || (input.reason?.trim() || null) !== row.reviewReason)) {
            throw new ConflictException("已确认归属的复核凭据与本次提交不同");
          }
          return this.readModel(row);
        }
        if (row.status !== "pending_review") {
          if (row.expenseCashCostLinkId && row.status === "returned" && input.decision === "return" &&
              actor === row.reviewedByUserId && input.revision === row.revision - 1 && input.reason?.trim() === row.reviewReason) {
            return this.readModel(row);
          }
          throw new ConflictException("该成本归属确认已退回，请重新发起");
        }
        if (row.revision !== input.revision) {
          throw new ConflictException("成本归属确认已更新，请刷新后重试");
        }
        const reviewReason = input.reason?.trim() ?? "";
        if (row.requestedByUserId === actor) {
          if (!reviewReason || !input.password?.trim()) {
            throw new BadRequestException("本人发起后自审须填写原因并确认本人密码");
          }
          await this.auth.confirmPassword(actor, input.password);
        }
        if (input.decision === "return") {
          if (!reviewReason) throw new BadRequestException("请填写退回原因");
          const updated = await tx.operatingCostAttributionConfirmation.updateMany({
            where: {
              id: confirmationId,
              projectId,
              status: "pending_review",
              revision: input.revision
            },
            data: {
              status: "returned",
              activeKey: null,
              reviewedByUserId: actor,
              reviewedAt: new Date(),
              reviewReason,
              revision: { increment: 1 }
            }
          });
          if (updated.count !== 1) {
            throw new ConflictException("成本归属确认已更新，请刷新后重试");
          }
          await this.audit.record(tx, {
            actorUserId: actor,
            action: "operating_cost_attribution.returned",
            businessType: "operating_fact",
            businessId: row.operatingFactId,
            metadata: { confirmationId, reason: reviewReason }
          });
          const current = await tx.operatingCostAttributionConfirmation.findUniqueOrThrow({
            where: { id: confirmationId }
          });
          return this.readModel(current);
        }
        if (row.expenseCashCostLinkId) {
          const { amount } = await lockExpenseCashCostEvidence(tx, projectId, row.operatingFactId, row.expenseCashCostLinkId);
          if (amount !== row.attributedAmountCents) {
            throw new ConflictException("实付净额已变化，请退回后按当前可归属金额重新发起");
          }
        }
        // 确认时重新核对事实仍未归属，且承担公司在事实日有效。
        const fact = await tx.operatingFact.findFirst({
          where: {
            id: row.operatingFactId,
            projectId,
            status: "confirmed",
            costBearingCompanySubjectKind: null,
            costBearingCompanySubjectId: null
          },
          select: { id: true, occurredAt: true }
        });
        if (!fact) {
          throw new ConflictException("原成本事实已非待归属状态，不能确认");
        }
        await this.resolveCompanyAtFactDate(
          tx,
          projectId,
          row.companyEntityVersionId,
          linked ? expenseCashCostDay(fact.occurredAt) : fact.occurredAt
        );
        const updated = await tx.operatingCostAttributionConfirmation.updateMany({
          where: {
            id: confirmationId,
            projectId,
            status: "pending_review",
            revision: input.revision
          },
          data: {
            status: "confirmed",
            activeKey: row.activeKey,
            reviewedByUserId: actor,
            reviewedAt: new Date(),
            reviewReason: reviewReason || null,
            revision: { increment: 1 }
          }
        });
        if (updated.count !== 1) {
          throw new ConflictException("成本归属确认已更新，请刷新后重试");
        }
        await this.audit.record(tx, {
          actorUserId: actor,
          action: "operating_cost_attribution.confirmed",
          businessType: "operating_fact",
          businessId: row.operatingFactId,
          metadata: {
            confirmationId,
            companyEntityId: row.companyEntityId,
            sourceDedupKey: row.sourceDedupKey,
            ...(row.expenseCashCostLinkId ? { expenseCashCostLinkId: row.expenseCashCostLinkId,
              attributedAmountCents: row.attributedAmountCents?.toString() } : {}),
            selfReview: row.requestedByUserId === actor
          }
        });
        const current = await tx.operatingCostAttributionConfirmation.findUniqueOrThrow({
          where: { id: confirmationId }
        });
        return this.readModel(current);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    ).catch(error => {
      if (linked) translateExpenseCashCostConflict(error);
      throw error;
    });
  }

  private async readCandidates(
    tx: Prisma.TransactionClient,
    projectId: string
  ): Promise<CostAttributionCandidate[]> {
    const facts = await tx.operatingFact.findMany({
      where: {
        projectId,
        status: "confirmed",
        evidenceLevel: { not: "C" },
        actualPayerSubjectKind: "public_cash",
        actualPayerSubjectId: "public_cash",
        costBearingCompanySubjectKind: null,
        costBearingCompanySubjectId: null,
        impacts: {
          some: {
            impactKind: "public_cash_funds_decrease"
          }
        }
      },
      select: {
        id: true,
        sourceType: true,
        sourceBusinessCode: true,
        occurredAt: true,
        amountCents: true,
        impacts: {
          where: { impactKind: "confirmed_cost" },
          select: { amountCents: true, direction: true, description: true }
        }
      },
      orderBy: [{ occurredAt: "desc" }, { id: "asc" }],
      take: 200
    });
    if (!facts.length) return [];
    const confirmations =
      await tx.operatingCostAttributionConfirmation.findMany({
        where: {
          projectId,
          operatingFactId: { in: facts.map((fact) => fact.id) },
          activeKey: "active"
        },
        select: { id: true, operatingFactId: true, status: true }
      });
    const confirmationByFact = new Map(
      confirmations.map((row) => [row.operatingFactId, row])
    );
    const confirmedFactIds = new Set(
      confirmations
        .filter((row) => row.status === "confirmed")
        .map((row) => row.operatingFactId)
    );
    return facts
      .filter(
        (fact) => fact.impacts.length > 0 && !confirmedFactIds.has(fact.id)
      )
      .map((fact) => {
        const amount = fact.impacts.reduce(
          (sum, impact) =>
            sum +
            (impact.direction === "decrease"
              ? -(impact.amountCents ?? 0n)
              : impact.amountCents ?? 0n),
          0n
        );
        const active = confirmationByFact.get(fact.id);
        return {
          factId: fact.id,
          sourceType: fact.sourceType,
          sourceBusinessCode: fact.sourceBusinessCode,
          occurredAt: fact.occurredAt.toISOString(),
          amountCents: amount.toString(),
          description: fact.impacts[0]?.description ?? null,
          companyName: "公共现金",
          activeConfirmationId: active?.id ?? null,
          activeStatus: active?.status ?? null
        };
      });
  }

  private async readExpenseCashCostCandidates(
    tx: Prisma.TransactionClient, projectId: string
  ): Promise<CostAttributionCandidate[]> {
    const links = await tx.expensePublicCashCostLink.findMany({
      where: expenseCashCostEligibility(projectId),
      select: expenseCashCostEvidenceSelect,
      orderBy: [{ costImpact: { fact: { occurredAt: "desc" } } }, { id: "asc" }],
      take: 200
    });
    const active = links.length
      ? await tx.operatingCostAttributionConfirmation.findMany({
          where: { projectId, expenseCashCostLinkId: { in: links.map(link => link.id) }, status: { in: ["pending_review", "confirmed"] } },
          select: { id: true, status: true, expenseCashCostLinkId: true, attributedAmountCents: true }
        })
      : [];
    const byLink = new Map(active.map(row => [row.expenseCashCostLinkId, row]));
    return links.flatMap(link => {
      const row = byLink.get(link.id);
      if (row?.status === "confirmed") return [];
      const available = expenseCashCostAvailable(link);
      const amount = row?.attributedAmountCents ?? available;
      if (amount <= 0n) return [];
      const { costImpact: { fact, factId, description } } = link;
      return [{
        factId, expenseCashCostLinkId: link.id, sourceType: fact.sourceType, sourceBusinessCode: fact.sourceBusinessCode,
        occurredAt: fact.occurredAt.toISOString(), amountCents: amount.toString(), description, companyName: "公共现金",
        activeConfirmationId: row?.id ?? null, activeStatus: row?.status ?? null,
        cashEvidenceChanged: row?.status === "pending_review" && available !== amount
      }];
    });
  }

  private async resolveCompanyAtFactDate(
    tx: Prisma.TransactionClient,
    projectId: string,
    companyEntityVersionId: string,
    occurredAt: Date
  ) {
    const company = await tx.projectParticipatingCompany.findFirst({
      where: {
        projectId,
        AND: [
          {
            OR: [
              { companyEntityVersionId },
              { companyEntityId: companyEntityVersionId }
            ]
          },
          { effectiveFrom: { lte: occurredAt } },
          { OR: [{ endedAt: null }, { endedAt: { gt: occurredAt } }] }
        ]
      },
      select: {
        companyEntityId: true,
        companyEntityVersionId: true,
        companyNameSnapshot: true,
        companyCreditCodeSnapshot: true
      }
    });
    if (!company) {
      throw new BadRequestException(
        "所选公司在该成本事实发生日未参与本项目，不能确认归属"
      );
    }
    return company;
  }

  private async requireProject(
    client: Prisma.TransactionClient | PrismaService,
    projectId: string,
    actor: string
  ): Promise<RoleKey[]> {
    const roles = await this.visibility.effectiveRoleKeysByProjectInTransaction(
      client as Prisma.TransactionClient,
      actor,
      [projectId]
    );
    const project = await client.project.findFirst({
      where: { id: projectId, isActive: true },
      select: { id: true }
    });
    if (!project) throw new NotFoundException("项目不存在或已停用");
    const roleKeys = roles.get(projectId) ?? [];
    if (!roleKeys.length) throw new ForbiddenException("无权读取该项目");
    return roleKeys;
  }

  private readModel(row: {
    id: string;
    operatingFactId: string;
    expenseCashCostLinkId?: string | null;
    attributedAmountCents?: bigint | null;
    status: string;
    companyEntityId: string;
    companyEntityVersionId: string;
    companyNameSnapshot: string;
    reason: string;
    requestedByUserId: string;
    requestedAt: Date;
    reviewedByUserId: string | null;
    reviewedAt: Date | null;
    reviewReason: string | null;
    revision: number;
    operatingFact?: { sourceBusinessCode: string } | null;
  }): CostAttributionReadModel {
    return {
      id: row.id,
      factId: row.operatingFactId,
      ...(row.expenseCashCostLinkId && row.attributedAmountCents !== null ? {
        expenseCashCostLinkId: row.expenseCashCostLinkId, attributedAmountCents: row.attributedAmountCents?.toString()
      } : {}),
      factCode: row.operatingFact?.sourceBusinessCode ?? "",
      status: row.status,
      statusLabel: STATUS_LABELS[row.status] ?? row.status,
      companyEntityId: row.companyEntityId,
      companyEntityVersionId: row.companyEntityVersionId,
      companyName: row.companyNameSnapshot,
      reason: row.reason,
      requestedByUserId: row.requestedByUserId,
      requestedAt: row.requestedAt.toISOString(),
      reviewedByUserId: row.reviewedByUserId,
      reviewedAt: row.reviewedAt?.toISOString() ?? null,
      reviewReason: row.reviewReason,
      revision: row.revision
    };
  }
}
