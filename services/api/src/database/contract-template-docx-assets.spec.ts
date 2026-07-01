import { existsSync, readFileSync } from "node:fs";
import * as path from "node:path";
import PizZip from "pizzip";

const repoRoot = path.resolve(__dirname, "../../../..");
const templatesRoot = path.join(repoRoot, "services/api/assets/templates");
const blockedProvenanceStrings = ["WPS", "wpsCustomData", "LibreOffice", "Lenovo", "LIYI", "hdid", "userId"];

function countOccurrences(text: string, value: string) {
  return text.split(value).length - 1;
}

function readDocxXml(fileName: string) {
  const filePath = path.join(templatesRoot, fileName);
  expect(existsSync(filePath)).toBe(true);
  const zip = new PizZip(readFileSync(filePath));
  const fileNames = Object.keys(zip.files);
  const xmlFiles = fileNames
    .filter((name) => name.startsWith("word/") && name.endsWith(".xml"))
    .map((name) => zip.file(name)?.asText() ?? "");
  return {
    appXml: zip.file("docProps/app.xml")?.asText() ?? "",
    contentTypesXml: zip.file("[Content_Types].xml")?.asText() ?? "",
    coreXml: zip.file("docProps/core.xml")?.asText() ?? "",
    fileNames,
    relationshipsText: fileNames
      .filter((name) => name.endsWith(".rels"))
      .map((name) => zip.file(name)?.asText() ?? "")
      .join("\n"),
    stylesXml: zip.file("word/styles.xml")?.asText() ?? "",
    text: xmlFiles.join("\n")
  };
}

describe("contract DOCX template assets", () => {
  it.each([
    {
      fileName: "material-purchase-real-v1.docx",
      placeholders: [
        "contract.name",
        "contract.temporaryCode",
        "contract.amountUppercase",
        "party.owner.name",
        "party.counterparty.name",
        "field.projectName",
        "field.deliveryLocation",
        "field.deliveryDeadline",
        "field.qualityStandard",
        "field.taxRatePercent",
        "field.settlementMethod",
        "clause.payment.text",
        "bill.materials"
      ]
    },
    {
      fileName: "equipment-rental-real-v1.docx",
      placeholders: [
        "contract.name",
        "contract.temporaryCode",
        "contract.amountUppercase",
        "party.owner.name",
        "party.counterparty.name",
        "field.rentalStartDate",
        "field.rentalEndDate",
        "field.useLocation",
        "field.settlementCycle",
        "field.paymentRatioPercent",
        "clause.payment.text",
        "bill.equipmentRentals"
      ]
    },
    {
      fileName: "labor-subcontract-real-v1.docx",
      placeholders: [
        "contract.name",
        "contract.temporaryCode",
        "contract.amountUppercase",
        "party.owner.name",
        "party.counterparty.name",
        "field.workScope",
        "field.workLocation",
        "field.plannedStartDate",
        "field.plannedEndDate",
        "field.settlementCycle",
        "field.progressPaymentRatioPercent",
        "clause.payment.text",
        "clause.safety.text",
        "clause.wageCommitment.text",
        "bill.laborItems"
      ]
    },
    {
      fileName: "generic-contract-v1.docx",
      placeholders: [
        "contract.name",
        "contract.temporaryCode",
        "contract.amountUppercase",
        "field.businessSummary",
        "field.settlementCycle",
        "field.paymentRatioPercent",
        "clause.payment.text",
        "clause.specialAgreement.text",
        "bill.genericItems"
      ]
    }
  ])("$fileName contains required placeholders, Word sections, and neutral metadata", ({ fileName, placeholders }) => {
    const docx = readDocxXml(fileName);
    expect(docx.fileNames.some((name) => name.startsWith("word/header"))).toBe(true);
    expect(docx.fileNames.some((name) => name.startsWith("word/footer"))).toBe(true);
    expect(docx.text).toContain("sectPr");
    expect(docx.text).toContain("document.watermark");
    expect(docx.text).toContain("第    页 / 共    页");
    expect(docx.text).toContain(
      '<w:pgMar w:top="1417" w:right="1701" w:bottom="1417" w:left="1701" w:header="720" w:footer="720" w:gutter="0"/>'
    );
    expect(docx.stylesXml).toContain('w:style w:type="paragraph" w:default="1" w:styleId="Normal"');
    expect(docx.stylesXml).toContain('w:ascii="Times New Roman"');
    expect(docx.stylesXml).toContain('w:eastAsia="仿宋"');
    expect(docx.stylesXml).toContain('w:line="500" w:lineRule="exact"');
    expect(docx.stylesXml).toContain('w:firstLineChars="200"');
    expect(docx.stylesXml).toContain('w:style w:type="paragraph" w:styleId="ContractTitle"');
    expect(docx.stylesXml).toContain('w:eastAsia="黑体"');
    expect(`${docx.stylesXml}\n${docx.text}`).not.toMatch(
      /宋体|仿宋_GB2312|方正仿宋简体|方正小标宋简体|方正宋三简体|Calibri|楷体/
    );
    expect(docx.text).not.toContain('w:color w:val="FF0000"');
    expect(docx.text).not.toContain('<w:pgSz w:orient="landscape" w:w="11906" w:h="16838"/>');
    for (const placeholder of placeholders) {
      expect(docx.text).toContain(placeholder);
    }

    expect(docx.fileNames.some((name) => name.startsWith("customXml/"))).toBe(false);
    expect(docx.fileNames).not.toContain("docProps/custom.xml");
    expect(docx.relationshipsText).not.toContain("customXml");
    expect(docx.contentTypesXml).not.toContain("customXml");
    expect(docx.contentTypesXml).not.toContain("docProps/custom.xml");
    expect(docx.coreXml).toContain("建工智管");
    expect(docx.appXml).toContain("<TotalTime>0</TotalTime>");
    expect(docx.appXml).toContain("<AppVersion>1.0</AppVersion>");
    for (const provenance of blockedProvenanceStrings) {
      expect(`${docx.coreXml}\n${docx.appXml}\n${docx.contentTypesXml}\n${docx.relationshipsText}\n${docx.text}`).not.toContain(provenance);
    }
  });

  it("binds material purchase seller on both cover and signature pages", () => {
    const docx = readDocxXml("material-purchase-real-v1.docx");
    expect(countOccurrences(docx.text, "party.counterparty.name")).toBeGreaterThanOrEqual(2);
    const signatureLabelIndex = docx.text.lastIndexOf("卖方");
    expect(signatureLabelIndex).toBeGreaterThanOrEqual(0);
    expect(docx.text.slice(signatureLabelIndex, signatureLabelIndex + 600)).toContain(
      "party.counterparty.name"
    );
  });

  it("keeps the equipment certificate attachment upright", () => {
    const docx = readDocxXml("equipment-rental-real-v1.docx");
    expect(docx.text).not.toContain('rot="16200000"');
    expect(docx.text).not.toContain("<w:drawing>");
    expect(docx.text).not.toContain("附件：营业执照");
  });

  it("uses a formal cover and signature page for generic fallback contracts", () => {
    const docx = readDocxXml("generic-contract-v1.docx");
    expect(docx.text).toContain("项目名称：{field.projectName}");
    expect(docx.text).toContain("甲方：建工智管建设有限公司");
    expect(docx.text).toContain("乙方：{field.counterpartyName}");
    expect(docx.text).toContain("第一条 业务内容");
    expect(docx.text).toContain("第五条 合同清单");
    expect(docx.text).toContain("签章页");
    expect(docx.text).toContain("法定代表人或授权代表");
  });
});
