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
