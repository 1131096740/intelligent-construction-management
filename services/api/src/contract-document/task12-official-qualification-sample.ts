import { applyMechanicalContactLayout, MECHANICAL_CONTACT_LAYOUT_VERSION } from "./mechanical-contact-layout";
import PizZip from "pizzip";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import { createHash } from "node:crypto";
import { removeMechanicalPartyDetailsFromLegacyDocx } from "./contract-mechanical-party-placement";
import { prepareLayoutSourceMapping, readLayoutSourcePositions, type LayoutFieldBinding } from "../contract-template/layout-field-mapping";
import { BUILT_IN_PARTY_PLACEMENT_VERSION, SIGNATURE_SUPPLEMENT_PAGE_VERSION, CONTRACT_BODY_MONEY_SEMANTICS_VERSION, CONTRACT_BODY_TABLE_LAYOUT_VERSION, REVIEWED_MATERIAL_TYPOGRAPHY_V4_VERSION, REVIEWED_MECHANICAL_TYPOGRAPHY_VERSION,
  finalizeContractBodyLineBoxScope, prepareContractBodyTableMargins, renderContractBody } from "./contract-body-document";
import { renderLayoutPreviewDocx } from "./layout-preview-docx";
import { completeContractDocxFontTableType } from "./contract-docx-package-metadata";

function anonymizeQualificationMetadata(bytes:Buffer):Buffer {
  const zip=new PizZip(bytes);
  if(!zip.file("docProps/core.xml")||!zip.file("docProps/app.xml")||Object.values(zip.files).some(entry=>!entry.dir&&entry.name.startsWith("docProps/")&&!['docProps/core.xml','docProps/app.xml'].includes(entry.name))) throw new Error("资格样张元数据无法核对");
  zip.file("docProps/core.xml",'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>虚构资格样张</dc:title><dc:creator>虚构资格样张</dc:creator><cp:lastModifiedBy>虚构资格样张</cp:lastModifiedBy></cp:coreProperties>');
  zip.file("docProps/app.xml",'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>资格样张</Application></Properties>');
  const settingsPart=zip.file("word/settings.xml");
  if(!settingsPart||Object.values(zip.files).some(entry=>!entry.dir&&entry.name.startsWith("word/")&&entry.name.endsWith(".xml")&&/DOCVARIABLE/iu.test(entry.asText()))) throw new Error("资格样张隐藏变量无法核对");
  const settings=new DOMParser({onError:()=>{throw new Error("资格样张设置无法核对");}}).parseFromString(settingsPart.asText(),"application/xml");
  for(const node of Array.from(settings.getElementsByTagNameNS("http://schemas.openxmlformats.org/wordprocessingml/2006/main","docVars"))) node.parentNode?.removeChild(node);
  zip.file("word/settings.xml",new XMLSerializer().serializeToString(settings));
  return zip.generate({type:"nodebuffer"});
}

/** Fixed fictional data only. Uses the production mapping -> renderer -> table
 * margins -> font package -> final scope sequence, without services or a DB. */
export function createOfficialQualificationSample(source: Buffer) {
  if(createHash("sha256").update(source).digest("hex") === "b846a2f93a3f118581a58fe137b9a74c0433a7faa271eed1569068da6d5cef89") return createMechanicalSample(source);
  return createMaterialSample(source);
}
function createMaterialSample(source: Buffer) {
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
    "22222222-2222-4222-8222-222222222222",undefined,{tableLayoutVersion:CONTRACT_BODY_TABLE_LAYOUT_VERSION,typographyVersion:REVIEWED_MATERIAL_TYPOGRAPHY_V4_VERSION,partyDetailsVersion:BUILT_IN_PARTY_PLACEMENT_VERSION});
  if(!rendered.lineBoxScope) throw new Error("资格样张纸面范围缺失");
  const docx=anonymizeQualificationMetadata(completeContractDocxFontTableType(prepareContractBodyTableMargins(rendered.docx,CONTRACT_BODY_TABLE_LAYOUT_VERSION),sourceSha256).docx);
  const scope=finalizeContractBodyLineBoxScope(docx,rendered.lineBoxScope);
  const officeDocx=anonymizeQualificationMetadata(removeMechanicalPartyDetailsFromLegacyDocx(source,renderLayoutPreviewDocx(mapped,{values},["contract.name","contract.temporaryCode","document.watermark"])));
  return {docx,officeDocx,scope,expectations:{actualPdfQualification:"NOT_EXECUTED",minimumPages:1,maximumPages:100,
    requiredDrawnText:["隔离工具资格材料合同","虚构甲方公司","虚构乙方公司","壹佰壹拾叁元整","资格样张材料","买方","卖方"],
    mainBodyLinePoints:25,bodyFont:"仿宋_GB2312",bodyFontSizePoints:14,
    exactPageCount:"UNPROVEN_REQUIRES_INDEPENDENT_PHYSICAL_REVIEW",signatureAndPagination:"REQUIRES_INDEPENDENT_PHYSICAL_REVIEW"}} as const;
}

