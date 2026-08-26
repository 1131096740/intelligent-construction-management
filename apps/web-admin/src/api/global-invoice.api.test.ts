import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./api-fetch", () => ({ apiFetch: vi.fn() }));
import { apiFetch } from "./api-fetch";
import { allocateGlobalInvoice, createGlobalInvoice, createRedGlobalInvoice, createReissueGlobalInvoice, reverseGlobalInvoiceAllocation, voidGlobalInvoice } from "./global-invoice.api";

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
});
