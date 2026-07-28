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
}

function plain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
