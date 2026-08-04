import { ConflictException } from "@nestjs/common";
import { ContractSettlementProcessService } from "./contract-settlement-process.service";

describe("ContractSettlementProcessService", () => {
  const input = {
    contractId: "contract-1",
    contractVersionId: "version-1",
    contractEffectiveAt: new Date("2026-07-01T12:00:00.000Z"),
    isFinal: false,
    periodEnd: "2026-07-31"
  };

  function context(overrides: {
    open?: { id: string; sequenceNo: number } | null;
    latest?: { sequenceNo: number } | null;
    previousPeriodEnd?: Date | null;
    createError?: unknown;
  } = {}) {
    const process = {
      findFirst: jest.fn()
        .mockResolvedValueOnce(overrides.open ?? null)
        .mockResolvedValueOnce(overrides.latest ?? null),
      create: jest.fn().mockImplementation(async ({ data }) => {
        if (overrides.createError) throw overrides.createError;
        return { id: "process-1", ...data };
      }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 })
    };
    const settlement = {
      findFirst: jest.fn().mockResolvedValue(
        overrides.previousPeriodEnd ? { periodEnd: overrides.previousPeriodEnd } : null
      )
    };
    return {
      tx: { contractSettlementProcess: process, settlement },
      process,
      settlement,
      service: new ContractSettlementProcessService()
    };
  }

  it("starts the first structured period at the contract effective date", async () => {
    const current = context();
    await current.service.createOpen(current.tx as never, input);

    expect(current.process.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        sequenceNo: 1,
        periodStart: new Date("2026-07-01T00:00:00.000Z"),
        periodEnd: new Date("2026-07-31T00:00:00.000Z")
      })
    }));
  });

  it("starts the next structured period on the day after the last effective period", async () => {
    const current = context({
      latest: { sequenceNo: 2 },
      previousPeriodEnd: new Date("2026-07-15T00:00:00.000Z")
    });
    await current.service.createOpen(current.tx as never, input);

    expect(current.process.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        sequenceNo: 3,
        periodStart: new Date("2026-07-16T00:00:00.000Z")
      })
    }));
  });

  it("keeps the existing open process as the single continuation target", async () => {
    const current = context({ open: { id: "process-2", sequenceNo: 2 } });
    await expect(current.service.createOpen(current.tx as never, input)).rejects.toBeInstanceOf(
      ConflictException
    );
    expect(current.process.create).not.toHaveBeenCalled();
  });

  it("maps the partial-unique race winner to the same user-facing conflict", async () => {
    const current = context({ createError: { code: "P2002" } });
    await expect(current.service.createOpen(current.tx as never, input)).rejects.toBeInstanceOf(
      ConflictException
    );
  });

  it("ends the process when the linked settlement becomes effective", async () => {
    const current = context();

    await current.service.completeSettlement(
      current.tx as never,
      "process-1",
      "settlement-1",
      "user-contract-director"
    );

    expect(current.process.updateMany).toHaveBeenCalledWith({
      where: {
        id: "process-1",
        status: "open",
        settlementId: "settlement-1"
      },
      data: {
        status: "effective",
        endedAt: expect.any(Date),
        endedByUserId: "user-contract-director",
        endedReason: "结算归档确认生效"
      }
    });
  });
});
