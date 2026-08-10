export type ContractMutationMethod = "DELETE" | "PATCH" | "POST" | "PUT";

export type ContractMutationAuthority =
  | "aggregate_member_writer"
  | "governed_specialized_command"
  | "exit_candidate";

export interface ContractMutationRouteIdentity {
  method: ContractMutationMethod;
  controller: string;
  handler: string;
  contractCutoverSurface: boolean;
  contractCutoverLegacyWrite: boolean;
}

export interface ContractMutationAuthorityClassification {
  authority: ContractMutationAuthority;
  authorityRule:
    | "contract_draft_aggregate_save"
    | "legacy_cutover_exit"
    | "registered_exit_candidate"
    | "governed_specialized_command";
}

interface ContractMutationTarget {
  method: ContractMutationMethod;
  controller: string;
  handler: string;
  contractCutoverLegacyWrite?: boolean;
}

const AGGREGATE_MEMBER_WRITER: ContractMutationTarget = {
  method: "PUT",
  controller: "ContractDraftController",
  handler: "saveDraft"
};

const EXIT_CANDIDATE_TARGETS = new Set([
  "DELETE\u0000BusinessPartyController\u0000removeContractParty",
  "DELETE\u0000ContractBillController\u0000deleteRow",
  "PATCH\u0000BusinessPartyController\u0000updateContractPartyRole",
  "PATCH\u0000ContractBillController\u0000updateRow",
  "POST\u0000BusinessPartyController\u0000addContractParty",
  "POST\u0000ContractBillController\u0000addRow",
  "POST\u0000ContractBillController\u0000reorderRows",
  "POST\u0000ContractBillExcelController\u0000applyImport",
  "POST\u0000ContractBillExcelController\u0000previewImport",
  "POST\u0000ContractDocumentController\u0000createOfflineRevisionPreviewDownloadTicket",
  "POST\u0000ContractWorkbenchController\u0000createCheckpoint",
  "POST\u0000ContractWorkbenchController\u0000restore",
  "POST\u0000ContractWorkbenchController\u0000restoreCheckpoint",
  "POST\u0000ContractWorkbenchController\u0000void",
  "POST\u0000ContractController\u0000copyAbandonedDraft",
  "POST\u0000ContractController\u0000submitApproval",
  "PUT\u0000ContractBillController\u0000replaceRows"
]);

