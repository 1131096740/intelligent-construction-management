import {
  classifyContractMutationRoute,
  projectContractDraftOperationCapabilities
} from "./contract-mutation-authority";

describe("contract mutation authority", () => {
  it("rejects a route that would belong to both aggregate and exit authority", () => {
    expect(() =>
      classifyContractMutationRoute({
        method: "PUT",
        controller: "ContractDraftController",
        handler: "saveDraft",
        contractCutoverSurface: true,
        contractCutoverLegacyWrite: true,
        contractCutoverTombstoneWrite: false
      })
    ).toThrow("CONTRACT_MUTATION_AUTHORITY_OVERLAP");
  });

  it("classifies the old historical takeover confirmation as a non-advertised exit", () => {
    expect(
      classifyContractMutationRoute({
        method: "POST",
        controller: "ContractTakeoverController",
        handler: "confirm",
        contractCutoverSurface: true,
        contractCutoverLegacyWrite: false,
        contractCutoverTombstoneWrite: true
      })
    ).toEqual({
      authority: "exit_candidate",
      authorityRule: "tombstoned_cutover_exit"
    });
  });

  it("classifies a tombstoned ordinary party write as a non-advertised exit", () => {
    expect(
      classifyContractMutationRoute({
        method: "POST",
        controller: "BusinessPartyController",
        handler: "addContractParty",
        contractCutoverSurface: true,
        contractCutoverLegacyWrite: false,
        contractCutoverTombstoneWrite: true
      })
    ).toEqual({
      authority: "exit_candidate",
      authorityRule: "tombstoned_cutover_exit"
    });
  });

  it("projects only executable draft operations and fails closed for unknown actions", () => {
    expect(
      projectContractDraftOperationCapabilities([
        "save_contract_draft",
        "open_contract_revision_preview",
        "upload_contract_formal_approval_file",
        "unknown_contract_operation"
      ])
    ).toEqual(["save_contract_draft"]);
  });
});
