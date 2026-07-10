import * as ExcelJS from "exceljs";
import type { Cell } from "exceljs";
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
  "taxRatePercent",
  "isProvisional",
  "settlementBasis"
];

interface SheetRow {
  values: Record<string, unknown>;
  rowKey?: string;
}

type TestSchemaColumn = { key: string; label?: string; type?: string };

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
        const record = { id: `import-${imports.length + 1}`, ...data };
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
  return { service, tx, bill, version, rows, imports, fileService };
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
  });

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
            taxRatePercent: "0"
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
      expect.objectContaining({ sheet: DATA_SHEET, row: 3, column: "quantity" })
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
            taxRatePercent: "0"
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
    expect(preview.errors[0].message).toMatch(/merged/i);
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
              taxRatePercent: "0"
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

    const replace = await previewWith("replace");
    expect(replace.added).toBe(1);
    expect(replace.removed).toBe(1);

    const update = await previewWith("update", "key-1");
    expect(update.updated).toBe(1);
    expect(update.added).toBe(0);
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
            taxRatePercent: "0"
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
            taxRatePercent: "0"
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
            taxRatePercent: "0"
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
    ).rejects.toThrow("Contract bill import preview is stale");

    expect(tx.contractBillRow.create).not.toHaveBeenCalled();
    expect(rows).toHaveLength(0);
    expect(imports[0].status).toBe("preview");
  });
});
