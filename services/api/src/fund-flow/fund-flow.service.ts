import {
  BadRequestException,
  ForbiddenException,
  Injectable
} from "@nestjs/common";
import { canPerform } from "@jiangkong/shared-domain";
import { AuditService } from "../audit/audit.service";
import { ProjectVisibilityService } from "../auth/project-visibility.service";
import {
  buildLedgerWorkbook,
  shanghaiDateStamp,
  type LedgerExcelColumn
} from "../core-flow/ledger-excel";
import { PrismaService } from "../database/prisma.service";

/**
 * FND-23 资金流水读取模型。
 *
 * 行来自正式经营事实的现金影响分录（与经营总览同一事实源），不另建影子流水。
 * 到账/付款/转入/转出/退款按来源与事实类型分类；余额变化按持有主体逐笔滚动。
 * 权限：财务、财务主管、综合主管、总经理、董事长看全部可见项目；
 * 项目经理只看自己项目相关资金。导出与列表同一筛选与权限。
 */
export const FUND_FLOW_TYPES = [
  "receipt",
  "payment",
  "transfer_in",
  "transfer_out",
  "refund"
] as const;
export type FundFlowType = (typeof FUND_FLOW_TYPES)[number];

const CASH_IMPACT_KINDS = [
  "construction_enterprise_funds_increase",
  "construction_enterprise_funds_decrease",
  "company_project_funds_increase",
  "company_project_funds_decrease",
  "public_cash_funds_decrease"
] as const;

const TYPE_LABELS: Record<FundFlowType, string> = {
  receipt: "到账",
  payment: "付款",
  transfer_in: "转入",
  transfer_out: "转出",
  refund: "退款"
};

export interface FundFlowRow {
  [key: string]: unknown;
  id: string;
  factId: string;
  impactId: string;
  projectId: string;
  projectCode: string;
  projectName: string;
  occurredAt: string;
  holderKind: string;
  holderId: string;
  holderName: string;
  direction: "in" | "out";
  directionLabel: "流入" | "流出";
  type: FundFlowType;
  typeLabel: string;
  amountCents: string;
  balanceAfterCents: string;
  sourceType: string;
  sourceTypeLabel: string;
  sourceBusinessCode: string;
  description: string | null;
}

export interface FundFlowPage {
  rows: FundFlowRow[];
  summary: {
    inflowCents: string;
    outflowCents: string;
    refundCents: string;
    rowCount: number;
  };
  meta: { page: number; pageSize: number; total: number; totalPages: number };
  filters: {
    projectId: string | null;
    companyEntityId: string | null;
    dateFrom: string | null;
    dateTo: string | null;
    type: FundFlowType | null;
  };
}

const SOURCE_LABELS: Record<string, string> = {
  payment_execution: "合同付款",
  expense_claim_payment_execution: "费用报销付款",
  spot_procurement_payment_execution: "零星材料付款",
  fund_execution: "资金执行",
  fund_movement: "资金调度",
  company_transfer_event: "公司互转",
  project_upstream_fund_fact: "施工企业资金",
  project_affiliate_payment_fact: "施工企业付款",
  spot_procurement_refund: "零星材料退款",
  payment_refund: "付款退款",
  owner_settlement: "业主结算",
  project_owner_settlement_entry: "业主结算登记"
};

