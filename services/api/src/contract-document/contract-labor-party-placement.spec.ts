import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import PizZip from "pizzip";
import { appendDocxImageAttachments } from "./docx-attachment-appender";
import { assertBuiltInPartyPlacementPlan, assertLaborPartySourceMapping, renderContractBody } from "./contract-body-document";
import { renderContractDocx } from "./contract-docx-renderer";
import { prepareLegacyPartyRoleBindings, removeMechanicalPartyDetailsFromLegacyDocx } from "./contract-mechanical-party-placement";
import { appendLaborFinalPartyPageToDocx } from "./contract-labor-final-party-page";
import { readLayoutSourcePositions, prepareLayoutSourceMapping } from "../contract-template/layout-field-mapping";

const source = readFileSync(join(__dirname, "../../assets/templates/labor-subcontract-real-v1.docx"));
const values = { "contract.name": "虚构合同", "contract.temporaryCode": "TEST", "party.owner.name": "虚构甲方公司", "party.counterparty.name": "虚构乙方公司", "document.watermark": "草稿" };
const rows = (bytes: Buffer) => {
  const document = new DOMParser().parseFromString(new PizZip(bytes).file("word/document.xml")!.asText(), "application/xml");
  return Array.from(document.getElementsByTagName("w:p")).map(p => Array.from(p.getElementsByTagName("w:t")).map(t => t.textContent ?? "").join(""));
};
const tableShape = (bytes: Buffer) => {
  const document = new DOMParser().parseFromString(new PizZip(bytes).file("word/document.xml")!.asText(), "application/xml");
  return Array.from(document.getElementsByTagName("w:tbl")).map(table => ({
    rows: table.getElementsByTagName("w:tr").length,
    cells: table.getElementsByTagName("w:tc").length
  }));
};

it("removes body party bindings and bank labels while retaining signature structure", () => {
  const old = renderContractBody(source, source, { values }, [], "layout").docx;
  const actual = renderContractBody(source, source, { values }, [], "layout", undefined, { partyDetailsVersion: "built-in-party-placement-v1" }).docx;
  const legacy = appendLaborFinalPartyPageToDocx(removeMechanicalPartyDetailsFromLegacyDocx(source, renderContractDocx(prepareLegacyPartyRoleBindings(source, source), { values }, []), { rolesPrepared: true }), values);
  expect(rows(old).filter(row => row.includes("虚构甲方公司"))).toHaveLength(2);
  for (const document of [actual, legacy]) {
    const text = rows(document).join("");
    expect(tableShape(document)).toEqual(tableShape(old));
    expect(rows(document).filter(row => row.includes("虚构甲方公司"))).toHaveLength(2);
    expect(rows(document).filter(row => row.includes("虚构乙方公司"))).toHaveLength(2);
    expect(text.replace(/\s+/gu, "")).not.toContain("开户银行");
    expect(text.match(/开户行：/gu)).toHaveLength(2);
    expect(text).toContain("公司名称：（盖章）");
    expect(text).toContain("发包人：(盖章)");
    expect(text).toContain("民工工资兑现承诺书");
  }
});

it("rejects overflowing or multiline company names without truncation", () => {
  for (const bad of ["甲".repeat(81), "甲\n方"]) {
    expect(() => renderContractBody(source, source, { values: { ...values, "party.owner.name": bad } }, [], "layout", undefined, { partyDetailsVersion: "built-in-party-placement-v1" })).toThrow("合同主体名称过长或含不支持的字符");
  }
});

it.each([156, 157, 158, 159, 160, 161])("keeps prior edits in bank paragraph %i and refuses to discard them", index => {
  const positions = readLayoutSourcePositions(source);
  const bank = positions.positions.find(item => item.part === "word/document.xml" && item.paragraphIndex === index);
  const bankId = bank?.positionId ?? createHash("sha256").update(JSON.stringify([positions.sourceSha256, index])).digest("hex");
  const plan = { protocolVersion: 1, layoutTemplateVersionId: "layout", sourceSha256: positions.sourceSha256, edits: [{ positionId: bankId, text: "原有银行资料" }] };
  expect(() => assertBuiltInPartyPlacementPlan(source, source, "layout", plan)).toThrow();
  const preview = renderContractBody(source, source, { values }, [], "layout", plan, { partyDetailsVersion: "built-in-party-placement-v1", partyDetailsConflictPreview: true });
  expect(preview.partyDetailsConflict).toBe(true);
  expect(preview.blocks.some(block => block.text === "原有银行资料")).toBe(true);
});

it("refuses a changed bank mapping in both render paths", () => {
  const zip = new PizZip(source);
  const xml = zip.file("word/document.xml")!.asText();
  const changed = xml.replace("开  户  银  行", "已映射银行资料");
  expect(changed).not.toBe(xml);
  zip.file("word/document.xml", changed);
  const mapped = zip.generate({ type: "nodebuffer" });
  expect(() => assertBuiltInPartyPlacementPlan(source, mapped, "layout", undefined)).toThrow();
  expect(() => prepareLegacyPartyRoleBindings(source, mapped)).toThrow();
  const preview = renderContractBody(source, mapped, { values }, [], "layout", undefined, { partyDetailsVersion: "built-in-party-placement-v1", partyDetailsConflictPreview: true });
  expect(preview.partyDetailsMappingConflict).toBe(true);
  expect(preview.blocks.some(block => block.text.includes("已映射银行资料"))).toBe(true);
});

