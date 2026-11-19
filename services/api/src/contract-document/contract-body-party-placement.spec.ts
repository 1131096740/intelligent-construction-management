import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import PizZip from "pizzip";
import { assertBuiltInPartyPlacementPlan, renderContractBody } from "./contract-body-document";
import { createOfficialQualificationSample } from "./task12-official-qualification-sample";
import { renderContractDocx } from "./contract-docx-renderer";
import { prepareLegacyPartyRoleBindings, removeMechanicalPartyDetailsFromLegacyDocx } from "./contract-mechanical-party-placement";
import { prepareLayoutSourceMapping, readLayoutSourcePositions } from "../contract-template/layout-field-mapping";

const source=readFileSync(join(__dirname,"../../assets/templates/equipment-rental-real-v1.docx"));
const values={"contract.name":"虚构合同","party.owner.name":"虚构甲方公司","party.counterparty.name":"虚构乙方公司","contract.temporaryCode":"TEST","document.watermark":"草稿"};
function paragraphs(bytes:Buffer){
  const doc=new DOMParser().parseFromString(new PizZip(bytes).file("word/document.xml")!.asText(),"application/xml");
  return Array.from(doc.getElementsByTagName("w:p")).map(p=>Array.from(p.getElementsByTagName("w:t")).map(t=>t.textContent??"").join("").replace(/\s+/gu,""));
}

