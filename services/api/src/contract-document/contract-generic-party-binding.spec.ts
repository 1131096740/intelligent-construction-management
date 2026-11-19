import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DOMParser } from "@xmldom/xmldom";
import PizZip from "pizzip";
import { renderContractBody, assertBuiltInPartyPlacementPlan, assertGenericPartySourceMapping } from "./contract-body-document";
import { renderContractDocx } from "./contract-docx-renderer";
import { prepareLegacyPartyRoleBindings, removeMechanicalPartyDetailsFromLegacyDocx } from "./contract-mechanical-party-placement";
import { readLayoutSourcePositions, prepareLayoutSourceMapping } from "../contract-template/layout-field-mapping";

const source=readFileSync(join(__dirname,"../../assets/templates/generic-contract-v1.docx"));
const values={"contract.name":"虚构合同","contract.temporaryCode":"TEST","document.watermark":"草稿","party.owner.name":"虚构所选甲方公司","party.counterparty.name":"虚构所选乙方公司","field.counterpartyName":"过期的自由字段"};
const text=(bytes:Buffer)=>{
  const doc=new DOMParser().parseFromString(new PizZip(bytes).file("word/document.xml")!.asText(),"application/xml");
  return Array.from(doc.getElementsByTagName("w:t")).map(node=>node.textContent??"").join("");
};

it("uses the selected company on the cover and signature for new output while old snapshots remain unchanged",()=>{
  const old=renderContractBody(source,source,{values},[],"layout").docx;
  const body=renderContractBody(source,source,{values},[],"layout",undefined,{partyDetailsVersion:"built-in-party-placement-v1"}).docx;
  const legacy=removeMechanicalPartyDetailsFromLegacyDocx(source,renderContractDocx(prepareLegacyPartyRoleBindings(source,source),{values},[]),{rolesPrepared:true});
  expect(text(old)).toContain("建工智管建设有限公司");
  for(const bytes of [body,legacy]) {
    expect(text(bytes)).not.toContain("建工智管建设有限公司");
    expect(text(bytes).split("虚构所选甲方公司")).toHaveLength(3);
    expect(text(bytes).split("虚构所选乙方公司")).toHaveLength(3);
    expect(text(bytes)).not.toContain("过期的自由字段");
  }
});

it("blocks a mapped partial hardcoded name rather than discarding the confirmed mapping",()=>{
  const positions=readLayoutSourcePositions(source),owner=positions.positions.find(position=>position.paragraphIndex===13 && position.part==="word/document.xml")!;
  const required=[["{合同名称}","contract.name"],["{相对方名称}","party.counterparty.name"],["{草稿编号}","contract.temporaryCode"],["{文档水印}","document.watermark"]].map(([token,fieldKey])=>{
    const position=positions.positions.find(item=>item.text.includes(token))!,start=position.text.indexOf(token);
    return {positionId:position.positionId,start,end:start+token.length,fieldKey};
  });
  const mapped=prepareLayoutSourceMapping(source,"fixture",1,[...required,{positionId:owner.positionId,start:owner.text.indexOf("建工"),end:owner.text.indexOf("建工")+1,fieldKey:"party.owner.name"}]).docx;
  expect(()=>assertBuiltInPartyPlacementPlan(source,mapped,"layout",undefined)).toThrow("主体位置与版式映射冲突");
  expect(()=>prepareLegacyPartyRoleBindings(source,mapped)).toThrow();
  const preview=renderContractBody(source,mapped,{values},[],"layout",undefined,{partyDetailsVersion:"built-in-party-placement-v1",partyDetailsConflictPreview:true});
  expect(preview.partyDetailsMappingConflict).toBe(true);
});

it("preserves confirmed mappings outside the company name",()=>{
  const parsed=readLayoutSourcePositions(source);
  const required=[["{合同名称}","contract.name"],["{相对方名称}","party.counterparty.name"],["{草稿编号}","contract.temporaryCode"],["{文档水印}","document.watermark"]].map(([token,fieldKey])=>{
    const position=parsed.positions.find(item=>item.text.includes(token))!,start=position.text.indexOf(token);
    return {positionId:position.positionId,start,end:start+token.length,fieldKey};
  });
  const cover=parsed.positions.find(item=>item.part==="word/document.xml"&&item.paragraphIndex===13)!;
  const signature=parsed.positions.find(item=>item.part==="word/document.xml"&&item.paragraphIndex===53)!;
  const company="建工智管建设有限公司", start=signature.text.indexOf(company);
  const mapped=prepareLayoutSourceMapping(source,"fixture",1,[...required,
    {positionId:signature.positionId,start,end:start+company.length,fieldKey:"party.owner.name"},
    {positionId:cover.positionId,start:0,end:2,fieldKey:"field.useLocation"}]).docx;
  const input={values:{...values,"field.useLocation":"虚构位置"}};
  const body=renderContractBody(source,mapped,input,[],"layout",undefined,{partyDetailsVersion:"built-in-party-placement-v1"}).docx;
  const legacy=removeMechanicalPartyDetailsFromLegacyDocx(source,renderContractDocx(prepareLegacyPartyRoleBindings(source,mapped),input,[]),{rolesPrepared:true});
  for(const bytes of [body,legacy]) {
    expect(text(bytes)).toContain("虚构位置");
    expect(text(bytes).split("虚构所选甲方公司")).toHaveLength(3);
  }
});

