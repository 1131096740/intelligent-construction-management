import { BadRequestException } from "@nestjs/common";
import { ContractBillLineageService } from "./contract-bill-lineage.service";

describe("ContractBillLineageService", () => {
  function context() {
    const tx = {
      contractBillRowLineage: { create: jest.fn().mockResolvedValue({ id: "lineage-1" }) },
      contractBillRowTransition: { create: jest.fn().mockResolvedValue({ id: "transition-1" }) },
      contractBillRow: { update: jest.fn().mockResolvedValue({ id: "row-2" }) },
      settlementLine: { findFirst: jest.fn().mockResolvedValue(null) }
    };
    return { tx, service: new ContractBillLineageService() };
  }

  it("creates exactly one lineage for a new physical row", async () => {
    const current = context();
    await current.service.bindNewRow(current.tx as never, {
      contractId: "contract-1", contractVersionId: "version-1", contractBillRowId: "row-1", actorUserId: "user-1"
    });
    expect(current.tx.contractBillRowLineage.create).toHaveBeenCalledTimes(1);
    expect(current.tx.contractBillRow.update).toHaveBeenCalledWith({
      where: { id: "row-1" }, data: { lineageId: "lineage-1" }
    });
  });

  it("inherits only a same-unit source lineage and records the one-to-one transition", async () => {
    const current = context();
    await current.service.cloneOneToOne(current.tx as never, {
      contractId: "contract-1", fromContractVersionId: "version-1", toContractVersionId: "version-2",
      source: { id: "row-1", unit: "m", lineageId: "lineage-1" },
      target: { id: "row-2", unit: "m" }, actorUserId: "director-1"
    });
    expect(current.tx.contractBillRowTransition.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ relationType: "one_to_one", matchBasis: "clone_row_key", status: "confirmed" })
    }));
  });

  it("does not infer a cross-unit one-to-one mapping", async () => {
    const current = context();
    await current.service.cloneOneToOne(current.tx as never, {
      contractId: "contract-1", fromContractVersionId: "version-1", toContractVersionId: "version-2",
      source: { id: "row-1", unit: "m", lineageId: "lineage-1" },
      target: { id: "row-2", unit: "㎡" }, actorUserId: "director-1"
    });
    expect(current.tx.contractBillRowTransition.create).not.toHaveBeenCalled();
    expect(current.tx.contractBillRowLineage.create).toHaveBeenCalledTimes(1);
  });

  it("blocks ordinary deletion for an occupied formal settlement source", async () => {
    const current = context();
    current.tx.settlementLine.findFirst.mockResolvedValue({ contractBillRowId: "row-1" });
    await expect(current.service.assertRowsDeletable(current.tx as never, ["row-1"])).rejects.toBeInstanceOf(BadRequestException);
  });
});