describe("mechanical contract party placement",()=>{
  it.each(["equipment-rental-real-v1.docx","material-purchase-real-v1.docx"])("preserves confirmed non-party mappings on the body role line in new and legacy %s",name=>{
    const input=readFileSync(join(__dirname,"../../assets/templates",name));
    const positions=readLayoutSourcePositions(input).positions;
    const role=positions.find(p=>p.part==="word/document.xml"&&p.paragraphIndex===28)!;
    const start=role.text.indexOf("{甲方名称}");
    expect(start).toBeGreaterThanOrEqual(0);
    const required=["contract.name","party.owner.name","party.counterparty.name","contract.temporaryCode","document.watermark"];
    const targets=positions.filter(p=>p.positionId!==role.positionId&&p.text.length>0&&!/[{}]/u.test(p.text)).slice(0,required.length);
    const {docx:mapped}=prepareLayoutSourceMapping(input,"fixture",1,[
      ...required.map((fieldKey,index)=>({positionId:targets[index].positionId,start:0,end:1,fieldKey})),
      {positionId:role.positionId,start,end:start+"{甲方名称}".length,fieldKey:"field.useLocation"}
    ]);
    const renderInput={values:{...values,"field.useLocation":"虚构作业地点"}};
    const {docx}=renderContractBody(input,mapped,renderInput,[],"test-layout",undefined,{partyDetailsVersion:"built-in-party-placement-v1"});
    const legacy=removeMechanicalPartyDetailsFromLegacyDocx(input,renderContractDocx(prepareLegacyPartyRoleBindings(input,mapped),renderInput,[]),{rolesPrepared:true});
    for(const bytes of [docx,legacy]) expect(paragraphs(bytes).some(row=>row.includes("虚构作业地点"))).toBe(true);
  });
  it.each([["equipment-rental-real-v1.docx","甲方"],["material-purchase-real-v1.docx","买方"]])("retains the role when %s maps its role label",(name,label)=>{
    const input=readFileSync(join(__dirname,"../../assets/templates",name));
    const positions=readLayoutSourcePositions(input).positions;
    const role=positions.find(p=>p.part==="word/document.xml"&&p.paragraphIndex===28)!;
    const start=role.text.indexOf(label);
    expect(start).toBeGreaterThanOrEqual(0);
    const required=["contract.name","party.owner.name","party.counterparty.name","contract.temporaryCode","document.watermark"];
    const targets=positions.filter(p=>p.positionId!==role.positionId&&p.text.length>0&&!/[{}]/u.test(p.text)).slice(0,required.length);
    const {docx:mapped}=prepareLayoutSourceMapping(input,"fixture",1,[
      ...required.map((fieldKey,index)=>({positionId:targets[index].positionId,start:0,end:1,fieldKey})),
      {positionId:role.positionId,start,end:start+label.length,fieldKey:"field.useLocation"}
    ]);
    const renderInput={values:{...values,"field.useLocation":"虚构作业地点"}};
    const body=renderContractBody(input,mapped,renderInput,[],"test-layout",undefined,{partyDetailsVersion:"built-in-party-placement-v1"}).docx;
    const legacy=removeMechanicalPartyDetailsFromLegacyDocx(input,renderContractDocx(prepareLegacyPartyRoleBindings(input,mapped),renderInput,[]),{rolesPrepared:true});
    for(const bytes of [body,legacy]) expect(paragraphs(bytes).some(row=>row.includes(label)&&row.includes("虚构作业地点"))).toBe(true);
  });
  it.each(["equipment-rental-real-v1.docx","material-purchase-real-v1.docx"])("removes only the role-line party names in prepared legacy %s",name=>{
    const input=readFileSync(join(__dirname,"../../assets/templates",name));
    const prepared=prepareLegacyPartyRoleBindings(input,input);
    const legacy=removeMechanicalPartyDetailsFromLegacyDocx(input,renderContractDocx(prepared,{values},[]),{rolesPrepared:true});
    const rows=paragraphs(legacy);
    expect(rows.filter(row=>row.includes("虚构甲方公司"))).toHaveLength(2);
    expect(rows.filter(row=>row.includes("虚构乙方公司"))).toHaveLength(2);
  });
  it("rejects a changed legacy template structure instead of processing wrong paragraph positions",()=>{
    const zip=new PizZip(source);
    const xml=zip.file("word/document.xml")!.asText();
    zip.file("word/document.xml",xml.replace("<w:body>","<w:body><w:p/>"));
    expect(()=>prepareLegacyPartyRoleBindings(source,zip.generate({type:"nodebuffer"}))).toThrow();
  });
  it("keeps existing body edits readable for recovery but rejects them for document generation",()=>{
    const positions=readLayoutSourcePositions(source);
    const target=positions.positions.find(p=>p.part==="word/document.xml"&&p.paragraphIndex===94)!;
    const edit={protocolVersion:1,layoutTemplateVersionId:"test-layout",sourceSha256:positions.sourceSha256,edits:[{positionId:target.positionId,text:"原有需用户核对的内容"}]};
    expect(()=>assertBuiltInPartyPlacementPlan(source,source,"test-layout",edit)).toThrow();
    expect(()=>renderContractBody(source,source,{values},[],"test-layout",edit,{partyDetailsVersion:"built-in-party-placement-v1"})).toThrow();
    const view=renderContractBody(source,source,{values},[],"test-layout",edit,{partyDetailsVersion:"built-in-party-placement-v1",partyDetailsConflictPreview:true} as never);
    expect(view.partyDetailsConflict).toBe(true);
    expect(view.blocks.some(block=>block.text.includes("原有需用户核对的内容"))).toBe(true);
    const resolved={...edit,edits:[],deletedPositionIds:[target.positionId]};
    expect(()=>assertBuiltInPartyPlacementPlan(source,source,"test-layout",resolved)).not.toThrow();
    const generated=renderContractBody(source,source,{values},[],"test-layout",resolved,{partyDetailsVersion:"built-in-party-placement-v1"});
    expect(generated.blocks.some(block=>block.text.includes("原有需用户核对的内容"))).toBe(false);
  });
  it("does not silently drop either required role when an older plan deleted its paragraph",()=>{
    const zip=new PizZip(source),xml=zip.file("word/document.xml")!.asText();
    zip.file("word/document.xml",xml.replace(/\{甲方名称\}/gu,"原甲方名称"));
    const mapped=zip.generate({type:"nodebuffer"}),positions=readLayoutSourcePositions(source);
    const target=positions.positions.find(p=>p.part==="word/document.xml"&&p.paragraphIndex===28)!;
    const deleted={protocolVersion:1,layoutTemplateVersionId:"test-layout",sourceSha256:positions.sourceSha256,edits:[],deletedPositionIds:[target.positionId]};
    expect(()=>assertBuiltInPartyPlacementPlan(source,mapped,"test-layout",deleted)).toThrow();
    const preview=renderContractBody(source,mapped,{values},[],"test-layout",deleted,{partyDetailsVersion:"built-in-party-placement-v1",partyDetailsConflictPreview:true});
    expect(preview.partyDetailsRecovery?.roleIds).toEqual([target.positionId]);
    expect(preview.partyDetailsRecovery?.groups.flat()).toContain(target.positionId);
  });
  it("keeps legacy output unchanged when the new version is absent",()=>{
    const {docx}=renderContractBody(source,source,{values},[],"test-layout");
    const rows=paragraphs(docx);
    expect(rows.filter(row=>row.includes("虚构甲方公司"))).toHaveLength(3);
    expect(rows.some(row=>row.includes("甲方开户银行"))).toBe(true);
  });
  it("omits body party details while preserving both cover and signature names",()=>{
    const original=paragraphs(source);
    const sensitiveFields=["甲方单位名称","甲方统一社会信用代码","甲方注册地址","甲方联系电话","甲方开户银行","甲方银行账号"];
    const sensitive=sensitiveFields.map(field=>original.find(p=>p.includes(field))!.split(field)[1].replace(/^[：:_＿]+/u,""));
    const {docx}=renderContractBody(source,source,{values},[],"test-layout",undefined,{partyDetailsVersion:"built-in-party-placement-v1"} as never);
    const rows=paragraphs(docx),text=rows.join("");
    expect(sensitive.every(value=>value.length>=4)).toBe(true);
    expect(sensitive.some(value=>text.includes(value))).toBe(false);
    expect(sensitiveFields.some(field=>rows.some(row=>row.includes(field)))).toBe(false);
    expect(rows.filter(row=>row.includes("虚构甲方公司"))).toHaveLength(2);
    expect(rows.filter(row=>row.includes("虚构乙方公司"))).toHaveLength(2);
  });
  it("keeps both official qualification documents fictional without body billing details",()=>{
    const original=paragraphs(source);
    const fields=["甲方单位名称","甲方统一社会信用代码","甲方注册地址","甲方联系电话","甲方开户银行","甲方银行账号"];
    const originals=fields.map(field=>original.find(p=>p.includes(field))!.split(field)[1].replace(/^[：:_＿]+/u,""));
    const sample=createOfficialQualificationSample(source);
    for(const document of [sample.docx,sample.officeDocx]){
      const rows=paragraphs(document),text=rows.join("");
      expect(originals.some(value=>text.includes(value))).toBe(false);
      expect(fields.some(field=>rows.some(row=>row.includes(field)))).toBe(false);
      expect(rows.filter(row=>row.includes("虚构甲方公司"))).toHaveLength(2);
      expect(rows.filter(row=>row.includes("虚构乙方公司"))).toHaveLength(2);
    }
  });
  it("removes body details from a newly generated legacy mechanical document while retaining cover and signature",()=>{
    const rendered=renderContractDocx(source,{values},[]);
    const rows=paragraphs(removeMechanicalPartyDetailsFromLegacyDocx(source,rendered));
    expect(rows.some(row=>row.includes("甲方银行账号"))).toBe(false);
    expect(rows.filter(row=>row.includes("虚构甲方公司"))).toHaveLength(2);
    expect(rows.filter(row=>row.includes("虚构乙方公司"))).toHaveLength(2);
    expect(()=>removeMechanicalPartyDetailsFromLegacyDocx(Buffer.from("unknown"),rendered)).toThrow();
  });
});

