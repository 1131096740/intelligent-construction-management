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

  it("blocks employee and deduction rows when their business subtype is missing", async () => {
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
      rows: [
        {
          sceneKey: "employee_advance",
          values: {
            businessRef: "员工-001",
            occurredAt: "2026-08-01",
            amountYuan: "100.00",
            actualPayerName: "员工甲",
            costBearingCompanyName: "我方公司",
            evidenceLevel: "A",
            sourceDescription: "员工垫资单"
          }
        },
        {
          sceneKey: "construction_enterprise_deduction",
          values: {
            businessRef: "扣费-001",
            occurredAt: "2026-08-02",
            amountYuan: "200.00",
            costCategoryCode: "construction_enterprise_deduction",
            evidenceLevel: "A",
            sourceDescription: "施工企业对账单"
          }
        }
      ]
    });

    expect(result.summary).toMatchObject({ totalRows: 2, blockedRows: 2, readyRows: 0 });
    expect(result.rows[0].issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "missing_entry_type" })
    ]));
    expect(result.rows[1].issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "missing_deduction_type" })
    ]));
  });

  it("allows precheck for finance but reserves batch creation for the contract director", async () => {
    const prisma = {
      project: { findUnique: jest.fn().mockResolvedValue({ id: "project-1", operatingLedgerEffectiveDate: new Date("2026-08-16T00:00:00.000Z") }) }
    };
    const visibility = { effectiveRoleKeys: jest.fn().mockResolvedValue(["finance_staff"]) };
    const service = new OperatingTakeoverService(
      prisma as never,
      {} as never,
      visibility as never,
      {} as never,
      {} as never,
      {} as never
    );

    await expect(service.createBatch("project-1", "user-1", {
      rows: [{
        sceneKey: "historical_expense",
        values: {
          businessRef: "历史-001",
          occurredAt: "2026-08-01",
          amountYuan: "100.00",
          counterpartyName: "供应商甲",
          costCategoryCode: "material",
          evidenceLevel: "A",
          sourceDescription: "原始付款凭据"
        }
      }]
    })).rejects.toThrow("合同部负责人创建");
  });

  it("rejects a stale row revision before evaluating or writing the row", async () => {
    const prisma = {
      project: { findUnique: jest.fn().mockResolvedValue({ id: "project-1", operatingLedgerEffectiveDate: new Date("2026-08-16T00:00:00.000Z") }) },
      operatingTakeoverRow: {
        findFirst: jest.fn().mockResolvedValue({ id: "row-1", revision: 2, batch: { status: "under_review" } })
      }
    };
    const visibility = { effectiveRoleKeys: jest.fn().mockResolvedValue(["contract_director"]) };
    const definitions = { validateDraft: jest.fn() };
    const service = new OperatingTakeoverService(
      prisma as never,
      definitions as never,
      visibility as never,
      {} as never,
      {} as never,
      {} as never
    );

    await expect(service.updateRow("project-1", "batch-1", "row-1", "user-1", {
      expectedRevision: 1,
      values: {}
    })).rejects.toThrow("版本已变化");
    expect(definitions.validateDraft).not.toHaveBeenCalled();
  });
});
