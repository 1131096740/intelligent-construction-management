import { Injectable, Optional } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { CONTRACT_RELATIONSHIP_LABELS } from "@jiangkong/shared-domain";
import { AuditService } from "../audit/audit.service";
import { ProjectVisibilityService } from "../auth/project-visibility.service";
import {
  buildLedgerWorkbook,
  LEDGER_DATE_FORMAT,
  LEDGER_MONEY_FORMAT,
  shanghaiDateStamp,
  type LedgerExcelColumn
} from "../core-flow/ledger-excel";
import {
  matchesLedgerExportQuery,
  normalizeLedgerExportQuery,
  resolveLedgerExportColumns,
  sortLedgerRows,
  type NormalizedLedgerExportQuery
} from "../core-flow/ledger-export-query";
import { PrismaService } from "../database/prisma.service";

/**
 * 正式结算台账的读取岗位。
 *
 * 结算例外（UI-11）：只有主管复核通过的 `SignedContractSettlement`
 * 才进入正式台账；`draft`/`pending_review`/`returned` 留在办理工作台。
 * 行级可见性与已签结算登记列表一致：合同部主管/合同部人员可见，
 * 财务、综合、项目经理等有权查账岗位可见；其它岗位即使能看到项目也不可见。
 */
export const SIGNED_SETTLEMENT_LEDGER_READ_ROLE_KEYS = [
  "chairman",
  "general_manager",
  "contract_director",
  "contract_staff",
  "finance_staff",
  "finance_director",
  "comprehensive_director",
  "project_manager"
] as const;

const READ_ROLE_SET = new Set<string>(SIGNED_SETTLEMENT_LEDGER_READ_ROLE_KEYS);

const CONTRACT_KIND_LABELS: Record<string, string> = {
  downstream: "下游合同",
  outside_fact: "表外合同",
  upward: "对上合同"
};

export type SignedSettlementLedgerRow = {
  id: string;
  settlementId: string;
  settlementNo: string;
  confirmationNo: string | null;
  contractKind: string;
  contractKindLabel: string;
  relationship: string;
  relationshipLabel: string;
  contractName: string;
  projectId: string;
  project: string;
  signingParty: string;
  counterparty: string;
  amountYuan: string | null;
  amount: string;
  amountKnown: boolean;
  confirmedAt: string | null;
  confirmedDate: string | null;
  confirmedAtText: string;
  reviewerName: string;
  status: string;
  statusLabel: string;
  updatedAt: string;
};

export type SignedSettlementLedgerColumn = {
  key: string;
  header: string;
  required: boolean;
};

