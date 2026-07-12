import { describe, expect, it } from "vitest";
import {
  buildGlobalSearchItems,
  filterGlobalSearchItems,
  globalSearchColumns,
  type GlobalSearchSources
} from "./global-search.config";

describe("global search configuration", () => {
  it("maps contract, settlement, payment, and archive ledgers into searchable items", () => {
    const items = buildGlobalSearchItems(sampleSources());

    expect(items.map((item) => item.type)).toEqual(["合同", "结算", "付款", "资料"]);
    expect(items.map((item) => item.targetPath)).toEqual([
      "/合同管理/contract-1",
      "/结算管理/settlement-1",
      "/付款管理/payment-1",
      "/资料库"
    ]);
  });

  it("filters by multiple keywords across business code, project, status, and related text", () => {
    const items = buildGlobalSearchItems(sampleSources());

    expect(filterGlobalSearchItems(items, "付款 项目A 待付").map((item) => item.title)).toEqual([
      "FK-2026-001"
    ]);
    expect(filterGlobalSearchItems(items, "HT-2026 项目A").map((item) => item.title)).toEqual([
      "HT-2026-001",
      "JS-2026-001",
      "GD-2026-001"
    ]);
  });

  it("defines concise columns for a dense enterprise search result table", () => {
    expect(globalSearchColumns.map((column) => column.title)).toEqual([
      "类型",
      "业务编号/文件",
      "说明",
      "项目",
      "当前状态",
      "更新时间",
      "操作"
    ]);
  });
});

function sampleSources(): GlobalSearchSources {
  return {
    contracts: [
      {
        id: "contract-1",
        contractNo: "HT-2026-001",
        name: "钢筋采购合同",
        project: "项目A",
        counterparty: "供应商A",
        amount: "100,000.00",
        version: "v1",
        currentNode: "已生效",
        nodeTone: "success",
        ownerDepartment: "合同部",
        pendingOwner: "合同主管",
        stalledFor: "0天",
        returnReason: "-",
        nextAction: "发起结算",
        updatedAt: "2026-07-08 10:00"
      }
    ],
    settlements: [
      {
        id: "settlement-1",
        settlementNo: "JS-2026-001",
        contractNo: "HT-2026-001",
        project: "项目A",
        period: "2026-06",
        amount: "80,000.00",
        paymentTermsVersion: "v1",
        currentNode: "已生效",
        nodeTone: "success",
        ownerDepartment: "预算部",
        pendingOwner: "预算主管",
        stalledFor: "0天",
        returnReason: "-",
        nextAction: "发起付款",
        updatedAt: "2026-07-08 11:00"
      }
    ],
    payments: [
      {
        id: "payment-1",
        paymentNo: "FK-2026-001",
        contractNo: "HT-2026-001 · 材料采购合同",
        settlementNo: "JS-2026-001",
        project: "项目A",
        requestedAmount: "50,000.00",
        approvalStatus: "已批待付",
        approvalTone: "warning",
        paymentStatus: "未付款",
        paymentTone: "warning",
        currentNode: "出纳实付",
        ownerDepartment: "财务部",
        pendingOwner: "出纳",
        stalledFor: "1天",
        returnReason: "-",
        nextAction: "登记实付",
        updatedAt: "2026-07-08 12:00"
      }
    ],
    archives: [
      {
        id: "archive-1",
        documentNo: "GD-2026-001",
        fileId: "file-1",
        documentType: "合同归档件",
        businessRef: "HT-2026-001",
        project: "项目A",
        fileSource: "合同扫描件.pdf",
        fileSizeBytes: 1024,
        canDownload: true,
        disabledReason: null,
        archiveStatus: "已确认",
        statusTone: "success",
        uploadDepartment: "合同部",
        confirmedBy: "合同主管",
        lastAction: "2026-07-08 13:00"
      }
    ]
  };
}