function yuanNumber(cents: string): string {
  const value = BigInt(cents);
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const yuan = absolute / 100n;
  const fraction = (absolute % 100n).toString().padStart(2, "0");
  return `${negative ? "-" : ""}${yuan}.${fraction}`;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function classify(
  fact: { sourceType: string; factKind: string },
  direction: "in" | "out"
): FundFlowType {
  if (
    fact.sourceType.includes("refund") ||
    fact.factKind.includes("refund")
  ) {
    return "refund";
  }
  if (
    fact.factKind === "fund_movement" ||
    ["company_transfer_event", "fund_movement", "project_upstream_fund_fact"].includes(
      fact.sourceType
    )
  ) {
    return direction === "in" ? "transfer_in" : "transfer_out";
  }
  return direction === "in" ? "receipt" : "payment";
}

function holderName(
  fact: {
    affiliateNameSnapshot: string;
    subjectSnapshot: unknown;
  },
  kind: string,
  id: string
): string {
  if (kind === "construction_enterprise") return fact.affiliateNameSnapshot;
  if (kind === "public_cash") return "公共现金";
  const snapshot = record(fact.subjectSnapshot);
  for (const role of ["actualPayer", "debtor", "creditor", "payee"]) {
    const subject = record(snapshot[role]);
    if (
      (subject.id === id || subject.companyEntityId === id || subject.companyEntityVersionId === id) &&
      text(subject.name)
    ) {
      return text(subject.name)!;
    }
  }
  return "公司资料待核对";
}

/** 财务/综合/领导看全部可见项目；项目经理只保留自己项目。 */
export function allowedFundFlowProjectIds(
  visibleProjectIds: readonly string[],
  rolesByProject: ReadonlyMap<string, readonly string[]>
): string[] {
  return visibleProjectIds.filter((projectId) =>
    canPerform("fund_flow.read", (rolesByProject.get(projectId) ?? []) as never)
  );
}

@Injectable()
export class FundFlowService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly visibility: ProjectVisibilityService,
    private readonly audit: AuditService
  ) {}

  async list(projectId: string | null, actor: string, raw: Record<string, unknown>) {
    const filtered = await this.read(projectId, actor, raw);
    const page = this.page(raw.page);
    const pageSize = this.pageSize(raw.pageSize);
    const total = filtered.rows.length;
    const start = (page - 1) * pageSize;
    return {
      rows: filtered.rows.slice(start, start + pageSize),
      summary: filtered.summary,
      meta: {
        page,
        pageSize,
        total,
        totalPages: total === 0 ? 0 : Math.ceil(total / pageSize)
      },
      filters: filtered.filters
    } satisfies FundFlowPage;
  }

  async export(projectId: string | null, actor: string, raw: Record<string, unknown>) {
    const filtered = await this.read(projectId, actor, raw);
    const exportRows = filtered.rows.map((row) => ({
      ...row,
      amountCents: yuanNumber(row.amountCents),
      balanceAfterCents: yuanNumber(row.balanceAfterCents)
    }));
    const columns: LedgerExcelColumn<FundFlowRow>[] = [
      { header: "项目编号", key: "projectCode", required: true, width: 16 },
      { header: "项目名称", key: "projectName", required: true, width: 24 },
      { header: "发生时间", key: "occurredAt", required: true, width: 20 },
      { header: "资金主体", key: "holderName", required: true, width: 22 },
      { header: "方向", key: "directionLabel", required: true, width: 8 },
      { header: "类型", key: "typeLabel", required: true, width: 10 },
      { header: "金额（元）", key: "amountCents", required: true, width: 16, kind: "number", numFmt: "#,##0.00", total: "sum" },
      { header: "余额（元）", key: "balanceAfterCents", required: true, width: 16, kind: "number", numFmt: "#,##0.00" },
      { header: "来源", key: "sourceTypeLabel", required: true, width: 18 },
      { header: "业务编号", key: "sourceBusinessCode", required: true, width: 24 },
      { header: "说明", key: "description", width: 30 }
    ];
    const buffer = await buildLedgerWorkbook({
      sheetName: "资金流水",
      columns,
      rows: exportRows,
      totals: { label: "合计", note: "按当前筛选的全部可见流水" }
    });
    await this.audit.record(this.prisma, {
      actorUserId: actor,
      action: "fund_flow.export",
      businessType: "fund_flow",
      businessId: projectId,
      metadata: {
        rowCount: filtered.rows.length,
        type: filtered.filters.type
      }
    });
    return {
      buffer,
      fileName: `资金流水_${shanghaiDateStamp()}.xlsx`
    };
  }

  private async read(
    projectId: string | null,
    actor: string,
    raw: Record<string, unknown>
  ) {
    const filters = this.filters(raw);
    if (filters.projectId && projectId && filters.projectId !== projectId) {
      throw new BadRequestException("项目筛选不一致");
    }
    const selectedProjectId = projectId ?? filters.projectId;
    const allowedProjectIds = await this.prisma.$transaction(async (tx) => {
      const visible = await this.visibility.visibleProjectIdsInTransaction(tx, actor);
      if (!visible.length) throw new ForbiddenException("当前账号没有可见项目");
      const roles = await this.visibility.effectiveRoleKeysByProjectInTransaction(
        tx,
        actor,
        visible
      );
      return allowedFundFlowProjectIds(visible, roles);
    });
    if (selectedProjectId && !allowedProjectIds.includes(selectedProjectId)) {
      throw new ForbiddenException("无权读取该项目资金流水");
    }
    const projectIds = selectedProjectId ? [selectedProjectId] : allowedProjectIds;
    if (!projectIds.length) throw new ForbiddenException("当前岗位无权读取资金流水");
    const facts = await this.prisma.operatingFact.findMany({
      where: {
        projectId: { in: projectIds },
        status: "confirmed",
        evidenceLevel: { not: "C" },
        impacts: {
          some: { impactKind: { in: [...CASH_IMPACT_KINDS] } }
        },
        ...(filters.from || filters.to
          ? {
              occurredAt: {
                ...(filters.from ? { gte: this.dayStart(filters.from) } : {}),
                ...(filters.to ? { lt: this.dayEnd(filters.to) } : {})
              }
            }
          : {})
      },
      select: {
        id: true,
        projectId: true,
        sourceType: true,
        sourceBusinessCode: true,
        factKind: true,
        occurredAt: true,
        affiliateNameSnapshot: true,
        subjectSnapshot: true,
        impacts: {
          where: { impactKind: { in: [...CASH_IMPACT_KINDS] } },
          select: {
            id: true,
            impactKind: true,
            amountCents: true,
            direction: true,
            subjectKind: true,
            subjectId: true,
            description: true
          }
        }
      },
      orderBy: [{ occurredAt: "asc" }, { id: "asc" }]
    });
    const projects = await this.prisma.project.findMany({
      where: { id: { in: projectIds } },
      select: { id: true, code: true, name: true }
    });
    const projectById = new Map(projects.map((project) => [project.id, project]));
    const balances = new Map<string, bigint>();
    const rows: FundFlowRow[] = [];
    for (const fact of facts) {
      const project = projectById.get(fact.projectId);
      for (const impact of fact.impacts) {
        const kind = impact.subjectKind;
        const holderId = impact.subjectId;
        if (!kind || !holderId) continue;
        if (
          filters.companyEntityId &&
          !(
            kind === "participating_company" &&
            holderId === filters.companyEntityId
          )
        ) {
          continue;
        }
        const increase = impact.direction === "increase";
        const amount = impact.amountCents ?? 0n;
        if (amount === 0n) continue;
        const direction: "in" | "out" = increase ? "in" : "out";
        const type = classify(fact, direction);
        if (filters.type && filters.type !== type) continue;
        const holderKey = `${kind}\u0000${holderId}`;
        const balance =
          (balances.get(holderKey) ?? 0n) + (increase ? amount : -amount);
        balances.set(holderKey, balance);
        rows.push({
          id: `${fact.id}:${impact.id}`,
          factId: fact.id,
          impactId: impact.id,
          projectId: fact.projectId,
          projectCode: project?.code ?? "",
          projectName: project?.name ?? "项目资料待核对",
          occurredAt: fact.occurredAt.toISOString(),
          holderKind: kind,
          holderId,
          holderName: holderName(
            {
              affiliateNameSnapshot: fact.affiliateNameSnapshot,
              subjectSnapshot: fact.subjectSnapshot
            },
            kind,
            holderId
          ),
          direction,
          directionLabel: direction === "in" ? "流入" : "流出",
          type,
          typeLabel: TYPE_LABELS[type],
          amountCents: amount.toString(),
          balanceAfterCents: balance.toString(),
          sourceType: fact.sourceType,
          sourceTypeLabel: SOURCE_LABELS[fact.sourceType] ?? "其他资金事实",
          sourceBusinessCode: fact.sourceBusinessCode,
          description: impact.description ?? null
        });
      }
    }
    rows.sort(
      (left, right) =>
        right.occurredAt.localeCompare(left.occurredAt) ||
        right.id.localeCompare(left.id)
    );
    const inflow = rows
      .filter((row) => row.direction === "in" && row.type !== "refund")
      .reduce((sum, row) => sum + BigInt(row.amountCents), 0n);
    const outflow = rows
      .filter((row) => row.direction === "out" && row.type !== "refund")
      .reduce((sum, row) => sum + BigInt(row.amountCents), 0n);
    const refund = rows
      .filter((row) => row.type === "refund")
      .reduce((sum, row) => sum + BigInt(row.amountCents), 0n);
    return {
      rows,
      summary: {
        inflowCents: inflow.toString(),
        outflowCents: outflow.toString(),
        refundCents: refund.toString(),
        rowCount: rows.length
      },
      filters: {
        projectId: selectedProjectId,
        companyEntityId: filters.companyEntityId,
        dateFrom: filters.from,
        dateTo: filters.to,
        type: filters.type
      }
    };
  }

  private filters(raw: Record<string, unknown>) {
    const type = text(raw.type);
    if (type && !(FUND_FLOW_TYPES as readonly string[]).includes(type)) {
      throw new BadRequestException("资金流水类型不正确");
    }
    const from = text(raw.dateFrom);
    const to = text(raw.dateTo);
    for (const [label, value] of [["开始日期", from], ["结束日期", to]] as const) {
      if (value && !/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
        throw new BadRequestException(`${label}须为 YYYY-MM-DD`);
      }
    }
    return {
      projectId: text(raw.projectId),
      companyEntityId: text(raw.companyEntityId),
      from,
      to,
      type: type as FundFlowType | null
    };
  }

  private dayStart(date: string) {
    return new Date(`${date}T00:00:00+08:00`);
  }

  private dayEnd(date: string) {
    const end = new Date(`${date}T00:00:00+08:00`);
    end.setUTCDate(end.getUTCDate() + 1);
    return end;
  }

  private page(value: unknown) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 1;
  }

  private pageSize(value: unknown) {
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed <= 0) return 100;
    return Math.min(parsed, 500);
  }
}
