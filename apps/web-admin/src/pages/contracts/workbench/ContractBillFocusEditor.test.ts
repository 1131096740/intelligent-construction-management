/* eslint-disable vue/one-component-per-file */
import {
  createSSRApp,
  defineComponent,
  h,
  nextTick,
  type App
} from "vue";
import { renderToString } from "vue/server-renderer";
import { describe, expect, it, vi } from "vitest";
import type {
  ReplaceContractBillRowsInput,
  ReplaceContractBillRowsReadModel
} from "../../../api/contract-workbench.api";
import ContractBillsSection from "./ContractBillsSection.vue";
import ContractBillFocusEditor, {
  createContractBillFocusController
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
      itemName: "钢筋",
      unit: "吨",
      quantity: "1",
      unitPrice: "11.3",
      taxRatePercent: "13",
      taxRateSource: "version_default",
      taxInclusiveAmountCents: "1130",
      taxExclusiveAmountCents: "1000",
      taxAmountCents: "130",
      customData: {}
    },
    {
      rowKey: "server-2",
      itemName: "水泥",
      unit: "吨",
      quantity: "1",
      unitPrice: "11.3",
      taxRatePercent: "13",
      taxRateSource: "version_default",
      taxInclusiveAmountCents: "1130",
      taxExclusiveAmountCents: "1000",
      taxAmountCents: "130",
      customData: {}
    }
  ]
};

function authoritativeRows(): ReplaceContractBillRowsReadModel {
  return {
    bill: {
      id: bill.id,
      contractVersionId: "version-1",
      billKey: bill.billKey,
      name: bill.name,
      amountRole: "contract_amount",
      pricingMode: "quantity_unit_price",
      quantityScale: 2,
      unitPriceScale: 2,
      schemaSnapshot: {},
      sourceExcelFileId: null,
      revision: 8,
      taxInclusiveAmountCents: "1130",
      taxExclusiveAmountCents: "1000",
      taxAmountCents: "130",
      createdAt: "2026-07-25T00:00:00.000Z",
      updatedAt: "2026-07-25T00:00:00.000Z"
    },
    rows: [
      {
        id: "row-3",
        contractBillId: bill.id,
        rowKey: "server-3",
        sortOrder: 0,
        itemCode: null,
        itemName: "权威钢筋",
        specification: null,
        unit: "吨",
        quantity: "1",
        unitPrice: "11.3",
        taxRate: "13",
        taxRateSource: "version_default",
        pricingFactStatus: "confirmed",
        precisionPolicy: "two_decimal",
        taxInclusiveAmountCents: "1130",
        taxExclusiveAmountCents: "1000",
        taxAmountCents: "130",
        isProvisional: false,
        settlementBasis: null,
        customData: {},
        createdAt: "2026-07-25T00:00:00.000Z",
        updatedAt: "2026-07-25T00:00:00.000Z"
      }
    ]
  };
}

function controllerOptions(overrides: {
  bill?: () => WorkbenchBill;
  ordinaryDraftDirty?: () => boolean;
  replaceRows?: (billId: string, input: ReplaceContractBillRowsInput) =>
    Promise<ReplaceContractBillRowsReadModel>;
  previewImport?: () => Promise<unknown>;
} = {}) {
  let key = 0;
  return {
    bill: overrides.bill ?? (() => bill),
    disabled: () => false,
    ordinaryDraftDirty: overrides.ordinaryDraftDirty ?? (() => false),
    emit: vi.fn(),
    deps: {
      createKey: () => `save-key-${++key}`,
      downloadTemplate: vi.fn().mockResolvedValue(undefined),
      uploadFile: vi.fn().mockResolvedValue({ id: "file-1" }),
      previewImport: overrides.previewImport ?? vi.fn().mockResolvedValue({ candidateRows: [] }),
      replaceRows: overrides.replaceRows ?? vi.fn().mockResolvedValue(authoritativeRows())
    }
  };
}

