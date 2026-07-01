import PizZip from "pizzip";
import {
  formatChineseUppercaseMoney,
  formatMoneyCents,
  renderContractDocx
} from "./contract-docx-renderer";

function createDocx(documentXml: string): Buffer {
  const zip = new PizZip();
  zip.file(
    "[Content_Types].xml",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      "</Types>"
  );
  zip.folder("_rels")?.file(
    ".rels",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      "</Relationships>"
  );
  zip.folder("word")?.file(
    "document.xml",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      `<w:body>${documentXml}<w:sectPr/></w:body>` +
      "</w:document>"
  );
  return zip.generate({ type: "nodebuffer" });
}

function paragraph(text: string): string {
  return `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
}

function table(rows: string[][]): string {
  return `<w:tbl>${rows
    .map(
      (row) =>
        `<w:tr>${row
          .map((cell) => `<w:tc><w:p><w:r><w:t xml:space="preserve">${cell}</w:t></w:r></w:p></w:tc>`)
          .join("")}</w:tr>`
    )
    .join("")}</w:tbl>`;
}

function renderedDocumentXml(buffer: Buffer): string {
  return new PizZip(buffer).file("word/document.xml")?.asText() ?? "";
}

function countOccurrences(text: string, value: string): number {
  return text.split(value).length - 1;
}

function requiredValues(values: Record<string, unknown> = {}) {
  return {
    "contract.name": "钢材采购合同",
    "contract.temporaryCode": "DRAFT-20260624-AB12CD34",
    "document.watermark": "草稿",
    ...values
  };
}

describe("contract DOCX renderer", () => {
  it("renders contract, field, clause, and party placeholders", () => {
    const template = createDocx(
      paragraph(
        "{contract.name}|{contract.temporaryCode}|{contract.code}|{party.party_b.name}|{field.deliveryLocation}|{clause.payment.text}|{document.generatedAt}"
      )
    );

    const result = renderContractDocx(template, {
      values: requiredValues({
        "contract.code": "",
        "party.party_b.name": "云南示例供应商有限公司",
        "field.deliveryLocation": "项目现场",
        "clause.payment.text": "结算单生效后方可付款。",
        "document.generatedAt": "2026-06-24 16:00:00"
      })
    });

    const xml = renderedDocumentXml(result);
    expect(xml).toContain("钢材采购合同");
    expect(xml).toContain("DRAFT-20260624-AB12CD34");
    expect(xml).toContain("云南示例供应商有限公司");
    expect(xml).toContain("项目现场");
    expect(xml).toContain("结算单生效后方可付款。");
    expect(xml).toContain("2026-06-24 16:00:00");
  });

  it("renders bill rows through a docxtemplater loop", () => {
    const template = createDocx(
      [
        paragraph("{#bill.materials}"),
        paragraph("{itemName}|{specification}|{unit}|{quantity}|{unitPrice}|{taxRatePercent}"),
        paragraph("{/bill.materials}")
      ].join("")
    );

    const result = renderContractDocx(template, {
      values: requiredValues({
        "bill.materials": [
          {
            itemName: "螺纹钢",
            specification: "HRB400E Φ20",
            unit: "吨",
            quantity: "10.000",
            unitPrice: "3,500.00",
            taxRatePercent: "13%"
          },
          {
            itemName: "盘螺",
            specification: "HRB400E Φ8",
            unit: "吨",
            quantity: "2.000",
            unitPrice: "3,600.00",
            taxRatePercent: "13%"
          }
        ]
      })
    });

    const xml = renderedDocumentXml(result);
    expect(xml).toContain("螺纹钢");
    expect(xml).toContain("HRB400E Φ20");
    expect(xml).toContain("盘螺");
    expect(xml).toContain("HRB400E Φ8");
    expect(xml).not.toContain("bill.materials");
  });

  it("merges repeated bill tables after rendering a table-level loop", () => {
    const template = createDocx(
      [
        paragraph("{#bill.materials}"),
        table([
          ["序号", "货物名称", "规格型号", "计量单位", "数量", "含税单价", "税率(%)", "价税合计"],
          ["", "{itemName}", "{specification}", "{unit}", "{quantity}", "{unitPrice}", "{taxRatePercent}", "{taxInclusiveAmount}"]
        ]),
        paragraph("{/bill.materials}")
      ].join("")
    );

    const result = renderContractDocx(template, {
      values: requiredValues({
        "bill.materials": [
          {
            itemName: "钢筋",
            specification: "HRB400E 直径18",
            unit: "吨",
            quantity: "10.000",
            unitPrice: "10000.0000",
            taxRatePercent: "13",
            taxInclusiveAmount: "100000.00"
          },
          {
            itemName: "水泥",
            specification: "P.O 42.5",
            unit: "吨",
            quantity: "20.000",
            unitPrice: "480.0000",
            taxRatePercent: "13",
            taxInclusiveAmount: "9600.00"
          }
        ]
      })
    });

    const xml = renderedDocumentXml(result);
    expect(countOccurrences(xml, "货物名称")).toBe(1);
    expect(xml).toContain("钢筋");
    expect(xml).toContain("水泥");
  });

  it("uses formatted money and uppercase money values", () => {
    const amountCents = 100_000_000n;
    const template = createDocx(
      paragraph("{contract.amount}|{contract.amountUppercase}")
    );

    const result = renderContractDocx(template, {
      values: requiredValues({
        "contract.amount": formatMoneyCents(amountCents),
        "contract.amountUppercase": formatChineseUppercaseMoney(amountCents)
      })
    });

    const xml = renderedDocumentXml(result);
    expect(xml).toContain("1,000,000.00");
    expect(xml).toContain("人民币壹佰万元整");
  });

  it("fails on an unresolved required placeholder", () => {
    const template = createDocx(
      paragraph("{contract.name}|{field.deliveryLocation}|{document.watermark}")
    );

    expect(() =>
      renderContractDocx(
        template,
        {
          values: requiredValues()
        },
        ["field.deliveryLocation"]
      )
    ).toThrow(
      "Missing required contract document values: field.deliveryLocation"
    );
  });

  it.each([
    ["contract.name", "   "],
    ["document.watermark", "\t\n"]
  ])("rejects blank required string value for %s", (key, value) => {
    const template = createDocx(paragraph("{contract.name}|{document.watermark}"));

    expect(() =>
      renderContractDocx(template, {
        values: requiredValues({ [key]: value })
      })
    ).toThrow(`Missing required contract document values: ${key}`);
  });

  it("allows unresolved optional placeholders to render as empty strings", () => {
    const template = createDocx(paragraph("编号：{contract.code}。"));
    const result = renderContractDocx(template, {
      values: requiredValues()
    });

    expect(renderedDocumentXml(result)).toContain("编号：。");
  });

  it.each(["草稿", "磋商稿"])(
    "adds the requested %s watermark value",
    (watermark) => {
      const template = createDocx(paragraph("{document.watermark}"));
      const result = renderContractDocx(template, {
        values: requiredValues({ "document.watermark": watermark })
      });

      expect(renderedDocumentXml(result)).toContain(watermark);
    }
  );

  it("rejects invalid DOCX input with a clear error", () => {
    expect(() =>
      renderContractDocx(Buffer.from("not a docx"), {
        values: requiredValues()
      })
    ).toThrow("Invalid contract DOCX template");
  });
});

describe("contract money formatting", () => {
  it.each([
    [0n, "人民币零元整"],
    [100n, "人民币壹元整"],
    [105n, "人民币壹元零伍分"],
    [1010n, "人民币壹拾元壹角"],
    [100_100n, "人民币壹仟零壹元整"],
    [100_010_000n, "人民币壹佰万零壹佰元整"],
    [100_000_000n, "人民币壹佰万元整"],
    [10_000_000_100n, "人民币壹亿零壹元整"],
    [100_000_000_000_100n, "人民币壹兆零壹元整"],
    [1_234_567_890_12n, "人民币壹拾贰亿叁仟肆佰伍拾陆万柒仟捌佰玖拾元壹角贰分"]
  ])("formats %s cents as Chinese uppercase money", (cents, expected) => {
    expect(formatChineseUppercaseMoney(cents)).toBe(expected);
  });

  it("formats cents without locale-dependent output", () => {
    expect(formatMoneyCents(1_234_567_890_12n)).toBe("1,234,567,890.12");
  });

  it.each([-1n, Number.MAX_SAFE_INTEGER + 1, 1.5])(
    "rejects invalid cents value %s",
    (cents) => {
      expect(() =>
        formatChineseUppercaseMoney(cents as bigint | number)
      ).toThrow("Money cents must be a non-negative bigint or safe integer");
    }
  );
});
