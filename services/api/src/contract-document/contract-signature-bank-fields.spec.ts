import { assertBankFieldCapacity, projectSignatureBankValues } from "./contract-signature-bank-fields";
it("preserves both sets of saved bank fields without inferring the payment account",()=>{
 const values={"party.owner.name":"甲方","party.owner.unifiedSocialCreditCode":"CREDIT-A","party.counterparty.name":"乙方"};
 const parties=[{roleKey:"party_a",snapshot:{name:"甲方",unifiedSocialCreditCode:"CREDIT-A",openingBank:"开户甲",bankAccount:"A001",paymentBank:"收款甲",paymentAccount:"A002"}},{roleKey:"party_b",snapshot:{name:"乙方",openingBank:"开户乙",bankAccount:"B001"}}];
 Object.assign(values,{"party.owner":[parties[0].snapshot],"party.counterparty":[parties[1].snapshot]});
 expect(projectSignatureBankValues(values,parties)).toMatchObject({"party.owner.openingBank":"开户甲","party.owner.bankAccount":"A001","party.owner.paymentBank":"收款甲","party.owner.paymentAccount":"A002","party.counterparty.openingBank":"开户乙","party.counterparty.bankAccount":"B001"});
 expect(values).not.toHaveProperty("party.owner.bankAccount");
});
it("fails closed when owner identity is unproven or role bank values are ambiguous",()=>{
 const values={"party.owner.name":"甲方","party.owner.unifiedSocialCreditCode":"CREDIT-A","party.counterparty.name":"乙方"};
 expect(()=>projectSignatureBankValues({...values,"party.owner":[{name:"甲方",unifiedSocialCreditCode:"CREDIT-A"}]},[{roleKey:"party_a",snapshot:{name:"甲方",unifiedSocialCreditCode:"CREDIT-A",bankAccount:"A001"}}])).toThrow("核对");
 expect(()=>projectSignatureBankValues(values,[{roleKey:"party_b",snapshot:{name:"乙方",bankAccount:"B001"}},{roleKey:"party_b",snapshot:{name:"乙方",bankAccount:"B002"}}])).toThrow("核对");
});
it("accepts the tested single-line capacity and identifies the precise invalid field without changing its value",()=>{
 const values={"party.owner.openingBank":"行".repeat(40),"party.counterparty.paymentAccount":"号".repeat(40)};
 expect(()=>assertBankFieldCapacity(values)).not.toThrow();
 for(const invalid of ["行".repeat(41),"第一行\n第二行","第一行\u2028第二行","\ufffe","\uffff","\ud800","\udfff"]) {
  const snapshot={...values,"party.owner.openingBank":invalid};
  expect(()=>assertBankFieldCapacity(snapshot)).toThrow("甲方开户行请改为单行且不超过40个字，并删除不支持的字符；原资料已保留");
  expect(snapshot["party.owner.openingBank"]).toBe(invalid);
 }
 expect(()=>assertBankFieldCapacity({...values,"party.counterparty.paymentAccount":"号".repeat(41)})).toThrow("乙方实际收款账号");
 expect(()=>assertBankFieldCapacity({...values,"party.owner.openingBank":"虚构𠮷银行"})).not.toThrow();
});
it("uses explicitly bound company bank data without assigning old party data to that company",()=>{
 const selected={id:"company-a",versionId:"version-a",name:"同名"};
 const oldParty={name:"同名",bankAccount:"new-account"};
 const counterparty={bankAccount:"b-account"};
 const binding={protocolVersion:1 as const,companyEntityId:"company-a",companyEntityVersionNo:1,companyEntityVersionId:"version-a",values:{openingBank:"new-bank",bankAccount:"new-account",paymentBank:"",paymentAccount:""}};
 expect(projectSignatureBankValues({"party.owner":[selected],"party.counterparty":[counterparty]},[{roleKey:"party_a",snapshot:oldParty},{roleKey:"party_b",snapshot:counterparty}],binding)).toMatchObject({"party.owner.bankAccount":"new-account","party.counterparty.bankAccount":"b-account"});
 expect(oldParty.bankAccount).toBe("new-account");
 expect(()=>projectSignatureBankValues({"party.owner":[{...selected,id:"different"}]},[],binding)).toThrow("核对");
 expect(()=>projectSignatureBankValues({"party.owner":[{...selected,versionId:"changed"}]},[],binding)).toThrow("核对");
});
it("requires explicit resolution when an old party bank field is absent or different in the new binding",()=>{
 const selected={id:"company-a",versionId:"version-a"};
 const old={roleKey:"party_a",snapshot:{bankAccount:"OLD"}};
 const binding={protocolVersion:1 as const,companyEntityId:"company-a",companyEntityVersionNo:1,companyEntityVersionId:"version-a",values:{openingBank:"bank",bankAccount:"",paymentBank:"",paymentAccount:""}};
 expect(()=>projectSignatureBankValues({"party.owner":[selected]},[old],binding)).toThrow("核对");
 expect(()=>projectSignatureBankValues({"party.owner":[selected]},[old],{...binding,values:{...binding.values,bankAccount:"OTHER"}})).toThrow("核对");
 expect(projectSignatureBankValues({"party.owner":[selected]},[old],{...binding,values:{...binding.values,bankAccount:"OLD"}})["party.owner.bankAccount"]).toBe("OLD");
 expect(old.snapshot.bankAccount).toBe("OLD");
});
