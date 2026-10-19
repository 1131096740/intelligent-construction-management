import { describe, expect, it } from "vitest";
import { downstreamContractRelationship, operatingContractRelationship } from "./contract-relationship";
describe("签约关系独立于付款主体", () => {
  it("不将缺少主体快照的旧默认值当作表内证据", () => {
    expect(downstreamContractRelationship({ signingSubjectType: "our_company" })).toBe("unclassified");
  });
  it("使用具体公司/施工企业的冻结身份", () => {
    expect(downstreamContractRelationship({ signingSubjectType: "our_company", companyEntityVersionId: "c1" })).toBe("inside");
    expect(downstreamContractRelationship({ signingSubjectType: "affiliate", affiliateAssignmentId: "a1", affiliateBusinessPartyVersionId: "a2" })).toBe("outside");
  });
  it("施工企业代付表内合同不改变分类", () => {
    expect(operatingContractRelationship("payment_execution", { signingSubjectType: "our_company", companyEntityVersionId: "c1", actualPayerType: "affiliate" })).toBe("inside");
  });
  it("对上与业主关系明确区分", () => {
    expect(operatingContractRelationship("project_affiliate_settlement_fact", { affiliateCompanyContractId: "up" })).toBe("upward");
    expect(operatingContractRelationship("project_upstream_settlement", {})).toBe("owner");
  });
  it("付款缺少签约快照时不按实际付款人推测", () => {
    expect(operatingContractRelationship("payment_execution", { actualPayerType: "our_company" })).toBe("unclassified");
  });
  it("冲减继承原始合同分类，空施工企业对象和未知来源不能冒充已核对", () => {
    expect(operatingContractRelationship("settlement", { authority: "contract_takeover_append_only_correction", originalSnapshot: { sourceType: "settlement", sourceSnapshot: { signingSubjectType: "our_company", companyEntityVersionId: "c1" } } })).toBe("inside");
    expect(operatingContractRelationship("settlement", { signingSubjectType: "affiliate", affiliate: {} })).toBe("unclassified");
    expect(operatingContractRelationship("unknown_source", {})).toBe("unclassified");
  });

});