describe("ContractBillFocusEditor state", () => {
  it("keeps repeated row operations in one complete local candidate", async () => {
    const options = controllerOptions();
    const controller = createContractBillFocusController(options);

    controller.addRow();
    controller.addRow();
    expect(controller.rows.value).toHaveLength(bill.rows.length + 2);
    expect(controller.dirty.value).toBe(true);

    controller.selectedClientRowKey.value = controller.rows.value[0]!.clientRowKey;
    controller.copySelectedRow();
    expect(controller.rows.value).toHaveLength(bill.rows.length + 3);
    controller.moveSelectedRow(-1);
    expect(controller.rows.value.at(-2)?.clientRowKey).toBe(
      controller.selectedClientRowKey.value
    );
    controller.deleteSelectedRow();
    expect(controller.rows.value).toHaveLength(bill.rows.length + 2);

    await nextTick();
    expect(options.emit).toHaveBeenLastCalledWith("dirty-change", true);
  });

  it("keeps Excel preview pending until explicit replacement confirmation", async () => {
    const imported = [{
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
    }];
    const replaceRows = vi.fn().mockResolvedValue(authoritativeRows());
    const options = controllerOptions({
      replaceRows,
      previewImport: vi.fn().mockResolvedValue({
        added: 1,
        removed: 2,
        errors: [],
        candidateRows: imported
      })
    });
    const controller = createContractBillFocusController(options);
    controller.addRow();
    controller.addRow();
    const manualRows = plainRows(controller.rows.value);

    await controller.previewExcel(new File(["xlsx"], "清单.xlsx"));
    expect(controller.replaceConfirmVisible.value).toBe(true);
    expect(controller.replacePrompt.value).toContain(
      `将替换当前 ${bill.rows.length + 2} 行未保存清单`
    );
    expect(controller.rows.value).toEqual(manualRows);
    controller.cancelImportReplace();
    expect(controller.rows.value).toEqual(manualRows);

    await controller.previewExcel(new File(["xlsx"], "清单.xlsx"));
    controller.confirmImportReplace();
    expect(controller.rows.value).toEqual([
      expect.objectContaining({ clientRowKey: "import-1", itemName: "导入钢筋" })
    ]);
    expect(replaceRows).not.toHaveBeenCalled();
  });

  it("accepts a valid empty replacement preview so Excel can clear all local rows", async () => {
    const controller = createContractBillFocusController(controllerOptions({
      previewImport: vi.fn().mockResolvedValue({
        added: 0,
        removed: bill.rows.length,
        errors: [],
        candidateRows: []
      })
    }));

    await controller.previewExcel(new File(["xlsx"], "空清单.xlsx"));
    expect(controller.replaceConfirmVisible.value).toBe(true);
    controller.confirmImportReplace();
    expect(controller.rows.value).toEqual([]);
    expect(controller.dirty.value).toBe(true);
  });

  it("blocks preview and save while the ordinary draft is dirty without saving it", async () => {
    let ordinaryDirty = true;
    const previewImport = vi.fn();
    const replaceRows = vi.fn();
    const options = controllerOptions({
      ordinaryDraftDirty: () => ordinaryDirty,
      previewImport,
      replaceRows
    });
    const controller = createContractBillFocusController(options);

    await controller.previewExcel(new File(["xlsx"], "清单.xlsx"));
    await controller.saveAll();
    expect(controller.saveMessage.value).toContain(
      "请先使用右上角保存当前合同基础信息"
    );
    expect(options.deps.uploadFile).not.toHaveBeenCalled();
    expect(previewImport).not.toHaveBeenCalled();
    expect(replaceRows).not.toHaveBeenCalled();

    ordinaryDirty = false;
    controller.addRow();
    expect(controller.dirty.value).toBe(true);
  });

  it("retains candidates and the idempotency key after structured or network failure", async () => {
    const structuredError = Object.assign(new Error("请检查清单"), {
      code: "CONTRACT_BILL_VALIDATION_FAILED",
      rowErrors: [{
        clientRowKey: "server-1",
        field: "itemName",
        message: "请填写项目名称"
      }]
    });
    const replaceRows = vi.fn()
      .mockRejectedValueOnce(structuredError)
      .mockRejectedValueOnce(new Error("网络暂不可用"));
    const options = controllerOptions({ replaceRows });
    const controller = createContractBillFocusController(options);
    const before = plainRows(controller.rows.value);

    await controller.saveAll();
    expect(controller.errors.value).toEqual(structuredError.rowErrors);
    expect(controller.rows.value).toEqual(before);
    await controller.saveAll();
    expect(controller.saveMessage.value).toBe("网络暂不可用");
    expect(controller.rows.value).toEqual(before);
    expect(replaceRows.mock.calls[0]?.[1].idempotencyKey).toBe("save-key-1");
    expect(replaceRows.mock.calls[1]?.[1].idempotencyKey).toBe("save-key-1");
  });

  it("rotates the idempotency key only when the failed candidate actually changes", async () => {
    const replaceRows = vi.fn()
      .mockRejectedValueOnce(new Error("网络暂不可用"))
      .mockResolvedValueOnce(authoritativeRows());
    const controller = createContractBillFocusController(
      controllerOptions({ replaceRows })
    );

    await controller.saveAll();
    const changedRows = plainRows(controller.rows.value);
    changedRows[0]!.itemName = "失败后重新编辑的钢筋";
    controller.setRows(changedRows);
    await controller.saveAll();

    expect(replaceRows.mock.calls[0]?.[1].idempotencyKey).toBe("save-key-1");
    expect(replaceRows.mock.calls[1]?.[1].idempotencyKey).toBe("save-key-2");
    expect(replaceRows.mock.calls[1]?.[1].rows[0]?.itemName).toBe(
      "失败后重新编辑的钢筋"
    );
  });

  it("keeps the failed-attempt key when only selection or validation feedback changes", async () => {
    const replaceRows = vi.fn()
      .mockRejectedValueOnce(new Error("网络暂不可用"))
      .mockResolvedValueOnce(authoritativeRows());
    const controller = createContractBillFocusController(
      controllerOptions({ replaceRows })
    );

    await controller.saveAll();
    controller.selectedClientRowKey.value = controller.rows.value[1]!.clientRowKey;
    await controller.previewExcel(new File(["not-xlsx"], "错误格式.xls"));
    await controller.saveAll();

    expect(replaceRows.mock.calls[0]?.[1].idempotencyKey).toBe("save-key-1");
    expect(replaceRows.mock.calls[1]?.[1].idempotencyKey).toBe("save-key-1");
  });

  it("rebuilds from the authoritative response and rotates the key only after success", async () => {
    const replaceRows = vi.fn().mockResolvedValue(authoritativeRows());
    const options = controllerOptions({ replaceRows });
    const controller = createContractBillFocusController(options);
    controller.syncBill({ ...bill, revision: 11, rows: plainRows(bill.rows) });

    await controller.saveAll();
    expect(controller.rows.value).toEqual([
      expect.objectContaining({
        clientRowKey: "server-server-3",
        rowKey: "server-3",
        itemName: "权威钢筋"
      })
    ]);
    expect(controller.dirty.value).toBe(false);
    expect(controller.saveKey.value).toBe("save-key-3");
    expect(controller.saveMessage.value).toBe("清单已全部保存");
    expect(replaceRows.mock.calls[0]?.[1]).toMatchObject({
      expectedBillRevision: 11,
      idempotencyKey: "save-key-2"
    });
    expect(options.emit).toHaveBeenCalledWith("saved", authoritativeRows());
  });

  it("does not let an older external response overwrite its authoritative save response", async () => {
    const controller = createContractBillFocusController(controllerOptions());
    await controller.saveAll();
    expect(controller.rows.value[0]?.itemName).toBe("权威钢筋");

    controller.syncBill({
      ...plainRows(bill),
      revision: 7,
      rows: [{
        ...plainRows(bill.rows[0]!),
        itemName: "迟到的旧钢筋"
      }]
    });

    expect(controller.rows.value).toEqual([
      expect.objectContaining({ itemName: "权威钢筋", rowKey: "server-3" })
    ]);
    expect(controller.billSnapshot.value.revision).toBe(8);
    expect(controller.dirty.value).toBe(false);
  });

  it("freezes candidate rows and their revision together while local rows are dirty", async () => {
    let currentBill = plainRows(bill);
    const replaceRows = vi.fn().mockRejectedValue(new Error("并发冲突"));
    const controller = createContractBillFocusController(controllerOptions({
      bill: () => currentBill,
      replaceRows
    }));
    const localRows = plainRows(controller.rows.value);
    localRows[0]!.itemName = "本地钢筋";
    controller.setRows(localRows);

    currentBill = {
      ...plainRows(bill),
      revision: 12,
      rows: [{
        ...plainRows(bill.rows[0]!),
        rowKey: "server-concurrent",
        itemName: "并发钢筋"
      }]
    };
    controller.syncBill(currentBill);
    await controller.saveAll();

    expect(controller.rows.value[0]?.itemName).toBe("本地钢筋");
    expect(replaceRows.mock.calls[0]?.[1]).toMatchObject({
      expectedBillRevision: 7,
      rows: [expect.objectContaining({ itemName: "本地钢筋" }), expect.anything()]
    });
  });

  it("rebuilds rows, baseline, and revision together from a clean external bill", async () => {
    const replaceRows = vi.fn().mockResolvedValue(authoritativeRows());
    const controller = createContractBillFocusController(
      controllerOptions({ replaceRows })
    );
    const refreshedBill: WorkbenchBill = {
      ...plainRows(bill),
      revision: 12,
      rows: [{
        ...plainRows(bill.rows[0]!),
        rowKey: "server-refreshed",
        itemName: "完整刷新钢筋"
      }]
    };

    controller.syncBill(refreshedBill);
    expect(controller.rows.value).toEqual([
      expect.objectContaining({
        rowKey: "server-refreshed",
        itemName: "完整刷新钢筋"
      })
    ]);
    expect(controller.dirty.value).toBe(false);

    await controller.saveAll();
    expect(replaceRows.mock.calls[0]?.[1]).toMatchObject({
      expectedBillRevision: 12,
      rows: [expect.objectContaining({ itemName: "完整刷新钢筋" })]
    });
  });

  it.each([
    {
      name: "100 行中有 1 行畸形",
      candidateRows: [
        ...Array.from({ length: 99 }, (_, index) => importRow(index)),
        { clientRowKey: "broken-100", itemName: "缺少单位和单价" }
      ]
    },
    {
      name: "唯一候选行畸形",
      candidateRows: [{ clientRowKey: "broken-1", itemName: "缺少单位和单价" }]
    },
    {
      name: "candidateRows 不是数组",
      candidateRows: { clientRowKey: "not-an-array" }
    }
  ])("rejects malformed Excel preview atomically: $name", async ({ candidateRows }) => {
    const controller = createContractBillFocusController(controllerOptions({
      previewImport: vi.fn().mockResolvedValue({
        added: 1,
        removed: 0,
        errors: [],
        candidateRows
      })
    }));
    const before = plainRows(controller.rows.value);

    await controller.previewExcel(new File(["xlsx"], "异常清单.xlsx"));

    expect(controller.replaceConfirmVisible.value).toBe(false);
    expect(controller.pendingImportRows.value).toBeNull();
    expect(controller.rows.value).toEqual(before);
    expect(controller.messageDanger.value).toBe(true);
  });

  it("restores the baseline when the parent confirms abandoning focus changes", () => {
    const controller = createContractBillFocusController(controllerOptions());
    const baseline = plainRows(controller.rows.value);
    controller.addRow();

    controller.discardChanges();

    expect(controller.rows.value).toEqual(baseline);
    expect(controller.dirty.value).toBe(false);
  });

  it("fails closed when discard is requested while the batch replacement is in flight", async () => {
    const replacement = deferred<ReplaceContractBillRowsReadModel>();
    const replaceRows = vi.fn().mockReturnValue(replacement.promise);
    const controller = createContractBillFocusController(
      controllerOptions({ replaceRows })
    );
    const localRows = plainRows(controller.rows.value);
    localRows[0]!.itemName = "保存中的本地钢筋";
    controller.setRows(localRows);

    const savePromise = controller.saveAll();
    expect(replaceRows).toHaveBeenCalledOnce();
    expect(controller.saving.value).toBe(true);

    expect(controller.discardChanges()).toBe(false);
    expect(controller.rows.value[0]?.itemName).toBe("保存中的本地钢筋");
    expect(controller.dirty.value).toBe(true);

    replacement.resolve(authoritativeRows());
    await savePromise;
    expect(controller.saving.value).toBe(false);
  });
});

