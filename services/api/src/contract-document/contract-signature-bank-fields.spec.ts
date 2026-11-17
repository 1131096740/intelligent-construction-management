import { projectSignatureBankValues } from "./contract-signature-bank-fields";
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
