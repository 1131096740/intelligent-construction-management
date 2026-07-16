import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  confirmContractTaxFactRevision,
  createContractTaxFactRevision,
  fetchContractTaxFactRevisions,
  reviewContractTaxFactRevisionByFinance,
  submitContractTaxFactRevisionForFinanceReview,
  updateContractTaxFactRevision
} from "./contract-tax-facts.api";

vi.mock("./api-fetch", () => ({ apiFetch: vi.fn() }));
import { apiFetch } from "./api-fetch";

const mockApiFetch = vi.mocked(apiFetch);

describe("contract tax facts API", () => {
  beforeEach(() => {
    mockApiFetch.mockReset();
    mockApiFetch.mockImplementation(async () =>
      new Response(JSON.stringify({ id: "revision-1" }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    );
  });

  it("uses encoded takeover revision resources and the exact workflow endpoints", async () => {
    const draft = {
      kind: "supplement" as const,
      invoiceType: "vat_special" as const,
      taxMode: "single_rate" as const,
      defaultTaxRatePercent: "13",
      source: "contract_document" as const,
      confirmationExplanation: "按原合同签署页核对",
      evidenceFileId: "file-1",
      rowFacts: []
    };

    await fetchContractTaxFactRevisions("project/1", "takeover/1");
    await createContractTaxFactRevision("project/1", "takeover/1", draft);
    await updateContractTaxFactRevision("project/1", "takeover/1", "revision/1", draft);
    await submitContractTaxFactRevisionForFinanceReview(
      "project/1",
      "takeover/1",
      "revision/1"
    );
    await reviewContractTaxFactRevisionByFinance(
      "project/1",
      "takeover/1",
      "revision/1",
      { decision: "approve", comment: "财务已核对税率依据" }
    );
    await confirmContractTaxFactRevision(
      "project/1",
      "takeover/1",
      "revision/1",
      { decision: "reject", comment: "请补充合同签署页说明" }
    );

    expect(mockApiFetch.mock.calls.map(([path]) => path)).toEqual([
      "/projects/project%2F1/contract-takeovers/takeover%2F1/tax-fact-revisions",
      "/projects/project%2F1/contract-takeovers/takeover%2F1/tax-fact-revisions",
      "/projects/project%2F1/contract-takeovers/takeover%2F1/tax-fact-revisions/revision%2F1",
      "/projects/project%2F1/contract-takeovers/takeover%2F1/tax-fact-revisions/revision%2F1/finance-review-submission",
      "/projects/project%2F1/contract-takeovers/takeover%2F1/tax-fact-revisions/revision%2F1/finance-review",
      "/projects/project%2F1/contract-takeovers/takeover%2F1/tax-fact-revisions/revision%2F1/contract-confirmation"
    ]);
    expect(mockApiFetch.mock.calls.map(([, init]) => init?.method)).toEqual([
      undefined,
      "POST",
      "PATCH",
      "POST",
      "POST",
      "POST"
    ]);
    expect(mockApiFetch.mock.calls[1]?.[1]?.body).toBe(JSON.stringify(draft));
    expect(mockApiFetch.mock.calls[4]?.[1]?.body).toBe(
      JSON.stringify({ decision: "approve", comment: "财务已核对税率依据" })
    );
  });

  it("surfaces the backend business message instead of hiding the next step", async () => {
    mockApiFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ message: "当前合同已有进行中的税务事实补录或更正" }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      })
    );

    await expect(
      createContractTaxFactRevision("project-1", "takeover-1", {
        kind: "supplement",
        taxMode: "single_rate"
      })
    ).rejects.toThrow("当前合同已有进行中的税务事实补录或更正");
  });

  it("keeps current bill row identifiers in the revision read model", async () => {
    mockApiFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          contractId: "contract-1",
          current: {
            invoiceType: null,
            taxMode: "single_rate",
            defaultTaxRatePercent: null,
            status: "unconfirmed",
            source: null,
            confirmationExplanation: null,
            evidenceFileId: null,
            revision: 0
          },
          rows: [
            {
              contractBillRowId: "row-1",
              billName: "材料清单",
              rowKey: "ROW-1",
              itemName: "钢筋",
              specification: "HRB400",
              unit: "吨",
              taxInclusiveUnitPrice: null,
              taxRatePercent: null,
              taxRateSource: "version_default",
              pricingFactStatus: "unconfirmed"
            }
          ],
          revisions: []
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const result = await fetchContractTaxFactRevisions("project-1", "takeover-1");
    expect(result.rows[0]).toEqual(
      expect.objectContaining({
        contractBillRowId: "row-1",
        itemName: "钢筋",
        taxInclusiveUnitPrice: null
      })
    );
    expect(result.contractId).toBe("contract-1");
  });
});
