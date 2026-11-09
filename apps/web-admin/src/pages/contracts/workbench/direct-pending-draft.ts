import type { ContractDraftPartyModel, ContractDraftWorkbenchReadModel } from "../../../api/contract-workbench.api";

export const directOriginalSlot = "direct_signed_originals_v1";
export const directPendingBusinessTypes = [
  { value: "material_purchase", label: "材料采购" }, { value: "equipment_rental", label: "机械租赁" },
  { value: "labor_subcontract", label: "劳务分包" }, { value: "professional_subcontract", label: "专业分包" },
  { value: "other", label: "其他" }
];

export function isDirectSignedDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value) || value.length !== 10) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const monthLengths = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= monthLengths[month - 1]!;
}

export type DirectPartyLocator = { roleKey: string; displayOrder: number };
export interface DirectSigningMarker {
  protocolVersion: 1;
  source: "direct_signed";
  relationship: "outside";
  signedOn: string | null;
  enterpriseParty: DirectPartyLocator | null;
  counterpartyParty: DirectPartyLocator | null;
  fixedPaymentTermsVersionId: string | null;
}
export type UpwardPartyRole = "party_a" | "party_b";
export interface UpwardSigningMarker {
  protocolVersion: 2;
  source: "direct_signed";
  relationship: "upward";
  signedOn: string | null;
  enterpriseParty: { roleKey: UpwardPartyRole; displayOrder: 0 } | null;
  companyParty: { roleKey: UpwardPartyRole; displayOrder: 0 } | null;
  companyParticipationId: string | null;
  fixedPaymentTermsVersionId: string | null;
}
export type PendingSigningMarker = DirectSigningMarker | UpwardSigningMarker;
export type UpwardDraftSubjects = {
  enterprise: { businessPartyVersionId: string; name: string } | null;
  companies: { companyEntityId: string; companyEntityVersionId: string; name: string }[];
};
export type DirectInputState = "incomplete" | "complete" | "invalid" | "unavailable";

export function sameDirectParty(a: ContractDraftPartyModel | undefined, b: ContractDraftPartyModel | undefined): boolean {
  return Boolean(a && b && ((a.businessPartyId && a.businessPartyId === b.businessPartyId) ||
    (a.businessPartyVersionId && a.businessPartyVersionId === b.businessPartyVersionId)));
}