export const CONTRACT_DRAFT_OPERATION_TARGETS = {
  acquire_contract_draft_edit_lease: {
    method: "POST",
    controller: "ContractDraftController",
    handler: "acquireEditLease"
  },
  apply_contract_type_change: {
    method: "POST",
    controller: "ContractWorkbenchController",
    handler: "applyTypeChange"
  },
  check_contract_submission_readiness: {
    method: "POST",
    controller: "ContractController",
    handler: "checkReadiness"
  },
  close_contract_negotiation_round: {
    method: "POST",
    controller: "ContractDocumentController",
    handler: "closeNegotiationRound",
    contractCutoverLegacyWrite: true
  },
  confirm_contract_bill_transitions: {
    method: "POST",
    controller: "ContractBillTransitionController",
    handler: "confirm"
  },
  confirm_contract_counterparty_signed_files: {
    method: "POST",
    controller: "ContractController",
    handler: "confirmCounterpartySignedFiles"
  },
  confirm_contract_settlement_mode: {
    method: "POST",
    controller: "ContractWorkbenchController",
    handler: "confirmSettlementMode"
  },
  discard_contract_bill_transitions: {
    method: "DELETE",
    controller: "ContractBillTransitionController",
    handler: "discard"
  },
  dispose_contract_document_difference: {
    method: "POST",
    controller: "ContractDocumentController",
    handler: "disposeDifference",
    contractCutoverLegacyWrite: true
  },
  heartbeat_contract_draft_edit_lease: {
    method: "POST",
    controller: "ContractDraftController",
    handler: "heartbeatEditLease"
  },
  open_contract_negotiation_round: {
    method: "POST",
    controller: "ContractDocumentController",
    handler: "openNegotiationRound",
    contractCutoverLegacyWrite: true
  },
  open_contract_revision_preview: {
    method: "POST",
    controller: "ContractDocumentController",
    handler: "createOfflineRevisionPreviewDownloadTicket"
  },
  preview_contract_draft_bill_excel_import: {
    method: "POST",
    controller: "ContractDraftBillExcelController",
    handler: "previewImport"
  },
  preview_contract_type_change: {
    method: "POST",
    controller: "ContractWorkbenchController",
    handler: "previewTypeChange"
  },
  queue_contract_document: {
    method: "POST",
    controller: "ContractDocumentController",
    handler: "queue"
  },
  queue_contract_draft_preview: {
    method: "POST",
    controller: "ContractDraftController",
    handler: "generatePreview"
  },
  release_contract_draft_edit_lease: {
    method: "DELETE",
    controller: "ContractDraftController",
    handler: "releaseEditLease"
  },
  retry_contract_document: {
    method: "POST",
    controller: "ContractDocumentController",
    handler: "retry"
  },
  retry_contract_offline_revision: {
    method: "POST",
    controller: "ContractDocumentController",
    handler: "retryOfflineRevision",
    contractCutoverLegacyWrite: true
  },
  save_contract_bill_transitions: {
    method: "PUT",
    controller: "ContractBillTransitionController",
    handler: "save"
  },
  save_contract_draft: AGGREGATE_MEMBER_WRITER,
  set_contract_authorization: {
    method: "POST",
    controller: "ContractController",
    handler: "setAuthorization"
  },
  submit_contract_draft: {
    method: "POST",
    controller: "ContractDraftController",
    handler: "submitDraft"
  },
  take_over_contract_draft_edit_lease: {
    method: "POST",
    controller: "ContractDraftController",
    handler: "takeOverEditLease"
  },
  transfer_contract_draft: {
    method: "POST",
    controller: "ContractWorkbenchController",
    handler: "transfer"
  },
  upload_contract_counterparty_signed_files: {
    method: "POST",
    controller: "ContractController",
    handler: "uploadCounterpartySignedFiles"
  },
  upload_contract_formal_approval_file: {
    method: "POST",
    controller: "ContractController",
    handler: "uploadFormalApprovalFile",
    contractCutoverLegacyWrite: true
  },
  upload_contract_negotiation_revision: {
    method: "POST",
    controller: "ContractDocumentController",
    handler: "uploadOfflineRevision",
    contractCutoverLegacyWrite: true
  },
  upload_contract_workbench_private_file: {
    method: "POST",
    controller: "ContractDraftController",
    handler: "uploadPrivateFile"
  }
} as const satisfies Record<string, ContractMutationTarget>;

function targetKey(target: ContractMutationTarget) {
  return `${target.method}\u0000${target.controller}\u0000${target.handler}`;
}

function sameTarget(left: ContractMutationTarget, right: ContractMutationTarget) {
  return targetKey(left) === targetKey(right);
}

export function classifyContractMutationTarget(
  route: ContractMutationTarget & { contractCutoverLegacyWrite?: boolean }
): ContractMutationAuthorityClassification {
  const matches: ContractMutationAuthorityClassification[] = [
    ...(route.contractCutoverLegacyWrite
      ? [{ authority: "exit_candidate" as const, authorityRule: "legacy_cutover_exit" as const }]
      : []),
    ...(EXIT_CANDIDATE_TARGETS.has(targetKey(route))
      ? [{ authority: "exit_candidate" as const, authorityRule: "registered_exit_candidate" as const }]
      : []),
    ...(sameTarget(route, AGGREGATE_MEMBER_WRITER)
      ? [{ authority: "aggregate_member_writer" as const, authorityRule: "contract_draft_aggregate_save" as const }]
      : [])
  ];
  if (matches.length > 1) {
    throw new Error("CONTRACT_MUTATION_AUTHORITY_OVERLAP");
  }
  return matches[0] ?? {
    authority: "governed_specialized_command",
    authorityRule: "governed_specialized_command"
  };
}

export function classifyContractMutationRoute(
  route: ContractMutationRouteIdentity
): ContractMutationAuthorityClassification | null {
  if (!route.contractCutoverSurface) return null;
  return classifyContractMutationTarget(route);
}

export function projectContractDraftOperationCapabilities(
  candidateActions: readonly string[]
) {
  return candidateActions.filter((action) => {
    const target = CONTRACT_DRAFT_OPERATION_TARGETS[
      action as keyof typeof CONTRACT_DRAFT_OPERATION_TARGETS
    ];
    if (!target) return false;
    return classifyContractMutationTarget(target).authority !== "exit_candidate";
  });
}
