import { readFileSync } from "node:fs";
import { join } from "node:path";
import PizZip from "pizzip";
import {
  GENERIC_SIGNATURE_REVIEW_VERSION,
  LABOR_GLYPH_SIGNATURE_REVIEW_VERSION,
  renderContractBody
} from "./contract-body-document";
import { LABOR_MAIN_SIGNATURE_PAGE_VERSION } from "./contract-labor-final-party-page";
import { GENERIC_SIGNATURE_HEADING_VERSION } from "./generic-bank-blanks";

const values = {
  "contract.name": "虚构页码合同",
  "contract.temporaryCode": "TEST-429",
  "document.watermark": "草稿",
  "party.owner.name": "虚构甲方",
  "party.counterparty.name": "虚构乙方"
};

it.each([
  ["generic-contract-v1.docx", GENERIC_SIGNATURE_REVIEW_VERSION, { genericSignatureHeadingVersion: GENERIC_SIGNATURE_HEADING_VERSION }],
  ["labor-subcontract-real-v1.docx", LABOR_GLYPH_SIGNATURE_REVIEW_VERSION, { laborMainSignaturePageVersion: LABOR_MAIN_SIGNATURE_PAGE_VERSION }]
] as const)("adds current and total page fields to the new %s signing layout while preserving the historical footer", (filename, partyDetailsVersion, signingVersion) => {
  const source = readFileSync(join(__dirname, "../../assets/templates", filename));
  const oldDocx = renderContractBody(source, source, { values }, [], "layout", undefined, { partyDetailsVersion }).docx;
  const currentDocx = renderContractBody(source, source, { values }, [], "layout", undefined, { partyDetailsVersion, ...signingVersion }).docx;
  const historical = new PizZip(oldDocx);
  const current = new PizZip(currentDocx);
  const oldFooter = historical.file("word/footer1.xml")!.asText();
  const currentFooter = current.file("word/footer1.xml")!.asText();
  expect(oldFooter).toMatch(/第\s+页 \/ 共\s+页/u);
  expect(oldFooter).not.toContain('w:instr="PAGE"');
  expect(currentFooter.match(/w:instr="PAGE"/gu)).toHaveLength(1);
  expect(currentFooter.match(/w:instr="NUMPAGES"/gu)).toHaveLength(1);
  expect(currentFooter).not.toMatch(/第\s+页 \/ 共\s+页/u);
  expect(current.file("word/footer-contract-page.xml")!.asText()).toBe(historical.file("word/footer-contract-page.xml")!.asText());
});
