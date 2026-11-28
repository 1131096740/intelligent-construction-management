import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DOMParser } from "@xmldom/xmldom";
import PizZip from "pizzip";
import { renderContractBody } from "./contract-body-document";
import { renderContractDocx } from "./contract-docx-renderer";
import { prepareLegacyPartyRoleBindings, removeMechanicalPartyDetailsFromLegacyDocx } from "./contract-mechanical-party-placement";
import { appendLaborFinalPartyPageToDocx } from "./contract-labor-final-party-page";
import { addGenericBankBlanksToDocx } from "./generic-bank-blanks";
const values = {"contract.name":"虚构合同","contract.temporaryCode":"TEST","document.watermark":"草稿","party.owner.name":"虚构甲方","party.counterparty.name":"虚构乙方","party.owner.openingBank":"甲开户行","party.owner.bankAccount":"甲账号","party.owner.paymentBank":"甲收款行","party.owner.paymentAccount":"甲收款账号","party.counterparty.openingBank":"乙开户行","party.counterparty.bankAccount":"乙账号"};
const extract=(bytes:Buffer)=>Array.from(new DOMParser().parseFromString(new PizZip(bytes).file("word/document.xml")!.asText(),"application/xml").getElementsByTagName("w:t")).map(node=>node.textContent??"").join("");
it.each([["generic-contract-v1.docx","built-in-generic-bank-values-v2","built-in-generic-bank-blanks-v1"],["labor-subcontract-real-v1.docx","built-in-labor-party-glyph-banks-v2","built-in-labor-party-glyph-v1"]])("projects bank values only for new snapshot %s",(filename,current,old)=>{
 const source=readFileSync(join(__dirname,"../../assets/templates",filename));
 const render=(version:string)=>extract(renderContractBody(source,source,{values},[],"layout",undefined,{partyDetailsVersion:version as never}).docx);
 const modern=render(current),historical=render(old);
 for(const item of ["甲开户行","甲账号","甲收款行","甲收款账号","乙开户行","乙账号"]) { expect(modern).toContain(item); expect(historical).not.toContain(item); }
});
it.each(["generic-contract-v1.docx","labor-subcontract-real-v1.docx"])("keeps legacy output frozen and projects new legacy bank fields for %s",filename=>{
 const source=readFileSync(join(__dirname,"../../assets/templates",filename));
 const base=removeMechanicalPartyDetailsFromLegacyDocx(source,renderContractDocx(prepareLegacyPartyRoleBindings(source,source),{values},[]),{rolesPrepared:true});
 const render=(modern:boolean)=>extract(filename.startsWith("generic")?addGenericBankBlanksToDocx(base,modern?values:undefined):appendLaborFinalPartyPageToDocx(base,values,modern));
 const historical=render(false),current=render(true);
 for(const item of ["甲开户行","甲账号","甲收款行","甲收款账号","乙开户行","乙账号"]) { expect(current).toContain(item);expect(historical).not.toContain(item); }
});
