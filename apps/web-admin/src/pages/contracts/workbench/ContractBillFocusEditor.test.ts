/* eslint-disable vue/one-component-per-file */
import { createSSRApp, defineComponent, h, type App } from "vue";
import { renderToString } from "vue/server-renderer";
import { describe, expect, it, vi } from "vitest";
import type { ContractDraftBillExcelImportPreview } from "../../../api/contract-workbench.api";
import ContractBillsSection from "./ContractBillsSection.vue";
import ContractBillFocusEditor, {
  createContractBillFocusController,
  type ContractBillFocusControllerOptions
} from "./ContractBillFocusEditor.vue";
import type { WorkbenchBill } from "./contract-bill-editor";

vi.mock("./ContractBillGrid.vue", async () => {
  const { defineComponent: define, h: render } = await import("vue");
  return {
    default: define({
      inheritAttrs: false,
      setup(_props, { attrs }) {
        return () => render("div", {
          ...attrs,
          "data-testid": "contract-bill-grid"
        });
      }
    })
  };
});

const bill: WorkbenchBill = {
  id: "bill-1",
  billKey: "materials",
  name: "材料清单",
  revision: 7,
  taxMode: "multiple_rate",
  defaultTaxRatePercent: "13",
  taxInclusiveAmountCents: "2260",
  taxExclusiveAmountCents: "2000",
  taxAmountCents: "260",
  rows: [
    {
      rowKey: "server-1",
      clientRowKey: "aggregate-1",
      itemName: "钢筋",
      unit: "吨",
      quantity: "1",
      unitPrice: "11.3",
      taxRatePercent: "13",
      taxRateSource: "version_default",
      customData: {}
    },
    {
      rowKey: "server-2",
      clientRowKey: "aggregate-2",
      itemName: "水泥",
      unit: "吨",
      quantity: "1",
      unitPrice: "11.3",
      taxRatePercent: "13",
      taxRateSource: "version_default",
      customData: {}
    }
  ]
};

const governedBill: WorkbenchBill = {
  ...bill,
  rows: [{
    ...bill.rows[0]!,
    availableActions: [{
      key: "contract-bill.remainder-cancellation",
      label: "取消未实施余量",
      kind: "danger",
      enabled: true,
      disabledReason: null,
      requiresComment: true,
      requiresPassword: false
    }],
    remainderCancellation: {
      expectedBillRevision: 7,
      expectedDraftRevision: 12,
      expectedOccupancyToken: "occupancy-token-1",
      historicalQuantity: "3.5",
      historicalAmountCents: "35000"
    }
  }, bill.rows[1]!]
};

const malformedGovernedBill = {
  ...governedBill,
  rows: [{
    ...governedBill.rows[0]!,
    remainderCancellation: {
      ...governedBill.rows[0]!.remainderCancellation,
      expectedOccupancyToken: null,
      historicalQuantity: null
    }
  }, governedBill.rows[1]!]
} as unknown as WorkbenchBill;

function preview(
  patch: Partial<ContractDraftBillExcelImportPreview> = {}
): ContractDraftBillExcelImportPreview {
  return {
    billKey: "materials",
    targetBillRevision: 7,
    rows: [{
      clientRowKey: "import-1",
      sortOrder: 0,
      itemName: "导入钢筋",
      unit: "吨",
      quantity: "2",
      unitPrice: "20",
      taxRatePercent: "13",
      taxRateSource: "version_default",
      isProvisional: false,
      customData: {}
    }],
    added: 1,
    skipped: 0,
    beforeAmountCents: "2260",
    afterAmountCents: "4000",
    errors: [],
    ...patch
  };
}

function controllerOptions(
  overrides: Partial<NonNullable<ContractBillFocusControllerOptions["deps"]>> = {}
) {
  const emit = vi.fn();
  return {
    options: {
      bill: () => bill,
      contractVersionId: () => "version-1",
      disabled: () => false,
      emit,
      deps: {
        downloadTemplate: vi.fn().mockResolvedValue(undefined),
        uploadFile: vi.fn().mockResolvedValue({ id: "file-1" }),
        previewImport: vi.fn().mockResolvedValue(preview()),
        ...overrides
      }
    } satisfies ContractBillFocusControllerOptions,
    emit
  };
}