/** Exact reviewed mechanical source, original roles and legacy Java protocol. */
export function createMechanicalCurrentQualificationSample(source:Buffer) {
  if(createHash("sha256").update(source).digest("hex")!=="b846a2f93a3f118581a58fe137b9a74c0433a7faa271eed1569068da6d5cef89")throw new Error("资格样张原模板无法核对");
  return createMechanicalSample(source,true);
}
function createMechanicalSample(source: Buffer,current=false) {
  const sourceSha256=createHash("sha256").update(source).digest("hex");
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
    "contract.name":"隔离工具资格机械合同","contract.temporaryCode":"TOOL-MECHANICAL-QUALIFICATION-ONLY",
    "party.owner.name":"虚构甲方公司","party.counterparty.name":"虚构乙方公司","document.watermark":"工具资格样张",
    ...(current?{"party.owner.openingBank":"虚构甲方开户行","party.owner.bankAccount":"TESTACCOUNT-A","party.counterparty.openingBank":"虚构乙方开户行","party.counterparty.bankAccount":"TESTACCOUNT-B"}:{}),
    "contract.amountUppercase":"壹佰壹拾叁元整","contract.taxInclusiveAmountUppercase":"壹佰壹拾叁元整",
    "contract.taxRateLabel":"0%","contract.amountBasis":"tax_inclusive",
    "contract.renderSemanticVersion":CONTRACT_BODY_MONEY_SEMANTICS_VERSION,"contract.typographyVersion":REVIEWED_MECHANICAL_TYPOGRAPHY_VERSION,
    "field.projectName":"虚构工具资格项目","field.taxRatePercent":"0",
    "field.useLocation":"虚构使用地点","field.rentalStartDate":"虚构开始日期","field.rentalEndDate":"虚构结束日期",
    "field.settlementCycle":"虚构结算周期","field.paymentRatioPercent":"30","clause.payment.text":"虚构付款约定",
    "bill.equipmentRentals":[{itemName:"资格样张设备",specification:"M-001",unit:"小时",quantity:"1",taxInclusiveUnitPrice:"113.0000",taxInclusiveAmount:"113.0000",taxRatePercent:"0"}]
  };
  const required=["contract.name","contract.temporaryCode","document.watermark"];
  const layoutId="22222222-2222-4222-8222-222222222222";
  const plan=current?{protocolVersion:1,layoutTemplateVersionId:layoutId,sourceSha256,edits:[{positionId:positions.find(position=>position.part==="word/document.xml"&&position.paragraphIndex===189)!.positionId,text:"虚构甲方补充说明"},{positionId:positions.find(position=>position.part==="word/document.xml"&&position.paragraphIndex===195)?.positionId??createHash("sha256").update(JSON.stringify([sourceSha256,195])).digest("hex"),text:"虚构乙方补充说明"}]}:undefined;
  const options={tableLayoutVersion:CONTRACT_BODY_TABLE_LAYOUT_VERSION,typographyVersion:REVIEWED_MECHANICAL_TYPOGRAPHY_VERSION,partyDetailsVersion:current?SIGNATURE_SUPPLEMENT_PAGE_VERSION:BUILT_IN_PARTY_PLACEMENT_VERSION} as const;
  const preview=plan?renderContractBody(source,mapped,{values},required,layoutId,plan,{...options,partyDetailsConflictPreview:true}):undefined;
  if(plan&&(!preview?.signatureSupplementReview||preview.signatureSupplementReview.scope!=="company-and-bank"))throw new Error("资格样张签署核对无法确认");
  const rendered=renderContractBody(source,mapped,{values},required,layoutId,plan?{...plan,signatureSupplementReviewDigest:preview!.signatureSupplementReview!.digest}:undefined,options);
  if(rendered.lineBoxScope) throw new Error("机械资格样张不能使用材料行盒范围");
  const docx=anonymizeQualificationMetadata(completeContractDocxFontTableType(prepareContractBodyTableMargins(applyMechanicalContactLayout(source,rendered.docx,MECHANICAL_CONTACT_LAYOUT_VERSION),CONTRACT_BODY_TABLE_LAYOUT_VERSION),sourceSha256).docx);
  const officeDocx=current?docx:anonymizeQualificationMetadata(applyMechanicalContactLayout(source,removeMechanicalPartyDetailsFromLegacyDocx(source,renderLayoutPreviewDocx(mapped,{values},required)),MECHANICAL_CONTACT_LAYOUT_VERSION));
  return {docx,officeDocx,scope:null,expectations:{actualPdfQualification:"NOT_EXECUTED",minimumPages:1,maximumPages:100,
    requiredDrawnText:["隔离工具资格机械合同","虚构甲方公司","虚构乙方公司","资格样张设备","甲方","乙方"],
    mechanicalRoleHeading:"第一条  租赁机械设备名称、规格型号、数量及金额",roleFont:"黑体",roleFontSizePoints:14,
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
