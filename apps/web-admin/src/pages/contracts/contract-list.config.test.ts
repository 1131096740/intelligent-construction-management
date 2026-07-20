import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  contractFilterFields,
  contractLedgerColumns,
  contractLedgerFilterOptions,
  contractPaginationBlockReason,
  contractSummaryItems,
  emptyContractLedgerFilters,
  filterContractLedgerRows,
  type ContractLedgerRow
} from "./contract-list.config";

describe("contract ledger page configuration", () => {
  it("uses the shared enterprise ledger structure without native controls", () => {
    const source = readFileSync(new URL("./ContractListPage.vue", import.meta.url), "utf8");
    expect(source).toContain("<BusinessPageHeader");
    expect(source).toContain("<BusinessStatusSummary");
    expect(source).toContain("<BusinessTableToolbar");
    expect(source).toContain("<BusinessFeedback");
    expect(source).toContain("<EmptyBusinessState");
    expect(source).not.toContain("<input");
  });

  it("uses the approved compact enterprise filter fields", () => {
    expect(contractFilterFields.map((field) => field.label)).toEqual([
      "项目",
      "合同状态",
      "归档状态",
      "付款条款版本",
      "关键词"
    ]);
  });

  it("keeps the compact summary strip focused on contract states", () => {
    expect(contractSummaryItems.map((item) => item.label)).toEqual([
      "正式台账",
      "我的草稿",
      "退回待修改",
      "已结束"
    ]);
  });

  it("keeps ended draft history visible without linking to an unrelated contract detail", () => {
    const source = readFileSync(new URL("./ContractListPage.vue", import.meta.url), "utf8");
    expect(source).toContain("row.abandonReason || '—'");
    expect(source).toContain("历史已保留");
    expect(source).not.toContain("查看历史");
    expect(source).not.toMatch(/activeTab\.value === "ended"[\s\S]{0,160}router\.push/);
  });

  it("defaults an unqualified ledger visit to the formal ledger", () => {
    const source = readFileSync(new URL("./ContractListPage.vue", import.meta.url), "utf8");
    expect(source).toMatch(
      /const requested =[^;]+\? value as DraftLedgerView\s*: "formal_ledger";/s
    );
    expect(source).not.toMatch(
      /: canManageContracts\.value \? "my_drafts" : "formal_ledger"/
    );
  });

  it("executes only server-advertised workbench actions without forcing an invalid save", () => {
    const source = readFileSync(new URL("./ContractWorkbenchPage.vue", import.meta.url), "utf8");
    expect(source).toContain("<BusinessDraftAction");
    expect(source).toContain("workbench.value?.availableActions ?? []");
    expect(source).toContain("useUnsavedChangesGuard");
    expect(source).toContain("suspendAutosaveForLifecycleAction");
    expect(source).toContain("expectedRevision: savedRevision.value");
    const lifecycleActionSource = source.slice(
      source.indexOf("async function executeContractDraftAction"),
      source.indexOf("// Sections are presentational")
    );
    expect(lifecycleActionSource).not.toContain("saveNow()");
    expect(source).not.toContain("enabled: true");
  });

  it("builds stable select options from the currently loaded contract ledger", () => {
    const rows = [
      contractRow({
        project: "乙项目",
        currentNode: "待归档确认",
        nextAction: "确认归档",
        paymentTermsVersion: "条款 v2"
      }),
      contractRow({
        project: "甲项目",
        currentNode: "审批中",
        nextAction: "等待审批",
        paymentTermsVersion: "条款 v1"
      }),
      contractRow({
        project: "甲项目",
        currentNode: "已生效",
        nextAction: "发起结算",
        paymentTermsVersion: "条款 v1"
      })
    ];

    expect(contractLedgerFilterOptions(rows)).toEqual({
      project: [
        { label: "全部项目", value: "" },
        { label: "甲项目", value: "甲项目" },
        { label: "乙项目", value: "乙项目" }
      ],
      contractStatus: [
        { label: "全部合同状态", value: "" },
        { label: "待归档确认", value: "待归档确认" },
        { label: "审批中", value: "审批中" },
        { label: "已生效", value: "已生效" }
      ],
      archiveStatus: [
        { label: "全部归档状态", value: "" },
        { label: "待归档确认", value: "待归档确认" },
        { label: "未进入归档", value: "未进入归档" },
        { label: "已生效", value: "已生效" }
      ],
      paymentTermsVersion: [
        { label: "全部付款条款版本", value: "" },
        { label: "条款 v1", value: "条款 v1" },
        { label: "条款 v2", value: "条款 v2" }
      ]
    });
    expect(contractPaginationBlockReason).toContain("服务端分页");
  });

  it("shows version, archive, owner, and next-node columns in the ledger", () => {
    expect(contractLedgerColumns.map((column) => column.title)).toEqual([
      "合同编号",
      "合同名称",
      "项目",
      "相对方",
      "金额",
      "版本",
      "当前节点",
      "当前处理人",
      "停留时长",
      "退回原因",
      "下一步动作",
      "更新时间",
      "操作"
    ]);
  });

  it("filters ledger rows by project, status, archive text, payment terms, and keyword", () => {
    const rows: ContractLedgerRow[] = [
      contractRow({
        id: "contract-1",
        project: "E2E 项目",
        currentNode: "待归档确认",
        nextAction: "确认归档",
        paymentTermsVersion: "条款 v2",
        counterparty: "钢材供应商"
      }),
      contractRow({
        id: "contract-2",
        project: "其他项目",
        currentNode: "已生效",
        nextAction: "发起结算",
        paymentTermsVersion: "条款 v1",
        counterparty: "劳务班组"
      })
    ];

    expect(
      filterContractLedgerRows(rows, {
        ...emptyContractLedgerFilters(),
        project: "E2E",
        contractStatus: "归档",
        archiveStatus: "待归档确认",
        paymentTermsVersion: "v2",
        keyword: "钢材"
      }).map((row) => row.id)
    ).toEqual(["contract-1"]);
  });
});

function contractRow(overrides: Partial<ContractLedgerRow>): ContractLedgerRow {
  return {
    id: "contract",
    contractNo: "HT-001",
    name: "钢材采购合同",
    project: "项目",
    counterparty: "供应商",
    amount: "¥1.00",
    version: "v1",
    currentNode: "审批中",
    nodeTone: "primary",
    ownerDepartment: "合同部",
    pendingOwner: "合同部",
    stalledFor: "1天",
    returnReason: "-",
    nextAction: "待处理",
    updatedAt: "2026-07-08",
    ...overrides
  };
}
