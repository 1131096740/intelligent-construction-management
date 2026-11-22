import { ForbiddenException, ServiceUnavailableException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { contractTaxForNewSettlement, ContractEffectiveTaxService } from "./contract-effective-tax.service";

describe("ContractEffectiveTaxService", () => {
  const binding = { database: "db", role: "app", xid: "1", backend: "2", expires: "1700000000" };
  const oldKey = process.env.CONTRACT_SIGNED_CHANGE_SUBMIT_WITNESS_KEY;
  beforeEach(() => { process.env.CONTRACT_SIGNED_CHANGE_SUBMIT_WITNESS_KEY = "a".repeat(64); });
  afterEach(() => {
    if (oldKey === undefined) delete process.env.CONTRACT_SIGNED_CHANGE_SUBMIT_WITNESS_KEY;
    else process.env.CONTRACT_SIGNED_CHANGE_SUBMIT_WITNESS_KEY = oldKey;
  });
  function fixture({ director = false, existing = false }: { director?: boolean; existing?: boolean } = {}) {
    const version = {
      id: "effective", contractId: "contract", taxMode: null, taxFactRevision: 1, invoiceType: existing ? "vat_general" : null,
      defaultTaxRatePercent: existing ? new Prisma.Decimal("6") : null
    };
    const revision = {
      id: "review", kind: "correction", status: "pending_contract_confirmation",
      beforeSnapshot: { invoiceType: "vat_general", taxRate: "6" },
      invoiceType: "vat_special", defaultTaxRatePercent: new Prisma.Decimal("6"),
      createdByUserId: "staff"
    };
    const tx = {
      $queryRaw: jest.fn(),
      contract: { findUnique: jest.fn().mockResolvedValue({ projectId: "project" }) },
      project: { findUnique: jest.fn().mockResolvedValue({ isActive: true }) },
      user: { findUnique: jest.fn().mockResolvedValue({ isActive: true }) },
      position: { findUnique: jest.fn().mockResolvedValue({ id: "director-role" }) },
      userPosition: { findFirst: jest.fn().mockResolvedValue(director ? { id: "assignment" } : null) },
      projectMember: { findFirst: jest.fn().mockResolvedValue({ id: "membership" }) },
      contractVersion: { findUnique: jest.fn().mockResolvedValue(version), findFirst: jest.fn().mockResolvedValue(version) },
      contractTakeover: { findFirst: jest.fn().mockResolvedValue(null) },
      contractTaxFactRevision: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([revision]),
        create: jest.fn().mockImplementation(({ data }) => ({ id: "new", status: data.status })),
        update: jest.fn()
      }
    };
    const service = new ContractEffectiveTaxService({
      $transaction: jest.fn().mockImplementation(callback => callback(tx))
    } as never, {} as never);
    return { tx, service, revision };
  }

  it("stops tax backfill before writing when the dedicated witness is unavailable", async () => {
    const { tx, service } = fixture();
    const oldKey = process.env.CONTRACT_SIGNED_CHANGE_SUBMIT_WITNESS_KEY;
    delete process.env.CONTRACT_SIGNED_CHANGE_SUBMIT_WITNESS_KEY;
    try {
      await expect(service.submit("effective", "staff", { taxRate: "6", explanation: "合同原件" }))
        .rejects.toBeInstanceOf(ServiceUnavailableException);
    } finally {
      if (oldKey !== undefined) process.env.CONTRACT_SIGNED_CHANGE_SUBMIT_WITNESS_KEY = oldKey;
    }
    expect(tx.contractTaxFactRevision.create).not.toHaveBeenCalled();
  });

  it("passes an empty-field supplement through the fixed write operation with the supplied precision", async () => {
    const { tx, service } = fixture();
    tx.$queryRaw.mockResolvedValueOnce([binding]).mockResolvedValueOnce([{ id: "new", status: "confirmed" }]);
    await expect(service.submit("effective", "staff", { taxRate: "1.234560", explanation: "以签署合同为准" }))
      .resolves.toMatchObject({ status: "confirmed" });
    expect(tx.$queryRaw).toHaveBeenLastCalledWith(
      expect.arrayContaining([expect.stringContaining("jg_write_ordinary_contract_tax_fact_v1")]),
      "submit", "project", "contract", "effective", "staff", null, null, "1.234560", "以签署合同为准", null, null,
      binding.expires, expect.stringMatching(/^[a-f0-9]{64}$/u)
    );
    expect(tx.contractTaxFactRevision.create).not.toHaveBeenCalled();
  });

  it("keeps filled values active and rejects staff review of a pending correction", async () => {
    const { service, tx, revision } = fixture({ existing: true });
    tx.$queryRaw.mockResolvedValueOnce([binding]).mockResolvedValueOnce([{ id: "review", status: revision.status }])
      .mockResolvedValueOnce([revision]);
    await expect(service.submit("effective", "staff", { invoiceType: "vat_special", explanation: "核对后确认录入错误" }))
      .resolves.toMatchObject({ status: "pending_contract_confirmation" });
    await expect(service.list("effective", "staff")).resolves.toMatchObject({
      current: { invoiceType: "vat_general", taxRate: "6" }
    });
    await expect(service.review("effective", "review", "staff", { decision: "approve" })).rejects.toBeInstanceOf(ForbiddenException);
    expect(tx.contractTaxFactRevision.update).not.toHaveBeenCalled();
  });

  it("lets the current supervisor send a matching correction to the fixed operation", async () => {
    const { service, tx, revision } = fixture({ director: true, existing: true });
    tx.$queryRaw.mockResolvedValueOnce([revision]).mockResolvedValueOnce([binding])
      .mockResolvedValueOnce([{ id: "review", status: "confirmed" }]);
    await expect(service.review("effective", "review", "director", { decision: "approve" })).resolves.toMatchObject({ status: "confirmed" });
    expect(tx.$queryRaw).toHaveBeenLastCalledWith(expect.arrayContaining([expect.stringContaining("jg_write_ordinary_contract_tax_fact_v1")]),
      "approve", "project", "contract", "effective", "director", "review", null, null, null, null, null,
      binding.expires, expect.stringMatching(/^[a-f0-9]{64}$/u));
    expect(tx.contractTaxFactRevision.update).not.toHaveBeenCalled();
  });

  it("passes only confirmed ordinary tax into future settlement snapshots without mutating the frozen version", async () => {
    const { tx } = fixture();
    const base = {
      id: "effective", contractId: "contract", invoiceType: null, defaultTaxRatePercent: null, taxFactStatus: "missing", taxFactRevision: 1
    };
    tx.$queryRaw.mockResolvedValueOnce([
      { invoiceType: "vat_special", defaultTaxRatePercent: new Prisma.Decimal("6.123456"), revisionNo: 2 }
    ]);
    await expect(contractTaxForNewSettlement(tx as never, base)).resolves.toMatchObject({
      invoiceType: "vat_special", taxFactStatus: "confirmed", taxFactRevision: 2
    });
    expect(tx.$queryRaw).toHaveBeenCalledWith(expect.objectContaining({
      strings: expect.arrayContaining([expect.stringContaining("jg_read_ordinary_contract_tax_fact_v1")]),
      values: ["effective", "contract", null]
    }));
    expect(base).toMatchObject({ invoiceType: null, taxFactRevision: 1 });
  });
});