export interface SignedSettlementLedgerPage {
  rows: SignedSettlementLedgerRow[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
  summary: {
    total: number;
    knownAmountRows: number;
    unknownAmountRows: number;
    totalAmountYuan: string | null;
    projectCount: number;
    latestConfirmedAt: string | null;
  };
  filters: {
    projectId: string | null;
    dateFrom: string | null;
    dateTo: string | null;
    status: string | null;
    keyword: string | null;
  };
  columns: SignedSettlementLedgerColumn[];
}

@Injectable()
export class SignedSettlementLedgerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projectVisibility: ProjectVisibilityService,
    @Optional()
    private readonly audit?: AuditService
  ) {}

  async list(
    visibleProjectIds: string[],
    actorUserId: string,
    rawQuery?: Record<string, unknown>
  ): Promise<SignedSettlementLedgerPage> {
    const query = normalizeLedgerExportQuery(rawQuery);
    const rows = await this.readRows(visibleProjectIds, actorUserId, query);
    const page = this.page(rawQuery?.page);
    const pageSize = this.pageSize(rawQuery?.pageSize);
    const total = rows.length;
    return {
      rows: rows.slice((page - 1) * pageSize, page * pageSize),
      meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
      summary: this.summary(rows),
      filters: {
        projectId: query.projectId ?? null,
        dateFrom: query.dateFrom ?? null,
        dateTo: query.dateTo ?? null,
        status: query.status ?? null,
        keyword: query.keyword ?? null
      },
      columns: LEDGER_COLUMNS.map((column) => ({
        key: String(column.key),
        header: column.header,
        required: Boolean(column.required)
      }))
    };
  }

  async exportLedger(
    visibleProjectIds: string[],
    actorUserId: string,
    rawQuery?: Record<string, unknown>
  ): Promise<{ buffer: Buffer; fileName: string }> {
    const query = normalizeLedgerExportQuery(rawQuery);
    const rows = await this.readRows(visibleProjectIds, actorUserId, query);
    const selectedColumns = resolveLedgerExportColumns(LEDGER_COLUMNS, query.columnKeys);
    const buffer = await buildLedgerWorkbook({
      sheetName: "已签结算台账",
      columns: selectedColumns,
      // 未知金额写回业务文案（「待确定」），而不是空值或 0。
      rows: rows.map((row) => ({
        ...row,
        amountYuan: row.amountYuan ?? row.amount
      })),
      totals: { label: "合计", note: "不含待确定金额" },
      print: { landscape: true }
    });

    if (!this.audit) {
      throw new Error("已签结算台账导出审计服务暂不可用，请稍后重试");
    }
    await this.audit.record(this.prisma, {
      actorUserId,
      action: "settlement.signed_ledger.export",
      businessType: "signed_settlement_ledger",
      metadata: {
        exportedRows: rows.length,
        visibleProjectCount: visibleProjectIds.length,
        scope: "all_filtered_confirmed_signed_settlements",
        filters: {
          projectId: query.projectId ?? null,
          dateFrom: query.dateFrom ?? null,
          dateTo: query.dateTo ?? null,
          status: query.status ?? null,
          keyword: query.keyword ?? null
        },
        exportedColumns: selectedColumns.map((column) => String(column.key))
      }
    });

    return {
      buffer,
      fileName: `已签结算台账-${shanghaiDateStamp()}.xlsx`
    };
  }

  /**
   * 读取口径：已复核 `SignedContractSettlement`，跨项目按可见范围合并；
   * 旧 `Settlement` 不进入本台账（见 Issue #421 实施决策）。
   */
  private async readRows(
    visibleProjectIds: string[],
    actorUserId: string,
    query: NormalizedLedgerExportQuery
  ): Promise<SignedSettlementLedgerRow[]> {
    const projectScopes = query.projectId
      ? visibleProjectIds.filter((projectId) => projectId === query.projectId)
      : visibleProjectIds;
    if (projectScopes.length === 0) return [];

    const settlements = await this.prisma.signedContractSettlement.findMany({
      where: { projectId: { in: projectScopes }, state: "confirmed" },
      orderBy: [{ reviewedAt: "desc" }, { createdAt: "desc" }]
    });
    if (settlements.length === 0) return [];

    const projectIds = [...new Set(settlements.map((settlement) => settlement.projectId))];
    const reviewerIds = [
      ...new Set(
        settlements
          .map((settlement) => settlement.reviewedByUserId)
          .filter((id): id is string => typeof id === "string" && id.length > 0)
      )
    ];
    const [projects, roleKeysByProject, reviewers] = await Promise.all([
      this.prisma.project.findMany({
        where: { id: { in: projectIds } },
        select: { id: true, name: true }
      }),
      this.projectVisibility.effectiveRoleKeysByProject(actorUserId, projectIds),
      reviewerIds.length
        ? this.prisma.user.findMany({
            where: { id: { in: reviewerIds } },
            select: { id: true, name: true }
          })
        : Promise.resolve([])
    ]);
    const projectNameById = new Map(projects.map((project) => [project.id, project.name]));
    const reviewerNameById = new Map(reviewers.map((reviewer) => [reviewer.id, reviewer.name]));

    const visibleRows = settlements
      .filter((settlement) =>
        (roleKeysByProject.get(settlement.projectId) ?? []).some((role) =>
          READ_ROLE_SET.has(role)
        )
      )
      .map((settlement) =>
        toLedgerRow(
          settlement,
          projectNameById.get(settlement.projectId) ?? "待确定",
          reviewerNameById.get(settlement.reviewedByUserId ?? "") ?? "—"
        )
      )
      .filter((row) =>
        matchesLedgerExportQuery(
          {
            projectId: row.projectId,
            occurredAt: row.confirmedAt,
            status: `${row.statusLabel} ${row.contractKindLabel} ${row.relationshipLabel}`,
            keywordParts: [
              row.settlementNo,
              row.project,
              row.contractName,
              row.signingParty,
              row.counterparty,
              row.contractKindLabel,
              row.relationshipLabel,
              row.reviewerName
            ]
          },
          query
        )
      );

    return sortLedgerRows(visibleRows, query.sortField, query.sortDirection, {
      confirmedAt: (row) => (row.confirmedAt ? new Date(row.confirmedAt) : null),
      amountYuan: (row) => (row.amountYuan === null ? null : Number(row.amountYuan)),
      project: (row) => row.project,
      settlementNo: (row) => row.settlementNo
    });
  }

  private summary(
    rows: readonly SignedSettlementLedgerRow[]
  ): SignedSettlementLedgerPage["summary"] {
    let known = 0;
    let unknown = 0;
    let totalScaled = 0n;
    for (const row of rows) {
      if (row.amountYuan === null) {
        unknown += 1;
        continue;
      }
      known += 1;
      totalScaled += yuanToScaled(row.amountYuan);
    }
    return {
      total: rows.length,
      knownAmountRows: known,
      unknownAmountRows: unknown,
      totalAmountYuan: known > 0 ? scaledToYuan(totalScaled) : null,
      projectCount: new Set(rows.map((row) => row.projectId)).size,
      latestConfirmedAt: rows.reduce<string | null>(
        (latest, row) =>
          row.confirmedAt && (latest === null || row.confirmedAt > latest)
            ? row.confirmedAt
            : latest,
        null
      )
    };
  }

  private page(raw: unknown) {
    const parsed = Number(raw ?? 1);
    return Number.isFinite(parsed) ? Math.max(1, Math.trunc(parsed)) : 1;
  }

  private pageSize(raw: unknown) {
    const parsed = Number(raw ?? 20);
    return Number.isFinite(parsed) ? Math.min(100, Math.max(1, Math.trunc(parsed))) : 20;
  }
}

