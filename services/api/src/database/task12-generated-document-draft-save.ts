import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import {
  CONTRACT_BODY_RENDER_PROFILE_KEY,
  REVIEWED_MATERIAL_SIGNATURE_DATE_VERSION,
  REVIEWED_MATERIAL_TYPOGRAPHY_V4_VERSION
} from "../contract-document/contract-body-document";
import { CONTRACT_DRAFT_LEASE_TTL_MS } from "../contract-workbench/contract-draft-edit-lease.service";
import type { SaveContractDraftAggregateDto } from "../contract-workbench/dto/contract-workbench.dto";
import type { openTask12GeneratedApprovalDraft } from "./task12-generated-approval-admission";
import { type bindTask12PublishedMaterialTemplate, isTask12PublishedMaterialTemplate } from "./task12-generated-document-seam";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA = /^[0-9a-f]{64}$/u;
const fixedTitle = "隔离表内材料采购合同";
const fixedOwner = "隔离材料采购甲方";
const fixedCounterparty = "隔离材料采购乙方";
const contractBasics = Object.freeze({
  relationship: "inside", businessType: "material_purchase", amountBasis: "tax_inclusive", invoiceStatus: "pending", settlementText: ""
});
const tax = Object.freeze({
  invoiceType: null, taxMode: "single_rate" as const, defaultTaxRatePercent: null, source: "contract_document" as const
});
const sections = ["draft", "parties"] as const;
const reviewedProfile = {
  typographyVersion: REVIEWED_MATERIAL_TYPOGRAPHY_V4_VERSION, signatureDateVersion: REVIEWED_MATERIAL_SIGNATURE_DATE_VERSION
};

type Opened = Awaited<ReturnType<typeof openTask12GeneratedApprovalDraft>>;
type Reply = { status: number; body: unknown };
interface Port {
  /** Both methods are owned by the same already-opened application and editing lease. */
  readDraftWorkbench(): Promise<Reply>;
  saveDraft(body: SaveContractDraftAggregateDto): Promise<Reply>;
}

