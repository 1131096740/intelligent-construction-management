import {
  BadRequestException,
  ConflictException,
  NotFoundException
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { VatRateOptionService } from "./vat-rate-option.service";

function option(overrides: Record<string, unknown> = {}) {
  return {
    id: "vat-rate-13",
    rateValue: new Prisma.Decimal("13.000000"),
    label: "13% 增值税",
    enabled: true,
    sortOrder: 10,
    createdByUserId: "finance-director-1",
    createdAt: new Date("2026-07-17T00:00:00.000Z"),
    updatedAt: new Date("2026-07-17T00:00:00.000Z"),
    ...overrides
  };
}

function createHarness(overrides: {
  tx?: Record<string, unknown>;
  prisma?: Record<string, unknown>;
} = {}) {
  const tx = {
    vatRateOption: {
      create: jest.fn().mockResolvedValue(option()),
      findUnique: jest.fn().mockResolvedValue(option()),
      update: jest.fn().mockResolvedValue(option())
    },
    auditLog: { create: jest.fn() },
    ...overrides.tx
  };
  const prisma = {
    vatRateOption: {
      findMany: jest.fn().mockResolvedValue([option()]),
      findUnique: jest.fn().mockResolvedValue(option())
    },
    $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) =>
      callback(tx)
    ),
    ...overrides.prisma
  };
  const audit = { record: jest.fn().mockResolvedValue({ id: "audit-1" }) };
  return {
    tx,
    prisma,
    audit,
    service: new VatRateOptionService(prisma as never, audit as never)
  };
}

