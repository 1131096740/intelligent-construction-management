import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const detail = readFileSync(
  new URL("./ContractDetailPage.vue", import.meta.url),
  "utf8"
);
const signedChanges = readFileSync(
  new URL("./SignedContractChanges.vue", import.meta.url),
  "utf8"
);

describe("contract lifecycle capability gates", () => {
  it("uses the isolated server action list as the visible action authority", () => {
    expect(detail).toContain(
      "new Map((contractLifecycleAvailableActions.value ?? []).map"
    );
  });

  it("uses the shared participant-authorized SMS reminder panel", () => {
    expect(detail).toContain("<ApprovalProgressPanel");
    expect(detail).toContain('business-type="contract_version"');
  });

  it.each([
    ["download_approval_form", "downloadContractApprovalFormWithCapability"],
    ["confirm_archive", "confirmContractArchiveWithCapability"],
    ["upload_final_contract", "associateContractFinalFileWithCapability"],
    ["return_final_contract", "returnContractFinalFileWithCapability"],
    ["confirm_final_contract", "confirmContractFinalFileWithCapability"],
    ["transfer_approval", "transferContractApprovalWithCapability"],
    ["delegate_approval", "delegateContractApprovalWithCapability"],
    ["generate_pdf_archive", "generateContractPdfArchiveWithCapability"],
    ["upload_archive", "associateContractArchiveFileWithCapability"]
  ])("rechecks the fresh %s server action before mutation", (action, helper) => {
    expect(detail).toContain(`function ${helper}(`);
    expect(detail).toContain(`"${action}"`);
  });

  it("publishes and validates the dedicated signed-supplement capability gates", () => {
    expect(detail).toContain("<SignedContractChanges");
    expect(detail).toContain(':version-id="contractDetail.contractVersionId"');
    expect(detail).not.toContain("createContractChangeDraftWithCapability");
    expect(signedChanges).toContain("if (!details?.canSubmit");
    expect(signedChanges).toContain("!detail.value?.canReview");
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
