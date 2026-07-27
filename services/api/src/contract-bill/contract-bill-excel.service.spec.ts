import * as ExcelJS from "exceljs";
import type { Cell } from "exceljs";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../database/prisma.service";
import { FileService } from "../file/file.service";
import { ContractBillExcelService } from "./contract-bill-excel.service";

const DATA_SHEET = "清单数据";
const INSTRUCTION_SHEET = "填写说明";
const ROW_KEY_CODE = "__rowKey";

// 测试用字段码顺序（与导出列顺序一致）。
const FIELD_CODES = [
  "itemCode",
  "itemName",
  "specification",
  "unit",
  "quantity",
  "unitPrice",
  "taxExclusiveUnitPrice",
  "taxRatePercent",
  "isProvisional",
  "settlementBasis"
];

interface SheetRow {
  values: Record<string, unknown>;
  rowKey?: string;
}

type TestSchemaColumn = { key: string; label?: string; type?: string; required?: boolean };

// 在内存中构造一个 `清单数据` 工作簿，第 1 行=标签、第 2 行=字段码、数据从第 3 行起。
async function buildWorkbookBuffer(options: {
  fieldCodes?: string[];
  rows: SheetRow[];
  mergeDataCell?: boolean;
}): Promise<Buffer> {
  const codes = options.fieldCodes ?? FIELD_CODES;
  const columns = [...codes, ROW_KEY_CODE];
  const workbook = new ExcelJS.Workbook();
  workbook.addWorksheet(INSTRUCTION_SHEET);
  const sheet = workbook.addWorksheet(DATA_SHEET);
  sheet.addRow(columns.map((code) => `标签:${code}`));
  sheet.addRow(columns);
  for (const row of options.rows) {
    const cells = codes.map((code) => row.values[code] ?? null);
    cells.push(row.rowKey ?? null);
    sheet.addRow(cells);
  }
  if (options.mergeDataCell) {
    sheet.mergeCells(3, 1, 3, 2);
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function billFixture(options: { rows?: Array<Record<string, unknown>> } = {}) {
  const bill = {
    id: "bill-1",
    contractVersionId: "version-1",
    revision: 2,
    name: "主合同清单",
    pricingMode: "tax_inclusive",
    amountRole: "included",
    quantityScale: 3,
    unitPriceScale: 2,
    schemaSnapshot: { columns: [] as TestSchemaColumn[] },
    taxInclusiveAmountCents: 0n,
    taxExclusiveAmountCents: 0n,
    taxAmountCents: 0n
  };
  const version = {
    id: "version-1",
    contractId: "contract-1",
    status: "draft",
    draftRevision: 5,
    amountSource: "bill_sum",
    pricingNature: "fixed_total",
    amountLimitType: "capped",
    taxMode: "single_rate",
    defaultTaxRatePercent: new Prisma.Decimal("13"),
    amountCents: 0n
  };
  const contract = { id: "contract-1", ownerUserId: "owner-1", voidedAt: null };
  const rows = [...(options.rows ?? [])];
  const imports: Array<Record<string, unknown>> = [];

  const tx = {
    contractBill: {
      findUnique: jest.fn().mockImplementation(() => Promise.resolve({ ...bill })),
      findMany: jest.fn().mockImplementation(() => Promise.resolve([{ ...bill }])),
      updateMany: jest
        .fn()
        .mockImplementation(({ where }: { where: { revision?: number } }) => {
          if (where.revision !== undefined && where.revision !== bill.revision) {
            return Promise.resolve({ count: 0 });
          }
          if (where.revision !== undefined) bill.revision += 1;
          return Promise.resolve({ count: 1 });
        }),
      update: jest.fn().mockImplementation(({ data }: { data: Record<string, bigint> }) => {
        Object.assign(bill, data);
        return Promise.resolve({ ...bill });
      })
    },
    contractVersion: {
      findUnique: jest.fn().mockResolvedValue(version),
      updateMany: jest.fn().mockImplementation(
        ({ where }: { where: { draftRevision?: number } }) => {
          if (
            where.draftRevision !== undefined &&
            where.draftRevision !== version.draftRevision
          ) {
            return Promise.resolve({ count: 0 });
          }
          if (where.draftRevision !== undefined) version.draftRevision += 1;
          return Promise.resolve({ count: 1 });
        }
      ),
      update: jest.fn().mockImplementation(({ data }: { data: { amountCents: bigint } }) => {
        version.amountCents = data.amountCents;
        return Promise.resolve(version);
      })
    },
    contract: {
      findUnique: jest.fn().mockResolvedValue(contract),
      updateMany: jest.fn().mockResolvedValue({ count: 1 })
    },
    contractBillRow: {
      findMany: jest
        .fn()
        .mockImplementation(() =>
          Promise.resolve([...rows].sort((a, b) => Number(a.sortOrder) - Number(b.sortOrder)))
        ),
      count: jest.fn().mockImplementation(() => Promise.resolve(rows.length)),
      create: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `row-${rows.length + 1}`, ...data };
        rows.push(row);
        return Promise.resolve(row);
      }),
      updateMany: jest.fn().mockImplementation(({ where, data }: {
        where: { rowKey: string };
        data: Record<string, unknown>;
      }) => {
        const row = rows.find((item) => item.rowKey === where.rowKey);
        if (!row) return Promise.resolve({ count: 0 });
        Object.assign(row, data);
        return Promise.resolve({ count: 1 });
      }),
      deleteMany: jest.fn().mockImplementation(({ where }: { where: { rowKey?: string } }) => {
        if (where.rowKey === undefined) {
          const count = rows.length;
          rows.length = 0;
          return Promise.resolve({ count });
        }
        const index = rows.findIndex((row) => row.rowKey === where.rowKey);
        if (index < 0) return Promise.resolve({ count: 0 });
        rows.splice(index, 1);
        return Promise.resolve({ count: 1 });
      })
    },
    contractBillImport: {
      create: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => {
        const record = { id: data.id ?? `import-${imports.length + 1}`, ...data };
        imports.push(record);
        return Promise.resolve(record);
      }),
      findUnique: jest.fn().mockImplementation(({ where }: { where: { id: string } }) =>
        Promise.resolve(imports.find((item) => item.id === where.id) ?? null)
      ),
      updateMany: jest.fn().mockImplementation(({ where, data }: {
        where: { id: string; status?: string };
        data: Record<string, unknown>;
      }) => {
        const record = imports.find((item) => item.id === where.id);
        if (!record) return Promise.resolve({ count: 0 });
        if (where.status !== undefined && record.status !== where.status) {
          return Promise.resolve({ count: 0 });
        }
        Object.assign(record, data);
        return Promise.resolve({ count: 1 });
      })
    },
    contractGeneratedDocument: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 })
    },
    auditLog: { create: jest.fn() }
  };

  const prisma = {
    fileObject: { findUnique: jest.fn() },
    $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx))
  } as unknown as PrismaService;

  const audit = { record: jest.fn().mockResolvedValue({}) };
  const fileService = { getFileBuffer: jest.fn() } as unknown as FileService;

  const service = new ContractBillExcelService(
    prisma,
    audit as never,
    fileService
  );
  return { service, tx, bill, version, rows, imports, fileService, audit };
}