it.each([13,53])("protects an existing generic party edit at paragraph %i",index=>{
  const positions=readLayoutSourcePositions(source),owner=positions.positions.find(position=>position.paragraphIndex===index&&position.part==="word/document.xml")!;
  const plan={protocolVersion:1,layoutTemplateVersionId:"layout",sourceSha256:positions.sourceSha256,edits:[{positionId:owner.positionId,text:"原有合同主体内容"}]};
  expect(()=>assertBuiltInPartyPlacementPlan(source,source,"layout",plan)).toThrow("主体信息位置已有编辑");
  const preview=renderContractBody(source,source,{values},[],"layout",plan,{partyDetailsVersion:"built-in-party-placement-v1",partyDetailsConflictPreview:true});
  expect(preview.partyDetailsConflict).toBe(true);
  expect(preview.blocks.some(block=>block.text==="原有合同主体内容")).toBe(true);
});

it.each([14,58])("requires exact intended mappings for the counterparty at paragraph %i",index=>{
  const parsed=readLayoutSourcePositions(source),position=parsed.positions.find(item=>item.part==="word/document.xml"&&item.paragraphIndex===index)!;
  const start=position.text.indexOf("{相对方名称}"),end=start+"{相对方名称}".length;
  const mapping={protocolVersion:1 as const,sourceFileId:"fixture",sourceSha256:parsed.sourceSha256,draftRevision:1,fingerprint:"fixture",bindings:[{positionId:position.positionId,start,end,fieldKey:"party.counterparty.name"}]};
  expect(()=>assertGenericPartySourceMapping(source,mapping)).not.toThrow();
  expect(()=>assertGenericPartySourceMapping(source,{...mapping,bindings:[{...mapping.bindings[0],fieldKey:"field.counterpartyName"}]})).toThrow();
  expect(()=>assertGenericPartySourceMapping(source,{...mapping,bindings:[{...mapping.bindings[0],end:end-1}]})).toThrow();
});

it("uses the selected counterparty when only one of the two positions is explicitly mapped",()=>{
  const parsed=readLayoutSourcePositions(source),position=parsed.positions.find(item=>item.part==="word/document.xml"&&item.paragraphIndex===14)!;
  const required=[["{合同名称}","contract.name"],["{草稿编号}","contract.temporaryCode"],["{文档水印}","document.watermark"]].map(([token,fieldKey])=>{
    const target=parsed.positions.find(item=>item.text.includes(token))!,start=target.text.indexOf(token);
    return {positionId:target.positionId,start,end:start+token.length,fieldKey};
  });
  const owner=parsed.positions.find(item=>item.part==="word/document.xml"&&item.paragraphIndex===13)!,ownerName="建工智管建设有限公司",ownerStart=owner.text.indexOf(ownerName);
  const start=position.text.indexOf("{相对方名称}");
  const mapped=prepareLayoutSourceMapping(source,"fixture",1,[...required,{positionId:owner.positionId,start:ownerStart,end:ownerStart+ownerName.length,fieldKey:"party.owner.name"},{positionId:position.positionId,start,end:start+"{相对方名称}".length,fieldKey:"party.counterparty.name"}]).docx;
  const body=renderContractBody(source,mapped,{values},[],"layout",undefined,{partyDetailsVersion:"built-in-party-placement-v1"}).docx;
  const legacy=removeMechanicalPartyDetailsFromLegacyDocx(source,renderContractDocx(prepareLegacyPartyRoleBindings(source,mapped),{values},[]),{rolesPrepared:true});
  for(const output of [body,legacy]) {
    expect(text(output).split("虚构所选乙方公司")).toHaveLength(3);
    expect(text(output)).not.toContain("过期的自由字段");
  }
});