describe("ContractBillFocusEditor aggregate editing", () => {
  it("emits complete controlled rows and edited for every local operation", () => {
    const { options, emit } = controllerOptions();
    const controller = createContractBillFocusController(options);

    controller.addRow();
    controller.selectedClientRowKey.value = controller.rows.value[0]!.clientRowKey;
    controller.copySelectedRow();
    controller.moveSelectedRow(1);
    controller.deleteSelectedRow();

    const rowUpdates = emit.mock.calls.filter(([event]) => event === "update:rows");
    expect(rowUpdates).toHaveLength(4);
    expect(rowUpdates.at(-1)?.[1]).toEqual(controller.rows.value);
    expect(emit.mock.calls.filter(([event]) => event === "edited")).toHaveLength(4);
  });

  it("keeps Excel preview pending and only emits rows after confirmation", async () => {
    const previewImport = vi.fn().mockResolvedValue(preview());
    const { options, emit } = controllerOptions({ previewImport });
    const controller = createContractBillFocusController(options);
    const before = plain(controller.rows.value);

    await controller.previewExcel(new File(["xlsx"], "清单.xlsx"));

    expect(previewImport).toHaveBeenCalledWith(
      "version-1",
      "materials",
      { fileId: "file-1" }
    );
    expect(controller.replaceConfirmVisible.value).toBe(true);
    expect(controller.rows.value).toEqual(before);
    expect(emit).not.toHaveBeenCalled();

    controller.confirmImportReplace();
    expect(controller.rows.value).toEqual([
      expect.objectContaining({ clientRowKey: "import-1", itemName: "导入钢筋" })
    ]);
    expect(emit).toHaveBeenCalledWith("update:rows", controller.rows.value);
    expect(emit).toHaveBeenCalledWith("edited");
  });

  it("accepts a valid empty preview so the aggregate can clear a bill", async () => {
    const { options } = controllerOptions({
      previewImport: vi.fn().mockResolvedValue(preview({
        rows: [],
        added: 0,
        afterAmountCents: "0"
      }))
    });
    const controller = createContractBillFocusController(options);

    await controller.previewExcel(new File(["xlsx"], "空清单.xlsx"));
    controller.confirmImportReplace();

    expect(controller.rows.value).toEqual([]);
  });

  it.each([
    {
      name: "row shape is incomplete",
      result: preview({
        rows: [{
          clientRowKey: "broken",
          sortOrder: 0,
          itemName: "缺少单位",
          unit: "",
          unitPrice: "10",
          customData: {}
        }]
      })
    },
    {
      name: "bill identity changed",
      result: preview({ billKey: "labor" })
    },
    {
      name: "bill revision changed",
      result: preview({ targetBillRevision: 8 })
    }
  ])("rejects malformed or stale preview atomically: $name", async ({ result }) => {
    const { options, emit } = controllerOptions({
      previewImport: vi.fn().mockResolvedValue(result)
    });
    const controller = createContractBillFocusController(options);
    const before = plain(controller.rows.value);

    await controller.previewExcel(new File(["xlsx"], "异常清单.xlsx"));

    expect(controller.replaceConfirmVisible.value).toBe(false);
    expect(controller.pendingImportRows.value).toBeNull();
    expect(controller.rows.value).toEqual(before);
    expect(controller.messageDanger.value).toBe(true);
    expect(emit).not.toHaveBeenCalled();
  });

  it("downloads the exact version-scoped bill template", async () => {
    const downloadTemplate = vi.fn().mockResolvedValue(undefined);
    const { options } = controllerOptions({ downloadTemplate });
    const controller = createContractBillFocusController(options);

    await controller.downloadTemplate();

    expect(downloadTemplate).toHaveBeenCalledWith("version-1", "materials");
  });

  it("synchronizes controlled aggregate rows without changing stable client keys", () => {
    const { options, emit } = controllerOptions();
    const controller = createContractBillFocusController(options);

    controller.syncBill({
      ...bill,
      rows: [{
        ...bill.rows[0]!,
        clientRowKey: "local-new-8",
        itemName: "父级草稿钢筋"
      }]
    });

    expect(controller.rows.value).toEqual([
      expect.objectContaining({
        clientRowKey: "local-new-8",
        itemName: "父级草稿钢筋"
      })
    ]);
    expect(emit).not.toHaveBeenCalled();
  });

  it("keeps governed rows out of local delete and confirms the independent dangerous action", async () => {
    const executeRemainderCancellation = vi.fn().mockResolvedValue(undefined);
    const emit = vi.fn();
    const controller = createContractBillFocusController({
      bill: () => governedBill,
      contractVersionId: () => "version-1",
      disabled: () => false,
      emit,
      executeRemainderCancellation
    });

    expect(controller.selectedRowCapability.value).toMatchObject({
      action: expect.objectContaining({
        key: "contract-bill.remainder-cancellation",
        enabled: true
      }),
      facts: expect.objectContaining({
        expectedOccupancyToken: "occupancy-token-1"
      })
    });

    controller.deleteSelectedRow();
    expect(controller.rows.value).toHaveLength(2);
    expect(emit).not.toHaveBeenCalled();

    controller.openRemainderCancellation();
    await controller.confirmRemainderCancellation({
      reason: "  已核对历史完成量  ",
      password: ""
    });

    expect(executeRemainderCancellation).toHaveBeenCalledWith({
      billId: "bill-1",
      billKey: "materials",
      rowKey: "server-1",
      reason: "已核对历史完成量"
    });
    expect(controller.remainderCancellationVisible.value).toBe(false);
    expect(controller.remainderCancellationError.value).toBe("");
  });

  it("fails closed without crashing when governed facts contain runtime nulls", () => {
    const emit = vi.fn();
    const executeRemainderCancellation = vi.fn();
    const controller = createContractBillFocusController({
      bill: () => malformedGovernedBill,
      contractVersionId: () => "version-1",
      disabled: () => false,
      emit,
      executeRemainderCancellation
    });

    expect(() => controller.selectedRowCapability.value).not.toThrow();
    expect(controller.selectedRowCapability.value).toBeNull();
    expect(controller.selectedRowHasRemainderCancellationCapability.value).toBe(true);

    controller.deleteSelectedRow();
    controller.openRemainderCancellation();

    expect(controller.rows.value).toHaveLength(2);
    expect(controller.messageDanger.value).toBe(true);
    expect(executeRemainderCancellation).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
  });

  it("rejects an Excel whole-table candidate that omits a governed server row", async () => {
    const emit = vi.fn();
    const controller = createContractBillFocusController({
      bill: () => governedBill,
      contractVersionId: () => "version-1",
      disabled: () => false,
      emit,
      deps: {
        uploadFile: vi.fn().mockResolvedValue({ id: "file-1" }),
        previewImport: vi.fn().mockResolvedValue(preview()),
        downloadTemplate: vi.fn()
      }
    });

    await controller.previewExcel(new File(["xlsx"], "遗漏历史行.xlsx"));

    expect(controller.replaceConfirmVisible.value).toBe(false);
    expect(controller.pendingImportRows.value).toBeNull();
    expect(controller.rows.value).toHaveLength(2);
    expect(controller.message.value).toContain("历史履约占用行");
    expect(controller.messageDanger.value).toBe(true);
    expect(emit).not.toHaveBeenCalled();
  });

  it("keeps the remainder dialog open and reports a failed governed write", async () => {
    const controller = createContractBillFocusController({
      bill: () => governedBill,
      contractVersionId: () => "version-1",
      disabled: () => false,
      emit: vi.fn(),
      executeRemainderCancellation: vi.fn().mockRejectedValue(
        new Error("取消结果未知，已重新读取服务端")
      )
    });

    controller.openRemainderCancellation();
    await controller.confirmRemainderCancellation({
      reason: "已核对历史完成量",
      password: ""
    });

    expect(controller.remainderCancellationVisible.value).toBe(true);
    expect(controller.remainderCancellationError.value).toContain("结果未知");
  });

  it("locks the governed action when the write was submitted but authoritative refresh failed", async () => {
    const executeRemainderCancellation = vi.fn().mockResolvedValue({
      status: "submitted_refresh_failed",
      message: "操作已提交，但工作台刷新失败；请手动刷新核对，不要重复提交。"
    });
    const controller = createContractBillFocusController({
      bill: () => governedBill,
      contractVersionId: () => "version-1",
      disabled: () => false,
      emit: vi.fn(),
      executeRemainderCancellation
    });

    controller.openRemainderCancellation();
    await controller.confirmRemainderCancellation({
      reason: "已核对历史完成量",
      password: ""
    });
    controller.openRemainderCancellation();

    expect(controller.remainderCancellationVisible.value).toBe(false);
    expect(controller.remainderCancellationRetryLocked.value).toBe(true);
    expect(controller.message.value).toContain("已提交");
    expect(controller.message.value).toContain("不要重复提交");
    expect(controller.messageDanger.value).toBe(true);
    expect(executeRemainderCancellation).toHaveBeenCalledTimes(1);
  });

  it("ignores a late governed-write callback after the authoritative row capability changes", async () => {
    let resolveWrite!: () => void;
    const write = new Promise<void>((resolve) => {
      resolveWrite = resolve;
    });
    const controller = createContractBillFocusController({
      bill: () => governedBill,
      contractVersionId: () => "version-1",
      disabled: () => false,
      emit: vi.fn(),
      executeRemainderCancellation: vi.fn(() => write)
    });

    controller.openRemainderCancellation();
    const confirmation = controller.confirmRemainderCancellation({
      reason: "已核对历史完成量",
      password: ""
    });
    controller.syncBill(bill);
    resolveWrite();
    await confirmation;

    expect(controller.remainderCancellationVisible.value).toBe(false);
    expect(controller.remainderCancellationBusy.value).toBe(false);
    expect(controller.message.value).toBe("");
    expect(controller.remainderCancellationError.value).toBe("");
  });
});

