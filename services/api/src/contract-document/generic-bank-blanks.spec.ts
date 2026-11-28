import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DOMParser } from "@xmldom/xmldom";
import PizZip from "pizzip";
import { renderContractBody, GENERIC_BANK_BLANKS_PLACEMENT_VERSION } from "./contract-body-document";
import { renderContractDocx } from "./contract-docx-renderer";
import { addGenericBankBlanksToDocx, assertGenericBankInputs } from "./generic-bank-blanks";
import { prepareLegacyPartyRoleBindings, removeMechanicalPartyDetailsFromLegacyDocx } from "./contract-mechanical-party-placement";
import { readLayoutSourcePositions } from "../contract-template/layout-field-mapping";

const source=readFileSync(join(__dirname,"../../assets/templates/generic-contract-v1.docx"));
const values={"contract.name":"虚构合同","contract.temporaryCode":"TEST","document.watermark":"草稿","party.owner.name":"虚构甲方","party.counterparty.name":"虚构乙方"};
const text=(bytes:Buffer)=>{
  const document=new DOMParser().parseFromString(new PizZip(bytes).file("word/document.xml")!.asText(),"application/xml");
  return Array.from(document.getElementsByTagName("w:t")).map(node=>node.textContent??"").join("");
};

it("adds two blank bank fields for each side in both new paths while retaining v1 output",()=>{
  const old=renderContractBody(source,source,{values},[],"layout",undefined,{partyDetailsVersion:"built-in-party-placement-v1"}).docx;
  const body=renderContractBody(source,source,{values},[],"layout",undefined,{partyDetailsVersion:GENERIC_BANK_BLANKS_PLACEMENT_VERSION}).docx;
  const legacy=addGenericBankBlanksToDocx(removeMechanicalPartyDetailsFromLegacyDocx(source,renderContractDocx(prepareLegacyPartyRoleBindings(source,source),{values},[]),{rolesPrepared:true}));
  expect(text(old)).not.toContain("银行账号：________________");
  for(const output of [body,legacy]) {
    expect(text(output).split("开户行：________________")).toHaveLength(3);
    expect(text(output).split("银行账号：________________")).toHaveLength(3);
    expect(text(output)).toContain("虚构甲方");expect(text(output)).toContain("虚构乙方");
  }
});

it("preserves a prior bank edit in preview and blocks generation",()=>{
  const parsed=readLayoutSourcePositions(source),position=parsed.positions.find(item=>item.part==="word/document.xml"&&item.paragraphIndex===56)!;
  const plan={protocolVersion:1,layoutTemplateVersionId:"layout",sourceSha256:parsed.sourceSha256,edits:[{positionId:position.positionId,text:"原有开户银行资料"}]};
  expect(()=>assertGenericBankInputs(source,source,values,plan)).toThrow("签章区已有银行资料");
  expect(()=>renderContractBody(source,source,{values},[],"layout",plan,{partyDetailsVersion:GENERIC_BANK_BLANKS_PLACEMENT_VERSION})).toThrow("签章区已有银行资料");
  const preview=renderContractBody(source,source,{values},[],"layout",plan,{partyDetailsVersion:GENERIC_BANK_BLANKS_PLACEMENT_VERSION,partyDetailsConflictPreview:true});
  expect(preview.partyDetailsConflict).toBe(true);
  expect(preview.blocks.some(block=>block.text==="原有开户银行资料")).toBe(true);
  expect(text(preview.docx)).not.toContain("银行账号：________________");
});

it("checks mapped text using the frozen input values before queueing",()=>{
  const zip=new PizZip(source),xml=zip.file("word/document.xml")!.asText();
  const changed=xml.replace("地址：","{field.useLocation}");
  expect(changed).not.toBe(xml);zip.file("word/document.xml",changed);
  const mapped=zip.generate({type:"nodebuffer"});
  expect(()=>assertGenericBankInputs(source,mapped,{...values,"field.useLocation":"虚构开 户 银 行资料"})).toThrow("签章区已有银行资料");
});
