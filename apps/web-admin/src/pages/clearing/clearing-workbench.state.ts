import type {
  ClearingCapabilities,
  ClearingCaseReadModel,
  ClearingEventKind,
  ClearingEventReadModel
} from "../../api/clearing.api";

export const clearingKindOptions = [
  { value: "estimated", label: "预计" },
  { value: "withheld", label: "暂扣" },
  { value: "pending_reconciliation", label: "待核对" },
  { value: "final_confirmed", label: "最终确认" },
  { value: "supplemental", label: "补扣" },
  { value: "returned", label: "退回" }
] as const satisfies ReadonlyArray<{ value: ClearingEventKind; label: string }>;

export function clearingKindLabel(kind: ClearingEventKind): string {
  return clearingKindOptions.find((option) => option.value === kind)?.label ?? kind;
}

export function clearingEventActions(
  event: ClearingEventReadModel,
  capabilities: ClearingCapabilities
) {
  const currentVersion = event.versions.find(
    (version) => version.versionNo === event.currentVersionNo
  );
  return {
    edit: capabilities.prepare && event.workflowStatus === "draft",
    submit: capabilities.submit && event.workflowStatus === "draft",
    attest:
      capabilities.attest &&
      event.workflowStatus === "submitted" &&
      currentVersion?.evidenceLevel === "B" &&
      !currentVersion.attestation,
    confirm:
      capabilities.confirm &&
      event.workflowStatus === "submitted" &&
      (currentVersion?.evidenceLevel !== "B" || Boolean(currentVersion.attestation)),
    return: capabilities.return && event.workflowStatus === "submitted",
    reopen: capabilities.reopen && event.workflowStatus === "returned"
  };
}

export function clearingTimeline(clearingCase: ClearingCaseReadModel) {
  return clearingCase.events.flatMap((event) =>
    event.versions.map((version) => ({
      key: `${event.id}:${version.id}`,
      eventId: event.id,
      kind: event.kind,
      kindLabel: clearingKindLabel(event.kind),
      versionNo: version.versionNo,
      workflowStatus: version.confirmation ? "confirmed" : version.workflowStatus,
      amountCents: version.amountCents,
      createdAt: version.createdAt,
      confirmedAt: version.confirmation?.confirmedAt ?? null
    }))
  ).sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}
