import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const detail = readFileSync(
  new URL("./ContractDetailPage.vue", import.meta.url),
  "utf8"
);
const changeState = readFileSync(
  new URL("./contract-change.state.ts", import.meta.url),
  "utf8"
);

describe("contract lifecycle capability gates", () => {
  it("uses the isolated server action list as the visible action authority", () => {
    expect(detail).toContain(
      "new Map((contractLifecycleAvailableActions.value ?? []).map"
    );
  });

  it.each([
    ["download_approval_form", "downloadContractApprovalFormWithCapability"],
    ["confirm_archive", "confirmContractArchiveWithCapability"],
    ["approve_seal", "approveLegacyContractSealWithCapability"],
    ["complete_seal", "completeContractSealWithCapability"],
    ["upload_final_contract", "associateContractFinalFileWithCapability"],
    ["return_final_contract", "returnContractFinalFileWithCapability"],
    ["confirm_final_contract", "confirmContractFinalFileWithCapability"],
    ["transfer_approval", "transferContractApprovalWithCapability"],
    ["delegate_approval", "delegateContractApprovalWithCapability"],
    ["remind_approval", "remindContractApprovalWithCapability"],
    ["generate_pdf_archive", "generateContractPdfArchiveWithCapability"],
    ["upload_archive", "associateContractArchiveFileWithCapability"]
  ])("rechecks the fresh %s server action before mutation", (action, helper) => {
    expect(detail).toContain(`function ${helper}(`);
    expect(detail).toContain(`"${action}"`);
  });

  it("publishes and validates a dedicated contract-change action", () => {
    expect(changeState).toContain('"create_contract_change_draft"');
    expect(detail).toContain("capability.availableActions.includes(");
    expect(detail).toContain('"create_contract_change_draft"');
  });

  it("prepares every private-file ticket from the exact file ACL capability", () => {
    expect(detail).toContain("getPrivateFileDownloadTicketCapability");
    expect(detail).toContain("contractFileDownloadAction");
    expect(detail).toMatch(
      /key === ["']create_private_file_download_ticket["']/u
    );
    expect(detail).toContain("requirePreparedContractFileDownload(");
  });
});
