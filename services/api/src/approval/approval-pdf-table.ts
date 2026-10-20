import { BadRequestException } from "@nestjs/common";
export interface TableColumn {
  header: string;
  width: number;
}

// 画带框线的表格，返回表格底部 y。单元格内文本自动换行；行高随内容增长。
// 可选 imageColumn + rowImages（按数据行索引）在指定列嵌入图片（如签名图）。
export function drawApprovalTable(
  doc: PDFKit.PDFDocument,
  startX: number,
  startY: number,
  columns: TableColumn[],
  rows: string[][],
  options: {
    headerRow?: boolean;
    minRowHeight?: number;
    imageColumn?: number;
    rowImages?: (Buffer | null)[];
  } = {}
): number {
  const cellPadding = 4;
  const bottomLimit = doc.page.height - doc.page.margins.bottom;
  const pageCapacity = bottomLimit - doc.page.margins.top;
  const hasHeader = options.headerRow !== false;
  const header = columns.map(column => column.header);
  let y = startY;
  const measure = (row: string[], size: number) => {
    doc.fontSize(size);
    return Math.max(...row.map((cell, index) => doc.heightOfString(cell || "", {
      width: columns[index].width - cellPadding * 2
    }))) + cellPadding * 2;
  };
  const headerHeight = hasHeader ? measure(header, 9) : 0;
  const draw = (row: string[], height: number, size: number, isHeader: boolean, image?: Buffer | null) => {
    doc.fontSize(size);
    let x = startX;
    row.forEach((cell, index) => {
      const width = columns[index].width;
      if (isHeader) doc.rect(x, y, width, height).fill("#eeeeee").fillColor("#000000");
      doc.rect(x, y, width, height).stroke("#000000");
      if (image && index === options.imageColumn) {
        try { doc.image(image, x + cellPadding, y + cellPadding, {
          fit: [width - cellPadding * 2, Math.min(44, height - cellPadding * 2)], align: "center", valign: "center"
        }); } catch { throw new BadRequestException("审批签名图片无法解码，不能生成正式审批单"); }
      } else doc.text(cell || "", x + cellPadding, y + cellPadding, { width: width - cellPadding * 2, height: height - cellPadding * 2 });
      x += width;
    });
    y += height;
  };
  const newPage = () => {
    doc.addPage(); y = doc.page.margins.top;
    if (hasHeader) draw(header, headerHeight, 9, true);
  };
  if (hasHeader) {
    if (y + headerHeight + (options.minRowHeight ?? 20) > bottomLimit) newPage();
    else draw(header, headerHeight, 9, true);
  }
  rows.forEach((row, index) => {
    const image = options.rowImages?.[index];
    let size = 9;
    let height = Math.max(measure(row, size), options.minRowHeight ?? 0);
    // Keep one signer's identity, full opinion and image together, including long opinions.
    while (height > pageCapacity - headerHeight && size > 4.5) {
      size -= 0.25;
      height = Math.max(measure(row, size), options.minRowHeight ?? 0);
    }
    if (height > pageCapacity - headerHeight) throw new BadRequestException("单条审批内容超过纸张容量，请核查内容后重试");
    if (y + height > bottomLimit) newPage();
    draw(row, height, size, false, image);
  });

  return y;
}