describe("other built-in contract party placement",()=>{
  it("requires recovery of a deleted material body role before generation",()=>{
    const input=readFileSync(join(__dirname,"../../assets/templates/material-purchase-real-v1.docx"));
    const zip=new PizZip(input),xml=zip.file("word/document.xml")!.asText();
    zip.file("word/document.xml",xml.replace(/\{甲方名称\}/gu,"原甲方名称"));
    const mapped=zip.generate({type:"nodebuffer"});
    const positions=readLayoutSourcePositions(input);
    const target=positions.positions.find(p=>p.part==="word/document.xml"&&p.paragraphIndex===28)!;
    const plan={protocolVersion:1,layoutTemplateVersionId:"test-layout",sourceSha256:positions.sourceSha256,edits:[],deletedPositionIds:[target.positionId]};
    expect(()=>assertBuiltInPartyPlacementPlan(input,mapped,"test-layout",plan)).toThrow();
    const preview=renderContractBody(input,mapped,{values},[],"test-layout",plan,{partyDetailsVersion:"built-in-party-placement-v1",partyDetailsConflictPreview:true});
    expect(preview.partyDetailsRecovery?.roleIds).toEqual([target.positionId]);
    expect(preview.partyDetailsRecovery?.groups.flat()).toContain(target.positionId);
  });
  it("applies the material party rule to new legacy documents without altering the cover or signature names",()=>{
    const input=readFileSync(join(__dirname,"../../assets/templates/material-purchase-real-v1.docx"));
    const rendered=renderContractDocx(input,{values},[]);
    const rows=paragraphs(removeMechanicalPartyDetailsFromLegacyDocx(input,rendered));
    expect(rows.filter(row=>row.includes("虚构甲方公司"))).toHaveLength(2);
    expect(rows.filter(row=>row.includes("虚构乙方公司"))).toHaveLength(2);
    const parse=(bytes:Buffer)=>new DOMParser().parseFromString(new PizZip(bytes).file("word/document.xml")!.asText(),"application/xml");
    const original=parse(rendered),actual=parse(removeMechanicalPartyDetailsFromLegacyDocx(input,rendered));
    for(const tag of ["w:drawing","w:pict","w:bookmarkStart","w:bookmarkEnd"]){
      const serialize=(doc:typeof original)=>Array.from(doc.getElementsByTagName(tag)).map(node=>new XMLSerializer().serializeToString(node));
      expect(serialize(actual)).toEqual(serialize(original));
    }
  });
  it.each([
    ["material-purchase-real-v1.docx","买方","卖方"]
  ])("keeps %s role labels while limiting names to the cover and final signature area",(name,firstRole,secondRole)=>{
    const input=readFileSync(join(__dirname,"../../assets/templates",name));
    const {docx}=renderContractBody(input,input,{values},[],"test-layout",undefined,{partyDetailsVersion:"built-in-party-placement-v1"});
    const rows=paragraphs(docx);
    expect(rows.filter(row=>row.includes("虚构甲方公司"))).toHaveLength(2);
    expect(rows.filter(row=>row.includes("虚构乙方公司"))).toHaveLength(2);
    expect(rows.some(row=>row.includes(firstRole)&&!row.includes("虚构甲方公司"))).toBe(true);
    expect(rows.some(row=>row.includes(secondRole)&&!row.includes("虚构乙方公司"))).toBe(true);
  });

});
