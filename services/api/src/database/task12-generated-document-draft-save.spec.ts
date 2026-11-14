import { CONTRACT_BODY_RENDER_PROFILE_KEY, REVIEWED_MATERIAL_SIGNATURE_DATE_VERSION, REVIEWED_MATERIAL_TYPOGRAPHY_V4_VERSION } from "../contract-document/contract-body-document";
import { ValidationPipe } from "@nestjs/common";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { SaveContractDraftAggregateDto } from "../contract-workbench/dto/contract-workbench.dto";
import { bindTask12PublishedMaterialTemplate, verifyTask12MaterialTemplate } from "./task12-generated-document-seam";
import { saveTask12GeneratedDocumentDraft } from "./task12-generated-document-draft-save";

const id = (n: number) => "10000000-0000-4000-8000-" + String(n).padStart(12, "0");
const [projectId, contractId, versionId, layoutId, handlerId, mainId] = [1, 2, 3, 4, 5, 6].map(id);
const fields = { contractName: "隔离表内材料采购合同", ownerName: "隔离材料采购甲方", counterpartyName: "隔离材料采购乙方" };
const contentFingerprint = "f".repeat(64);
const tax = { invoiceType: null, taxMode: "single_rate", defaultTaxRatePercent: null, source: "contract_document" };
const contractBasics = { relationship: "inside", businessType: "material_purchase", amountBasis: "tax_inclusive", invoiceStatus: "pending", settlementText: "" };

function publishedTemplate() {
  const source = verifyTask12MaterialTemplate(readFileSync(resolve(__dirname, "../../assets/templates/material-purchase-real-v1.docx")));
  const sourceFileId = id(7), previewJobId = id(8), previewPdfFileId = id(9);
  const binding = { sourceFileId, sourceSha256: source.sha256, draftRevision: 2 };
  return bindTask12PublishedMaterialTemplate(source, { id: sourceFileId, contentSha256: source.sha256, sizeBytes: source.bytes }, {
    id: layoutId, status: "published", docxFileId: sourceFileId, draftRevision: 2, previewPdfFileId,
    placeholderSchema: { sourceMapping: { ...binding, protocolVersion: 1, bindings: [], fingerprint: contentFingerprint,
      confirmation: { ...binding, mappingFingerprint: contentFingerprint, previewJobId, previewPdfFileId } } }
  });
}

type Request = Parameters<Parameters<typeof saveTask12GeneratedDocumentDraft>[3]["saveDraft"]>[0];
function application(change?: (phase: string, result: Record<string, unknown>) => Record<string, unknown>) {
  const calls: string[] = [];
  const expiresAt = new Date(Date.now() + 100_000).toISOString();
  let saved: Request | undefined;
  function observe() {
    const draft = {
      contractName: saved?.draft.draftData.contractName ?? "",
      fieldValues: saved ? { invoiceType: null, taxRatePercent: null } : {},
      partyValues: {}, contractBasics,
      ...(saved ? { [CONTRACT_BODY_RENDER_PROFILE_KEY]: {
        typographyVersion: REVIEWED_MATERIAL_TYPOGRAPHY_V4_VERSION, signatureDateVersion: REVIEWED_MATERIAL_SIGNATURE_DATE_VERSION
      } } : {})
    };
    return {
      contract: { id: contractId, projectId, ownerUserId: handlerId, contractTypeKey: "material_purchase", name: draft.contractName },
      version: { id: versionId, contractId, status: "draft", versionNo: 1, changeType: "original", signingSubjectType: "draft_unconfirmed",
        numericProtocolVersion: 2, draftRevision: saved ? 2 : 1, documentContentRevision: saved ? 2 : 1,
        documentContentFingerprint: saved ? contentFingerprint : null, latestDraftPreviewDocumentId: null,
        layoutTemplateVersionId: saved ? layoutId : null, layoutTemplateSelection: saved ? { id: layoutId, status: "published" } : null,
        pricingNature: "unit_price", amountSource: "bill_sum", amountLimitType: "capped", taxFacts: { ...tax, revision: 0, status: "draft", frozenAt: null } },
      expectedDraftRevision: saved ? 2 : 1, draft,
      lease: { state: "held_by_me", expiresAt },
      bills: [{ id: mainId, contractVersionId: versionId, billKey: "main", revision: 1, numericProtocolVersion: 2, amountRole: "included",
        pricingMode: "tax_inclusive", taxInclusiveAmountYuan: null, taxExclusiveAmountYuan: null, taxAmountYuan: null, rows: [] }],
      parties: saved ? saved.parties.map(party => ({ ...party, contractVersionId: versionId, businessPartyVersionId: null })) : [],
      paymentTerms: { originalText: "", stages: [] }, attachments: [], documents: []
    };
  }
  const port = {
    async readDraftWorkbench() {
      const phase = saved ? "AFTER" : "BEFORE";
      calls.push(phase);
      const body = observe();
      return { status: 200, body: change ? change(phase, body) : body };
    },
    async saveDraft(body: Request) {
      calls.push("SAVE");
      await new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true })
        .transform(body, { type: "body", metatype: SaveContractDraftAggregateDto });
      expect(body).toEqual({
        idempotencyKey: expect.stringMatching(/^[a-f0-9-]{36}$/u),
        saveKind: "manual", expectedRevision: 1, changedSections: ["draft", "parties"],
        draft: { numericProtocolVersion: 2, draftData: { contractName: fields.contractName, fieldValues: {}, partyValues: {}, contractBasics },
          clauses: [], pricingNature: "unit_price", amountSource: "bill_sum", layoutTemplateVersionId: layoutId, taxFacts: tax },
        parties: [
          { roleKey: "party_a", displayOrder: 0, snapshot: { name: fields.ownerName } },
          { roleKey: "party_b", displayOrder: 0, snapshot: { name: fields.counterpartyName } }
        ],
        bills: [{ billKey: "main", expectedRevision: 1, numericProtocolVersion: 2, rows: [] }],
        paymentTerms: null, attachments: [], negotiationDocuments: { referencedGeneratedDocumentIds: [] }
      });
      saved = body;
      const result = { contractVersionId: versionId, draftRevision: 2, serverRevision: 2, documentContentRevision: 2,
        documentContentFingerprint: contentFingerprint, billRevisions: { main: 1 },
        requestFingerprint: createHash("sha256").update(JSON.stringify(body)).digest("hex"),
        effectiveChangedSections: ["draft", "parties"], documentContentChangedSections: ["draft", "parties"] };
      return { status: 200, body: change ? change("SAVE", result) : result };
    }
  };
  return { port, calls, expiresAt };
}

