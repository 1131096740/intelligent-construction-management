import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  contractFilterFields,
  contractLedgerColumns,
  contractLedgerFilterOptions,
  historicalTakeoverRouteForContractLedgerRow,
  historicalTakeoverOperationLabel,
  historicalTakeoverReturnTargetFromError,
  isHistoricalTakeoverLedgerRow,
  contractWorkbenchRouteContractId,
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
    expect(source).toContain("<JgFilterBar");
    expect(source).toContain("<BusinessFeedback");
    expect(source).toContain("<EmptyBusinessState");
    expect(source).not.toContain("<input");
    expect(source).toContain('title="合同工作台"');
    expect(source).toContain('router.push("/合同工作台/新建")');
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

  it("keeps ended contract history readable without exposing the abandoned-draft copy mutation", () => {
    const source = readFileSync(new URL("./ContractListPage.vue", import.meta.url), "utf8");
    expect(source).toContain("activeTab === 'ended'");
    expect(source).toContain("fetchContractLifecycleLedger(");
    expect(source).toContain("openDetail(row.id)");
    expect(source).not.toContain("row.copyAvailable");
    expect(source).not.toContain("copyEndedContract");
    expect(source).not.toContain("copyAbandonedContractDraft");
    expect(source).not.toContain("复制为新草稿");
  });

  it("defaults an unqualified workbench visit to the formal lifecycle ledger", () => {
    const source = readFileSync(new URL("./ContractListPage.vue", import.meta.url), "utf8");
    expect(source).toMatch(
      /const requested = typeof value === "string"[\s\S]+?\s: "formal_ledger";/s
    );
    expect(source).toContain('pending_action: "returned_for_revision"');
    expect(source).toContain('all: "formal_ledger"');
  });

  it("executes only server-advertised workbench actions without forcing an invalid save", () => {
    const source = readFileSync(new URL("./ContractWorkbenchPage.vue", import.meta.url), "utf8");
    expect(source).not.toContain("<BusinessDraftAction");
    expect(source).not.toContain('from "../../components/BusinessDraftAction.vue"');
    expect(source).toContain(
      "contractDraftActionEnabled('delete_pristine_draft')"
    );
    expect(source).toContain(
      "contractDraftActionEnabled('abandon_application')"
    );
    expect(source).toContain('@confirm="confirmDeletePristineDraft"');
    expect(source).toContain('@confirm="confirmAbandonApplication"');
    expect(source).toContain("useUnsavedChangesGuard");
    expect(source).toContain("suspendAutosaveForLifecycleAction");
    expect(source).toContain(
      "const capability = await fetchContractDraftWorkbench(expectedVersionId)"
    );
    expect(source).toContain("contractDraftLifecycleContextCurrent");
    expect(source).toContain("executeDeletePristineContractDraftAction({");
    expect(source).toContain("executeAbandonContractDraftAction({");
    expect(source).toContain("expectedRevision: savedRevision.value");
    expect(source).toContain(
      "contractDraftAvailableActions.value = capability.availableActions!"
    );
    expect(source).not.toContain(
      "contractDraftAvailableActions.value = structuredClone("
    );
    const deleteActionSource = source.slice(
      source.indexOf("async function confirmDeletePristineDraft"),
      source.indexOf("async function confirmAbandonApplication")
    );
    const abandonActionSource = source.slice(
      source.indexOf("async function confirmAbandonApplication"),
      source.indexOf("// Sections are presentational")
    );
    expect(deleteActionSource).not.toContain('action: "delete_pristine_draft"');
    expect(abandonActionSource).not.toContain('action: "abandon_application"');
    expect(deleteActionSource).not.toContain("saveNow()");
    expect(abandonActionSource).not.toContain("saveNow()");
    expect(source).not.toContain("enabled: true");
  });

  it("routes pristine-draft deletion through the exact workbench instead of mutating from the ledger", () => {
    const source = readFileSync(new URL("./ContractListPage.vue", import.meta.url), "utf8");
    expect(source).toContain(
      'canDeleteDraftFromLedger(row) ? "进入工作台删除草稿" : "进入工作台"'
    );
    expect(source).toContain("openLifecycleRow(row)");
    expect(source).toContain(
      "path: `/contracts/${contractWorkbenchRouteContractId(row)}/workbench`"
    );
    expect(source).toContain(
      "query: row.contractVersionId ? { versionId: row.contractVersionId } : undefined"
    );
    expect(source).toContain('activeTab.value === "my_drafts"');
    expect(source).toContain('row.lifecycleKind === "pristine_draft"');
    expect(source).toContain('row.workbenchEditable === true');
    expect(source).not.toContain("abandonContractDraft");
    expect(source).not.toContain("confirmDraftDeletion");
    expect(source).not.toContain("<SensitiveActionDialog");
  });

  it("does not publish the dedicated takeover entry to a ledger-only role", () => {
    const source = readFileSync(new URL("./ContractListPage.vue", import.meta.url), "utf8");
    expect(source).toContain(
      "canReadTakeovers.value && row.takeoverReadable !== false"
    );
    expect(source).toContain(
      "row.takeoverReadable === false"
    );
    expect(source).toContain("openDetail(row.id)");
  });

  it("does not render a historical takeover as a new-sign workbench after a stale direct link", () => {
    const source = readFileSync(new URL("./ContractWorkbenchPage.vue", import.meta.url), "utf8");
    expect(source).toContain("HISTORICAL_TAKEOVER_WORKBENCH_REQUIRED");
    expect(source).toContain("historicalTakeoverRouteRequired.value = true");
    expect(source).toContain("historicalTakeoverReturnTarget.value");
    expect(source).toContain('path: "/历史合同接管"');
    expect(source).toContain("projectId: target.projectId");
    expect(source).toContain("takeoverId: target.takeoverId");
    expect(source).toContain("contractWorkbenchLoadContextCurrent(loadContext)");
    expect(source).toContain("returnToHistoricalTakeover");
    expect(source).toContain("返回历史合同接管");
  });

  it("routes a coded draft by its internal contract id", () => {
    expect(
      contractWorkbenchRouteContractId(
        contractRow({
          id: "HT-2026-001",
          contractId: "contract-internal-1"
        })
      )
    ).toBe("contract-internal-1");
  });

  it("routes historical takeover rows back to their dedicated project record", () => {
    const row = contractRow({
      id: "HT-TAKEOVER-1",
      contractId: "contract-takeover-1",
      projectId: "project-2",
      source: "historical_takeover",
      changeType: "historical_takeover",
      takeoverId: "takeover-1",
      takeoverStatus: "draft"
    });

    expect(historicalTakeoverRouteForContractLedgerRow(row)).toEqual({
      path: "/历史合同接管",
      query: { projectId: "project-2", takeoverId: "takeover-1" }
    });
    expect(historicalTakeoverOperationLabel(row)).toBe("继续接管");
    expect(historicalTakeoverRouteForContractLedgerRow(contractRow())).toBeNull();
    expect(historicalTakeoverRouteForContractLedgerRow(contractRow({
      source: "historical_takeover",
      changeType: "historical_takeover",
      projectId: "project-2",
      takeoverId: null
    }))).toBeNull();
  });

  it("builds a takeover return target only from non-empty string coordinates", () => {
    expect(historicalTakeoverReturnTargetFromError({
      projectId: " project-2 ",
      takeoverId: " takeover-1 "
    })).toEqual({ projectId: "project-2", takeoverId: "takeover-1" });
    expect(historicalTakeoverReturnTargetFromError({
      projectId: null,
      takeoverId: null
    })).toBeNull();
    expect(historicalTakeoverReturnTargetFromError({
      projectId: "null",
      takeoverId: undefined
    })).toBeNull();
  });

  it("prefers the stable historical-flow flag and fails closed on relation drift", () => {
    expect(isHistoricalTakeoverLedgerRow(contractRow({
      historicalTakeoverFlow: true,
      source: "system",
      changeType: "original"
    }))).toBe(true);
    expect(isHistoricalTakeoverLedgerRow(contractRow({
      historicalTakeoverFlow: false,
      source: "historical_takeover",
      changeType: "historical_takeover"
    }))).toBe(false);
    expect(isHistoricalTakeoverLedgerRow(contractRow({
      source: "historical_takeover",
      changeType: "historical_takeover"
    }))).toBe(true);

    const mismatch = contractRow({
      historicalTakeoverFlow: true,
      takeoverRelationMismatch: true,
      projectId: "project-2",
      source: "system",
      changeType: "original",
      takeoverId: "takeover-1",
      takeoverStatus: "draft"
    });
    expect(historicalTakeoverRouteForContractLedgerRow(mismatch)).toBeNull();
    expect(historicalTakeoverOperationLabel(mismatch)).toBe("检查关联");
  });

  it("keeps confirmed historical takeovers on the dedicated read path", () => {
    expect(historicalTakeoverOperationLabel(contractRow({
      source: "historical_takeover",
      changeType: "historical_takeover",
      takeoverStatus: "confirmed"
    }))).toBe("查看接管");
  });

  it("keeps abandoned takeovers out of the active takeover workspace", () => {
    const row = contractRow({
      source: "historical_takeover",
      changeType: "historical_takeover",
      takeoverStatus: "abandoned",
      projectId: "project-2",
      takeoverId: "takeover-abandoned"
    });

    expect(historicalTakeoverOperationLabel(row)).toBe("查看详情");
    expect(historicalTakeoverRouteForContractLedgerRow(row)).toBeNull();
  });

  it("keeps later changes to a historical contract in the normal contract workbench", () => {
    expect(isHistoricalTakeoverLedgerRow(contractRow({
      source: "historical_takeover",
      changeType: "change"
    }))).toBe(false);
    expect(historicalTakeoverRouteForContractLedgerRow(contractRow({
      source: "historical_takeover",
      changeType: "change",
      projectId: "project-2",
      takeoverId: "takeover-1"
    }))).toBeNull();
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
      "类型/计价方式",
      "金额/控制金额",
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

function contractRow(overrides: Partial<ContractLedgerRow> = {}): ContractLedgerRow {
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
