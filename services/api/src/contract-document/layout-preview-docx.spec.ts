import { prepareSeedLayoutDocxSource } from "./seed-layout-docx-source";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import PizZip from "pizzip";
import { coreFlowSeedData } from "../database/core-flow-seed-data";
import { layoutPreviewValues } from "./layout-preview-values";
import { renderLayoutPreviewDocx } from "./layout-preview-docx";
import { requiredPlaceholderKeys } from "./contract-document.service";

it.each([coreFlowSeedData.materialPurchaseWorkbench, coreFlowSeedData.equipmentRentalWorkbench,
  coreFlowSeedData.laborSubcontractWorkbench, coreFlowSeedData.genericContractWorkbench])(
  "$layout.name 样张副本有中文正文、清单和页码域，原 DOCX 不变", (sample) => {
    const source = readFileSync(join(__dirname, "../../assets/templates", sample.layout.docxFile.originalName));
    const original = Buffer.from(source);
    const output = renderLayoutPreviewDocx(prepareSeedLayoutDocxSource(source), { values: layoutPreviewValues(sample.layout.previewJob.sampleData) },
      requiredPlaceholderKeys({ fields: sample.fields, bills: sample.bills, clauses: sample.clauses }, sample.layout.inspectionReport));
    const zip = new PizZip(output);
    const xml = zip.file("word/document.xml")!.asText();
    expect(xml).toContain(sample.layout.previewJob.sampleData.contract.name);
    expect(xml).toContain(sample.layout.previewJob.sampleData.contract.amountUppercase);
    const billRow = Object.values(sample.layout.previewJob.sampleData.bill).flat().find((row) => "taxInclusiveUnitPrice" in row);
    expect(xml).toContain(billRow!.taxInclusiveUnitPrice);
    for (const file of Object.keys(zip.files).filter((name) => /^word\/footer\d*\.xml$/.test(name))) {
      expect(zip.file(file)!.asText()).toContain('w:instr="PAGE"');
      expect(zip.file(file)!.asText()).toContain('w:instr="NUMPAGES"');
    }
    expect(zip.file("word/styles.xml")!.asText()).not.toMatch(/Times New Roman|仿宋_GB2312|方正小标宋简体/);
    if (sample.template.contractTypeKey === "labor_subcontract") {
      expect(xml).toContain("☑");
      expect(xml).not.toContain('"Wingdings 2"');
    }
    expect(source).toEqual(original);
  }
);