const opened = { status: "DRAFT_ADMISSION_PROTOCOL_MATCHED" as const, projectId, contractId, versionId, leaseRevision: 1 } as const;

it("uses one original DTO save, preserves the empty bill, tax and payment and rereads generation coordinates", async () => {
  const f = application();
  const result = await saveTask12GeneratedDocumentDraft(opened, handlerId, publishedTemplate(), f.port);
  expect(f.calls).toEqual(["BEFORE", "SAVE", "AFTER"]);
  expect(result).toEqual({
    status: "DRAFT_DOCUMENT_SAVE_READBACK_MATCHED", projectId, contractId, versionId, layoutId, sourceRevision: 2,
    documentContentRevision: 2, documentContentFingerprint: contentFingerprint, leaseRevision: 1, leaseExpiresAt: f.expiresAt, fields
  });
});

it.each([
  ["BEFORE", { bills: [] }],
  ["BEFORE", { parties: [{ roleKey: "party_a" }] }],
  ["BEFORE", { paymentTerms: { originalText: "有既有付款资料", stages: [] } }],
  ["BEFORE", { lease: { state: "held_by_me", expiresAt: "2000-01-01T00:00:00.000Z" } }],
  ["SAVE", { requestFingerprint: "e".repeat(64) }],
  ["SAVE", { effectiveChangedSections: ["draft", "parties", "bills"] }],
  ["AFTER", { lease: { state: "held_by_me", expiresAt: new Date(Date.now() + 110_000).toISOString() } }]
] as const)("stops at %s if the fixed facts differ", async (phase, mutation) => {
  const f = application((at, row) => at === phase ? { ...row, ...mutation } : row);
  await expect(saveTask12GeneratedDocumentDraft(opened, handlerId, publishedTemplate(), f.port))
    .rejects.toMatchObject({ code: "TASK12_GENERATED_DOCUMENT_DRAFT_SAVE_" + phase });
  expect(f.calls.at(-1)).toBe(phase);
  expect(f.calls.filter(step => step === "SAVE")).toHaveLength(phase === "BEFORE" ? 0 : 1);
});

it("rejects changed content coordinates or the wrong published layout on independent workbench readback", async () => {
  for (const change of [{ documentContentFingerprint: "c".repeat(64) }, { layoutTemplateVersionId: id(11) }]) {
    const f = application((at, row) => at === "AFTER" ? { ...row, version: { ...row.version as object, ...change } } : row);
    await expect(saveTask12GeneratedDocumentDraft(opened, handlerId, publishedTemplate(), f.port))
      .rejects.toMatchObject({ code: "TASK12_GENERATED_DOCUMENT_DRAFT_SAVE_AFTER" });
    expect(f.calls).toEqual(["BEFORE", "SAVE", "AFTER"]);
  }
});

it("rejects a copied layout proof before touching the workbench", async () => {
  const f = application();
  await expect(saveTask12GeneratedDocumentDraft(opened, handlerId, { ...publishedTemplate() }, f.port))
    .rejects.toMatchObject({ code: "TASK12_GENERATED_DOCUMENT_DRAFT_SAVE_INPUT" });
  expect(f.calls).toEqual([]);
});

it("preserves the fixed error and never retries a rejected PUT", async () => {
  const f = application();
  await expect(saveTask12GeneratedDocumentDraft(opened, handlerId, publishedTemplate(), {
    ...f.port, async saveDraft() {
      f.calls.push("SAVE");
      return { status: 409, body: { debug: "private response" } };
    }
  })).rejects.toThrow("TASK12_GENERATED_DOCUMENT_DRAFT_SAVE_SAVE");
  expect(f.calls).toEqual(["BEFORE", "SAVE"]);
});