describe("Contract bill workbench surfaces", () => {
  it("renders a summary-only normal section with totals and focus/import entries", async () => {
    const app = createSSRApp(ContractBillsSection, {
      workbench: { bills: [bill] },
      disabled: false
    });
    registerTDesignStubs(app);
    const html = await renderToString(app);

    expect(html).toContain("材料清单");
    expect(html).toContain("已保存行数");
    expect(html).toContain("不含税合计");
    expect(html).toContain("税额");
    expect(html).toContain("含税合计");
    expect(html).toContain("下载标准模板");
    expect(html).toContain("导入 Excel");
    expect(html).toContain("放大编辑");
    expect(html).not.toContain("jg-business-grid");
    expect(html).not.toContain("<input");
  });

  it("renders the full-width focus toolbar and the single domain grid", async () => {
    const app = createSSRApp(ContractBillFocusEditor, {
      bill,
      disabled: false,
      ordinaryDraftDirty: false
    });
    registerTDesignStubs(app);
    const html = await renderToString(app);

    expect(html).toContain("返回合同");
    expect(html).toContain("新增行");
    expect(html).toContain("复制行");
    expect(html).toContain("保存全部");
    expect(html).toContain("accept=\".xlsx");
    expect(html.match(/data-testid="contract-bill-grid"/gu)).toHaveLength(1);
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
    props: {
      accept: { type: String, default: "" }
    },
    setup(props, { attrs }) {
      return () => h("input", {
        ...attrs,
        type: "file",
        accept: props.accept
      });
    }
  }));
  app.component("ContractBillGrid", defineComponent({
    setup() {
      return () => h("div", { "data-testid": "contract-bill-grid" });
    }
  }));
}

function plainRows<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function importRow(index: number) {
  return {
    clientRowKey: `import-${index}`,
    sortOrder: index,
    itemName: `导入材料 ${index}`,
    unit: "吨",
    quantity: "1",
    unitPrice: "10",
    taxRatePercent: "13",
    taxRateSource: "version_default",
    isProvisional: false,
    customData: {}
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
