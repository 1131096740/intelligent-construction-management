import PizZip from "pizzip";
import { createHash } from "node:crypto";
import { prepareLayoutSourceMapping, readLayoutSourcePositions, type LayoutFieldBinding } from "../contract-template/layout-field-mapping";
import { CONTRACT_BODY_MONEY_SEMANTICS_VERSION, CONTRACT_BODY_TABLE_LAYOUT_VERSION, REVIEWED_MATERIAL_TYPOGRAPHY_V4_VERSION,
  finalizeContractBodyLineBoxScope, prepareContractBodyTableMargins, renderContractBody } from "./contract-body-document";
import { renderLayoutPreviewDocx } from "./layout-preview-docx";
import { completeContractDocxFontTableType } from "./contract-docx-package-metadata";

/** Fixed fictional data only. Uses the production mapping -> renderer -> table
 * margins -> font package -> final scope sequence, without services or a DB. */
export function createOfficialQualificationSample(source: Buffer) {
  const sourceSha256=createHash("sha256").update(source).digest("hex");
  if(sourceSha256!=="44be99630d27578e9828bd7c6fa4925cdc26f552b84637e125c8acb0632b17bd") throw new Error("资格样张原模板无法核对");
  const positions=readLayoutSourcePositions(source).positions;
  const bindings: LayoutFieldBinding[]=[];
  for(const [token,fieldKey,count] of [
    ["{合同名称}","contract.name",2],["{甲方名称}","party.owner.name",3],["{乙方名称}","party.counterparty.name",3],
    ["{草稿编号}","contract.temporaryCode",1],["{文档水印}","document.watermark",1]
  ] as const) {
    let found=0;
    for(const position of positions) {
      let start=position.text.indexOf(token);
      while(start!==-1) { bindings.push({positionId:position.positionId,start,end:start+token.length,fieldKey});found++;start=position.text.indexOf(token,start+token.length); }
    }
    if(found!==count) throw new Error("资格样张固定映射无法核对");
  }
  const mapped=prepareLayoutSourceMapping(source,"11111111-1111-4111-8111-111111111111",1,bindings).docx;
  const values={
    "contract.name":"隔离工具资格材料合同","contract.temporaryCode":"TOOL-QUALIFICATION-ONLY",
    "party.owner.name":"虚构甲方公司","party.counterparty.name":"虚构乙方公司","document.watermark":"工具资格样张",
    "contract.amountUppercase":"壹佰壹拾叁元整","contract.taxInclusiveAmountUppercase":"壹佰壹拾叁元整",
    "contract.taxRateLabel":"0%","contract.amountBasis":"tax_inclusive",
    "contract.renderSemanticVersion":CONTRACT_BODY_MONEY_SEMANTICS_VERSION,"contract.typographyVersion":REVIEWED_MATERIAL_TYPOGRAPHY_V4_VERSION,
    "field.projectName":"虚构工具资格项目","field.taxRatePercent":"0","field.deliveryLocation":"虚构交付地点",
    "field.deliveryDeadline":"虚构交付期限","field.qualityStandard":"按固定合同原文约定","field.settlementMethod":"按固定合同原文约定",
    "bill.materials":[{itemName:"资格样张材料",specification:"虚构规格",unit:"件",quantity:"1",taxInclusiveUnitPrice:"113.0000",taxInclusiveAmount:"113.0000",taxRatePercent:"0"}]
  };
  const rendered=renderContractBody(source,mapped,{values},["contract.name","contract.temporaryCode","document.watermark"],
    "22222222-2222-4222-8222-222222222222",undefined,{tableLayoutVersion:CONTRACT_BODY_TABLE_LAYOUT_VERSION,typographyVersion:REVIEWED_MATERIAL_TYPOGRAPHY_V4_VERSION});
  if(!rendered.lineBoxScope) throw new Error("资格样张纸面范围缺失");
  const docx=completeContractDocxFontTableType(prepareContractBodyTableMargins(rendered.docx,CONTRACT_BODY_TABLE_LAYOUT_VERSION),sourceSha256).docx;
  const scope=finalizeContractBodyLineBoxScope(docx,rendered.lineBoxScope);
  const officeDocx=renderLayoutPreviewDocx(mapped,{values},["contract.name","contract.temporaryCode","document.watermark"]);
  return {docx,officeDocx,scope,expectations:{actualPdfQualification:"NOT_EXECUTED",minimumPages:1,maximumPages:100,
    requiredDrawnText:["隔离工具资格材料合同","虚构甲方公司","虚构乙方公司","壹佰壹拾叁元整","资格样张材料","买方","卖方"],
    mainBodyLinePoints:25,bodyFont:"仿宋_GB2312",bodyFontSizePoints:14,
    exactPageCount:"UNPROVEN_REQUIRES_INDEPENDENT_PHYSICAL_REVIEW",signatureAndPagination:"REQUIRES_INDEPENDENT_PHYSICAL_REVIEW"}} as const;
}

/** Match every uncompressed package part; transport timestamps convey no content authority. */
export function canonicalOfficialQualificationDocx(bytes: Buffer): string {
  if (!Buffer.isBuffer(bytes) || bytes.length > 20_000_000) throw new Error("资格样张包无法核对");
  const zip = new PizZip(bytes);
  let total = 0;
  const rows = Object.values(zip.files).filter(item => !item.dir).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0).map(item => {
    if (item.name.startsWith("/") || item.name.includes("\\") || item.name.split("/").some(part => !part || part === "." || part === "..")) throw new Error("资格样张包路径无法核对");
    const data = item.asNodeBuffer();
    total += data.length;
    if (total > 20_000_000) throw new Error("资格样张包范围无法核对");
    return [item.name, createHash("sha256").update(data).digest("hex")];
  });
  if (rows.length === 0 || rows.length > 2_000) throw new Error("资格样张包范围无法核对");
  return createHash("sha256").update(JSON.stringify(rows)).digest("hex");
}
