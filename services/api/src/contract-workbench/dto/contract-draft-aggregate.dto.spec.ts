import { createApiValidationPipe } from "../../validation/api-validation";
import { SaveContractDraftAggregateDto } from "./contract-workbench.dto";

const bodyMetadata = {
  type: "body" as const,
  metatype: SaveContractDraftAggregateDto
};

function validPayload() {
  return {
    idempotencyKey: "7ea6e68d-18cd-4ca7-83b8-99e7d1457125",
    saveKind: "manual",
    expectedRevision: 7,
    changedSections: [
      "draft",
      "parties",
      "bills",
      "payment_terms",
      "attachments",
      "negotiation_documents"
    ],
    draft: {
      companyEntityId: "company-version-1",
      draftData: { fieldValues: { name: "测试合同" } },
      clauses: [
        {
          key: "payment",
          title: "付款条款",
          numberingMode: "automatic",
          required: true,
          content: { type: "doc", content: [] }
        }
      ],
      pricingNature: "fixed_total",
      amountSource: "manual",
      manualAmountCents: "75000000",
      layoutTemplateVersionId: "layout-version-1",
      taxFacts: {
        invoiceType: "vat_special",
        taxMode: "single_rate",
        defaultTaxRatePercent: "9",
        source: "contract_document"
      }
    },
    parties: [
      {
        roleKey: "party_a",
        displayOrder: 0,
        businessPartyVersionId: "party-version-1",
        snapshot: { name: "甲方" }
      }
    ],
    bills: [
      {
        billKey: "main",
        expectedRevision: 2,
        rows: [
          {
            clientRowKey: "client-row-1",
            rowKey: "row-1",
            sortOrder: 0,
            itemName: "混凝土",
            unit: "m³",
            quantity: "2000",
            unitPrice: "375",
            taxRatePercent: "9",
            taxRateSource: "version_default",
            isProvisional: false,
            customData: {}
          }
        ]
      }
    ],
    paymentTerms: {
      originalText: "结算生效后 30 天付款。",
      stages: [
        {
          name: "进度款",
          basis: "current_settlement",
          ratioBps: 8000,
          triggerEvent: "结算生效",
          dueDays: 30,
          requiresInvoice: true,
          allowsEarlyPayment: false,
          allowsInstallments: true,
          originalText: "结算生效后 30 天付款。"
        }
      ]
    },
    attachments: [
      { slotKey: "supporting", fileId: "file-1", displayOrder: 0 }
    ],
    negotiationDocuments: {
      selectedNegotiationRoundId: "round-1",
      selectedOfflineRevisionId: "offline-revision-1",
      referencedGeneratedDocumentIds: ["generated-document-1"]
    }
  };
}

async function validate(value: unknown) {
  return createApiValidationPipe().transform(value, bodyMetadata);
}

describe("SaveContractDraftAggregateDto", () => {
  it("accepts a complete aggregate snapshot", async () => {
    await expect(validate(validPayload())).resolves.toBeInstanceOf(
      SaveContractDraftAggregateDto
    );
  });

  it.each([
    ["non-integer revision", { expectedRevision: 7.1 }],
    ["invalid idempotency key", { idempotencyKey: "retry-key" }],
    ["invalid save kind", { saveKind: "background" }],
    ["empty changed sections", { changedSections: [] }],
    ["duplicate changed sections", { changedSections: ["draft", "draft"] }]
  ])("rejects %s", async (_label, override) => {
    await expect(validate({ ...validPayload(), ...override })).rejects.toBeTruthy();
  });

  it("rejects duplicate party, bill, row and attachment positions", async () => {
    const duplicateParty = validPayload();
    duplicateParty.parties.push({
      ...duplicateParty.parties[0],
      displayOrder: 1
    });
    await expect(validate(duplicateParty)).rejects.toBeTruthy();

    const duplicateBill = validPayload();
    duplicateBill.bills.push({ ...duplicateBill.bills[0] });
    await expect(validate(duplicateBill)).rejects.toBeTruthy();

    const duplicateRow = validPayload();
    duplicateRow.bills[0].rows.push({ ...duplicateRow.bills[0].rows[0] });
    await expect(validate(duplicateRow)).rejects.toBeTruthy();

    const duplicateAttachment = validPayload();
    duplicateAttachment.attachments.push({
      ...duplicateAttachment.attachments[0]
    });
    await expect(validate(duplicateAttachment)).rejects.toBeTruthy();
  });

  it("rejects non-integer money text and an empty attachment file id", async () => {
    const money = validPayload();
    money.draft.manualAmountCents = "750000.50";
    await expect(validate(money)).rejects.toBeTruthy();

    const attachment = validPayload();
    attachment.attachments[0].fileId = "";
    await expect(validate(attachment)).rejects.toBeTruthy();
  });

  it.each(["formalCode", "status", "amountCents"])(
    "rejects server-authoritative field %s at the request boundary",
    async (field) => {
      await expect(
        validate({ ...validPayload(), [field]: field === "status" ? "effective" : "x" })
      ).rejects.toBeTruthy();
    }
  );

  it("rejects server-authoritative fields hidden inside the draft object", async () => {
    const payload = validPayload();
    await expect(
      validate({
        ...payload,
        draft: { ...payload.draft, status: "effective", amountCents: "1" }
      })
    ).rejects.toBeTruthy();
  });
});
