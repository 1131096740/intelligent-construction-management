import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addBillRow,
  addContractParty,
  applyBillExcelImport,
  createBusinessParty,
  createContractNumberRule,
  createDraftCheckpoint,
  createWorkbenchDraft,
  downloadBillExcelTemplate,
  fetchContractWorkbench,
  listBusinessParties,
  listContractDocuments,
  listContractDrafts,
  listContractNumberRules,
  listPublishedContractTemplates,
  listPublishedLayoutTemplates,
  previewBillExcelImport,
  previewContractTypeChange,
  queueContractDocument,
  restoreDraftCheckpoint,
  saveContractDraft,
  transferContractDraft,
  updateBillRow,
  voidContractDraft
} from "./contract-workbench.api";

vi.mock("./api-fetch", () => ({
  apiFetch: vi.fn()
}));

import { apiFetch } from "./api-fetch";
const mockApiFetch = vi.mocked(apiFetch);

function makeOkJson(data: unknown) {
  return Promise.resolve(
    new Response(JSON.stringify(data), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    })
  );
}

function makeOkBlob(content: string, contentType: string, disposition: string) {
  return Promise.resolve(
    new Response(content, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": disposition
      }
    })
  );
}

describe("contract workbench API client", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("createWorkbenchDraft – POST /contracts with workbench body", async () => {
    mockApiFetch.mockReturnValue(makeOkJson({ id: "contract-1", versionId: "version-1" }));

    await createWorkbenchDraft({
      projectId: "project-1",
      contractTypeKey: "material_purchase",
      businessTemplateVersionId: "template-version-1"
    });

    expect(mockApiFetch).toHaveBeenCalledWith("/contracts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: "project-1",
        contractTypeKey: "material_purchase",
        businessTemplateVersionId: "template-version-1"
      })
    });
  });

  it("fetchContractWorkbench – GET /contract-workbench/:contractId", async () => {
    mockApiFetch.mockReturnValue(makeOkJson({ id: "contract-1" }));

    await fetchContractWorkbench("contract-1");

    expect(mockApiFetch).toHaveBeenCalledWith("/contract-workbench/contract-1");
  });

  it("listContractDrafts('my') – GET /contract-workbench?scope=my", async () => {
    mockApiFetch.mockReturnValue(makeOkJson([]));

    await listContractDrafts("my");

    expect(mockApiFetch).toHaveBeenCalledWith("/contract-workbench?scope=my");
  });

  it("listContractDrafts('voided') – GET /contract-workbench?scope=voided", async () => {
    mockApiFetch.mockReturnValue(makeOkJson([]));

    await listContractDrafts("voided");

    expect(mockApiFetch).toHaveBeenCalledWith("/contract-workbench?scope=voided");
  });

  it("saveContractDraft – PATCH /contract-workbench/:contractVersionId (autosave must be PATCH)", async () => {
    mockApiFetch.mockReturnValue(makeOkJson({ revision: 2 }));

    await saveContractDraft("version-1", {
      expectedRevision: 1,
      draftData: { name: "钢材采购合同" },
      clauses: [],
      pricingNature: "fixed_total",
      amountSource: "manual",
      manualAmountCents: 1_000_000
    });

    const [path, options] = mockApiFetch.mock.calls[0];
    expect(path).toBe("/contract-workbench/version-1");
    expect((options as RequestInit).method).toBe("PATCH");
  });

  it("createDraftCheckpoint – POST /contract-workbench/:contractVersionId/checkpoints", async () => {
    mockApiFetch.mockReturnValue(makeOkJson({ id: "checkpoint-1" }));

    await createDraftCheckpoint("version-1", { name: "首次完整稿" });

    expect(mockApiFetch).toHaveBeenCalledWith("/contract-workbench/version-1/checkpoints", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "首次完整稿" })
    });
  });

  it("restoreDraftCheckpoint – POST /contract-workbench/:contractVersionId/checkpoints/:checkpointId/restore", async () => {
    mockApiFetch.mockReturnValue(makeOkJson({ revision: 3 }));

    await restoreDraftCheckpoint("version-1", "checkpoint-1");

    expect(mockApiFetch).toHaveBeenCalledWith(
      "/contract-workbench/version-1/checkpoints/checkpoint-1/restore",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({})
      }
    );
  });

  it("voidContractDraft – POST /contract-workbench/:contractId/void", async () => {
    mockApiFetch.mockReturnValue(makeOkJson({}));

    await voidContractDraft("contract-1", { reason: "重复创建" });

    expect(mockApiFetch).toHaveBeenCalledWith("/contract-workbench/contract-1/void", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: "重复创建" })
    });
  });

  it("previewContractTypeChange – POST /contract-workbench/:contractVersionId/type-change-preview", async () => {
    mockApiFetch.mockReturnValue(makeOkJson({ diff: [] }));

    await previewContractTypeChange("version-1", {
      targetBusinessTemplateVersionId: "template-version-2",
      expectedRevision: 2
    });

    expect(mockApiFetch).toHaveBeenCalledWith(
      "/contract-workbench/version-1/type-change-preview",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetBusinessTemplateVersionId: "template-version-2",
          expectedRevision: 2
        })
      }
    );
  });

  it("transferContractDraft – POST /contract-workbench/:contractId/transfer", async () => {
    mockApiFetch.mockReturnValue(makeOkJson({}));

    await transferContractDraft("contract-1", { toUserId: "contract-user-2" });

    expect(mockApiFetch).toHaveBeenCalledWith("/contract-workbench/contract-1/transfer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ toUserId: "contract-user-2" })
    });
  });

  it("listBusinessParties – GET /business-parties?query=云南", async () => {
    mockApiFetch.mockReturnValue(makeOkJson([]));

    await listBusinessParties("云南");

    expect(mockApiFetch).toHaveBeenCalledWith("/business-parties?query=%E4%BA%91%E5%8D%97");
  });

  it("createBusinessParty – POST /business-parties", async () => {
    mockApiFetch.mockReturnValue(makeOkJson({ id: "party-1" }));

    await createBusinessParty({
      name: "云南示例供应商有限公司",
      unifiedSocialCreditCode: "91530000EXAMPLE01",
      attachments: []
    });

    expect(mockApiFetch).toHaveBeenCalledWith("/business-parties", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "云南示例供应商有限公司",
        unifiedSocialCreditCode: "91530000EXAMPLE01",
        attachments: []
      })
    });
  });

  it("addContractParty – POST /contract-workbench/:contractVersionId/parties", async () => {
    mockApiFetch.mockReturnValue(makeOkJson({}));

    await addContractParty("version-1", {
      roleKey: "party_b",
      businessPartyVersionId: "party-version-1"
    });

    expect(mockApiFetch).toHaveBeenCalledWith("/contract-workbench/version-1/parties", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roleKey: "party_b", businessPartyVersionId: "party-version-1" })
    });
  });

  it("listContractNumberRules – GET /contract-number-rules", async () => {
    mockApiFetch.mockReturnValue(makeOkJson([]));

    await listContractNumberRules();

    expect(mockApiFetch).toHaveBeenCalledWith("/contract-number-rules");
  });

  it("createContractNumberRule – POST /contract-number-rules", async () => {
    mockApiFetch.mockReturnValue(makeOkJson({ id: "rule-1" }));

    await createContractNumberRule({
      name: "项目材料合同编号",
      pattern: "HT-{project}-{year}-{type}-{sequence}",
      contractTypeKey: "material_purchase",
      sequenceWidth: 3
    });

    expect(mockApiFetch).toHaveBeenCalledWith("/contract-number-rules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "项目材料合同编号",
        pattern: "HT-{project}-{year}-{type}-{sequence}",
        contractTypeKey: "material_purchase",
        sequenceWidth: 3
      })
    });
  });

  it("listPublishedContractTemplates – GET /contract-templates?contractTypeKey=material_purchase", async () => {
    mockApiFetch.mockReturnValue(makeOkJson([]));

    await listPublishedContractTemplates("material_purchase");

    expect(mockApiFetch).toHaveBeenCalledWith(
      "/contract-templates?contractTypeKey=material_purchase"
    );
  });

  it("listPublishedLayoutTemplates – GET /contract-layout-templates?contractTypeKey=material_purchase", async () => {
    mockApiFetch.mockReturnValue(makeOkJson([]));

    await listPublishedLayoutTemplates("material_purchase");

    expect(mockApiFetch).toHaveBeenCalledWith(
      "/contract-layout-templates?contractTypeKey=material_purchase"
    );
  });

  it("addBillRow – POST /contract-bills/:billId/rows", async () => {
    mockApiFetch.mockReturnValue(makeOkJson({ rowKey: "row-1" }));

    await addBillRow("bill-1", {
      expectedBillRevision: 1,
      itemName: "螺纹钢",
      unit: "吨",
      quantity: "10",
      unitPrice: "3500",
      taxRatePercent: "13",
      customData: {}
    });

    expect(mockApiFetch).toHaveBeenCalledWith("/contract-bills/bill-1/rows", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        expectedBillRevision: 1,
        itemName: "螺纹钢",
        unit: "吨",
        quantity: "10",
        unitPrice: "3500",
        taxRatePercent: "13",
        customData: {}
      })
    });
  });

  it("updateBillRow – PATCH /contract-bills/:billId/rows/:rowKey", async () => {
    mockApiFetch.mockReturnValue(makeOkJson({ rowKey: "row-1" }));

    await updateBillRow("bill-1", "row-1", {
      expectedBillRevision: 2,
      itemName: "螺纹钢",
      unit: "吨",
      quantity: "12",
      unitPrice: "3500",
      taxRatePercent: "13",
      customData: {}
    });

    const [path, options] = mockApiFetch.mock.calls[0];
    expect(path).toBe("/contract-bills/bill-1/rows/row-1");
    expect((options as RequestInit).method).toBe("PATCH");
  });

  it("downloadBillExcelTemplate – GET blob from /contract-bills/:billId/excel-template", async () => {
    // Minimal DOM stubs for a Node environment (no jsdom).
    const anchor = { href: "", download: "", click: vi.fn(), remove: vi.fn() };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const urlAny = globalThis.URL as any;
    urlAny.createObjectURL = vi.fn().mockReturnValue("blob:mock");
    urlAny.revokeObjectURL = vi.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const docAny = (globalThis as any);
    docAny.document ??= {};
    docAny.document.createElement = vi.fn().mockReturnValue(anchor);
    docAny.document.body = { appendChild: vi.fn().mockReturnValue(anchor) };

    mockApiFetch.mockReturnValue(
      makeOkBlob(
        "mock-xlsx-content",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "attachment; filename=\"template.xlsx\"; filename*=UTF-8''%E5%90%88%E5%90%8C-bill.xlsx"
      )
    );

    await downloadBillExcelTemplate("bill-1");

    expect(mockApiFetch).toHaveBeenCalledWith("/contract-bills/bill-1/excel-template");
  });

  it("previewBillExcelImport – POST JSON body (NOT FormData) to /contract-bills/:billId/excel-imports", async () => {
    mockApiFetch.mockReturnValue(makeOkJson({ importId: "import-1", rows: [] }));

    await previewBillExcelImport("bill-1", { fileId: "file-1", mode: "update" });

    const [path, options] = mockApiFetch.mock.calls[0];
    expect(path).toBe("/contract-bills/bill-1/excel-imports");
    expect((options as RequestInit).method).toBe("POST");
    // Must NOT use FormData
    expect((options as RequestInit).body).not.toBeInstanceOf(FormData);
    expect((options as RequestInit).headers).toMatchObject({ "Content-Type": "application/json" });
    expect(JSON.parse((options as RequestInit).body as string)).toEqual({
      fileId: "file-1",
      mode: "update"
    });
  });

  it("applyBillExcelImport – POST /contract-bill-imports/:importId/apply", async () => {
    mockApiFetch.mockReturnValue(makeOkJson({}));

    await applyBillExcelImport("import-1");

    expect(mockApiFetch).toHaveBeenCalledWith("/contract-bill-imports/import-1/apply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({})
    });
  });

  it("queueContractDocument – POST /contract-workbench/:contractVersionId/documents", async () => {
    mockApiFetch.mockReturnValue(makeOkJson({ documentId: "doc-1" }));

    await queueContractDocument("version-1", {
      layoutTemplateVersionId: "layout-version-1",
      purpose: "draft"
    });

    expect(mockApiFetch).toHaveBeenCalledWith("/contract-workbench/version-1/documents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        layoutTemplateVersionId: "layout-version-1",
        purpose: "draft"
      })
    });
  });

  it("listContractDocuments – GET /contract-workbench/:contractVersionId/documents", async () => {
    mockApiFetch.mockReturnValue(makeOkJson([]));

    await listContractDocuments("version-1");

    expect(mockApiFetch).toHaveBeenCalledWith("/contract-workbench/version-1/documents");
  });
});