export function directLocatedParty(parties: ContractDraftPartyModel[], locator: DirectPartyLocator | null | undefined) {
  return locator ? parties.find(party => party.roleKey === locator.roleKey && party.displayOrder === locator.displayOrder) : undefined;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

const roleKeys = ["party_a", "party_b", "party_c", "guarantor", "consortium_member", "other"];

function isLocator(value: unknown): value is DirectPartyLocator | null {
  if (value === null) return true;
  const locator = record(value);
  return Boolean(locator && Object.keys(locator).length === 2 && typeof locator.roleKey === "string" &&
    roleKeys.includes(locator.roleKey) && Number.isSafeInteger(locator.displayOrder) && Number(locator.displayOrder) >= 0);
}

export function directSigningMarker(value: unknown): DirectSigningMarker | null {
  const marker = record(value);
  if (!marker || Object.keys(marker).length !== 7 || marker.protocolVersion !== 1 ||
    marker.source !== "direct_signed" || marker.relationship !== "outside" ||
    !(marker.signedOn === null || typeof marker.signedOn === "string") ||
    !isLocator(marker.enterpriseParty) || !isLocator(marker.counterpartyParty) ||
    !(marker.fixedPaymentTermsVersionId === null || typeof marker.fixedPaymentTermsVersionId === "string" && marker.fixedPaymentTermsVersionId.length > 0)) return null;
  return marker as unknown as DirectSigningMarker;
}

function nonempty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function upwardPosition(value: unknown): value is NonNullable<UpwardSigningMarker["companyParty"]> {
  const position = record(value);
  return Boolean(position && Object.keys(position).length === 2 && position.displayOrder === 0 &&
    (position.roleKey === "party_a" || position.roleKey === "party_b"));
}

export function upwardSigningMarker(value: unknown): UpwardSigningMarker | null {
  const marker = record(value);
  if (!marker || Object.keys(marker).length !== 8 || marker.protocolVersion !== 2 || marker.source !== "direct_signed" ||
    marker.relationship !== "upward" || !(marker.signedOn === null || typeof marker.signedOn === "string") ||
    !((marker.enterpriseParty === null && marker.companyParty === null) ||
      (upwardPosition(marker.enterpriseParty) && upwardPosition(marker.companyParty) && marker.enterpriseParty.roleKey !== marker.companyParty.roleKey)) ||
    !(marker.companyParticipationId === null || nonempty(marker.companyParticipationId)) ||
    !(marker.fixedPaymentTermsVersionId === null || nonempty(marker.fixedPaymentTermsVersionId))) return null;
  return marker as unknown as UpwardSigningMarker;
}

export function pendingSigningMarker(value: unknown): PendingSigningMarker | null {
  return directSigningMarker(value) ?? upwardSigningMarker(value);
}

export function upwardSubjectOptions(workbench: {
  upwardDraftSubjects?: unknown;
  contract: { projectId: string };
  version: { id: string; draftRevision: number };
}): UpwardDraftSubjects | null {
  const options = record(workbench.upwardDraftSubjects);
  if (!options || options.projectId !== workbench.contract.projectId || options.contractVersionId !== workbench.version.id ||
    options.draftRevision !== workbench.version.draftRevision || !Array.isArray(options.companies)) return null;
  const enterprise = record(options.enterprise);
  if (options.enterprise !== null && (!enterprise || !nonempty(enterprise.businessPartyVersionId) || !nonempty(enterprise.name))) return null;
  const companies: UpwardDraftSubjects["companies"] = [];
  for (const item of options.companies) {
    const company = record(item);
    if (!company || !nonempty(company.companyEntityId) || !nonempty(company.companyEntityVersionId) || !nonempty(company.name) ||
      companies.some(existing => existing.companyEntityId === company.companyEntityId || existing.companyEntityVersionId === company.companyEntityVersionId)) return null;
    companies.push({ companyEntityId: company.companyEntityId, companyEntityVersionId: company.companyEntityVersionId, name: company.name });
  }
  return { enterprise: enterprise ? { businessPartyVersionId: String(enterprise.businessPartyVersionId), name: String(enterprise.name) } : null, companies };
}

export function upwardInputDetails(input: unknown) {
  const q = record(record(input)?.Q);
  const subjects = record(q?.subjects);
  const enterprise = record(subjects?.enterprise);
  const company = record(subjects?.company);
  return { q, enterprise, company };
}

function upwardInputState(source: Record<string, unknown>, contractId: string, versionId: string, revision: number, projectId: string): DirectInputState | null {
  if (source.protocolVersion !== 2 || source.sourceKind !== "upward_direct_signed_pending") return null;
  if (source.state === "unavailable") return source.sourceRevision === null && source.Q === null && source.inputSha256 === null ? "unavailable" : null;
  if (source.sourceRevision !== revision || !Number.isSafeInteger(revision) || revision < 1) return null;
  if (source.state === "incomplete") return source.Q === null && source.inputSha256 === null ? "incomplete" : null;
  const { q, enterprise, company } = upwardInputDetails(source);
  const locator = record(q?.locator);
  const kind = record(q?.source);
  const number = record(q?.contract)?.originalSignedNumber;
  if (source.state !== "complete" || typeof source.inputSha256 !== "string" || !/^[a-f0-9]{64}$/u.test(source.inputSha256) ||
    q?.inputProtocolVersion !== 2 || kind?.kind !== "direct_signed" || kind.relationship !== "upward" ||
    locator?.contractId !== contractId || locator.contractVersionId !== versionId || locator.projectId !== projectId ||
    locator.draftRevision !== revision || locator.changeType !== "original" || locator.versionNo !== 1 ||
    !enterprise || enterprise.projectId !== projectId || !upwardPosition(enterprise.position) || !nonempty(enterprise.cpsId) ||
    !nonempty(enterprise.assignmentId) || !nonempty(enterprise.businessPartyId) || !nonempty(enterprise.businessPartyVersionId) ||
    !company || company.projectId !== projectId || !upwardPosition(company.position) || !nonempty(company.participationId) ||
    !nonempty(company.companyEntityId) || !nonempty(company.companyEntityVersionId) || !nonempty(company.joinedCompanyEntityVersionId) ||
    enterprise.position.roleKey === company.position.roleKey || !(number === null || typeof number === "string" && number.length > 0) ||
    !Array.isArray(q.signedFiles) || q.signedFiles.length === 0 || q.signedFiles.length > 20) return null;
  const files = new Set<string>();
  for (const [index, item] of q.signedFiles.entries()) {
    const file = record(item);
    if (!file || !nonempty(file.fileId) || files.has(file.fileId) || file.displayOrder !== index ||
      !["application/pdf", "image/jpeg", "image/png"].includes(String(file.mimeType)) || !Number.isSafeInteger(file.sizeBytes) ||
      Number(file.sizeBytes) <= 0 || typeof file.contentSha256 !== "string" || !/^[a-f0-9]{64}$/u.test(file.contentSha256)) return null;
    files.add(file.fileId);
  }
  return "complete";
}

export function directInputState(
  input: unknown,
  contractId: string,
  versionId: string,
  revision: number,
  projectId: string,
  relationship: PendingSigningMarker["relationship"] = "outside"
): DirectInputState | null {
  const source = record(input);
  if (relationship === "upward") return source ? upwardInputState(source, contractId, versionId, revision, projectId) : null;
  if (!source || source.protocolVersion !== 1 || source.sourceKind !== "direct_signed_pending") return null;
  if (source.state === "unavailable") {
    return source.sourceRevision === null && source.Q === null && source.inputSha256 === null ? "unavailable" : null;
  }
  if (source.sourceRevision !== revision || !Number.isSafeInteger(revision) || revision < 1) return null;
  if (source.state === "incomplete" || source.state === "invalid") {
    return source.Q === null && source.inputSha256 === null ? source.state : null;
  }
  const q = record(source.Q);
  const locator = record(q?.locator);
  const kind = record(q?.source);
  if (source.state !== "complete" || typeof source.inputSha256 !== "string" || !/^[a-f0-9]{64}$/u.test(source.inputSha256) ||
    q?.inputProtocolVersion !== 1 || kind?.kind !== "direct_signed" || kind.relationship !== "outside" ||
    locator?.contractId !== contractId || locator.contractVersionId !== versionId || locator.projectId !== projectId ||
    locator.draftRevision !== revision || locator.changeType !== "original" ||
    !Array.isArray(q.signedFiles) || q.signedFiles.length === 0) return null;
  return "complete";
}

function samePartyPosition(left: DirectPartyLocator | null, right: DirectPartyLocator | null): boolean {
  return left?.roleKey === right?.roleKey && left?.displayOrder === right?.displayOrder;
}

function upwardWorkbenchState(workbench: ContractDraftWorkbenchReadModel): DirectInputState {
  const { version, contract } = workbench;
  const marker = upwardSigningMarker(version.draftData?.directSigningInput);
  const aggregateMarker = upwardSigningMarker(workbench.draft?.directSigningInput);
  const caps = record(workbench.directPendingCapabilities);
  const source = workbench.directPendingInput;
  const state = directInputState(source, contract.id, version.id, version.draftRevision, contract.projectId, "upward");
  const { q, enterprise, company } = upwardInputDetails(source);
  const files = q?.signedFiles;
  if (!marker || !aggregateMarker || marker.signedOn !== aggregateMarker.signedOn ||
    (marker.signedOn !== null && !isDirectSignedDay(marker.signedOn)) || marker.companyParticipationId !== aggregateMarker.companyParticipationId ||
    marker.fixedPaymentTermsVersionId !== aggregateMarker.fixedPaymentTermsVersionId ||
    !samePartyPosition(marker.enterpriseParty, aggregateMarker.enterpriseParty) || !samePartyPosition(marker.companyParty, aggregateMarker.companyParty) ||
    version.contractId !== contract.id || version.versionNo !== 1 || version.status !== "draft" || version.numericProtocolVersion !== 2 ||
    !("changeType" in version) || version.changeType !== "original" || version.documentContentRevision !== null || version.documentContentFingerprint !== null ||
    caps?.registrationEnabled !== false || caps.copyEnabled !== false || caps.purgeEnabled !== false || !state ||
    (marker.fixedPaymentTermsVersionId === null ? workbench.paymentTerms !== null :
      typeof workbench.paymentTerms?.originalText !== "string" || !Array.isArray(workbench.paymentTerms.stages) || workbench.paymentTerms.stages.length !== 0) ||
    (state === "complete" ? version.originalSignedNumberState !== "available" ||
      version.originalSignedNumber !== record(q?.contract)?.originalSignedNumber ||
      !upwardPosition(enterprise?.position) || !upwardPosition(company?.position) ||
      !samePartyPosition(marker.enterpriseParty, enterprise.position) || !samePartyPosition(marker.companyParty, company.position) ||
      company.participationId !== marker.companyParticipationId || !Array.isArray(files) || files.length !== workbench.attachments.length ||
      files.some((file, index) => workbench.attachments[index]?.slotKey !== directOriginalSlot ||
        workbench.attachments[index]?.fileId !== record(file)?.fileId || workbench.attachments[index]?.displayOrder !== index)
      : version.originalSignedNumberState !== "unavailable" || version.originalSignedNumber !== null)) {
    throw new Error("对上已签合同资料暂时无法核对，请刷新后再试");
  }
  return state;
}

export function directWorkbenchState(workbench: ContractDraftWorkbenchReadModel): DirectInputState | null {
  const { version, contract } = workbench;
  const direct = Object.hasOwn(version.draftData ?? {}, "directSigningInput") ||
    Object.hasOwn(workbench.draft ?? {}, "directSigningInput") || Object.hasOwn(workbench, "directPendingInput") ||
    Object.hasOwn(workbench, "directPendingCapabilities");
  if (!direct) return null;
  if (record(version.draftData?.directSigningInput)?.relationship === "upward" || record(workbench.draft?.directSigningInput)?.relationship === "upward" ||
    record(workbench.directPendingInput)?.sourceKind === "upward_direct_signed_pending") return upwardWorkbenchState(workbench);
  const marker = directSigningMarker(version.draftData?.directSigningInput);
  const aggregateMarker = directSigningMarker(workbench.draft?.directSigningInput);
  const caps = record(workbench.directPendingCapabilities);
  const state = directInputState(workbench.directPendingInput, contract.id, version.id, version.draftRevision, contract.projectId);
  if (!marker || !aggregateMarker || marker.signedOn !== aggregateMarker.signedOn ||
    (marker.signedOn !== null && !isDirectSignedDay(marker.signedOn)) ||
    marker.fixedPaymentTermsVersionId !== aggregateMarker.fixedPaymentTermsVersionId ||
    !samePartyPosition(marker.enterpriseParty, aggregateMarker.enterpriseParty) ||
    !samePartyPosition(marker.counterpartyParty, aggregateMarker.counterpartyParty) ||
    version.numericProtocolVersion !== 2 || !("changeType" in version) || version.changeType !== "original" ||
    version.documentContentRevision !== null || version.documentContentFingerprint !== null ||
    caps?.registrationEnabled !== false || caps.copyEnabled !== false || caps.purgeEnabled !== false ||
    !state || (state === "unavailable" ? version.originalSignedNumberState !== "unavailable" :
      version.originalSignedNumberState !== "available" || (version.originalSignedNumber !== null &&
        (typeof version.originalSignedNumber !== "string" || version.originalSignedNumber === ""))) ||
    (marker.fixedPaymentTermsVersionId === null ? workbench.paymentTerms !== null :
      typeof workbench.paymentTerms?.originalText !== "string" || !Array.isArray(workbench.paymentTerms.stages) || workbench.paymentTerms.stages.length !== 0)) {
    throw new Error("已签合同资料暂时无法核对，请刷新后再试");
  }
  return state;
}

export function directInputWritable(state: DirectInputState | null): boolean {
  return state === "incomplete" || state === "complete";
}
