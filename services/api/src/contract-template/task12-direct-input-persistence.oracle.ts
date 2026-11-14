import type { TemplateSyntheticStore } from "./template-management.test-support";

type Row = Record<string, unknown>;
function object(value: unknown): Row | null { return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Row : null; }
function money(value: unknown, scale = 4) {
  if (value === null || value === undefined) return null;
  const text = String(value), parts = text.split(".");
  if (!/^\d+(?:\.\d+)?$/u.test(text) || (parts[1]?.length ?? 0) > scale) throw new Error("有限工厂金额列域未登记");
  return parts[0]+"."+(parts[1] ?? "").padEnd(scale,"0");
}
/** Fixed factory persistence contract, not SQL execution or a JSONB digest. */
export async function directPendingInputFromStoredRows(store: TemplateSyntheticStore, versionId: string) {
  const version = await store.table("contractVersion").findUnique({ where: { id: versionId } });
  if (!version) throw new Error("工厂定位无真实Version行");
  const contract = await store.table("contract").findUnique({ where: { id: version.contractId } });
  const data = object(version.draftData), marker = object(data?.directSigningInput);
  const unavailable = (state: string, reason: string) => ({ protocolVersion: 1, sourceKind: "direct_signed_pending", state, sourceRevision: version.draftRevision, Q: null, inputSha256: null, reason });
  if (!contract || !marker || marker.source !== "direct_signed" || marker.protocolVersion !== 1 || marker.relationship !== "outside" || version.numericProtocolVersion !== 2 || version.changeType !== "original") return unavailable("invalid","持久来源不匹配");
  const parties = (await store.table("contractPartySnapshot").findMany({ where: { contractVersionId: version.id } })).sort((a,b) => String(a.roleKey) < String(b.roleKey) ? -1 : String(a.roleKey) > String(b.roleKey) ? 1 : Number(a.displayOrder)-Number(b.displayOrder));
  const enterpriseLoc = object(marker.enterpriseParty), counterpartyLoc = object(marker.counterpartyParty);
  const enterprise = enterpriseLoc ? parties.find(row => row.roleKey === enterpriseLoc.roleKey && row.displayOrder === enterpriseLoc.displayOrder) : null;
  const counterparty = counterpartyLoc ? parties.find(row => row.roleKey === counterpartyLoc.roleKey && row.displayOrder === counterpartyLoc.displayOrder) : null;
  const assignment = version.affiliateAssignmentId ? await store.table("projectAffiliateAssignment").findUnique({ where: { id: version.affiliateAssignmentId } }) : null;
  const attachments = await store.table("contractDraftAttachment").findMany({ where: { contractVersionId: version.id, slotKey: "direct_signed_originals_v1" }, orderBy: { displayOrder: "asc" } });
  if (typeof contract.name !== "string" || !contract.name.trim() || !enterprise?.businessPartyVersionId || !counterparty?.businessPartyVersionId || !assignment || !attachments.length) return unavailable("incomplete","签约双方、合同名称或原件尚未保存完整");
  if (enterprise.id === counterparty.id || enterprise.businessPartyVersionId === counterparty.businessPartyVersionId || assignment.projectId !== contract.projectId || assignment.businessPartyVersionId !== enterprise.businessPartyVersionId || version.affiliateBusinessPartyVersionId !== assignment.businessPartyVersionId || version.signingSubjectType !== "affiliate") return unavailable("invalid","签约身份与实际来源不匹配");
  const partyInputs: Row[] = [];
  for (const party of parties) {
    const bp = party.businessPartyVersionId ? await store.table("businessPartyVersion").findUnique({ where: { id: party.businessPartyVersionId } }) : null;
    const snapshot = object(bp?.snapshot);
    if ((party.id === enterprise.id || party.id === counterparty.id) && (!snapshot || (party.id === enterprise.id ? bp?.businessPartyId !== assignment.businessPartyId : bp?.businessPartyId === assignment.businessPartyId))) return unavailable("invalid","受控单位源资料不匹配");
    partyInputs.push({ cpsId: party.id, roleKey: party.roleKey, displayOrder: party.displayOrder, businessPartyVersionId: party.businessPartyVersionId,
      identity: Object.fromEntries(["name","unifiedSocialCreditCode","legalRepresentative","address","contactName","contactPhone"].map(key => [key, snapshot?.[key] ?? null])) });
  }
  let paymentTerms: Row | null = null;
  const terms = await store.table("paymentTermsVersion").findMany({ where: { contractVersionId: version.id } });
  if (marker.fixedPaymentTermsVersionId !== null) {
    const fixed = terms.find(row => row.id === marker.fixedPaymentTermsVersionId && row.contractId === contract.id);
    if (!fixed || (await store.table("paymentTermsStage").findMany({ where: { paymentTermsVersionId: fixed.id } })).length) return unavailable("invalid","付款约定固定来源不完整");
    paymentTerms = { id: fixed.id, versionNo: fixed.versionNo, originalText: fixed.originalText, stages: [] };
  } else if (terms.length) return unavailable("incomplete","付款约定尚未固定");
  const signedFiles: Row[] = [];
  for (const [index, attachment] of attachments.entries()) {
    const file = await store.table("fileObject").findUnique({ where: { id: attachment.fileId } });
    if (!file || attachment.displayOrder !== index || !["application/pdf","image/jpeg","image/png"].includes(String(file.mimeType)) || typeof file.sizeBytes !== "number" || file.sizeBytes <= 0 || file.storageStatus !== "active" || file.purgeReceiptId || file.supersedesFileObjectId || typeof file.contentSha256 !== "string" || !/^[a-f0-9]{64}$/u.test(file.contentSha256) || await store.table("fileObject").findFirst({ where: { supersedesFileObjectId: file.id } })) return unavailable("invalid","原件元数据或顺序不匹配");
    signedFiles.push({ fileId: file.id, displayOrder: index, mimeType: file.mimeType, sizeBytes: file.sizeBytes, contentSha256: file.contentSha256 });
  }
  const basics = object(data?.contractBasics);
  const Q = { inputProtocolVersion: 1, source: { kind: "direct_signed", relationship: "outside" }, locator: { projectId: contract.projectId, contractId: contract.id, contractVersionId: version.id, versionNo: version.versionNo, changeType: "original", draftRevision: version.draftRevision },
    contract: { businessType: contract.contractTypeKey, name: contract.name, originalSignedNumber: version.originalSignedNumber ?? null, signedOn: marker.signedOn },
    money: { numericProtocolVersion: 2, amountYuan: money(version.amountYuan), amountLimitType: version.amountLimitType, pricingNature: version.pricingNature, amountSource: version.amountSource },
    tax: { amountBasis: basics?.amountBasis, invoiceType: version.invoiceType, taxMode: version.taxMode, defaultTaxRatePercent: money(version.defaultTaxRatePercent,6) },
    subjects: { enterprise: { assignmentId: assignment.id, businessPartyId: assignment.businessPartyId, businessPartyVersionId: assignment.businessPartyVersionId, name: assignment.affiliateNameSnapshot, creditCode: assignment.affiliateCreditCodeSnapshot, effectiveFrom: assignment.effectiveFrom instanceof Date ? assignment.effectiveFrom.toISOString() : assignment.effectiveFrom }, roles: { enterpriseCpsId: enterprise.id, counterpartyCpsId: counterparty.id }, parties: partyInputs },
    terms: { settlementText: basics?.settlementText ?? "", paymentTerms }, signedFiles };
  // Explicit opaque adapter output. No claim this literal is PostgreSQL digest(Q).
  return { protocolVersion: 1, sourceKind: "direct_signed_pending", state: "complete", sourceRevision: version.draftRevision, Q, inputSha256: "d".repeat(64), reason: null };
}
