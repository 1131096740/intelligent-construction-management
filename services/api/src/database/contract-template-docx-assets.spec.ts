import { existsSync, readFileSync } from "node:fs";
import * as path from "node:path";
import PizZip from "pizzip";

const repoRoot = path.resolve(__dirname, "../../../..");
const templatesRoot = path.join(repoRoot, "services/api/assets/templates");
const blockedProvenanceStrings = ["WPS", "wpsCustomData", "LibreOffice", "Lenovo", "LIYI", "hdid", "userId"];

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
});
