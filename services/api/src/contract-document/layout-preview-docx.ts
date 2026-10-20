import PizZip from "pizzip";
import type { ContractDocumentRenderInput } from "./contract-document.types";
import { renderContractDocx } from "./contract-docx-renderer";

/** Preview copies fill the existing blank page-number footer; source DOCX bytes stay unchanged. */
export function renderLayoutPreviewDocx(source: Buffer, input: ContractDocumentRenderInput, required: readonly string[]) {
  const zip = new PizZip(renderContractDocx(source, input, required));
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