describe("ContractBillExcelService", () => {
  it("exports an instruction sheet and one named data sheet", async () => {
    const { service } = billFixture();

    const result = await service.exportTemplate("bill-1", "owner-1");

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(result.buffer as unknown as ExcelJS.Buffer);
    expect(workbook.getWorksheet(INSTRUCTION_SHEET)).toBeDefined();
    expect(workbook.getWorksheet(DATA_SHEET)).toBeDefined();
    expect(result.fileName).toMatch(/\.xlsx$/);
  }, 15_000);

  it("hides internal field codes and row keys from business users", async () => {
    const { service } = billFixture();

    const result = await service.exportTemplate("bill-1", "owner-1");

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(result.buffer as unknown as ExcelJS.Buffer);
    const sheet = workbook.getWorksheet(DATA_SHEET)!;
    const labelRow = sheet.getRow(1);
    const codeRow = sheet.getRow(2);
    const codes: string[] = [];
    codeRow.eachCell((cell: Cell) => codes.push(String(cell.value)));
    expect(labelRow.getCell(1).value).toBe("项目编号");
    expect(codeRow.hidden).toBe(true);
    expect(codes).toContain(ROW_KEY_CODE);
    expect(codes).toContain("quantity");
    // 隐藏列：__rowKey 所在列必须隐藏。
    const rowKeyIndex = codes.indexOf(ROW_KEY_CODE) + 1;
    expect(sheet.getColumn(rowKeyIndex).hidden).toBe(true);
    expect((sheet.views?.[0] as { ySplit?: number })?.ySplit).toBe(2);
  });

  it("uses Chinese labels for custom bill columns in exported templates", async () => {
    const { service, bill } = billFixture();
    bill.schemaSnapshot = { columns: [{ key: "brand", label: "品牌", type: "text" }] };

    const result = await service.exportTemplate("bill-1", "owner-1");

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(result.buffer as unknown as ExcelJS.Buffer);
    const sheet = workbook.getWorksheet(DATA_SHEET)!;
    const labels: string[] = [];
    sheet.getRow(1).eachCell((cell: Cell) => labels.push(String(cell.value)));
    expect(labels).toContain("品牌");
    expect(labels).not.toContain("brand");
  });

  it("keeps seed-like core and calculated schema fields out of custom Excel columns", async () => {
    const { service, bill } = billFixture();
    bill.schemaSnapshot = { columns: [
      { key: "itemName", label: "名称", required: true },
      { key: "quantity", label: "数量", required: true },
      { key: "taxInclusiveAmount", label: "含税金额", required: true },
      { key: "brand", label: "品牌", required: true }
    ] };

    const result = await service.exportTemplate("bill-1", "owner-1");
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(result.buffer as unknown as ExcelJS.Buffer);
    const codes: string[] = [];
    workbook.getWorksheet(DATA_SHEET)!.getRow(2).eachCell((cell: Cell) => codes.push(String(cell.value)));
    expect(codes.filter((code) => code === "itemName")).toHaveLength(1);
    expect(codes.filter((code) => code === "quantity")).toHaveLength(1);
    expect(codes).not.toContain("taxInclusiveAmount");
    expect(codes).toContain("brand");
  });

  it("uses explicit inclusive and read-only exclusive unit price labels", async () => {
    const { service } = billFixture();

    const result = await service.exportTemplate("bill-1", "owner-1");

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(result.buffer as unknown as ExcelJS.Buffer);
    const labels: string[] = [];
    workbook
      .getWorksheet(DATA_SHEET)!
      .getRow(1)
      .eachCell((cell: Cell) => labels.push(String(cell.value)));
    expect(labels).toContain("含税单价(元)");
    expect(labels).toContain("不含税单价(元)");
    expect(labels).not.toContain("单价(元)");
    const codes: string[] = [];
    const sheet = workbook.getWorksheet(DATA_SHEET)!;
    sheet.getRow(2).eachCell((cell: Cell) => codes.push(String(cell.value)));
    expect(
      sheet.getRow(3).getCell(codes.indexOf("taxRatePercent") + 1).value
    ).toBe("13");
  });

  it("recalculates formulas from raw quantity, price, and tax cells", async () => {
    const { service, rows, fileService } = billFixture();
    const buffer = await buildWorkbookBuffer({
      rows: [
        {
          values: {
            itemName: "钢筋",
            unit: "t",
            // 公式结果应被忽略，原始文本 "3" / "100" 才被采用。
            quantity: { formula: "1+2", result: 999 },
            unitPrice: { formula: "50+50", result: 999 },
            taxRatePercent: "13"
          }
        }
      ]
    });
    (fileService.getFileBuffer as jest.Mock).mockResolvedValue({
      file: { id: "file-1", originalName: "bill.xlsx" },
      buffer
    });

    const preview = await service.previewImport("bill-1", "owner-1", {
      fileId: "file-1",
      mode: "append"
    });

    expect(preview.errors).toEqual([]);
    expect(preview.added).toBe(1);
    // 3 * 100 = 300.00 元 = 30000 分（含税），与公式缓存结果 999 无关。
    expect(preview.afterAmountCents).toBe("30000");
    expect(rows).toHaveLength(0);
  });

  it("keeps large Excel unit prices exact through import preview", async () => {
    const { service, rows, fileService } = billFixture();
    const buffer = await buildWorkbookBuffer({
      rows: [
        {
          values: {
            itemName: "超大额精度验证项",
            unit: "项",
            quantity: "1",
            unitPrice: "90071992547409.93",
            taxRatePercent: ""
          }
        }
      ]
    });
    (fileService.getFileBuffer as jest.Mock).mockResolvedValue({
      file: { id: "file-large-amount", originalName: "large-amount.xlsx" },
      buffer
    });

    const preview = await service.previewImport("bill-1", "owner-1", {
      fileId: "file-large-amount",
      mode: "append"
    });

    expect(preview.errors).toEqual([]);
    expect(preview.added).toBe(1);
    expect(preview.afterAmountCents).toBe("9007199254740993");
    expect(rows).toHaveLength(0);
  });

  it("returns sheet-row-column errors for invalid numbers", async () => {
    const { service, fileService } = billFixture();
    const buffer = await buildWorkbookBuffer({
      rows: [
        {
          values: {
            itemName: "钢筋",
            unit: "t",
            quantity: "abc",
            unitPrice: "100",
            taxRatePercent: "13"
          }
        }
      ]
    });
    (fileService.getFileBuffer as jest.Mock).mockResolvedValue({
      file: { id: "file-1", originalName: "bill.xlsx" },
      buffer
    });

    const preview = await service.previewImport("bill-1", "owner-1", {
      fileId: "file-1",
      mode: "append"
    });

    expect(preview.errors.length).toBeGreaterThan(0);
    expect(preview.errors[0]).toEqual(
      expect.objectContaining({
        sheet: DATA_SHEET,
        row: 3,
        column: "quantity",
        message: "数量必须是规范的非负数字"
      })
    );
  });

  it("rejects merged cells in the data area", async () => {
    const { service, rows, fileService } = billFixture();
    const buffer = await buildWorkbookBuffer({
      mergeDataCell: true,
      rows: [
        {
          values: {
            itemName: "钢筋",
            unit: "t",
            quantity: "1",
            unitPrice: "1",
            taxRatePercent: ""
          }
        }
      ]
    });
    (fileService.getFileBuffer as jest.Mock).mockResolvedValue({
      file: { id: "file-1", originalName: "bill.xlsx" },
      buffer
    });

    const preview = await service.previewImport("bill-1", "owner-1", {
      fileId: "file-1",
      mode: "append"
    });

    expect(preview.errors.length).toBeGreaterThan(0);
    expect(preview.errors).toContainEqual(
      expect.objectContaining({ sheet: DATA_SHEET, row: 3 })
    );
    expect(preview.errors[0].message).toBe("清单数据区域不允许合并单元格");
    // 合并单元格的数据行不得落库。
    expect(rows).toHaveLength(0);
  });

  it("previews append, replace, and update-by-row-key modes", async () => {
    const existing = {
      id: "row-1",
      contractBillId: "bill-1",
      rowKey: "key-1",
      sortOrder: 0,
      itemName: "旧",
      unit: "t",
      taxInclusiveAmountCents: 100n,
      taxExclusiveAmountCents: 100n,
      taxAmountCents: 0n
    };

    async function previewWith(mode: "append" | "replace" | "update", rowKey?: string) {
      const { service, fileService } = billFixture({ rows: [{ ...existing }] });
      const buffer = await buildWorkbookBuffer({
        rows: [
          {
            rowKey,
            values: {
              itemName: "新",
              unit: "t",
              quantity: "1",
              unitPrice: "1",
              taxRatePercent: ""
            }
          }
        ]
      });
      (fileService.getFileBuffer as jest.Mock).mockResolvedValue({
        file: { id: "file-1", originalName: "bill.xlsx" },
        buffer
      });
      return service.previewImport("bill-1", "owner-1", { fileId: "file-1", mode });
    }

    const append = await previewWith("append");
    expect(append.added).toBe(1);
    expect(append.removed).toBe(0);
    expect(append.candidateRows).toEqual([]);

    const replace = await previewWith("replace");
    expect(replace.added).toBe(1);
    expect(replace.removed).toBe(1);
    expect(replace.candidateRows).toEqual([
      expect.objectContaining({ sortOrder: 0, itemName: "新" })
    ]);

    const update = await previewWith("update", "key-1");
    expect(update.updated).toBe(1);
    expect(update.added).toBe(0);
    expect(update.candidateRows).toEqual([]);
  });

  it("applies a version replacement by updating an explicit one-to-one row without replacing its lineage", async () => {
    const existing = {
      id: "row-1",
      contractBillId: "bill-1",
      rowKey: "key-1",
      lineageId: "lineage-1",
      sortOrder: 0,
      itemName: "旧名称",
      unit: "t",
      taxInclusiveAmountCents: 100n,
      taxExclusiveAmountCents: 100n,
      taxAmountCents: 0n
    };
    const { service, tx, rows, fileService } = billFixture({ rows: [{ ...existing }] });
    const buffer = await buildWorkbookBuffer({
      rows: [{
        rowKey: "key-1",
        values: {
          itemName: "新名称",
          unit: "t",
          quantity: "2",
          unitPrice: "10",
          taxRatePercent: ""
        }
      }]
    });
    (fileService.getFileBuffer as jest.Mock).mockResolvedValue({
      file: { id: "file-version-replace", originalName: "bill.xlsx" },
      buffer
    });

    const preview = await service.previewImport("bill-1", "owner-1", {
      fileId: "file-version-replace",
      mode: "version_replace"
    } as never);
    await service.applyImport(preview.importId, "owner-1");

    expect(tx.contractBillRow.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { contractBillId: "bill-1", rowKey: "key-1" } })
    );
    expect(tx.contractBillRow.create).not.toHaveBeenCalled();
    expect(tx.contractBillRow.deleteMany).not.toHaveBeenCalled();
    expect(rows).toEqual([
      expect.objectContaining({
        id: "row-1",
        rowKey: "key-1",
        lineageId: "lineage-1",
        itemName: "新名称"
      })
    ]);
  });

  it("blocks the whole version replacement when an explicit row changes unit", async () => {
    const existing = {
      id: "row-1",
      contractBillId: "bill-1",
      rowKey: "key-1",
      lineageId: "lineage-1",
      sortOrder: 0,
      itemName: "旧名称",
      unit: "t",
      taxInclusiveAmountCents: 100n,
      taxExclusiveAmountCents: 100n,
      taxAmountCents: 0n
    };
    const { service, tx, rows, fileService, imports } = billFixture({ rows: [{ ...existing }] });
    const buffer = await buildWorkbookBuffer({
      rows: [{
        rowKey: "key-1",
        values: {
          itemName: "新名称",
          unit: "m",
          quantity: "2",
          unitPrice: "10",
          taxRatePercent: ""
        }
      }]
    });
    (fileService.getFileBuffer as jest.Mock).mockResolvedValue({
      file: { id: "file-version-replace-unit", originalName: "bill.xlsx" },
      buffer
    });

    const preview = await service.previewImport("bill-1", "owner-1", {
      fileId: "file-version-replace-unit",
      mode: "version_replace"
    } as never);

    expect(preview.errors).toContainEqual(
      expect.objectContaining({
        column: "unit",
        message: "单位变化不能自动确认清单来源关系，请人工复核后再导入"
      })
    );
    expect(preview.diffs).toEqual([
      expect.objectContaining({ kind: "manual_review", rowKey: "key-1" })
    ]);
    expect(imports[0]).toMatchObject({ mappingStatus: "pending" });
    await expect(service.applyImport(preview.importId, "owner-1")).rejects.toThrow(
      "合同清单导入预检存在错误，请先修正后重新预检"
    );
    expect(tx.contractBillRow.create).not.toHaveBeenCalled();
    expect(tx.contractBillRow.updateMany).not.toHaveBeenCalled();
    expect(tx.contractBillRow.deleteMany).not.toHaveBeenCalled();
    expect(rows).toEqual([existing]);
  });

  it.each(["append", "replace", "update"] as const)(
    "returns a recorded header error without row writes for a header-only %s import",
    async (mode) => {
      const existing = {
        id: "row-existing",
        contractBillId: "bill-1",
        rowKey: "existing-row-key",
        sortOrder: 0,
        taxInclusiveAmountCents: 100n,
        taxExclusiveAmountCents: 100n,
        taxAmountCents: 0n
      };
      const { service, tx, rows, fileService } = billFixture({ rows: [{ ...existing }] });
      const buffer = await buildWorkbookBuffer({
        fieldCodes: FIELD_CODES.filter((code) => code !== "specification"),
        rows: []
      });
      (fileService.getFileBuffer as jest.Mock).mockResolvedValue({
        file: { id: `file-header-only-${mode}`, originalName: "bill.xlsx" },
        buffer
      });

      const preview = await service.previewImport("bill-1", "owner-1", {
        fileId: `file-header-only-${mode}`,
        mode
      });

      expect(preview.errors).toContainEqual(
        expect.objectContaining({
          sheet: DATA_SHEET,
          row: 2,
          column: "specification",
          message: expect.stringContaining("模板列结构与当前系统标准模板不一致")
        })
      );
      expect(preview.candidateRows).toEqual([]);
      expect(preview.rows).toEqual([]);
      expect(preview.added).toBe(0);
      expect(preview.updated).toBe(0);
      expect(preview.removed).toBe(0);
      expect(tx.contractBillRow.create).not.toHaveBeenCalled();
      expect(tx.contractBillRow.updateMany).not.toHaveBeenCalled();
      expect(tx.contractBillRow.deleteMany).not.toHaveBeenCalled();
      expect(rows).toEqual([existing]);
    }
  );

  it.each([
    {
      name: "a missing optional core column",
      fieldCodes: FIELD_CODES.filter((code) => code !== "settlementBasis"),
      schemaColumns: [] as TestSchemaColumn[],
      expectedColumn: "settlementBasis",
      message: "缺少"
    },
    {
      name: "a missing current custom column",
      fieldCodes: FIELD_CODES,
      schemaColumns: [{ key: "brand", label: "品牌", type: "text" }],
      expectedColumn: "brand",
      message: "缺少"
    },
    {
      name: "a duplicate field code",
      fieldCodes: [
        "itemCode",
        "itemCode",
        ...FIELD_CODES.slice(2)
      ],
      schemaColumns: [] as TestSchemaColumn[],
      expectedColumn: "itemCode",
      message: "重复"
    },
    {
      name: "a non-empty extra field code",
      fieldCodes: [...FIELD_CODES, "unexpectedColumn"],
      schemaColumns: [] as TestSchemaColumn[],
      expectedColumn: "unexpectedColumn",
      message: "非系统字段"
    }
  ])("rejects header-only uploads with $name", async ({
    fieldCodes,
    schemaColumns,
    expectedColumn,
    message
  }) => {
    const { service, tx, bill, rows, fileService } = billFixture();
    bill.schemaSnapshot = { columns: schemaColumns };
    const buffer = await buildWorkbookBuffer({ fieldCodes, rows: [] });
    (fileService.getFileBuffer as jest.Mock).mockResolvedValue({
      file: { id: `file-malformed-${expectedColumn}`, originalName: "bill.xlsx" },
      buffer
    });

    const preview = await service.previewImport("bill-1", "owner-1", {
      fileId: `file-malformed-${expectedColumn}`,
      mode: "replace"
    });

    expect(preview.errors).toContainEqual(
      expect.objectContaining({
        sheet: DATA_SHEET,
        row: 2,
        column: expectedColumn,
        message: expect.stringContaining(message)
      })
    );
    expect(preview.candidateRows).toEqual([]);
    expect(preview.rows).toEqual([]);
    expect(tx.contractBillRow.create).not.toHaveBeenCalled();
    expect(tx.contractBillRow.updateMany).not.toHaveBeenCalled();
    expect(tx.contractBillRow.deleteMany).not.toHaveBeenCalled();
    expect(rows).toEqual([]);
  });

  it("permits a header-only upload when its complete template is current", async () => {
    const { service, fileService } = billFixture();
    const buffer = await buildWorkbookBuffer({ rows: [] });
    (fileService.getFileBuffer as jest.Mock).mockResolvedValue({
      file: { id: "file-standard-empty", originalName: "bill.xlsx" },
      buffer
    });

    const preview = await service.previewImport("bill-1", "owner-1", {
      fileId: "file-standard-empty",
      mode: "replace"
    });

    expect(preview.errors).toEqual([]);
    expect(preview.candidateRows).toEqual([]);
  });

  it("returns one complete replace candidate without writing contract bill rows", async () => {
    const { service, tx, bill, rows, fileService } = billFixture();
    bill.schemaSnapshot = {
      columns: [{ key: "brand", label: "品牌", type: "text", required: false }]
    };
    const buffer = await buildWorkbookBuffer({
      fieldCodes: [...FIELD_CODES, "brand"],
      rows: [
        {
          values: {
            itemName: "混凝土",
            unit: "m³",
            quantity: "12.5",
            unitPrice: "480",
            taxRatePercent: "",
            isProvisional: "是",
            brand: "C50"
          }
        }
      ]
    });
    (fileService.getFileBuffer as jest.Mock).mockResolvedValue({
      file: { id: "file-replace-single-candidate", originalName: "bill.xlsx" },
      buffer
    });

    const preview = await service.previewImport("bill-1", "owner-1", {
      fileId: "file-replace-single-candidate",
      mode: "replace"
    });

    expect(preview.errors).toEqual([]);
    expect(preview.candidateRows).toEqual([
      expect.objectContaining({
        clientRowKey: `import-${preview.importId}-1`,
        rowKey: undefined,
        sortOrder: 0,
        itemName: "混凝土",
        unit: "m³",
        quantity: "12.5",
        unitPrice: "480",
        taxRatePercent: "13",
        taxRateSource: "version_default",
        isProvisional: true,
        customData: { brand: "C50" }
      })
    ]);
    expect(tx.contractBillRow.create).not.toHaveBeenCalled();
    expect(tx.contractBillRow.updateMany).not.toHaveBeenCalled();
    expect(tx.contractBillRow.deleteMany).not.toHaveBeenCalled();
    expect(rows).toEqual([]);
  });

  it("normalizes supported Excel custom boolean values in replace candidates", async () => {
    const { service, tx, bill, rows, fileService } = billFixture();
    bill.schemaSnapshot = {
      columns: [
        {
          key: "fuelIncluded",
          label: "是否含燃油",
          type: "boolean",
          required: true
        }
      ]
    };
    const inputs = ["是", "否", " yes ", "NO"];
    const buffer = await buildWorkbookBuffer({
      fieldCodes: [...FIELD_CODES, "fuelIncluded"],
      rows: inputs.map((fuelIncluded, index) => ({
        values: {
          itemName: `运输项目 ${index + 1}`,
          unit: "项",
          quantity: "1",
          unitPrice: "100",
          taxRatePercent: "",
          fuelIncluded
        }
      }))
    });
    (fileService.getFileBuffer as jest.Mock).mockResolvedValue({
      file: { id: "file-boolean-candidates", originalName: "bill.xlsx" },
      buffer
    });

    const preview = await service.previewImport("bill-1", "owner-1", {
      fileId: "file-boolean-candidates",
      mode: "replace"
    });

    expect(preview.errors).toEqual([]);
    expect(preview.candidateRows.map((row) => row.customData)).toEqual([
      { fuelIncluded: "true" },
      { fuelIncluded: "false" },
      { fuelIncluded: "true" },
      { fuelIncluded: "false" }
    ]);
    expect(tx.contractBillRow.create).not.toHaveBeenCalled();
    expect(tx.contractBillRow.updateMany).not.toHaveBeenCalled();
    expect(tx.contractBillRow.deleteMany).not.toHaveBeenCalled();
    expect(rows).toEqual([]);
  });

  it("rejects an invalid Excel custom boolean value by its schema column key", async () => {
    const { service, bill, fileService } = billFixture();
    bill.schemaSnapshot = {
      columns: [
        {
          key: "fuelIncluded",
          label: "是否含燃油",
          type: "boolean",
          required: true
        }
      ]
    };
    const buffer = await buildWorkbookBuffer({
      fieldCodes: [...FIELD_CODES, "fuelIncluded"],
      rows: [{
        values: {
          itemName: "运输项目",
          unit: "项",
          quantity: "1",
          unitPrice: "100",
          taxRatePercent: "",
          fuelIncluded: "有"
        }
      }]
    });
    (fileService.getFileBuffer as jest.Mock).mockResolvedValue({
      file: { id: "file-invalid-boolean", originalName: "bill.xlsx" },
      buffer
    });

    const preview = await service.previewImport("bill-1", "owner-1", {
      fileId: "file-invalid-boolean",
      mode: "replace"
    });

    expect(preview.errors).toContainEqual(expect.objectContaining({
      row: 3,
      column: "fuelIncluded",
      message: "自定义字段“是否含燃油”必须选择“是”或“否”"
    }));
    expect(preview.candidateRows).toEqual([]);
  });

  it("returns multiple replace candidates in Excel order with unique client keys", async () => {
    const existing = {
      id: "row-existing",
      contractBillId: "bill-1",
      rowKey: "existing-row-key",
      sortOrder: 0,
      itemName: "旧清单行",
      unit: "项",
      taxInclusiveAmountCents: 100n,
      taxExclusiveAmountCents: 100n,
      taxAmountCents: 0n
    };
    const { service, tx, rows, fileService } = billFixture({ rows: [{ ...existing }] });
    const buffer = await buildWorkbookBuffer({
      rows: [
        {
          values: {
            itemName: "混凝土",
            unit: "m³",
            quantity: "12.5",
            unitPrice: "480",
            taxRatePercent: "",
            isProvisional: "是"
          }
        },
        {
          values: {
            itemCode: "A-02",
            itemName: "钢筋",
            specification: "HRB400",
            unit: "t",
            quantity: "3",
            unitPrice: "4100.50",
            taxRatePercent: "",
            settlementBasis: "按实结算"
          }
        }
      ]
    });
    (fileService.getFileBuffer as jest.Mock).mockResolvedValue({
      file: { id: "file-replace-candidates", originalName: "bill.xlsx" },
      buffer
    });

    const preview = await service.previewImport("bill-1", "owner-1", {
      fileId: "file-replace-candidates",
      mode: "replace"
    });

    expect(preview.errors).toEqual([]);
    expect(preview.candidateRows).toEqual([
      expect.objectContaining({
        clientRowKey: expect.stringMatching(/^import-/),
        rowKey: undefined,
        sortOrder: 0,
        itemName: "混凝土",
        unit: "m³",
        quantity: "12.5",
        unitPrice: "480",
        taxRatePercent: "13",
        taxRateSource: "version_default",
        customData: {}
      }),
      expect.objectContaining({
        sortOrder: 1,
        itemCode: "A-02",
        specification: "HRB400",
        settlementBasis: "按实结算",
        quantity: "3",
        unitPrice: "4100.5"
      })
    ]);
    expect(preview.candidateRows.map((row) => row.clientRowKey)).toEqual([
      `import-${preview.importId}-1`,
      `import-${preview.importId}-2`
    ]);
    expect(new Set(preview.candidateRows.map((row) => row.clientRowKey)).size).toBe(2);
    expect(tx.contractBillRow.create).not.toHaveBeenCalled();
    expect(tx.contractBillRow.updateMany).not.toHaveBeenCalled();
    expect(tx.contractBillRow.deleteMany).not.toHaveBeenCalled();
    expect(rows).toEqual([existing]);
  });

  it.each([
    {
      fieldCodes: FIELD_CODES.filter((code) => code !== "itemName"),
      values: { unit: "m³", quantity: "12.5", unitPrice: "480", taxRatePercent: "" }
    },
    {
      fieldCodes: FIELD_CODES,
      values: {
        itemName: "混凝土",
        unit: "m³",
        quantity: "not-a-number",
        unitPrice: "480",
        taxRatePercent: ""
      }
    }
  ])("returns no replace candidates when a template column or row validation fails", async ({
    fieldCodes,
    values
  }) => {
    const existing = {
      id: "row-existing",
      contractBillId: "bill-1",
      rowKey: "existing-row-key",
      sortOrder: 0,
      taxInclusiveAmountCents: 100n,
      taxExclusiveAmountCents: 100n,
      taxAmountCents: 0n
    };
    const { service, tx, rows, fileService } = billFixture({ rows: [{ ...existing }] });
    const buffer = await buildWorkbookBuffer({ rows: [{ values }], fieldCodes });
    (fileService.getFileBuffer as jest.Mock).mockResolvedValue({
      file: { id: "file-replace-invalid", originalName: "bill.xlsx" },
      buffer
    });

    const preview = await service.previewImport("bill-1", "owner-1", {
      fileId: "file-replace-invalid",
      mode: "replace"
    });

    expect(preview.errors.length).toBeGreaterThan(0);
    expect(preview.candidateRows).toEqual([]);
    expect(tx.contractBillRow.create).not.toHaveBeenCalled();
    expect(tx.contractBillRow.updateMany).not.toHaveBeenCalled();
    expect(tx.contractBillRow.deleteMany).not.toHaveBeenCalled();
    expect(rows).toEqual([existing]);
  });

  it("does not write rows until the preview is explicitly applied", async () => {
    const { service, tx, version, rows, imports, fileService } = billFixture();
    const buffer = await buildWorkbookBuffer({
      rows: [
        {
          values: {
            itemName: "钢筋",
            unit: "t",
            quantity: "1",
            unitPrice: "1",
            taxRatePercent: ""
          }
        }
      ]
    });
    (fileService.getFileBuffer as jest.Mock).mockResolvedValue({
      file: { id: "file-1", originalName: "bill.xlsx" },
      buffer
    });

    const preview = await service.previewImport("bill-1", "owner-1", {
      fileId: "file-1",
      mode: "append"
    });

    expect(tx.contractBillRow.create).not.toHaveBeenCalled();
    expect(rows).toHaveLength(0);
    expect(imports[0].status).toBe("preview");

    const importId = (preview as { importId: string }).importId;
    await service.applyImport(importId, "owner-1");

    expect(tx.contractBillRow.create).toHaveBeenCalledTimes(1);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      taxRate: "13",
      taxRateSource: "version_default",
      pricingFactStatus: "confirmed",
      precisionPolicy: "two_decimal"
    });
    expect(imports[0].status).toBe("applied");
    expect(imports[0].appliedByUserId).toBe("owner-1");
    expect(version.draftRevision).toBe(6);
    expect(tx.contractGeneratedDocument.updateMany).toHaveBeenCalledWith({
      where: {
        contractVersionId: "version-1",
        status: "success",
        sourceRevision: { lt: 6 }
      },
      data: { status: "stale" }
    });
  });

  it("keeps the original uploaded XLSX file id on the import record", async () => {
    const { service, imports, fileService } = billFixture();
    const buffer = await buildWorkbookBuffer({
      rows: [
        {
          values: {
            itemName: "钢筋",
            unit: "t",
            quantity: "1",
            unitPrice: "1",
            taxRatePercent: ""
          }
        }
      ]
    });
    (fileService.getFileBuffer as jest.Mock).mockResolvedValue({
      file: { id: "file-xyz", originalName: "bill.xlsx" },
      buffer
    });

    const preview = await service.previewImport("bill-1", "owner-1", {
      fileId: "file-xyz",
      mode: "append"
    });
    const importId = (preview as { importId: string }).importId;

    await service.applyImport(importId, "owner-1");

    expect(imports[0].fileId).toBe("file-xyz");
    expect(imports[0].status).toBe("applied");
  });

  it("rejects applying a preview after the bill revision changed", async () => {
    const { service, tx, bill, rows, imports, fileService } = billFixture();
    const buffer = await buildWorkbookBuffer({
      rows: [
        {
          values: {
            itemName: "钢筋",
            unit: "t",
            quantity: "1",
            unitPrice: "1",
            taxRatePercent: ""
          }
        }
      ]
    });
    (fileService.getFileBuffer as jest.Mock).mockResolvedValue({
      file: { id: "file-1", originalName: "bill.xlsx" },
      buffer
    });

    const preview = await service.previewImport("bill-1", "owner-1", {
      fileId: "file-1",
      mode: "append"
    });
    bill.revision += 1;

    await expect(
      service.applyImport((preview as { importId: string }).importId, "owner-1")
    ).rejects.toThrow("合同清单已变化，请重新预检后再应用");

    expect(tx.contractBillRow.create).not.toHaveBeenCalled();
    expect(rows).toHaveLength(0);
    expect(imports[0].status).toBe("preview");
  });

  it.each([
    { status: "applied", message: "该合同清单导入已应用，不能重复操作" },
    { status: "failed", message: "当前合同清单导入状态不可应用" }
  ])("应用导入时用中文说明 $status 状态", async ({ status, message }) => {
    const { service, imports } = billFixture();
    imports.push({ id: "import-1", status, contractBillId: "bill-1" });

    await expect(service.applyImport("import-1", "owner-1")).rejects.toThrow(message);
  });

  it("导入记录不存在时返回中文错误", async () => {
    const { service } = billFixture();

    await expect(service.applyImport("missing", "owner-1")).rejects.toThrow(
      "合同清单导入记录不存在"
    );
  });

  it("预检错误使用中文且不暴露公式解析哨兵", async () => {
    const { service, fileService } = billFixture();
    const buffer = await buildWorkbookBuffer({
      rows: [
        {
          values: {
            itemName: "钢筋",
            unit: "t",
            quantity: { formula: "1+", result: 1 },
            unitPrice: "1",
            taxRatePercent: ""
          }
        }
      ]
    });
    (fileService.getFileBuffer as jest.Mock).mockResolvedValue({
      file: { id: "file-formula", originalName: "bill.xlsx" },
      buffer
    });

    const preview = await service.previewImport("bill-1", "owner-1", {
      fileId: "file-formula",
      mode: "append"
    });

    expect(preview.errors.map((error) => error.message)).toEqual([
      "数量必须是规范的非负数字"
    ]);
    expect(JSON.stringify(preview.errors)).not.toMatch(
      /invalid expression|unbalanced parentheses|unexpected token|trailing tokens/
    );
  });

  it.each([
    { field: "itemName", value: "", message: "项目名称不能为空" },
    { field: "unit", value: "", message: "单位不能为空" },
    { field: "quantity", value: "1234567890123456789", message: "数量整数位数不能超过 18 位" },
    { field: "quantity", value: "1.001", message: "数量最多保留 2 位小数" },
    { field: "unitPrice", value: "1.001", message: "含税单价最多保留 2 位小数" },
    { field: "taxRatePercent", value: "101", message: "税率不能超过 100" },
    { field: "isProvisional", value: "maybe", message: "是否暂定格式无效" }
  ])("预检 $field 时返回中文业务错误", async ({ field, value, message }) => {
    const { service, fileService } = billFixture();
    const buffer = await buildWorkbookBuffer({
      rows: [
        {
          values: {
            itemName: "钢筋",
            unit: "t",
            quantity: "1",
            unitPrice: "1",
            taxRatePercent: "",
            [field]: value
          }
        }
      ]
    });
    (fileService.getFileBuffer as jest.Mock).mockResolvedValue({
      file: { id: "file-validation", originalName: "bill.xlsx" },
      buffer
    });

    const preview = await service.previewImport("bill-1", "owner-1", {
      fileId: "file-validation",
      mode: "append"
    });

    expect(preview.errors).toContainEqual(
      expect.objectContaining({ row: 3, column: field, message })
    );
  });

  it("rejects zero tax and permits an explicit multiple-rate override", async () => {
    const zero = billFixture();
    const zeroBuffer = await buildWorkbookBuffer({
      rows: [
        {
          values: {
            itemName: "钢筋",
            unit: "t",
            quantity: "1",
            unitPrice: "1",
            taxRatePercent: "0"
          }
        }
      ]
    });
    (zero.fileService.getFileBuffer as jest.Mock).mockResolvedValue({
      file: { id: "file-zero-rate", originalName: "bill.xlsx" },
      buffer: zeroBuffer
    });
    const zeroPreview = await zero.service.previewImport("bill-1", "owner-1", {
      fileId: "file-zero-rate",
      mode: "append"
    });
    expect(zeroPreview.errors).toContainEqual(
      expect.objectContaining({
        column: "taxRatePercent",
        message: "税率必须大于 0"
      })
    );

    const multiple = billFixture();
    multiple.version.taxMode = "multiple_rate";
    const overrideBuffer = await buildWorkbookBuffer({
      rows: [
        {
          values: {
            itemName: "例外税率项目",
            unit: "项",
            quantity: "1",
            unitPrice: "100",
            taxRatePercent: "6"
          }
        }
      ]
    });
    (multiple.fileService.getFileBuffer as jest.Mock).mockResolvedValue({
      file: { id: "file-override-rate", originalName: "bill.xlsx" },
      buffer: overrideBuffer
    });
    const preview = await multiple.service.previewImport("bill-1", "owner-1", {
      fileId: "file-override-rate",
      mode: "append"
    });
    expect(preview.errors).toEqual([]);
    await multiple.service.applyImport(preview.importId, "owner-1");
    expect(multiple.rows[0]).toMatchObject({
      taxRate: "6",
      taxRateSource: "row_override"
    });
  });

  it("returns no replace candidates for a different single-rate tax without writing rows", async () => {
    const existing = {
      id: "row-existing",
      contractBillId: "bill-1",
      rowKey: "existing-row-key",
      sortOrder: 0,
      taxInclusiveAmountCents: 100n,
      taxExclusiveAmountCents: 100n,
      taxAmountCents: 0n
    };
    const fixture = billFixture({ rows: [{ ...existing }] });
    const buffer = await buildWorkbookBuffer({
      rows: [
        {
          values: {
            itemName: "错误税率项目",
            unit: "项",
            quantity: "1",
            unitPrice: "100",
            taxRatePercent: "6"
          }
        }
      ]
    });
    (fixture.fileService.getFileBuffer as jest.Mock).mockResolvedValue({
      file: { id: "file-wrong-single-rate", originalName: "bill.xlsx" },
      buffer
    });

    const preview = await fixture.service.previewImport("bill-1", "owner-1", {
      fileId: "file-wrong-single-rate",
      mode: "replace"
    });

    expect(preview.errors).toContainEqual(
      expect.objectContaining({
        column: "taxRatePercent",
        message: "单一税率合同的清单税率必须与合同默认税率一致"
      })
    );
    expect(preview.candidateRows).toEqual([]);
    expect(fixture.tx.contractBillRow.create).not.toHaveBeenCalled();
    expect(fixture.tx.contractBillRow.updateMany).not.toHaveBeenCalled();
    expect(fixture.tx.contractBillRow.deleteMany).not.toHaveBeenCalled();
    expect(fixture.rows).toEqual([existing]);
  });

  it("preserves unchanged legacy precision in update imports and rejects partial conversion", async () => {
    const existing = {
      id: "row-legacy",
      contractBillId: "bill-1",
      rowKey: "legacy",
      sortOrder: 0,
      itemName: "旧项目",
      unit: "项",
      quantity: new Prisma.Decimal("1.123"),
      unitPrice: new Prisma.Decimal("2.345"),
      taxRate: new Prisma.Decimal("13"),
      taxRateSource: "version_default",
      precisionPolicy: "legacy",
      pricingFactStatus: "confirmed",
      taxInclusiveAmountCents: 264n,
      taxExclusiveAmountCents: 234n,
      taxAmountCents: 30n
    };
    const fixture = billFixture({ rows: [existing] });
    const unchanged = await buildWorkbookBuffer({
      rows: [
        {
          rowKey: "legacy",
          values: {
            itemName: "仅修改名称",
            unit: "项",
            quantity: "1.123",
            unitPrice: "2.345",
            taxRatePercent: ""
          }
        }
      ]
    });
    (fixture.fileService.getFileBuffer as jest.Mock).mockResolvedValue({
      file: { id: "file-legacy-unchanged", originalName: "bill.xlsx" },
      buffer: unchanged
    });
    const accepted = await fixture.service.previewImport("bill-1", "owner-1", {
      fileId: "file-legacy-unchanged",
      mode: "update"
    });
    expect(accepted.errors).toEqual([]);

    const partiallyChanged = await buildWorkbookBuffer({
      rows: [
        {
          rowKey: "legacy",
          values: {
            itemName: "修改价格",
            unit: "项",
            quantity: "1.123",
            unitPrice: "2.35",
            taxRatePercent: ""
          }
        }
      ]
    });
    (fixture.fileService.getFileBuffer as jest.Mock).mockResolvedValue({
      file: { id: "file-legacy-changed", originalName: "bill.xlsx" },
      buffer: partiallyChanged
    });
    const blocked = await fixture.service.previewImport("bill-1", "owner-1", {
      fileId: "file-legacy-changed",
      mode: "update"
    });
    expect(blocked.errors).toContainEqual(
      expect.objectContaining({
        column: "quantity",
        message: "数量最多保留 2 位小数"
      })
    );
  });

  it("allows blank estimated quantity only for unlimited framework imports", async () => {
    const ordinary = billFixture();
    const buffer = await buildWorkbookBuffer({
      rows: [
        {
          values: {
            itemName: "框架项目",
            unit: "项",
            quantity: "",
            unitPrice: "100",
            taxRatePercent: ""
          }
        }
      ]
    });
    (ordinary.fileService.getFileBuffer as jest.Mock).mockResolvedValue({
      file: { id: "file-blank-quantity", originalName: "bill.xlsx" },
      buffer
    });
    const blocked = await ordinary.service.previewImport("bill-1", "owner-1", {
      fileId: "file-blank-quantity",
      mode: "append"
    });
    expect(blocked.errors).toContainEqual(
      expect.objectContaining({ column: "quantity", message: "数量不能为空" })
    );

    const framework = billFixture();
    framework.version.pricingNature = "framework";
    framework.version.amountLimitType = "unlimited";
    (framework.fileService.getFileBuffer as jest.Mock).mockResolvedValue({
      file: { id: "file-framework", originalName: "bill.xlsx" },
      buffer
    });
    const preview = await framework.service.previewImport("bill-1", "owner-1", {
      fileId: "file-framework",
      mode: "append"
    });
    expect(preview.errors).toEqual([]);
    await framework.service.applyImport(preview.importId, "owner-1");
    expect(framework.rows[0]).toMatchObject({
      quantity: null,
      taxInclusiveAmountCents: null,
      taxExclusiveAmountCents: null,
      taxAmountCents: null
    });
  });

  it("必填自定义字段缺失时返回中文预检错误", async () => {
    const { service, bill, fileService } = billFixture();
    bill.schemaSnapshot = {
      columns: [{ key: "brand", label: "品牌", type: "text", required: true }]
    };
    const buffer = await buildWorkbookBuffer({
      fieldCodes: [...FIELD_CODES, "brand"],
      rows: [
        {
          values: {
            itemName: "钢筋",
            unit: "t",
            quantity: "1",
            unitPrice: "1",
            taxRatePercent: "",
            brand: ""
          }
        }
      ]
    });
    (fileService.getFileBuffer as jest.Mock).mockResolvedValue({
      file: { id: "file-custom", originalName: "bill.xlsx" },
      buffer
    });

    const preview = await service.previewImport("bill-1", "owner-1", {
      fileId: "file-custom",
      mode: "append"
    });

    expect(preview.errors).toContainEqual(
      expect.objectContaining({
        row: 3,
        column: "brand",
        message: "必填自定义字段未填写：brand"
      })
    );
  });

  it.each([
    { rowKeys: [undefined], existingKeys: ["key-1"], message: "更新模式要求每行都包含 __rowKey" },
    { rowKeys: ["missing"], existingKeys: ["key-1"], message: "清单中不存在行标识：missing" },
    { rowKeys: ["key-1", "key-1"], existingKeys: ["key-1"], message: "行标识重复：key-1" }
  ])("更新模式行标识错误使用中文", async ({ rowKeys, existingKeys, message }) => {
    const existingRows = existingKeys.map((rowKey, index) => ({
      id: `row-${index + 1}`,
      contractBillId: "bill-1",
      rowKey,
      sortOrder: index,
      taxInclusiveAmountCents: 100n,
      taxExclusiveAmountCents: 100n,
      taxAmountCents: 0n
    }));
    const { service, fileService } = billFixture({ rows: existingRows });
    const buffer = await buildWorkbookBuffer({
      rows: rowKeys.map((rowKey) => ({
        rowKey,
        values: {
          itemName: "钢筋",
          unit: "t",
          quantity: "1",
          unitPrice: "1",
          taxRatePercent: ""
        }
      }))
    });
    (fileService.getFileBuffer as jest.Mock).mockResolvedValue({
      file: { id: "file-row-key", originalName: "bill.xlsx" },
      buffer
    });

    const preview = await service.previewImport("bill-1", "owner-1", {
      fileId: "file-row-key",
      mode: "update"
    });

    expect(preview.errors.map((error) => error.message)).toContain(message);
  });

  it.each([
    { input: null, message: "Excel 导入提交内容必须是对象" },
    { input: { fileId: "", mode: "append" }, message: "文件标识不能为空" },
    { input: { fileId: "file-1", mode: "merge" }, message: "导入模式必须是替换、更新、追加或新版清单导入" }
  ])("导入参数无效时返回中文错误", async ({ input, message }) => {
    const { service } = billFixture();

    await expect(
      service.previewImport("bill-1", "owner-1", input as never)
    ).rejects.toThrow(message);
  });

  it("导入文件缺少清单工作表时返回中文错误", async () => {
    const { service, fileService } = billFixture();
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet("其他工作表");
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    (fileService.getFileBuffer as jest.Mock).mockResolvedValue({
      file: { id: "file-no-sheet", originalName: "bill.xlsx" },
      buffer
    });

    await expect(
      service.previewImport("bill-1", "owner-1", {
        fileId: "file-no-sheet",
        mode: "append"
      })
    ).rejects.toThrow("Excel 文件缺少“清单数据”工作表");
  });

  it("损坏的 Excel 文件返回固定中文错误且不写入预检记录", async () => {
    const { service, tx, imports, fileService, audit } = billFixture();
    const sensitiveContent = "TOP-SECRET corrupt workbook";
    (fileService.getFileBuffer as jest.Mock).mockResolvedValue({
      file: { id: "file-corrupt", originalName: "broken.xlsx" },
      buffer: Buffer.from(sensitiveContent)
    });

    let thrown: unknown;
    try {
      await service.previewImport("bill-1", "owner-1", {
        fileId: "file-corrupt",
        mode: "append"
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toMatchObject({
      status: 400,
      message: "Excel 文件无法解析，请确认文件完整且格式正确"
    });
    expect(JSON.stringify(thrown)).not.toContain(sensitiveContent);
    expect(tx.contractBillImport.create).not.toHaveBeenCalled();
    expect(imports).toHaveLength(0);
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("存储的预检数据无效时返回中文错误", async () => {
    const { service, imports } = billFixture();
    imports.push({
      id: "import-invalid-preview",
      status: "preview",
      contractBillId: "bill-1",
      preview: {}
    });

    await expect(
      service.applyImport("import-invalid-preview", "owner-1")
    ).rejects.toThrow("合同清单导入预检数据无效");
  });
});
