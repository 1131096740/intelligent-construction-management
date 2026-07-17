import { assertContractChangeContentAllowed } from "./contract-change-policy";

const template = {
  fieldSchema: [
    { key: "contractName", label: "合同名称", type: "text" as const },
    { key: "myCompanyEntity", label: "我方主体", type: "text" as const },
    { key: "site_name", label: "项目名称", type: "text" as const },
    { key: "site_address", label: "项目地址", type: "text" as const }
  ],
  clauseSchema: [],
  supplementChangePolicy: {
    version: 1 as const,
    editableFieldKeys: ["contractName", "site_name"],
    editableClauseKeys: [],
    coreClauseKeys: []
  }
};

const baseDraftData = {
  contractName: "原合同",
  myCompanyEntity: "甲方公司",
  companyEntitySelection: {
    id: "entity-1",
    versionId: "entity-version-3",
    versionNo: 3,
    name: "甲方公司",
    unifiedSocialCreditCode: "91350211M000100Y46",
    registeredAddress: null
  },
  fieldValues: { site_name: "旧项目", site_address: "旧地址" },
  partyValues: { party_a: "甲方公司", party_b: "乙方公司" },
  historicalTakeover: true
};

function assertCandidate(candidateDraftData: Record<string, unknown>) {
  return assertContractChangeContentAllowed({
    baseDraftData,
    candidateDraftData,
    baseClauses: [],
    candidateClauses: [],
    template
  });
}

describe("assertContractChangeContentAllowed", () => {
  it("diffs fieldValues by real schema child key and permits an allowed field", () => {
    expect(() => assertCandidate({
      ...baseDraftData,
      fieldValues: { ...baseDraftData.fieldValues, site_name: "新项目" }
    })).not.toThrow();
  });

  it("blocks an adjacent field that is not in the policy", () => {
    expect(() => assertCandidate({
      ...baseDraftData,
      fieldValues: { ...baseDraftData.fieldValues, site_address: "新地址" }
    })).toThrow("字段 site_address 不在合同变更白名单内");
  });

  it("permanently blocks myCompanyEntity even when a policy is maliciously expanded", () => {
    expect(() => assertContractChangeContentAllowed({
      baseDraftData,
      candidateDraftData: { ...baseDraftData, myCompanyEntity: "攻击者公司" },
      baseClauses: [],
      candidateClauses: [],
      template: {
        ...template,
        supplementChangePolicy: {
          ...template.supplementChangePolicy,
          editableFieldKeys: [...template.supplementChangePolicy.editableFieldKeys, "myCompanyEntity"]
        }
      }
    })).toThrow("合同变更不得修改我方签约主体");
  });

  it("preserves the complete frozen company selection during a change", () => {
    expect(() => assertCandidate({
      ...baseDraftData,
      companyEntitySelection: {
        ...baseDraftData.companyEntitySelection,
        versionNo: 4,
        versionId: "entity-version-4"
      }
    })).toThrow("合同变更不得修改我方签约主体");
  });

  it("allows contractName only when both schema and policy explicitly declare it", () => {
    expect(() => assertCandidate({ ...baseDraftData, contractName: "新合同名称" })).not.toThrow();
    expect(() => assertContractChangeContentAllowed({
      baseDraftData,
      candidateDraftData: { ...baseDraftData, contractName: "新合同名称" },
      baseClauses: [],
      candidateClauses: [],
      template: {
        ...template,
        fieldSchema: template.fieldSchema.filter((field) => field.key !== "contractName")
      }
    })).toThrow("字段 contractName 未在合同模板中声明，不能修改");
  });

  it("fails closed when an unknown top-level value changes", () => {
    expect(() => assertCandidate({ ...baseDraftData, historicalTakeover: false })).toThrow(
      "合同草稿顶层字段 historicalTakeover 不允许在合同变更中修改"
    );
  });

  it("fails closed when top-level and fieldValues carry conflicting values", () => {
    expect(() => assertCandidate({
      ...baseDraftData,
      contractName: "攻击者名称",
      fieldValues: { ...baseDraftData.fieldValues, contractName: "原合同" }
    })).toThrow("当前草稿字段 contractName 存在冲突值");
  });
});