const LEDGER_COLUMNS: LedgerExcelColumn<SignedSettlementLedgerRow>[] = [
  { header: "结算编号", key: "settlementNo", width: 20, required: true },
  { header: "项目", key: "project", width: 24, required: true },
  { header: "合同类别", key: "contractKindLabel", width: 14 },
  { header: "签约关系", key: "relationshipLabel", width: 22 },
  { header: "合同名称", key: "contractName", width: 28 },
  { header: "签约方（甲方）", key: "signingParty", width: 26, required: true },
  { header: "相对方（乙方）", key: "counterparty", width: 26, required: true },
  {
    header: "结算金额（元）",
    key: "amountYuan",
    width: 18,
    kind: "number",
    numFmt: LEDGER_MONEY_FORMAT,
    total: "sum",
    required: true
  },
  { header: "金额说明", key: "amount", width: 18 },
  { header: "确认序号", key: "confirmationNo", width: 12 },
  { header: "复核状态", key: "statusLabel", width: 14 },
  { header: "复核日期", key: "confirmedDate", width: 14, kind: "date", numFmt: LEDGER_DATE_FORMAT },
  { header: "复核人", key: "reviewerName", width: 14 },
  { header: "更新时间", key: "updatedAt", width: 16, kind: "date", numFmt: LEDGER_DATE_FORMAT }
];

function toLedgerRow(
  settlement: {
    id: string;
    projectId: string;
    contractKind: string;
    number: string | null;
    amountYuan: Prisma.Decimal | null;
    confirmationNo: bigint | null;
    confirmedContractSource: Prisma.JsonValue | null;
    reviewedAt: Date | null;
    updatedAt: Date;
  },
  project: string,
  reviewerName: string
): SignedSettlementLedgerRow {
  const source = asRecord(settlement.confirmedContractSource);
  const relationship = typeof source.relationship === "string" ? source.relationship : "unclassified";
  const amountYuan = settlement.amountYuan === null ? null : settlement.amountYuan.toFixed(4);
  const confirmedAt = (settlement.reviewedAt ?? settlement.updatedAt).toISOString();
  return {
    id: settlement.id,
    settlementId: settlement.id,
    settlementNo: settlement.number ?? "待确定",
    confirmationNo: settlement.confirmationNo === null ? null : settlement.confirmationNo.toString(),
    contractKind: settlement.contractKind,
    contractKindLabel:
      CONTRACT_KIND_LABELS[settlement.contractKind] ?? "待确认类别",
    relationship,
    relationshipLabel:
      CONTRACT_RELATIONSHIP_LABELS[relationship as keyof typeof CONTRACT_RELATIONSHIP_LABELS] ??
      "待确认分类",
    contractName: textOr(source.name, "待确定"),
    projectId: settlement.projectId,
    project,
    signingParty: textOr(source.signingParty, "待确定"),
    counterparty: textOr(source.counterparty, "待确定"),
    amountYuan,
    amount: amountYuan === null ? "待确定" : `¥${amountYuan}`,
    amountKnown: amountYuan !== null,
    confirmedAt,
    confirmedDate: confirmedAt.slice(0, 10),
    confirmedAtText: confirmedAt.slice(0, 10),
    reviewerName,
    status: "confirmed",
    statusLabel: "已复核入账",
    updatedAt: settlement.updatedAt.toISOString()
  };
}

function asRecord(value: Prisma.JsonValue | null): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function textOr(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value : fallback;
}

function yuanToScaled(value: string): bigint {
  const negative = value.startsWith("-");
  const absolute = negative ? value.slice(1) : value;
  const [integerPart, fractionPart = ""] = absolute.split(".");
  const scaled = BigInt(`${integerPart || "0"}${fractionPart.padEnd(4, "0").slice(0, 4)}`);
  return negative ? -scaled : scaled;
}

function scaledToYuan(value: bigint): string {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const integerPart = absolute / 10_000n;
  const fractionPart = (absolute % 10_000n).toString().padStart(4, "0");
  return `${negative ? "-" : ""}${integerPart.toString()}.${fractionPart}`;
}
