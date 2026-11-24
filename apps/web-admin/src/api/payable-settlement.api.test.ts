import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./api-fetch", () => ({ apiFetch: vi.fn() }));

import { apiFetch } from "./api-fetch";
import {
  fetchInterEntityRelationships,
  fetchPayableSettlementCapabilities,
  fetchPayableSettlementWorkbench,
  uploadInterEntityRelationshipEvidence,
  returnInterEntityRelationship,
  fetchWagePayableCases
} from "./payable-settlement.api";

const mockApiFetch = vi.mocked(apiFetch);

describe("payable settlement API", () => {
  beforeEach(() => {
    mockApiFetch.mockReset();
    mockApiFetch.mockImplementation(async () =>
      new Response(JSON.stringify({}), { status: 200 })
    );
  });

  it("reads historical wage cases and workbench records", async () => {
    await fetchPayableSettlementCapabilities();
    await fetchPayableSettlementWorkbench();
    await fetchWagePayableCases();

    expect(mockApiFetch).toHaveBeenNthCalledWith(1, "/payable-settlements/capabilities");
    expect(mockApiFetch).toHaveBeenNthCalledWith(
      2,
      "/payable-settlements/workbench"
    );
    expect(mockApiFetch).toHaveBeenNthCalledWith(
      3,
      "/payable-settlements/wage-payable-cases"
    );
  });

  it("reads and returns the explicit cross-entity relationship without a payment UUID", async () => {
    await fetchInterEntityRelationships();
    const input = {
      amountCents: "3000",
      evidenceFileId: "file-return-evidence",
      evidenceClaimId: "claim-return-evidence",
      reason: "跨主体代付部分归还",
      idempotencyKey: "00000000-0000-4000-8000-000000000033"
    };
    await returnInterEntityRelationship("relationship / 1", input);

    expect(mockApiFetch).toHaveBeenNthCalledWith(
      1,
      "/payable-settlements/inter-entity-relationships"
    );
    expect(mockApiFetch).toHaveBeenNthCalledWith(
      2,
      "/payable-settlements/inter-entity-relationships/relationship%20%2F%201/returns",
      expect.objectContaining({ method: "POST", body: JSON.stringify(input) })
    );
    expect(JSON.stringify(input)).not.toContain("paymentExecutionId");
  });

  it("uploads relationship evidence through the finance-only domain route", async () => {
    const file = new Blob(["evidence"], { type: "text/plain" });
    await uploadInterEntityRelationshipEvidence(
      "relationship / 1",
      file,
      "return.txt",
      "00000000-0000-4000-8000-000000000034"
    );

    expect(mockApiFetch).toHaveBeenCalledWith(
      "/payable-settlements/inter-entity-relationships/relationship%20%2F%201/evidence",
      expect.objectContaining({ method: "POST", body: expect.any(FormData) })
    );
  });
});
