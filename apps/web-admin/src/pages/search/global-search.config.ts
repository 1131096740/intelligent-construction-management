import type { ContractRelationshipLedgerRow } from "@jiangkong/shared-domain";
import type { PrimaryTableCol } from "tdesign-vue-next";
import type {
  ArchiveListReadModel,
  ContractLedgerListReadModel,
  PaymentLedgerListReadModel,
  SettlementLedgerListReadModel
} from "../../api/core-flow-read.api";

export type GlobalSearchType = "合同" | "结算" | "付款" | "资料";

export interface GlobalSearchSources {
  relationships?: ContractRelationshipLedgerRow[];
  contracts: ContractLedgerListReadModel["rows"];
  settlements: SettlementLedgerListReadModel["rows"];
  payments: PaymentLedgerListReadModel["rows"];
  archives: ArchiveListReadModel["rows"];
}

export interface GlobalSearchItem {
  id: string;
  type: GlobalSearchType;
  title: string;
  subtitle: string;
  project: string;
  status: string;
  updatedAt: string;
  targetPath: string;
  keywords: string;
}

export const globalSearchColumns: PrimaryTableCol<GlobalSearchItem>[] = [
  { colKey: "type", title: "类型", width: 72 },
  { colKey: "title", title: "业务编号/文件", minWidth: 160 },
  { colKey: "subtitle", title: "说明", minWidth: 220 },
  { colKey: "project", title: "项目", minWidth: 140 },
  { colKey: "status", title: "当前状态", width: 128 },
  { colKey: "updatedAt", title: "更新时间", width: 150 },
  { colKey: "operation", title: "操作", width: 72, fixed: "right" }
];

export function buildGlobalSearchItems(input: GlobalSearchSources): GlobalSearchItem[] {
  return [
    ...(input.relationships??[]).filter(row=>!row.detailPath.startsWith("/合同管理/")&&!row.detailPath.startsWith("/结算管理/")&&!row.detailPath.startsWith("/付款管理/")).map((row):GlobalSearchItem=>({id:`relationship:${row.section}:${row.id}`,type:row.section==="contracts"?"合同":row.section==="settlements"?"结算":"付款",title:row.reference,subtitle:`${row.relationshipLabel} · ${row.signingParty} · ${row.counterparty}`,project:row.projectName,status:row.statusLabel,updatedAt:row.occurredAt,targetPath:row.detailPath,keywords:`${row.relationshipLabel} ${row.name} ${row.accountingEffect}`})),
    ...input.contracts.map((row): GlobalSearchItem => ({
      id: `contract:${row.id}`,
      type: "合同",
      title: row.contractNo,
      subtitle: `${row.contractRelationshipLabel ?? "待确认分类"} · ${row.name} · ${row.counterparty} · ${row.amount}`,
      project: row.project,
      status: row.currentNode,
      updatedAt: row.updatedAt,
      targetPath: `/合同管理/${encodeURIComponent(row.id)}`,
      keywords: [
        row.contractNo,
        row.name,
        row.counterparty,
        row.project,
        row.amount,
        row.currentNode,
        row.pendingOwner,
        row.nextAction
      ].join(" ")
    })),
    ...input.settlements.map((row): GlobalSearchItem => ({
      id: `settlement:${row.id}`,
      type: "结算",
      title: row.settlementNo,
      subtitle: `${row.contractRelationshipLabel ?? "待确认分类"} · ${row.contractNo} · ${row.period} · ${row.amount}`,
      project: row.project,
      status: row.currentNode,
      updatedAt: row.updatedAt,
      targetPath: `/结算管理/${encodeURIComponent(row.id)}`,
      keywords: [
        row.settlementNo,
        row.contractNo,
        row.project,
        row.period,
        row.amount,
        row.currentNode,
        row.pendingOwner,
        row.nextAction
      ].join(" ")
    })),
    ...input.payments.map((row): GlobalSearchItem => ({
      id: `payment:${row.id}`,
      type: "付款",
      title: row.paymentNo,
      subtitle: `${row.contractRelationshipLabel ?? "待确认分类"} · ${row.settlementNo} · 申请 ${row.requestedAmount} · ${row.paymentStatus}`,
      project: row.project,
      status: row.approvalStatus,
      updatedAt: row.updatedAt,
      targetPath: `/付款管理/${encodeURIComponent(row.id)}`,
      keywords: [
        row.paymentNo,
        row.settlementNo,
        row.project,
        row.requestedAmount,
        row.approvalStatus,
        row.paymentStatus,
        row.pendingOwner,
        row.nextAction
      ].join(" ")
    })),
    ...input.archives.map((row): GlobalSearchItem => ({
      id: `archive:${row.id}`,
      type: "资料",
      title: row.documentNo,
      subtitle: `${row.contractRelationshipLabel??"待确认分类"} · ${row.documentType} · ${row.businessRef} · ${row.fileSource}`,
      project: row.project,
      status: row.archiveStatus,
      updatedAt: row.lastAction,
      targetPath: "/资料库",
      keywords: [
        row.documentNo,
        row.documentType,
        row.businessRef,
        row.project,
        row.fileSource,
        row.archiveStatus,
        row.uploadDepartment,
        row.confirmedBy
      ].join(" ")
    }))
  ];
}

export function filterGlobalSearchItems(items: GlobalSearchItem[], query: string): GlobalSearchItem[] {
  const terms = query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (!terms.length) {
    return items;
  }
  return items.filter((item) => {
    const haystack = [
      item.type,
      item.title,
      item.subtitle,
      item.project,
      item.status,
      item.updatedAt,
      item.keywords
    ]
      .join(" ")
      .toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}
