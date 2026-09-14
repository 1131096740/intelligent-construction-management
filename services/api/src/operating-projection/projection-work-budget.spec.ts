import { Prisma } from "@prisma/client";
import { preflightProjectionWork } from "./projection-work-budget";
import { ProjectionResourceBudgetExceededError } from "./operating-projection.reducer";

describe("projection request work budget", () => {
  it.each([
    [20_000n, 100_000n, 67_108_864n, 40_000n, false],
    [20_001n, 1n, 1n, 0n, true],
    [1n, 100_001n, 1n, 0n, true],
    [1n, 1n, 67_108_865n, 0n, true],
    [1n, 1n, 1n, 40_001n, true]
  ])("enforces the inclusive rows and bytes boundary %s/%s/%s", async (
    workFactCount, workImpactCount, workBytes, targetCount, rejected
  ) => {
    const tx = { $queryRaw: jest.fn().mockResolvedValue([{ workFactCount, workImpactCount, workBytes, targetCount }]) };
    const result = preflightProjectionWork(tx as never, ["p"], new Date(), new Date(), Prisma.sql`TRUE`);
    if (rejected) await expect(result).rejects.toBeInstanceOf(ProjectionResourceBudgetExceededError);
    else await expect(result).resolves.toBeUndefined();
  });
  it("fails closed on missing database evidence", async () => {
    await expect(preflightProjectionWork({ $queryRaw: jest.fn().mockResolvedValue([{}]) } as never,
      ["p"], new Date(), new Date(), Prisma.sql`TRUE`)).rejects.toBeInstanceOf(ProjectionResourceBudgetExceededError);
  });
});