describe("Contract bill workbench surfaces", () => {
  it("renders a summary-only normal section with focus and import entries", async () => {
    const app = createSSRApp(ContractBillsSection, {
      workbench: { bills: [bill] },
      disabled: false
    });
    registerTDesignStubs(app);
    const html = await renderToString(app);

    expect(html).toContain("材料清单");
    expect(html).toContain("下载标准模板");
    expect(html).toContain("导入 Excel");
    expect(html).toContain("放大编辑");
    expect(html).not.toContain("jg-business-grid");
  });

  it("has no section save action and keeps the single domain grid", async () => {
    const app = createSSRApp(ContractBillFocusEditor, {
      bill,
      contractVersionId: "version-1",
      disabled: false
    });
    registerTDesignStubs(app);
    const html = await renderToString(app);

    expect(html).toContain("返回合同");
    expect(html).toContain("新增行");
    expect(html).toContain("复制行");
    expect(html).not.toContain("保存全部");
    expect(html).toContain("由顶部统一保存");
    expect(html).toContain("accept=\".xlsx");
    expect(html.match(/data-testid="contract-bill-grid"/gu)).toHaveLength(1);
  });

  it("keeps the return action enabled when the bill is read-only", async () => {
    const app = createSSRApp(ContractBillFocusEditor, {
      bill,
      contractVersionId: "version-1",
      disabled: true
    });
    registerTDesignStubs(app);
    const html = await renderToString(app);
    const closeButton = html.match(
      /<button[^>]*data-testid="bill-focus-close"[^>]*>/u
    )?.[0];

    expect(closeButton).toBeTruthy();
    expect(closeButton).not.toContain("disabled");
  });

  it("renders remainder cancellation separately and disables ordinary delete for a governed row", async () => {
    const app = createSSRApp(ContractBillFocusEditor, {
      bill: governedBill,
      contractVersionId: "version-1",
      disabled: false,
      executeRemainderCancellation: vi.fn()
    });
    registerTDesignStubs(app);
    const html = await renderToString(app);
    const deleteButton = html.match(
      /<button[^>]*data-testid="bill-delete-row"[^>]*>/u
    )?.[0];

    expect(html).toContain("取消未实施余量");
    expect(html).toContain("data-testid=\"bill-cancel-remainder\"");
    expect(deleteButton).toContain("disabled");
  });
});

