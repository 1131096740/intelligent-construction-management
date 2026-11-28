import {normalizeCompanyBankBinding} from "./company-bank-binding";
const company={id:"company-a",versionId:"version-a1",versionNo:1}, next={id:"company-b",versionId:"version-b1",versionNo:1};
const data={protocolVersion:1,companyEntityId:"company-a",companyEntityVersionNo:1,values:{openingBank:"虚构甲银行",bankAccount:"A001",paymentBank:"",paymentAccount:""}};
it("binds new bank input to the server-selected company version without modifying it",()=>{
 const before=JSON.stringify(data),result=normalizeCompanyBankBinding(data,undefined,company);
 expect(result).toEqual({...data,companyEntityVersionId:"version-a1"});expect(JSON.stringify(data)).toBe(before);
});
it("preserves an old binding when the selected company changes, without assigning it to the new company",()=>{
 const old={...data,companyEntityVersionId:"version-a1"};expect(normalizeCompanyBankBinding(old,old,next)).toEqual(old);
});
it("rejects modified bank values assigned to a different or stale company version",()=>{
 const old={...data,companyEntityVersionId:"version-a1"};expect(()=>normalizeCompanyBankBinding({...old,values:{...old.values,bankAccount:"B002"}},old,next)).toThrow("银行资料");
 expect(()=>normalizeCompanyBankBinding({...data,companyEntityVersionNo:2},undefined,company)).toThrow("银行资料");
});
it("allows explicit reassignment to the newly selected version",()=>{
 const old={...data,companyEntityVersionId:"version-a1"},reassigned={...data,companyEntityId:"company-b",companyEntityVersionNo:1};
 expect(normalizeCompanyBankBinding(reassigned,old,next)).toEqual({...reassigned,companyEntityVersionId:"version-b1"});
});