it("retains an existing edit on a non-target counterparty mapping in the conflict preview",()=>{
  const parsed=readLayoutSourcePositions(source);
  const required=[["{合同名称}","contract.name"],["{草稿编号}","contract.temporaryCode"],["{文档水印}","document.watermark"]].map(([token,fieldKey])=>{
    const target=parsed.positions.find(item=>item.text.includes(token))!,start=target.text.indexOf(token);
    return {positionId:target.positionId,start,end:start+token.length,fieldKey};
  });
  const cover=parsed.positions.find(item=>item.part==="word/document.xml"&&item.paragraphIndex===14)!;
  const signature=parsed.positions.find(item=>item.part==="word/document.xml"&&item.paragraphIndex===58)!;
  const owner=parsed.positions.find(item=>item.part==="word/document.xml"&&item.paragraphIndex===13)!;
  const ownerName="建工智管建设有限公司",ownerStart=owner.text.indexOf(ownerName),token="{相对方名称}";
  const bindings=[...required,{positionId:owner.positionId,start:ownerStart,end:ownerStart+ownerName.length,fieldKey:"party.owner.name"},
    {positionId:cover.positionId,start:cover.text.indexOf(token),end:cover.text.indexOf(token)+token.length,fieldKey:"field.useLocation"},
    {positionId:signature.positionId,start:signature.text.indexOf(token),end:signature.text.indexOf(token)+token.length,fieldKey:"party.counterparty.name"}];
  const prepared=prepareLayoutSourceMapping(source,"fixture",1,bindings);
  expect(()=>assertGenericPartySourceMapping(source,prepared.mapping)).toThrow();
  const plan={protocolVersion:1,layoutTemplateVersionId:"layout",sourceSha256:parsed.sourceSha256,edits:[{positionId:cover.positionId,text:"原有乙方编辑"}]};
  const preview=renderContractBody(source,prepared.docx,{values:{...values,"field.useLocation":"原有映射"}},[],"layout",plan,{partyDetailsVersion:"built-in-party-placement-v1",partyDetailsConflictPreview:true,partyDetailsExternalMappingConflict:true});
  expect(preview.partyDetailsMappingConflict).toBe(true);
  expect(preview.blocks.some(block=>block.text==="原有乙方编辑")).toBe(true);
});

it.each([13,14,53,58])("preserves a second nonoverlapping mapping on party paragraph %i",index=>{
  const parsed=readLayoutSourcePositions(source);
  const required=[["{合同名称}","contract.name"],["{草稿编号}","contract.temporaryCode"],["{文档水印}","document.watermark"]].map(([token,fieldKey])=>{
    const item=parsed.positions.find(position=>position.text.includes(token))!,start=item.text.indexOf(token);
    return {positionId:item.positionId,start,end:start+token.length,fieldKey};
  });
  const owner=parsed.positions.find(item=>item.part==="word/document.xml"&&item.paragraphIndex===([13,53].includes(index)?index:13))!;
  const counterparty=parsed.positions.find(item=>item.part==="word/document.xml"&&item.paragraphIndex===([14,58].includes(index)?index:14))!;
  const selected=[13,53].includes(index)?owner:counterparty;
  const company="建工智管建设有限公司",counterpartyToken="{相对方名称}",ownerStart=owner.text.indexOf(company),counterpartyStart=counterparty.text.indexOf(counterpartyToken);
  const roles=[{positionId:owner.positionId,start:ownerStart,end:ownerStart+company.length,fieldKey:"party.owner.name"},
    {positionId:counterparty.positionId,start:counterpartyStart,end:counterpartyStart+counterpartyToken.length,fieldKey:"party.counterparty.name"}];
  const other={positionId:selected.positionId,start:0,end:2,fieldKey:"field.useLocation"};
  const prepared=prepareLayoutSourceMapping(source,"fixture",1,[...required,...roles,other]);
  expect(()=>assertGenericPartySourceMapping(source,prepared.mapping)).not.toThrow();
  const input={values:{...values,"field.useLocation":"虚构保留文字"}};
  const body=renderContractBody(source,prepared.docx,input,[],"layout",undefined,{partyDetailsVersion:"built-in-party-placement-v1"}).docx;
  const legacy=removeMechanicalPartyDetailsFromLegacyDocx(source,renderContractDocx(prepareLegacyPartyRoleBindings(source,prepared.docx),input,[]),{rolesPrepared:true});
  for(const output of [body,legacy]) {
    expect(text(output)).toContain("虚构保留文字");
    expect(text(output).split("虚构所选甲方公司")).toHaveLength(3);
    expect(text(output).split("虚构所选乙方公司")).toHaveLength(3);
  }
  const conflict=roles.find(role=>role.positionId===selected.positionId)!;
  expect(()=>assertGenericPartySourceMapping(source,{...prepared.mapping,bindings:prepared.mapping.bindings.map(binding=>binding.positionId===selected.positionId&&binding.fieldKey===conflict.fieldKey?{...binding,end:binding.end-1}:binding)})).toThrow();
});
