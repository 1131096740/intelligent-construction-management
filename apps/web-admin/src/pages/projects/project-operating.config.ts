import type { ContractBusinessOptionReadModel } from "@jiangkong/shared-domain";
import type { ProjectOperatingOverviewReadModel } from "../../api/core-flow-read.api";

export type ProjectProxySettlementOption = ContractBusinessOptionReadModel["settlements"][number];

export interface ProjectBusinessEntry {
  label: string;
  description: string;
  path: string;
  count?: number;
}

export interface ProjectBusinessEntryCounts {
  contracts: number;
  settlements: number;
  payments: number;
}

export interface ExecutiveProjectOverviewRow {
  id: string;
  code: string;
  name: string;
  contractAmountCents: number;
  settlementAmountCents: number;
  payableAmountCents: number;
  actualReceiptsCents: number | null;
  actualPaidCents: number;
  approvedPendingPaymentCents: number;
  availableFundsCents: number | null;
  dataGapCount: number;
}

export interface ExecutiveProjectOverviewSummary {
  projectCount: number;
  contractAmountCents: number;
  settlementAmountCents: number;
  payableAmountCents: number;
  actualReceiptsCents: number | null;
  actualPaidCents: number;
  approvedPendingPaymentCents: number;
  availableFundsCents: number | null;
  dataGapCount: number;
}

export interface ExecutiveProjectOverview {
  summary: ExecutiveProjectOverviewSummary;
  rows: ExecutiveProjectOverviewRow[];
}

export function findProjectProxyContract(
  contracts: ContractBusinessOptionReadModel[],
  value: string
): ContractBusinessOptionReadModel | null {
  return contracts.find((contract) => (contract.contractVersionId ?? contract.contractId) === value) ?? null;
}

export function findProjectProxySettlement(
  contract: ContractBusinessOptionReadModel | null,
  settlementId: string
): ProjectProxySettlementOption | null {
  return contract?.settlements.find((settlement) => settlement.settlementId === settlementId) ?? null;
}

export function buildProxyPaymentLinkPayload(
  contract: ContractBusinessOptionReadModel | null,
  settlement: ProjectProxySettlementOption | null
) {
  return {
    ...(contract ? { contractId: contract.contractId } : {}),
    ...(settlement ? { settlementId: settlement.settlementId } : {})
  };
}

export function buildProjectBusinessEntries(
  projectName: string,
  counts: ProjectBusinessEntryCounts
): ProjectBusinessEntry[] {
  const projectQuery = `project=${encodeURIComponent(projectName)}`;
  return [
    {
      label: "合同",
      description: "查看当前项目合同、版本、归档与付款条款",
      path: `/合同管理?${projectQuery}`,
      count: counts.contracts
    },
    {
      label: "结算",
      description: "查看当前项目结算、生效状态与可付款来源",
      path: `/结算管理?${projectQuery}`,
      count: counts.settlements
    },
    {
      label: "付款",
      description: "查看当前项目付款申请、已批待付、实付与入账",
      path: `/付款管理?${projectQuery}`,
      count: counts.payments
    },
    {
      label: "资料",
      description: "查看当前项目合同原件、结算件、付款凭证和归档文件",
      path: `/资料库?${projectQuery}`
    },
    {
      label: "审批",
      description: "查看与当前项目相关的待办、已办和阻塞审批任务",
      path: `/审批中心?${projectQuery}`
    },
    {
      label: "审计",
      description: "追踪当前项目登录、审批、下载、付款和权限变更记录",
      path: `/审计日志?${projectQuery}`
    }
  ];
}

export function buildExecutiveProjectOverview(
  overviews: ProjectOperatingOverviewReadModel[]
): ExecutiveProjectOverview {
  const rows = overviews
    .map((overview) => ({
      id: overview.project.id,
      code: overview.project.code,
      name: overview.project.name,
      contractAmountCents: overview.business.effectiveContractAmountCents,
      settlementAmountCents: overview.business.effectiveSettlementAmountCents,
      payableAmountCents: overview.business.payableSettlementAmountCents,
      actualReceiptsCents: overview.cash.actualReceiptsCents,
      actualPaidCents: overview.cash.actualPaidCents,
      approvedPendingPaymentCents: overview.cash.approvedPendingPaymentCents,
      availableFundsCents: overview.cash.availableFundsCents,
      dataGapCount: overview.dataGaps.length
    }))
    .sort((left, right) => right.payableAmountCents - left.payableAmountCents);

  return {
    rows,
    summary: {
      projectCount: rows.length,
      contractAmountCents: sumNumbers(rows.map((row) => row.contractAmountCents)),
      settlementAmountCents: sumNumbers(rows.map((row) => row.settlementAmountCents)),
      payableAmountCents: sumNumbers(rows.map((row) => row.payableAmountCents)),
      actualReceiptsCents: sumNullableCents(rows.map((row) => row.actualReceiptsCents)),
      actualPaidCents: sumNumbers(rows.map((row) => row.actualPaidCents)),
      approvedPendingPaymentCents: sumNumbers(rows.map((row) => row.approvedPendingPaymentCents)),
      availableFundsCents: sumNullableCents(rows.map((row) => row.availableFundsCents)),
      dataGapCount: sumNumbers(rows.map((row) => row.dataGapCount))
    }
  };
}

function sumNumbers(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0);
}

function sumNullableCents(values: Array<number | null>): number | null {
  const knownValues = values.filter((value): value is number => value !== null);
  return knownValues.length ? sumNumbers(knownValues) : null;
}
