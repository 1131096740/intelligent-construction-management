import { Prisma, type Contract, type ContractArchiveFile, type ContractVersion } from "@prisma/client";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { assertDirectArchiveOriginals } from "../file/contract-archive-generation-read";
import { directArchiveRequestSha } from "./contract-direct-archive-request";
import { readUpwardDirectArchiveProof } from "./contract-upward-direct-archive-native";
import { record, upwardArchiveUnavailable, usesUpwardDirectArchive } from "./contract-upward-direct-registration";

export async function assertUpwardDirectArchivePersistentProof(tx: Prisma.TransactionClient, owner: Contract,
  version: ContractVersion, parent: ContractArchiveFile) {
  try {
    if (!usesUpwardDirectArchive(parent) || parent.archiveProtocolVersion !== 2 || parent.status !== "confirmed"
      || version.numericProtocolVersion !== 2 || version.signingSubjectType !== "upward" || version.status !== "effective"
      || version.versionNo !== 1 || version.changeType !== "original" || version.baseVersionId !== null
      || version.supersedesVersionId !== null || version.copiedFromContractVersionId !== null
      || version.firstSubmittedAt !== null || version.endedAt !== null || version.draftRevision !== parent.sourceRevision
      || !version.taxFactsFrozenAt || version.taxFactsFrozenAt.getTime() !== parent.confirmedAt?.getTime()
      || version.contractId !== owner.id || parent.contractVersionId !== version.id || parent.uploadedByUserId !== owner.ownerUserId
      || parent.confirmedByUserId !== parent.uploadedByUserId || !parent.confirmedAt || !version.effectiveAt
      || version.effectiveAt.getTime() !== parent.confirmedAt.getTime() || parent.approvalInstanceId !== null || parent.sealTaskId !== null
      || !parent.idempotencyKey || !/^[a-f0-9-]{36}$/u.test(parent.idempotencyKey)
      || !parent.authoritySha256 || !/^[a-f0-9]{64}$/u.test(parent.authoritySha256)) upwardArchiveUnavailable();
    const proof = await readUpwardDirectArchiveProof(tx, parent);
    const authority = record(parent.authoritySnapshot);
    const frozenInput = record(record(authority.sourceBasis).directInput);
    let authorityValue: unknown;
    try { authorityValue = JSON.parse(String(proof.authorityText)); } catch { upwardArchiveUnavailable(); }
    if (typeof proof.authorityText !== "string" || !isDeepStrictEqual(authorityValue, authority)
      || createHash("sha256").update(proof.authorityText).digest("hex") !== parent.authoritySha256
      || !isDeepStrictEqual(frozenInput.Q, proof.Q) || frozenInput.inputSha256 !== proof.inputSha256
      || !isDeepStrictEqual(authority.originals, proof.originals)
      || !isDeepStrictEqual(authority.operatingConsequence, proof.operatingConsequence)) upwardArchiveUnavailable();
    const originals = assertDirectArchiveOriginals(proof.originals);
    const q = record(proof.Q);
    if (typeof proof.qText !== "string" || typeof proof.inputSha256 !== "string" || !/^[a-f0-9]{64}$/u.test(proof.inputSha256)
      || !isDeepStrictEqual(JSON.parse(proof.qText), q) || createHash("sha256").update(proof.qText).digest("hex") !== proof.inputSha256
      || q.inputProtocolVersion !== 2 || !isDeepStrictEqual(q.source, { kind: "direct_signed", relationship: "upward" })
      || !isDeepStrictEqual(q.locator, { projectId: owner.projectId, contractId: owner.id, contractVersionId: version.id,
        draftRevision: parent.sourceRevision, versionNo: 1, changeType: "original" })
      || !Number.isSafeInteger(parent.sourceRevision) || Number(parent.sourceRevision) < 1) upwardArchiveUnavailable();
    const enterprise = record(record(q.subjects).enterprise), company = record(record(q.subjects).company);
    const contract = record(q.contract), money = record(q.money), tax = record(q.tax);
    const marker = record(record(version.draftData).directSigningInput);
    if (contract.businessType !== owner.contractTypeKey || contract.name !== owner.name || contract.originalSignedNumber !== version.originalSignedNumber
      || contract.signedOn !== marker.signedOn || marker.protocolVersion !== 2 || marker.source !== "direct_signed" || marker.relationship !== "upward"
      || enterprise.assignmentId !== version.affiliateAssignmentId || enterprise.businessPartyVersionId !== version.affiliateBusinessPartyVersionId
      || company.companyEntityId !== version.companyEntityIdSnapshot || company.companyEntityVersionId !== version.companyEntityVersionId
      || company.participationId !== marker.companyParticipationId || !isDeepStrictEqual(enterprise.position, marker.enterpriseParty)
      || !isDeepStrictEqual(company.position, marker.companyParty)
      || money.numericProtocolVersion !== 2 || money.amountYuan !== (version.amountYuan === null ? null : new Prisma.Decimal(String(version.amountYuan)).toFixed(4))
      || money.amountLimitType !== version.amountLimitType || money.pricingNature !== version.pricingNature || money.amountSource !== version.amountSource
      || tax.invoiceType !== version.invoiceType || tax.taxMode !== version.taxMode
      || tax.defaultTaxRatePercent !== (version.defaultTaxRatePercent === null ? null : new Prisma.Decimal(String(version.defaultTaxRatePercent)).toFixed(6))) upwardArchiveUnavailable();
    const files = originals.map(original => String(original!.fileId));
    if (!isDeepStrictEqual(q.signedFiles, originals.map(original => {
      const { fileId, displayOrder, mimeType, sizeBytes, contentSha256 } = original!;
      return { fileId, displayOrder, mimeType, sizeBytes, contentSha256 };
    }))) upwardArchiveUnavailable();
    const intent = { archiveProtocolVersion: 2 as const, archiveSource: "direct_signed" as const, idempotencyKey: parent.idempotencyKey,
      expectedDraftRevision: parent.sourceRevision!, expectedInputSha256: proof.inputSha256, fileIds: files,
      confirmedMatchingSignedDocument: true as const };
    const requestSha256 = directArchiveRequestSha(owner.id, version.id, parent.uploadedByUserId, intent);
    const result = { archiveId: parent.id, contractVersionId: version.id, status: "effective" as const, fileIds: files };
    if (parent.requestSha256 !== requestSha256 || !isDeepStrictEqual(parent.responseSnapshot, result)
      || !isDeepStrictEqual(proof.result, result)) upwardArchiveUnavailable();
    const consequence = record(authority.operatingConsequence);
    if (consequence.protocolVersion !== 1 || consequence.expectedSource !== null
      || (consequence.mode === "internal_reference_only" ? (typeof consequence.operatingLedgerEffectiveDateSnapshot !== "string"
        || !/^\d{4}-\d{2}-\d{2}$/u.test(consequence.operatingLedgerEffectiveDateSnapshot)
        || !Number.isFinite(Date.parse(consequence.operatingLedgerEffectiveDateSnapshot + "T00:00:00Z"))
        || new Date(consequence.operatingLedgerEffectiveDateSnapshot + "T00:00:00Z").toISOString().slice(0, 10) !== consequence.operatingLedgerEffectiveDateSnapshot)
        : consequence.mode !== "not_applicable" || consequence.operatingLedgerEffectiveDateSnapshot !== null)) upwardArchiveUnavailable();
    const source = { sourceType: "contract_version", sourceBusinessId: version.id };
    if (await tx.operatingFact.count({ where: source }) || await tx.operatingImpactEntry.count({ where: source })) upwardArchiveUnavailable();
    return { status: "archived" as const, result, requestSha256, intent };
  } catch { upwardArchiveUnavailable(); }
}
