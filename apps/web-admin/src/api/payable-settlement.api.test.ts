import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./api-fetch", () => ({ apiFetch: vi.fn() }));

import { apiFetch } from "./api-fetch";
import {
  allocatePayableSettlement,
  confirmPayableSettlement,
  fetchPaymentExecutionCandidates,
  fetchInterEntityRelationships,
  fetchPayableSettlementCapabilities,
  fetchPayableSettlementWorkbench,
  uploadInterEntityRelationshipEvidence,
  returnInterEntityRelationship,
  fetchWagePayableCases,
  returnPayableSettlement,
  submitPayableSettlement
} from "./payable-settlement.api";

const mockApiFetch = vi.mocked(apiFetch);

describe("payable settlement API", () => {
  beforeEach(() => {
    mockApiFetch.mockReset();
    mockApiFetch.mockImplementation(async () =>
      new Response(JSON.stringify({}), { status: 200 })
    );
  });

  it("reads only the controlled opaque candidate projection", async () => {
    await fetchPayableSettlementCapabilities();
    await fetchPayableSettlementWorkbench();
    await fetchWagePayableCases();
    await fetchPaymentExecutionCandidates("wage / payable");

    expect(mockApiFetch).toHaveBeenNthCalledWith(1, "/payable-settlements/capabilities");
    expect(mockApiFetch).toHaveBeenNthCalledWith(
      2,
      "/payable-settlements/workbench"
    );
    expect(mockApiFetch).toHaveBeenNthCalledWith(
      3,
      "/payable-settlements/wage-payable-cases"
    );
    expect(mockApiFetch).toHaveBeenNthCalledWith(
      4,
      "/payable-settlements/wage-payable-cases/wage%20%2F%20payable/payment-execution-candidates"
    );
  });

  it("submits only selectionRef, expiry, amount, case revision and idempotency for allocation", async () => {
    const input = {
      selectionRef: "pes1.opaque",
      selectionExpiresAt: "2026-08-27T18:08:00.000Z",
      amountCents: "4000",
      expectedCaseRevision: 3,
      idempotencyKey: "00000000-0000-4000-8000-000000000031"
    };
    await allocatePayableSettlement("payable-1", input);

    expect(mockApiFetch).toHaveBeenCalledWith(
      "/payable-settlements/wage-payable-cases/payable-1/allocations",
      expect.objectContaining({ method: "POST", body: JSON.stringify(input) })
    );
    expect(JSON.stringify(input)).not.toContain("paymentExecutionId");
  });

  it("uses revision-bound lifecycle commands for the real workbench", async () => {
    const input = {
      expectedRevision: 2,
      idempotencyKey: "00000000-0000-4000-8000-000000000032"
    };
    await submitPayableSettlement("case / 1", input);
    await confirmPayableSettlement("case / 1", input);
    await returnPayableSettlement("case / 1", input);

    expect(mockApiFetch.mock.calls.map(([path]) => path)).toEqual([
      "/payable-settlements/case%20%2F%201/submit",
      "/payable-settlements/case%20%2F%201/confirm",
      "/payable-settlements/case%20%2F%201/return"
    ]);
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
