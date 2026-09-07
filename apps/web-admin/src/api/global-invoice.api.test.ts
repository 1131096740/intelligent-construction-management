import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./api-fetch", () => ({ apiFetch: vi.fn() }));
import { apiFetch } from "./api-fetch";
import {
  allocateGlobalInvoice,
  createGlobalInvoice,
  createRedGlobalInvoice,
  createReissueGlobalInvoice,
  fetchGlobalInvoiceEvidenceRepairImpacts,
  fetchGlobalInvoices,
  resolveGlobalInvoiceEvidenceRepairImpact,
  reverseGlobalInvoiceAllocation,
  voidGlobalInvoice
} from "./global-invoice.api";

const mockApiFetch = vi.mocked(apiFetch);
const response = (body: unknown) => new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });

describe("global invoice API", () => {
  beforeEach(() => { mockApiFetch.mockReset(); });

  it("uses only append-oriented global invoice and allocation commands", async () => {
    mockApiFetch.mockImplementation(() => Promise.resolve(response({ id: "command-1", replayed: false })));
    await createGlobalInvoice({ idempotencyKey: "create" });
    await allocateGlobalInvoice({ idempotencyKey: "allocate" });
    await reverseGlobalInvoiceAllocation("allocation-1", { idempotencyKey: "reverse" });
    await voidGlobalInvoice("invoice-1", { idempotencyKey: "void" });
    await createRedGlobalInvoice({ idempotencyKey: "red" });
    await createReissueGlobalInvoice({ idempotencyKey: "reissue" });
    expect(mockApiFetch).toHaveBeenNthCalledWith(1, "/global-invoices", expect.objectContaining({ method: "POST" }));
    expect(mockApiFetch).toHaveBeenNthCalledWith(2, "/invoice-clearing-allocations", expect.objectContaining({ method: "POST" }));
    expect(mockApiFetch).toHaveBeenNthCalledWith(3, "/invoice-clearing-allocations/allocation-1/reversal", expect.objectContaining({ method: "POST" }));
    expect(mockApiFetch).toHaveBeenNthCalledWith(4, "/global-invoices/invoice-1/void", expect.objectContaining({ method: "POST" }));
    expect(mockApiFetch).toHaveBeenNthCalledWith(5, "/global-invoices/red", expect.objectContaining({ method: "POST" }));
    expect(mockApiFetch).toHaveBeenNthCalledWith(6, "/global-invoices/reissue", expect.objectContaining({ method: "POST" }));
  });

  it("loads selectable global invoice business records through the protected read API", async () => {
    mockApiFetch.mockImplementation(() => Promise.resolve(response([])));
    await fetchGlobalInvoices();
    expect(mockApiFetch).toHaveBeenCalledWith("/global-invoices");
  });

  it("loads evidence-repair state and posts an explicit revision-bound confirmation", async () => {
    mockApiFetch.mockImplementation(() => Promise.resolve(response({ id: "resolution-1", replayed: false })));
    await fetchGlobalInvoiceEvidenceRepairImpacts();
    await resolveGlobalInvoiceEvidenceRepairImpact("impact-1", {
      replacementInvoiceRecordId: "replacement-invoice-1",
      replacementFileId: "replacement-file-1",
      reasonCode: "replacement_invoice_verified",
      expectedRevision: 3,
      idempotencyKey: "00000000-0000-4000-8000-000000000001",
      confirmRepair: true
    });

    expect(mockApiFetch).toHaveBeenNthCalledWith(1, "/invoice-evidence-repair-impacts");
    expect(mockApiFetch).toHaveBeenNthCalledWith(
      2,
      "/invoice-evidence-repair-impacts/impact-1/resolution",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"confirmRepair":true')
      })
    );
  });
});
