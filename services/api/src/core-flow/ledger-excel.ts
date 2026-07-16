import * as ExcelJS from "exceljs";

export const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export interface LedgerExcelColumn<Row> {
  header: string;
  key: keyof Row;
  width?: number;
}

export async function buildLedgerWorkbook<Row extends Record<string, unknown>>(input: {
  sheetName: string;
  columns: readonly LedgerExcelColumn<Row>[];
  rows: readonly Row[];
}) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "建工智管";
  workbook.created = new Date();
  const sheet = workbook.addWorksheet(input.sheetName);
  sheet.columns = input.columns.map((column) => ({
    header: column.header,
    key: String(column.key),
    width: column.width ?? 18
  }));
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: input.columns.length }
  };

  const header = sheet.getRow(1);
  header.height = 24;
  header.font = { bold: true, color: { argb: "FF1F2329" } };
  header.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFF2F3F5" }
  };
  header.alignment = { vertical: "middle", horizontal: "center" };

  for (const row of input.rows) {
    const worksheetRow = sheet.addRow(row);
    worksheetRow.height = 22;
    worksheetRow.alignment = { vertical: "middle", wrapText: true };
  }

  sheet.eachRow((row) => {
    row.eachCell((cell) => {
      cell.border = {
        top: { style: "thin", color: { argb: "FFDCDCDC" } },
        left: { style: "thin", color: { argb: "FFDCDCDC" } },
        bottom: { style: "thin", color: { argb: "FFDCDCDC" } },
        right: { style: "thin", color: { argb: "FFDCDCDC" } }
      };
    });
  });

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

export function shanghaiDateStamp(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  })
    .format(now)
    .replace(/-/g, "");
}