it.each([157, 158, 160, 161])("refuses mapped content in originally blank bank cell %i", index => {
  const zip = new PizZip(source), document = new DOMParser().parseFromString(zip.file("word/document.xml")!.asText(), "application/xml");
  const paragraph = document.getElementsByTagName("w:p").item(index)!;
  const run = document.createElementNS("http://schemas.openxmlformats.org/wordprocessingml/2006/main", "w:r");
  const text = document.createElementNS("http://schemas.openxmlformats.org/wordprocessingml/2006/main", "w:t");
  text.appendChild(document.createTextNode("已有银行资料")); run.appendChild(text); paragraph.appendChild(run);
  zip.file("word/document.xml", new XMLSerializer().serializeToString(document));
  const mapped = zip.generate({ type: "nodebuffer" });
  expect(() => assertBuiltInPartyPlacementPlan(source, mapped, "layout", undefined)).toThrow();
  expect(() => prepareLegacyPartyRoleBindings(source, mapped)).toThrow();
  const preview = renderContractBody(source, mapped, { values }, [], "layout", undefined, { partyDetailsVersion: "built-in-party-placement-v1", partyDetailsConflictPreview: true });
  expect(preview.partyDetailsMappingConflict).toBe(true);
  expect(preview.blocks.some(block => block.text.includes("已有银行资料"))).toBe(true);
});

it("refuses a party-name mapping in ordinary labor body while preserving the preview",()=>{
  const parsed=readLayoutSourcePositions(source);
  const required=[["{合同名称}","contract.name"],["{甲方名称}","party.owner.name"],["{乙方名称}","party.counterparty.name"],["{草稿编号}","contract.temporaryCode"],["{文档水印}","document.watermark"]].flatMap(([token,fieldKey])=>{
    const position=parsed.positions.find(item=>item.text.includes(token));
    if(!position)return [];
    const start=position.text.indexOf(token);return [{positionId:position.positionId,start,end:start+token.length,fieldKey}];
  });
  const selected=new Set(required.map(item=>item.fieldKey));
  const missing=["contract.name","contract.temporaryCode","document.watermark"].filter(key=>!selected.has(key));
  const neutral=parsed.positions.filter(item=>item.part==="word/document.xml"&&![13,14,27,28,35].includes(item.paragraphIndex)&&item.text.length>0&&!/[{}]/u.test(item.text));
  for(const [index,fieldKey] of missing.entries())required.push({positionId:neutral[index].positionId,start:0,end:1,fieldKey});
  const paragraph=parsed.positions.find(item=>item.part==="word/document.xml"&&item.paragraphIndex===35)!;
  const prepared=prepareLayoutSourceMapping(source,"fixture",1,[...required,{positionId:paragraph.positionId,start:0,end:1,fieldKey:"party.owner.name"}]);
  expect(()=>assertLaborPartySourceMapping(source,prepared.mapping)).toThrow("主体位置与版式映射冲突");
  const preview=renderContractBody(source,prepared.docx,{values},[],"layout",undefined,{partyDetailsVersion:"built-in-labor-party-v1",partyDetailsConflictPreview:true,partyDetailsExternalMappingConflict:true});
  expect(preview.partyDetailsMappingConflict).toBe(true);
  expect(preview.blocks.some(block=>block.text.includes("虚构甲方公司"))).toBe(true);
});

it.each([13,14,27,28])("only accepts exact party mappings at labor slot %i",index=>{
  const parsed=readLayoutSourcePositions(source),position=parsed.positions.find(item=>item.part==="word/document.xml"&&item.paragraphIndex===index)!;
  const owner=index===13||index===27,token=owner?"{甲方名称}":"{乙方名称}",start=position.text.indexOf(token),end=start+token.length,key=owner?"party.owner.name":"party.counterparty.name";
  const binding={positionId:position.positionId,start,end,fieldKey:key};
  const mapping={protocolVersion:1 as const,sourceFileId:"fixture",sourceSha256:parsed.sourceSha256,draftRevision:1,fingerprint:"fixture",bindings:[binding,{positionId:position.positionId,start:0,end:1,fieldKey:"field.useLocation"}]};
  expect(()=>assertLaborPartySourceMapping(source,mapping)).not.toThrow();
  expect(()=>assertLaborPartySourceMapping(source,{...mapping,bindings:[{...binding,end:end-1}]})).toThrow();
  expect(()=>assertLaborPartySourceMapping(source,{...mapping,bindings:[{...binding,fieldKey:"field.useLocation"}]})).toThrow();
  expect(()=>assertLaborPartySourceMapping(source,{...mapping,bindings:[{...binding,fieldKey:owner?"party.counterparty.name":"party.owner.name"}]})).toThrow();
});
it("appends external images after the generated final party page",()=>{
 const plain=renderContractBody(source,source,{values},[],"layout",undefined,{partyDetailsVersion:"built-in-labor-signature-review-v3"}).docx;
 const png=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nGQAAAAASUVORK5CYII=","base64");
 const result=appendDocxImageAttachments(plain,[{name:"虚构图片.png",type:"png",buffer:png}]);
 expect(rows(result).filter(text=>text.trim())).toEqual(rows(plain).filter(text=>text.trim()));
 const body=new DOMParser().parseFromString(new PizZip(result).file("word/document.xml")!.asText(),"application/xml").getElementsByTagName("w:body").item(0)!;
 const nodes=Array.from(body.childNodes).filter(n=>n.nodeType===1),image=nodes.findIndex(n=>(n as typeof body).getElementsByTagName("w:drawing").length>0),last=nodes.findIndex(n=>(n.textContent??"").includes("双方主体及银行信息"));expect(image).toBeGreaterThan(last);
});
