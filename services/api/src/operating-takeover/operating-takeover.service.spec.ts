import { OperatingTakeoverService } from "./operating-takeover.service";

describe("OperatingTakeoverService", () => {
  it("precheck is read-only and rejects no valid historical expense row", async () => {
    const prisma = {
      project: { findUnique: jest.fn().mockResolvedValue({ id: "project-1", operatingLedgerEffectiveDate: new Date("2026-08-16T00:00:00.000Z") }) },
      operatingTakeoverRow: { findMany: jest.fn().mockResolvedValue([]) }
    };
    const visibility = { effectiveRoleKeys: jest.fn().mockResolvedValue(["finance_staff"]) };
    const definitions = { validateDraft: jest.fn().mockResolvedValue({ valid: true, definitionVersion: 1, errors: [] }) };
    const service = new OperatingTakeoverService(
      prisma as never,
      definitions as never,
      visibility as never,
      {} as never,
      {} as never,
      {} as never
    );

    const result = await service.precheck("project-1", "user-1", {
      sceneKey: "historical_expense",
      rows: [{
        values: {
          businessRef: "历史-001",
          occurredAt: "2026-08-01",
          amountYuan: "100.05",
          counterpartyName: "供应商甲",
          costCategoryCode: "material",
          evidenceLevel: "A",
          sourceDescription: "原始付款凭据"
        }
      }]
    });

    expect(result.zeroWrites).toBe(true);
    expect(result.summary).toMatchObject({ totalRows: 1, readyRows: 1, blockedRows: 0 });
    expect(prisma.operatingTakeoverRow.findMany).toHaveBeenCalledTimes(1);
  });
});