function requireStage(value: unknown, stage: string): asserts value {
  if (!value) {
    const code = "TASK12_GENERATED_DOCUMENT_DRAFT_SAVE_" + stage;
    throw Object.assign(new Error(code), { code });
  }
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function isId(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

function empty(value: unknown) {
  return Array.isArray(value) && value.length === 0;
}

async function call(operation: () => Promise<Reply>, stage: string) {
  let response: Reply;
  try {
    response = await operation();
  } catch {
    requireStage(false, stage);
  }
  requireStage(response?.status === 200, stage);
  return object(response.body);
}

function observe(workbench: Record<string, unknown>, opened: Opened, handlerId: string, stage: string) {
  const contract = object(workbench.contract), version = object(workbench.version), draft = object(workbench.draft);
  const terms = object(workbench.paymentTerms), lease = object(workbench.lease);
  const bills = workbench.bills;
  const bill = object(Array.isArray(bills) ? bills[0] : undefined);
  const expiresAt = lease.expiresAt, observedAt = Date.now();
  const expiry = typeof expiresAt === "string" ? Date.parse(expiresAt) : NaN;
  requireStage(contract.id === opened.contractId && contract.projectId === opened.projectId &&
    contract.ownerUserId === handlerId && contract.contractTypeKey === "material_purchase" &&
    version.id === opened.versionId && version.contractId === opened.contractId && version.status === "draft" &&
    version.versionNo === 1 && version.changeType === "original" && version.signingSubjectType === "draft_unconfirmed" &&
    version.numericProtocolVersion === 2 && version.pricingNature === "unit_price" && version.amountSource === "bill_sum" &&
    version.amountLimitType === "capped" && version.latestDraftPreviewDocumentId === null &&
    workbench.expectedDraftRevision === version.draftRevision &&
    isDeepStrictEqual(version.taxFacts, { ...tax, status: "draft", revision: 0, frozenAt: null }) &&
    isDeepStrictEqual(draft.contractBasics, contractBasics) && !Object.hasOwn(draft, "directSigningInput") &&
    !Object.hasOwn(draft, "documentBody") && !Object.hasOwn(workbench, "directPendingInput") &&
    Array.isArray(bills) && bills.length === 1 && isId(bill.id) && bill.contractVersionId === opened.versionId &&
    bill.billKey === "main" && bill.revision === 1 && bill.numericProtocolVersion === 2 && bill.amountRole === "included" &&
    bill.pricingMode === "tax_inclusive" && bill.taxInclusiveAmountYuan === null &&
    bill.taxExclusiveAmountYuan === null && bill.taxAmountYuan === null && empty(bill.rows) &&
    terms.originalText === "" && empty(terms.stages) && empty(workbench.attachments) && empty(workbench.documents) &&
    lease.state === "held_by_me" && typeof expiresAt === "string" && expiry > observedAt &&
    expiry - observedAt <= CONTRACT_DRAFT_LEASE_TTL_MS && new Date(expiry).toISOString() === expiresAt, stage);
  return { contract, version, draft, billId: bill.id, expiresAt };
}

/** One original aggregate save on the current fresh inside-material draft and one independent reread. */
export async function saveTask12GeneratedDocumentDraft(
  opened: Opened, handlerId: string, template: ReturnType<typeof bindTask12PublishedMaterialTemplate>, port: Port
) {
  requireStage(opened?.status === "DRAFT_ADMISSION_PROTOCOL_MATCHED" && opened.leaseRevision === 1 &&
    isId(opened.projectId) && isId(opened.contractId) && isId(opened.versionId) && isId(handlerId) &&
    isTask12PublishedMaterialTemplate(template) &&
    new Set([opened.projectId, opened.contractId, opened.versionId, handlerId, template.layoutId]).size === 5, "INPUT");
  const { projectId, contractId, versionId, leaseRevision } = opened;
  const { layoutId } = template;
  const before = await call(() => port.readDraftWorkbench(), "BEFORE");
  const previous = observe(before, opened, handlerId, "BEFORE");
  requireStage(previous.version.draftRevision === 1 && previous.version.documentContentRevision === 1 &&
    previous.version.documentContentFingerprint === null && previous.version.layoutTemplateVersionId === null &&
    previous.version.layoutTemplateSelection === null && previous.contract.name === "" && previous.draft.contractName === "" &&
    isDeepStrictEqual(previous.draft.fieldValues, {}) && isDeepStrictEqual(previous.draft.partyValues, {}) &&
    !Object.hasOwn(previous.draft, CONTRACT_BODY_RENDER_PROFILE_KEY) && empty(before.parties), "BEFORE");

  const body: SaveContractDraftAggregateDto = {
    idempotencyKey: randomUUID(), saveKind: "manual", expectedRevision: 1, changedSections: [...sections],
    draft: {
      numericProtocolVersion: 2, draftData: { contractName: fixedTitle, fieldValues: {}, partyValues: {}, contractBasics },
      clauses: [], pricingNature: "unit_price", amountSource: "bill_sum", layoutTemplateVersionId: layoutId, taxFacts: tax
    },
    parties: [
      { roleKey: "party_a", displayOrder: 0, snapshot: { name: fixedOwner } },
      { roleKey: "party_b", displayOrder: 0, snapshot: { name: fixedCounterparty } }
    ],
    bills: [{ billKey: "main", expectedRevision: 1, numericProtocolVersion: 2, rows: [] }],
    paymentTerms: null, attachments: [], negotiationDocuments: { referencedGeneratedDocumentIds: [] }
  };
  const requestFingerprint = createHash("sha256").update(JSON.stringify(body)).digest("hex");
  const saved = await call(() => port.saveDraft(body), "SAVE");
  const { draftRevision: sourceRevision, documentContentRevision, documentContentFingerprint } = saved;
  requireStage(saved.contractVersionId === versionId && sourceRevision === 2 && saved.serverRevision === sourceRevision &&
    documentContentRevision === 2 && typeof documentContentFingerprint === "string" && SHA.test(documentContentFingerprint) &&
    saved.requestFingerprint === requestFingerprint && isDeepStrictEqual(saved.billRevisions, { main: 1 }) &&
    isDeepStrictEqual(saved.effectiveChangedSections, sections) && isDeepStrictEqual(saved.documentContentChangedSections, sections), "SAVE");

  const after = await call(() => port.readDraftWorkbench(), "AFTER");
  const current = observe(after, opened, handlerId, "AFTER");
  const layout = object(current.version.layoutTemplateSelection);
  const parties = after.parties;
  requireStage(Array.isArray(parties) && parties.length === 2, "AFTER");
  const [owner, counterparty] = parties.map(object);
  const ownerName = object(owner.snapshot).name, counterpartyName = object(counterparty.snapshot).name;
  const contractName = current.draft.contractName;
  requireStage(current.version.draftRevision === sourceRevision && current.version.documentContentRevision === documentContentRevision &&
    current.version.documentContentFingerprint === documentContentFingerprint && current.version.layoutTemplateVersionId === layoutId &&
    layout.id === layoutId && layout.status === "published" && current.expiresAt === previous.expiresAt &&
    current.billId === previous.billId && contractName === fixedTitle && current.contract.name === contractName &&
    isDeepStrictEqual(current.draft[CONTRACT_BODY_RENDER_PROFILE_KEY], reviewedProfile) &&
    isDeepStrictEqual(current.draft.fieldValues, { invoiceType: null, taxRatePercent: null }) &&
    isDeepStrictEqual(current.draft.partyValues, {}) &&
    owner.roleKey === "party_a" && counterparty.roleKey === "party_b" &&
    [owner, counterparty].every(party => party.contractVersionId === versionId && party.displayOrder === 0 &&
      party.businessPartyVersionId === null) && ownerName === fixedOwner && counterpartyName === fixedCounterparty, "AFTER");

  return Object.freeze({
    status: "DRAFT_DOCUMENT_SAVE_READBACK_MATCHED" as const, projectId, contractId, versionId, layoutId, sourceRevision,
    documentContentRevision, documentContentFingerprint, leaseRevision, leaseExpiresAt: current.expiresAt,
    fields: Object.freeze({ contractName, ownerName, counterpartyName })
  });
}