describe("VatRateOptionService", () => {
  it("lists only enabled options in stable order and serializes Decimal as strings", async () => {
    const { service, prisma } = createHarness({
      prisma: {
        vatRateOption: {
          findMany: jest.fn().mockResolvedValue([
            option({ rateValue: new Prisma.Decimal("13.500000") }),
            option({
              id: "vat-rate-0",
              rateValue: new Prisma.Decimal("0.000000"),
              label: "免税",
              sortOrder: 20
            })
          ])
        }
      }
    });

    await expect(service.listEnabled()).resolves.toEqual([
      {
        id: "vat-rate-13",
        rateValue: "13.5",
        label: "13% 增值税",
        enabled: true,
        sortOrder: 10
      },
      {
        id: "vat-rate-0",
        rateValue: "0",
        label: "免税",
        enabled: true,
        sortOrder: 20
      }
    ]);
    expect(prisma.vatRateOption.findMany).toHaveBeenCalledWith({
      where: { enabled: true },
      orderBy: [
        { sortOrder: "asc" },
        { rateValue: "asc" },
        { label: "asc" },
        { id: "asc" }
      ]
    });
    expect(typeof (await service.listEnabled())[0]?.rateValue).toBe("string");
  });

  it("creates a Decimal option and its audit record in the same transaction", async () => {
    const { service, prisma, tx, audit } = createHarness();

    await service.create("finance-director-1", {
      rateValue: "13.000000",
      label: "\u0085\uFEFF13%\u0085\u0085增值税\uFEFF",
      sortOrder: 10
    });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.vatRateOption.create).toHaveBeenCalledTimes(1);
    const createData = tx.vatRateOption.create.mock.calls[0]?.[0]?.data;
    expect(createData.rateValue).toBeInstanceOf(Prisma.Decimal);
    expect(createData.rateValue.toString()).toBe("13");
    expect(createData).toEqual(
      expect.objectContaining({
        label: "13% 增值税",
        sortOrder: 10,
        createdByUserId: "finance-director-1"
      })
    );
    expect(audit.record).toHaveBeenCalledWith(tx, {
      actorUserId: "finance-director-1",
      action: "invoice.vat_rate.create",
      businessType: "vat_rate_option",
      businessId: "vat-rate-13",
      metadata: {
        rateValue: "13",
        label: "13% 增值税",
        enabled: true,
        sortOrder: 10
      }
    });
  });

  it.each([
    [{ rateValue: 13, label: "13%", sortOrder: 1 }, "税率"],
    [{ rateValue: "1e1", label: "13%", sortOrder: 1 }, "税率"],
    [{ rateValue: "100.000001", label: "超范围", sortOrder: 1 }, "税率"],
    [{ rateValue: "-1", label: "负数", sortOrder: 1 }, "税率"],
    [{ rateValue: "13", label: "   ", sortOrder: 1 }, "标签"],
    [{ rateValue: "13", label: "\u0085\uFEFF", sortOrder: 1 }, "标签"],
    [{ rateValue: "13", label: "13%", sortOrder: 0 }, "排序"]
  ])("rejects invalid create input %j", async (input, message) => {
    const { service, tx } = createHarness();

    await expect(service.create("finance-director-1", input as never)).rejects.toThrow(
      message
    );
    expect(tx.vatRateOption.create).not.toHaveBeenCalled();
  });

  it("maps create P2002 to a fixed conflict without writing audit outside the transaction", async () => {
    const { service, tx, audit } = createHarness({
      tx: {
        vatRateOption: {
          create: jest.fn().mockRejectedValue({ code: "P2002" }),
          findUnique: jest.fn(),
          update: jest.fn()
        }
      }
    });

    await expect(
      service.create("finance-director-1", {
        rateValue: "13",
        label: "13% 增值税",
        sortOrder: 10
      })
    ).rejects.toThrow("相同税率数值和标签的选项已存在");
    await expect(
      service.create("finance-director-1", {
        rateValue: "13",
        label: "13% 增值税",
        sortOrder: 10
      })
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.vatRateOption.create).toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("maps update P2002 to a fixed conflict without writing audit", async () => {
    const { service, audit } = createHarness({
      tx: {
        vatRateOption: {
          create: jest.fn(),
          findUnique: jest.fn().mockResolvedValue(option()),
          update: jest.fn().mockRejectedValue({ code: "P2002" })
        }
      }
    });

    await expect(
      service.update("vat-rate-13", "finance-director-1", {
        label: "重复标签"
      })
    ).rejects.toThrow("相同税率数值和标签的选项已存在");
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("maps P2034 transaction conflicts to a fixed refresh message", async () => {
    const transaction = jest.fn().mockRejectedValue({ code: "P2034" });
    const { service, audit } = createHarness({
      prisma: { $transaction: transaction }
    });

    await expect(
      service.create("finance-director-1", {
        rateValue: "13",
        label: "13% 增值税",
        sortOrder: 10
      })
    ).rejects.toThrow("税率配置已变化，请刷新后重试");
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("rejects an empty update in the service boundary", async () => {
    const { service, tx, audit } = createHarness();

    await expect(service.update("vat-rate-13", "finance-director-1", {})).rejects.toBeInstanceOf(
      BadRequestException
    );
    expect(tx.vatRateOption.update).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("uses disable audit action only for an enabled-to-disabled transition", async () => {
    const disabled = option({ enabled: false });
    const { service, tx, audit } = createHarness({
      tx: {
        vatRateOption: {
          findUnique: jest.fn().mockResolvedValue(option()),
          update: jest.fn().mockResolvedValue(disabled),
          create: jest.fn()
        }
      }
    });

    await service.update("vat-rate-13", "finance-director-1", {
      enabled: false
    });

    expect(tx.vatRateOption.update).toHaveBeenCalledWith({
      where: { id: "vat-rate-13" },
      data: { enabled: false }
    });
    expect(audit.record).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        action: "invoice.vat_rate.disable",
        metadata: expect.objectContaining({
          rateValue: "13",
          enabled: false
        })
      })
    );
  });

  it("uses update audit action for label, rate, sort or re-enable changes", async () => {
    const existing = option({ enabled: false });
    const updated = option({
      rateValue: new Prisma.Decimal("9.500000"),
      label: "9.5% 增值税",
      enabled: true,
      sortOrder: 5
    });
    const { service, tx, audit } = createHarness({
      tx: {
        vatRateOption: {
          findUnique: jest.fn().mockResolvedValue(existing),
          update: jest.fn().mockResolvedValue(updated),
          create: jest.fn()
        }
      }
    });

    await service.update("vat-rate-13", "finance-director-1", {
      rateValue: "9.500000",
      label: " 9.5% 增值税 ",
      enabled: true,
      sortOrder: 5
    });

    const updateData = tx.vatRateOption.update.mock.calls[0]?.[0]?.data;
    expect(updateData.rateValue).toBeInstanceOf(Prisma.Decimal);
    expect(updateData.rateValue.toString()).toBe("9.5");
    expect(audit.record).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        action: "invoice.vat_rate.update",
        metadata: {
          rateValue: "9.5",
          label: "9.5% 增值税",
          enabled: true,
          sortOrder: 5
        }
      })
    );
  });

  it("requires an enabled option for new procurement drafts without changing snapshots", async () => {
    const { service, prisma } = createHarness();

    await expect(service.requireEnabledOption("vat-rate-13")).resolves.toEqual({
      id: "vat-rate-13",
      rateValue: "13",
      label: "13% 增值税",
      enabled: true,
      sortOrder: 10
    });

    prisma.vatRateOption.findUnique.mockResolvedValueOnce(null);
    await expect(service.requireEnabledOption("missing")).rejects.toBeInstanceOf(
      NotFoundException
    );

    prisma.vatRateOption.findUnique.mockResolvedValueOnce(option({ enabled: false }));
    await expect(service.requireEnabledOption("vat-rate-13")).rejects.toThrow(
      "税率选项已停用"
    );
  });

  it("does not expose deletion or seed permanent tax-rate arrays", () => {
    const serviceSource = readFileSync(
      join(__dirname, "vat-rate-option.service.ts"),
      "utf8"
    );
    const migrationSource = readFileSync(
      join(
        __dirname,
        "../../prisma/migrations/20260716190000_spot_procurement_core/migration.sql"
      ),
      "utf8"
    );

    expect("delete" in VatRateOptionService.prototype).toBe(false);
    expect(serviceSource).not.toMatch(/(?:VAT|TAX)_RATES?\s*=/u);
    expect(serviceSource).not.toContain("spotProcurementLine");
    expect(migrationSource).not.toMatch(/INSERT\s+INTO\s+"VatRateOption"/iu);
  });
});
