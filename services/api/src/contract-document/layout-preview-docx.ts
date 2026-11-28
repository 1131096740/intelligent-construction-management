import PizZip from "pizzip";
import type { ContractDocumentRenderInput } from "./contract-document.types";
import { renderContractDocx } from "./contract-docx-renderer";

/** Fill only the existing blank page-number footer; unrelated package parts retain their contents. */
export function completeContractPageNumberFields(docx: Buffer) {
  const zip = new PizZip(docx);
  for (const name of Object.keys(zip.files)) {
    if (!/^word\/footer\d*\.xml$/.test(name)) continue;
    const xml = zip.file(name)?.asText();
    if (!xml) continue;
    zip.file(name, xml.replace(/<w:r><w:t xml:space="preserve">第\s+页 \/ 共\s+页<\/w:t><\/w:r>/g,
      '<w:r><w:t xml:space="preserve">第 </w:t></w:r><w:fldSimple w:instr="PAGE"><w:r><w:t>1</w:t></w:r></w:fldSimple>' +
      '<w:r><w:t xml:space="preserve"> 页 / 共 </w:t></w:r><w:fldSimple w:instr="NUMPAGES"><w:r><w:t>1</w:t></w:r></w:fldSimple><w:r><w:t> 页</w:t></w:r>'));
  }
  return zip.generate({ type: "nodebuffer" });
}

/** Preview copies and body25 output use the same existing footer field projection. */
export function renderLayoutPreviewDocx(source: Buffer, input: ContractDocumentRenderInput, required: readonly string[]) {
  return completeContractPageNumberFields(renderContractDocx(source, input, required));
}