function registerTDesignStubs(app: App) {
  app.component("TCard", defineComponent({
    setup(_props, { slots }) {
      return () => h("article", [slots.title?.(), slots.default?.()]);
    }
  }));
  app.component("TTag", defineComponent({
    setup(_props, { slots }) {
      return () => h("span", slots.default?.());
    }
  }));
  app.component("TButton", defineComponent({
    inheritAttrs: false,
    setup(_props, { attrs, slots }) {
      return () => h("button", attrs, slots.default?.());
    }
  }));
  app.component("TAlert", defineComponent({
    setup(_props, { slots }) {
      return () => h("aside", slots.default?.());
    }
  }));
  app.component("TDialog", defineComponent({
    setup(_props, { slots }) {
      return () => h("section", [slots.default?.(), slots.footer?.()]);
    }
  }));
  app.component("TUpload", defineComponent({
    inheritAttrs: false,
    props: { accept: { type: String, default: "" } },
    setup(props, { attrs }) {
      return () => h("input", { ...attrs, type: "file", accept: props.accept });
    }
  }));
  app.component("TTextarea", defineComponent({
    inheritAttrs: false,
    setup(_props, { attrs }) {
      return () => h("textarea", attrs);
    }
  }));
  app.component("TInput", defineComponent({
    inheritAttrs: false,
    setup(_props, { attrs }) {
      return () => h("input", attrs);
    }
  }));
}

function plain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
