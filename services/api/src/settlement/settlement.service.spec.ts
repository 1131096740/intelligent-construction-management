import * as ExcelJS from "exceljs";
import { Decimal } from "@prisma/client/runtime/library";
import { SettlementService } from "./settlement.service";

describe("SettlementService", () => {
  const service = new SettlementService();
  const audit = {
    record: jest.fn()
  };
  const auth = {
    confirmPassword: jest.fn()
  };

  beforeEach(() => {
    audit.record.mockReset();
    auth.confirmPassword.mockReset();
    auth.confirmPassword.mockResolvedValue({ ok: true });
  });

  function approvalRoleTables(roleKey: string) {
    return {
      userPosition: {
        findMany: jest.fn().mockResolvedValue([])
      },
      projectMember: {
        findMany: jest.fn().mockResolvedValue([{ positionKey: roleKey }])
      },
      position: {
        findMany: jest.fn().mockResolvedValue([])
      }
    };
  }

  function settlementQuotaTables() {
    return {
      $queryRaw: jest.fn().mockResolvedValue([{ id: "project-1" }]),
      projectUpstreamSettlement: {
        findMany: jest.fn().mockResolvedValue([{ approvedAmountCents: BigInt(20000000) }])
      },
      projectSettlementExceptionQuota: {
        findMany: jest.fn().mockResolvedValue([])
      },
      projectSettlementExceptionQuotaUsage: {
        findMany: jest.fn().mockResolvedValue([]),
        createMany: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 0 })
      }
    };
  }

  it("rejects settlement creation before contract version is effective", () => {
    expect(() => service.assertContractVersionEffective("pending_archive_confirm")).toThrow(
      "合同尚未归档生效，不能创建结算。请先完成合同归档确认。"
    );
  });

  it("allows settlement creation from effective contract version", () => {
    expect(() => service.assertContractVersionEffective("effective")).not.toThrow();
  });

  it("creates settlement from an effective contract version with bound payment terms", async () => {
    const tx = {
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-version-1",
          contractId: "contract-1",
          status: "effective"
        })
      },
      contract: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-1",
          projectId: "project-1"
        })
      },
      paymentTermsVersion: {
        findFirst: jest.fn().mockResolvedValue({
          id: "terms-version-1"
        })
      },
      paymentTermsStage: {
        findFirst: jest.fn().mockResolvedValue({
          ratioBps: 8000
        })
      },
      settlement: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({
          id: "settlement-1",
          code: "JS-2026-019"
        })
      },
      ...settlementQuotaTables()
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const settlementService = new SettlementService(prisma as never, audit as never);

    const created = await settlementService.create({
      contractVersionId: "contract-version-1",
      code: "JS-2026-019",
      periodLabel: "2026-06",
      amountCents: 10000000
    });

    expect(created.code).toBe("JS-2026-019");
    expect(tx.settlement.create).toHaveBeenCalledWith({
      data: {
        projectId: "project-1",
        contractId: "contract-1",
        contractVersionId: "contract-version-1",
        paymentTermsVersionId: "terms-version-1",
        code: "JS-2026-019",
        periodLabel: "2026-06",
        status: "approval_pending",
        amountCents: 10000000,
        payableAmountCents: 8000000,
        paidAmountCents: 0
      }
    });
  });

  it("rejects settlement creation when the service is unavailable", async () => {
    await expect(
      service.create({
        contractVersionId: "contract-version-1",
        code: "JS-2026-019",
        periodLabel: "2026-06",
        amountCents: 10000000
      })
    ).rejects.toThrow("结算创建服务暂不可用，请稍后重试或联系管理员");
  });

  it("rejects settlement creation when the contract version is missing", async () => {
    const tx = {
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue(null)
      },
      settlement: {
        create: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const settlementService = new SettlementService(prisma as never, audit as never);

    await expect(
      settlementService.create({
        contractVersionId: "missing-version",
        code: "JS-2026-019",
        periodLabel: "2026-06",
        amountCents: 10000000
      })
    ).rejects.toThrow("未找到可结算的合同版本，请刷新合同后重试");
    expect(tx.settlement.create).not.toHaveBeenCalled();
  });

  it("rejects settlement creation when the linked contract is missing", async () => {
    const tx = {
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-version-1",
          contractId: "contract-1",
          status: "effective"
        })
      },
      contract: {
        findUnique: jest.fn().mockResolvedValue(null)
      },
      paymentTermsVersion: {
        findFirst: jest.fn().mockResolvedValue({
          id: "terms-version-1"
        })
      },
      settlement: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const settlementService = new SettlementService(prisma as never, audit as never);

    await expect(
      settlementService.create({
        contractVersionId: "contract-version-1",
        code: "JS-2026-019",
        periodLabel: "2026-06",
        amountCents: 10000000
      })
    ).rejects.toThrow("未找到结算关联合同，请刷新合同台账后重试");
    expect(tx.settlement.create).not.toHaveBeenCalled();
  });

  it("rejects settlement creation when effective payment terms are missing", async () => {
    const tx = {
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-version-1",
          contractId: "contract-1",
          status: "effective"
        })
      },
      contract: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-1",
          projectId: "project-1"
        })
      },
      paymentTermsVersion: {
        findFirst: jest.fn().mockResolvedValue(null)
      },
      settlement: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const settlementService = new SettlementService(prisma as never, audit as never);

    await expect(
      settlementService.create({
        contractVersionId: "contract-version-1",
        code: "JS-2026-019",
        periodLabel: "2026-06",
        amountCents: 10000000
      })
    ).rejects.toThrow("合同缺少已生效的结构化付款条款，不能创建结算。请先补齐并确认合同付款条款。");
    expect(tx.settlement.create).not.toHaveBeenCalled();
  });

  it("stores settlement lines and refuses to trust a mismatched frontend total", async () => {
    const tx = {
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-version-1",
          contractId: "contract-1",
          status: "effective"
        })
      },
      contractBill: {
        findMany: jest.fn().mockResolvedValue([{ id: "bill-1" }])
      },
      contractBillRow: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "bill-row-1",
            contractBillId: "bill-1",
            itemName: "钢筋材料",
            unit: "吨",
            unitPrice: new Decimal("3200"),
            taxInclusiveAmountCents: BigInt(1000000)
          }
        ])
      },
      contract: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-1",
          projectId: "project-1"
        })
      },
      paymentTermsVersion: {
        findFirst: jest.fn().mockResolvedValue({
          id: "terms-version-1"
        })
      },
      paymentTermsStage: {
        findFirst: jest.fn().mockResolvedValue({
          ratioBps: 8000
        })
      },
      settlement: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({
          id: "settlement-1",
          code: "JS-2026-020"
        })
      },
      settlementLine: {
        findMany: jest.fn().mockResolvedValue([]),
        createMany: jest.fn()
      },
      ...settlementQuotaTables()
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const settlementService = new SettlementService(prisma as never, audit as never);

    await settlementService.create({
      contractVersionId: "contract-version-1",
      code: "JS-2026-020",
      periodLabel: "2026-06",
      amountCents: 950000,
      settlementLines: [
        {
          sourceType: "contract_bill_row",
          contractBillRowId: "bill-row-1",
          quantity: "3",
          amountCents: 960000
        },
        {
          sourceType: "manual_adjustment",
          name: "材料扣款",
          amountCents: -10000,
          reason: "现场扣款确认"
        }
      ]
    });

    expect(tx.settlement.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        amountCents: 950000,
        payableAmountCents: 760000
      })
    });
    expect(tx.settlementLine.createMany).toHaveBeenCalledWith({
      data: [
        {
          settlementId: "settlement-1",
          contractBillRowId: "bill-row-1",
          sourceType: "contract_bill_row",
          name: "钢筋材料",
          unit: "吨",
          quantity: new Decimal("3"),
          unitPriceCents: null,
          amountCents: 960000,
          reason: null,
          remark: null,
          sortOrder: 1
        },
        {
          settlementId: "settlement-1",
          contractBillRowId: null,
          sourceType: "manual_adjustment",
          name: "材料扣款",
          unit: null,
          quantity: null,
          unitPriceCents: null,
          amountCents: -10000,
          reason: "现场扣款确认",
          remark: null,
          sortOrder: 2
        }
      ]
    });
  });

  it("rejects negative contract bill row settlement lines", async () => {
    const tx = {
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-version-1",
          contractId: "contract-1",
          status: "effective"
        })
      },
      contractBill: {
        findMany: jest.fn().mockResolvedValue([{ id: "bill-1" }])
      },
      contractBillRow: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "bill-row-1",
            contractBillId: "bill-1",
            itemName: "钢筋材料",
            unit: "吨",
            unitPrice: new Decimal("3200"),
            taxInclusiveAmountCents: BigInt(1000000)
          }
        ])
      },
      contract: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-1",
          projectId: "project-1"
        })
      },
      paymentTermsVersion: {
        findFirst: jest.fn().mockResolvedValue({
          id: "terms-version-1"
        })
      },
      paymentTermsStage: {
        findFirst: jest.fn().mockResolvedValue({
          ratioBps: 8000
        })
      },
      settlement: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({
          id: "settlement-negative-bill-row",
          code: "JS-2026-NEG"
        })
      },
      settlementLine: {
        findMany: jest.fn().mockResolvedValue([]),
        createMany: jest.fn()
      },
      ...settlementQuotaTables()
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const settlementService = new SettlementService(prisma as never, audit as never);

    await expect(
      settlementService.create({
        contractVersionId: "contract-version-1",
        code: "JS-2026-NEG",
        periodLabel: "2026-06",
        amountCents: 100000,
        settlementLines: [
          {
            sourceType: "contract_bill_row",
            contractBillRowId: "bill-row-1",
            amountCents: -10000
          },
          {
            sourceType: "manual_adjustment",
            name: "本期补差",
            amountCents: 110000,
            reason: "补差确认"
          }
        ]
      })
    ).rejects.toThrow("合同清单项结算金额必须大于 0");
    expect(tx.settlement.create).not.toHaveBeenCalled();
    expect(tx.settlementLine.createMany).not.toHaveBeenCalled();
  });

  it("rejects duplicate active settlement for the same contract version and period", async () => {
    const tx = {
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-version-1",
          contractId: "contract-1",
          status: "effective"
        })
      },
      contract: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-1",
          projectId: "project-1"
        })
      },
      paymentTermsVersion: {
        findFirst: jest.fn().mockResolvedValue({
          id: "terms-version-1"
        })
      },
      paymentTermsStage: {
        findFirst: jest.fn().mockResolvedValue({
          ratioBps: 8000
        })
      },
      settlement: {
        findFirst: jest.fn().mockResolvedValue({
          id: "settlement-existing",
          code: "JS-2026-020"
        }),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({
          id: "settlement-duplicate",
          code: "JS-2026-021"
        })
      },
      ...settlementQuotaTables()
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const settlementService = new SettlementService(prisma as never, audit as never);

    await expect(
      settlementService.create({
        contractVersionId: "contract-version-1",
        code: "JS-2026-021",
        periodLabel: "2026-06",
        amountCents: 100000
      })
    ).rejects.toThrow("同一合同版本和结算期间已存在结算单");
    expect(tx.settlement.create).not.toHaveBeenCalled();
  });

  it("allows a new settlement period when previous same-period settlements are inactive", async () => {
    const tx = {
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-version-1",
          contractId: "contract-1",
          status: "effective"
        })
      },
      contract: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-1",
          projectId: "project-1"
        })
      },
      paymentTermsVersion: {
        findFirst: jest.fn().mockResolvedValue({
          id: "terms-version-1"
        })
      },
      paymentTermsStage: {
        findFirst: jest.fn().mockResolvedValue({
          ratioBps: 8000
        })
      },
      settlement: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({
          id: "settlement-recreated",
          code: "JS-2026-022"
        })
      },
      ...settlementQuotaTables()
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const settlementService = new SettlementService(prisma as never, audit as never);

    await settlementService.create({
      contractVersionId: "contract-version-1",
      code: "JS-2026-022",
      periodLabel: "2026-06",
      amountCents: 100000
    });

    expect(tx.settlement.findFirst).toHaveBeenCalledWith({
      where: {
        contractVersionId: "contract-version-1",
        periodLabel: "2026-06",
        status: {
          in: [
            "draft",
            "in_approval",
            "approval_pending",
            "approved_pending_archive",
            "pending_archive_confirm",
            "effective",
            "partially_paid",
            "paid"
          ]
        }
      },
      select: { id: true, code: true }
    });
    expect(tx.settlement.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        contractVersionId: "contract-version-1",
        periodLabel: "2026-06",
        amountCents: 100000
      })
    });
  });

  it("maps database duplicate settlement period guard to Chinese business error", async () => {
    const tx = {
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-version-1",
          contractId: "contract-1",
          status: "effective"
        })
      },
      contract: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-1",
          projectId: "project-1"
        })
      },
      paymentTermsVersion: {
        findFirst: jest.fn().mockResolvedValue({
          id: "terms-version-1"
        })
      },
      paymentTermsStage: {
        findFirst: jest.fn().mockResolvedValue({
          ratioBps: 8000
        })
      },
      settlement: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockRejectedValue({
          code: "P2002",
          meta: { target: "Settlement_contractVersion_period_active_key" }
        })
      },
      approvalInstance: {
        create: jest.fn()
      },
      ...settlementQuotaTables()
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const settlementService = new SettlementService(prisma as never, audit as never);

    await expect(
      settlementService.create(
        {
          contractVersionId: "contract-version-1",
          code: "JS-2026-021",
          periodLabel: "2026-06",
          amountCents: 100000
        },
        "contract-staff-1"
      )
    ).rejects.toThrow("同一合同版本和结算期间已存在结算单");
    expect(tx.approvalInstance.create).not.toHaveBeenCalled();
  });

  it("rejects duplicate settlement when the period label only differs by spaces", async () => {
    const tx = {
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-version-1",
          contractId: "contract-1",
          status: "effective"
        })
      },
      settlement: {
        findFirst: jest.fn((args: { where: { periodLabel: string } }) =>
          args.where.periodLabel === "2026-06"
            ? Promise.resolve({ id: "settlement-existing", code: "JS-2026-020" })
            : Promise.resolve(null)
        ),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({
          id: "settlement-duplicate-spaces",
          code: "JS-2026-021"
        })
      },
      contract: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-1",
          projectId: "project-1"
        })
      },
      paymentTermsVersion: {
        findFirst: jest.fn().mockResolvedValue({
          id: "terms-version-1"
        })
      },
      paymentTermsStage: {
        findFirst: jest.fn().mockResolvedValue({
          ratioBps: 8000
        })
      },
      ...settlementQuotaTables()
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const settlementService = new SettlementService(prisma as never, audit as never);

    await expect(
      settlementService.create({
        contractVersionId: "contract-version-1",
        code: "JS-2026-021",
        periodLabel: " 2026-06 ",
        amountCents: 100000
      })
    ).rejects.toThrow("同一合同版本和结算期间已存在结算单");
    expect(tx.settlement.findFirst).toHaveBeenCalledWith({
      where: {
        contractVersionId: "contract-version-1",
        periodLabel: "2026-06",
        status: expect.any(Object)
      },
      select: { id: true, code: true }
    });
    expect(tx.settlement.create).not.toHaveBeenCalled();
  });

  it("rejects contract bill row settlement lines when cumulative settled amount exceeds the bill row amount", async () => {
    const tx = {
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-version-1",
          contractId: "contract-1",
          status: "effective"
        })
      },
      contractBill: {
        findMany: jest.fn().mockResolvedValue([{ id: "bill-1" }])
      },
      contractBillRow: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "bill-row-1",
            contractBillId: "bill-1",
            itemName: "钢筋材料",
            unit: "吨",
            unitPrice: new Decimal("3200"),
            taxInclusiveAmountCents: BigInt(100000)
          }
        ])
      },
      contract: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-1",
          projectId: "project-1"
        })
      },
      paymentTermsVersion: {
        findFirst: jest.fn().mockResolvedValue({
          id: "terms-version-1"
        })
      },
      paymentTermsStage: {
        findFirst: jest.fn().mockResolvedValue({
          ratioBps: 8000
        })
      },
      settlement: {
        findMany: jest.fn((args: { where?: { id?: { in?: string[] } } }) =>
          args?.where?.id?.in
            ? Promise.resolve([{ id: "settlement-old" }])
            : Promise.resolve([])
        ),
        create: jest.fn().mockResolvedValue({
          id: "settlement-over-bill-row",
          code: "JS-2026-022"
        })
      },
      settlementLine: {
        findMany: jest.fn().mockResolvedValue([
          {
            contractBillRowId: "bill-row-1",
            settlementId: "settlement-old",
            amountCents: 80000
          }
        ]),
        createMany: jest.fn()
      },
      ...settlementQuotaTables()
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const settlementService = new SettlementService(prisma as never, audit as never);

    await expect(
      settlementService.create({
        contractVersionId: "contract-version-1",
        code: "JS-2026-022",
        periodLabel: "2026-06",
        amountCents: 30000,
        settlementLines: [
          {
            sourceType: "contract_bill_row",
            contractBillRowId: "bill-row-1",
            quantity: "1",
            amountCents: 30000
          }
        ]
      })
    ).rejects.toThrow(
      "合同清单项“钢筋材料”累计结算金额不能超过合同清单金额。本次结算 300.00 元，前序已结算 800.00 元，合同清单金额 1,000.00 元，超出 100.00 元。"
    );
    expect(tx.settlement.create).not.toHaveBeenCalled();
    expect(tx.settlementLine.createMany).not.toHaveBeenCalled();
  });

  it("rejects duplicate contract bill row lines when their current total exceeds the bill row amount", async () => {
    const tx = {
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-version-1",
          contractId: "contract-1",
          status: "effective"
        })
      },
      contractBill: {
        findMany: jest.fn().mockResolvedValue([{ id: "bill-1" }])
      },
      contractBillRow: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "bill-row-1",
            contractBillId: "bill-1",
            itemName: "钢筋采购",
            unit: "吨",
            unitPrice: new Decimal("3200"),
            taxInclusiveAmountCents: BigInt(100000)
          }
        ])
      },
      contract: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-1",
          projectId: "project-1"
        })
      },
      paymentTermsVersion: {
        findFirst: jest.fn().mockResolvedValue({
          id: "terms-version-1"
        })
      },
      paymentTermsStage: {
        findFirst: jest.fn().mockResolvedValue({
          ratioBps: 8000
        })
      },
      settlement: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn()
      },
      settlementLine: {
        findMany: jest.fn().mockResolvedValue([]),
        createMany: jest.fn()
      },
      ...settlementQuotaTables()
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const settlementService = new SettlementService(prisma as never, audit as never);

    await expect(
      settlementService.create({
        contractVersionId: "contract-version-1",
        code: "JS-2026-024",
        periodLabel: "2026-06",
        amountCents: 110000,
        settlementLines: [
          {
            sourceType: "contract_bill_row",
            contractBillRowId: "bill-row-1",
            quantity: "1",
            amountCents: 60000
          },
          {
            sourceType: "contract_bill_row",
            contractBillRowId: "bill-row-1",
            quantity: "1",
            amountCents: 50000
          }
        ]
      })
    ).rejects.toThrow(
      "合同清单项“钢筋采购”累计结算金额不能超过合同清单金额。本次结算 1,100.00"
    );
    expect(tx.settlement.create).not.toHaveBeenCalled();
    expect(tx.settlementLine.createMany).not.toHaveBeenCalled();
  });

  it("rejects settlement creation when payment terms have no current settlement stage", async () => {
    const tx = {
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-version-1",
          contractId: "contract-1",
          status: "effective"
        })
      },
      contract: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-1",
          projectId: "project-1"
        })
      },
      paymentTermsVersion: {
        findFirst: jest.fn().mockResolvedValue({
          id: "terms-version-1"
        })
      },
      paymentTermsStage: {
        findFirst: jest.fn().mockResolvedValue(null)
      },
      settlement: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn()
      },
      ...settlementQuotaTables()
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const settlementService = new SettlementService(prisma as never, audit as never);

    await expect(
      settlementService.create({
        contractVersionId: "contract-version-1",
        code: "JS-2026-023",
        periodLabel: "2026-06",
        amountCents: 100000
      })
    ).rejects.toThrow("合同付款条款缺少结算款阶段");
    expect(tx.settlement.create).not.toHaveBeenCalled();
  });

  it("rejects settlement lines when their total differs from the backend settlement amount", async () => {
    const tx = {
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-version-1",
          contractId: "contract-1",
          status: "effective"
        })
      },
      contract: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-1",
          projectId: "project-1"
        })
      },
      paymentTermsVersion: {
        findFirst: jest.fn().mockResolvedValue({
          id: "terms-version-1"
        })
      },
      paymentTermsStage: {
        findFirst: jest.fn()
      },
      settlement: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn()
      },
      settlementLine: {
        createMany: jest.fn()
      },
      ...settlementQuotaTables()
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const settlementService = new SettlementService(prisma as never, audit as never);

    await expect(
      settlementService.create({
        contractVersionId: "contract-version-1",
        code: "JS-2026-021",
        periodLabel: "2026-06",
        amountCents: 100000,
        settlementLines: [
          {
            sourceType: "manual_adjustment",
            name: "扣款",
            amountCents: 90000,
            reason: "扣款确认"
          }
        ]
      })
    ).rejects.toThrow("结算明细合计必须等于本次结算金额");
    expect(tx.settlement.create).not.toHaveBeenCalled();
    expect(tx.settlementLine.createMany).not.toHaveBeenCalled();
  });

  it("stores a final settlement as the current-period delta while snapshotting the final cumulative amount", async () => {
    const tx = {
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-version-1",
          contractId: "contract-1",
          status: "effective"
        })
      },
      contract: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-1",
          projectId: "project-1"
        })
      },
      paymentTermsVersion: {
        findFirst: jest.fn().mockResolvedValue({
          id: "terms-version-1"
        })
      },
      paymentTermsStage: {
        findFirst: jest.fn().mockResolvedValue({
          ratioBps: 8000
        })
      },
      settlement: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([{ amountCents: 900000 }])
          .mockResolvedValueOnce([{ amountCents: 900000 }]),
        create: jest.fn().mockResolvedValue({
          id: "settlement-final-1",
          code: "JS-2026-FINAL"
        })
      },
      ...settlementQuotaTables()
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const settlementService = new SettlementService(prisma as never, audit as never);

    await settlementService.create({
      contractVersionId: "contract-version-1",
      code: "JS-2026-FINAL",
      periodLabel: "最终结算",
      amountCents: 1200000,
      isFinal: true
    });

    expect(tx.settlement.findMany).toHaveBeenNthCalledWith(1, {
      where: {
        contractId: "contract-1",
        status: { in: ["effective", "partially_paid", "paid"] }
      },
      select: { amountCents: true }
    });
    expect(tx.settlement.create).toHaveBeenCalledWith({
      data: {
        projectId: "project-1",
        contractId: "contract-1",
        contractVersionId: "contract-version-1",
        paymentTermsVersionId: "terms-version-1",
        code: "JS-2026-FINAL",
        periodLabel: "最终结算",
        status: "approval_pending",
        amountCents: 300000,
        payableAmountCents: 240000,
        paidAmountCents: 0,
        isFinal: true,
        finalCumulativeAmountCents: 1200000
      }
    });
  });

  it("rejects a final settlement when the final cumulative amount is not greater than previous effective settlements", async () => {
    const tx = {
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-version-1",
          contractId: "contract-1",
          status: "effective"
        })
      },
      contract: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-1",
          projectId: "project-1"
        })
      },
      paymentTermsVersion: {
        findFirst: jest.fn().mockResolvedValue({
          id: "terms-version-1"
        })
      },
      paymentTermsStage: {
        findFirst: jest.fn()
      },
      settlement: {
        findMany: jest.fn().mockResolvedValue([{ amountCents: 1200000 }]),
        create: jest.fn()
      },
      ...settlementQuotaTables()
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const settlementService = new SettlementService(prisma as never, audit as never);

    await expect(
      settlementService.create({
        contractVersionId: "contract-version-1",
        code: "JS-2026-FINAL",
        periodLabel: "最终结算",
        amountCents: 1200000,
        isFinal: true
      })
    ).rejects.toThrow("最终审定累计结算总额必须大于前序已生效累计结算金额");
    expect(tx.settlement.create).not.toHaveBeenCalled();
  });

  it("blocks settlement creation when upstream approved quota is insufficient", async () => {
    const tx = {
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-version-1",
          contractId: "contract-1",
          status: "effective"
        })
      },
      contract: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-1",
          projectId: "project-1"
        })
      },
      paymentTermsVersion: {
        findFirst: jest.fn().mockResolvedValue({ id: "terms-version-1" })
      },
      paymentTermsStage: {
        findFirst: jest.fn()
      },
      settlement: {
        findMany: jest.fn().mockResolvedValue([
          { amountCents: 8000000, status: "effective" }
        ]),
        create: jest.fn()
      },
      approvalInstance: {
        create: jest.fn()
      },
      $queryRaw: jest.fn().mockResolvedValue([{ id: "project-1" }]),
      projectUpstreamSettlement: {
        findMany: jest.fn().mockResolvedValue([{ approvedAmountCents: BigInt(10000000) }])
      },
      projectSettlementExceptionQuota: {
        findMany: jest.fn().mockResolvedValue([])
      },
      projectSettlementExceptionQuotaUsage: {
        findMany: jest.fn().mockResolvedValue([]),
        createMany: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const settlementService = new SettlementService(prisma as never, audit as never);

    await expect(
      settlementService.create(
        {
          contractVersionId: "contract-version-1",
          code: "JS-2026-030",
          periodLabel: "2026-06",
          amountCents: 3000000
        },
        "user-contract-staff"
      )
    ).rejects.toThrow("下游结算额度不足");
    expect(tx.$queryRaw).toHaveBeenCalled();
    expect(tx.settlement.create).not.toHaveBeenCalled();
    expect(tx.approvalInstance.create).not.toHaveBeenCalled();
    expect(tx.projectSettlementExceptionQuotaUsage.createMany).not.toHaveBeenCalled();
  });

  it("occupies approved settlement exception quota when upstream approved quota is insufficient", async () => {
    const tx = {
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-version-1",
          contractId: "contract-1",
          status: "effective"
        })
      },
      contract: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-1",
          projectId: "project-1",
          contractTypeKey: "material_purchase",
          name: "钢材采购合同",
          counterparty: "钢材供应商"
        })
      },
      paymentTermsVersion: {
        findFirst: jest.fn().mockResolvedValue({ id: "terms-version-1" })
      },
      paymentTermsStage: {
        findFirst: jest.fn().mockResolvedValue({ ratioBps: 10000 })
      },
      settlement: {
        findMany: jest.fn().mockResolvedValue([{ amountCents: 8000000, status: "effective" }]),
        create: jest.fn().mockResolvedValue({ id: "settlement-1", code: "JS-2026-031" })
      },
      approvalInstance: {
        create: jest.fn()
      },
      $queryRaw: jest.fn().mockResolvedValue([{ id: "project-1" }]),
      projectUpstreamSettlement: {
        findMany: jest.fn().mockResolvedValue([{ approvedAmountCents: BigInt(10000000) }])
      },
      projectSettlementExceptionQuota: {
        findMany: jest.fn().mockResolvedValue([{ id: "quota-1", amountCents: BigInt(5000000) }])
      },
      projectSettlementExceptionQuotaUsage: {
        findMany: jest.fn().mockResolvedValue([]),
        createMany: jest.fn()
      },
      auditLog: {
        create: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const settlementService = new SettlementService(prisma as never, audit as never);

    await settlementService.create(
      {
        contractVersionId: "contract-version-1",
        code: "JS-2026-031",
        periodLabel: "2026-06",
        amountCents: 3000000
      },
      "user-contract-staff"
    );

    expect(tx.projectSettlementExceptionQuotaUsage.createMany).toHaveBeenCalledWith({
      data: [
        {
          quotaId: "quota-1",
          settlementId: "settlement-1",
          projectId: "project-1",
          contractId: "contract-1",
          amountCents: BigInt(1000000),
          status: "occupied"
        }
      ]
    });
    expect(tx.approvalInstance.create).toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(tx, {
      actorUserId: "user-contract-staff",
      action: "settlement.exception_quota.occupy",
      businessType: "settlement",
      businessId: "settlement-1",
      metadata: {
        projectId: "project-1",
        contractId: "contract-1",
        allocations: [{ quotaId: "quota-1", amountCents: "1000000" }]
      }
    });
  });

  it("freezes material settlement approval route when settlement is created by an applicant", async () => {
    const tx = {
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-version-1",
          contractId: "contract-1",
          status: "effective"
        })
      },
      contract: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-1",
          projectId: "project-1",
          contractTypeKey: "material_purchase",
          name: "钢材采购合同",
          counterparty: "钢材供应商"
        })
      },
      paymentTermsVersion: {
        findFirst: jest.fn().mockResolvedValue({
          id: "terms-version-1"
        })
      },
      paymentTermsStage: {
        findFirst: jest.fn().mockResolvedValue({ ratioBps: 8000 })
      },
      settlement: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({
          id: "settlement-1",
          code: "JS-2026-019"
        })
      },
      approvalInstance: {
        create: jest.fn()
      },
      ...settlementQuotaTables()
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const settlementService = new SettlementService(prisma as never, audit as never);

    await settlementService.create(
      {
        contractVersionId: "contract-version-1",
        code: "JS-2026-019",
        periodLabel: "2026-06",
        amountCents: 10000000
      },
      "user-contract-staff"
    );

    expect(tx.approvalInstance.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        flowType: "settlement.approve",
        businessType: "settlement",
        businessId: "settlement-1",
        status: "in_progress",
        currentNodeIndex: 0,
        applicantUserId: "user-contract-staff",
        frozenNodes: expect.arrayContaining([
          { name: "物资员", mode: "any", roleKeys: ["material_staff"] },
          { name: "物资主管", mode: "any", roleKeys: ["material_director"] }
        ])
      })
    });
  });

  it("generates the initial formal approval PDF after a settlement is submitted for approval", async () => {
    const createTx = {
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-version-1",
          contractId: "contract-1",
          status: "effective"
        })
      },
      contract: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-1",
          projectId: "project-1",
          contractTypeKey: "material_purchase",
          name: "钢材采购合同",
          counterparty: "钢材供应商"
        })
      },
      paymentTermsVersion: {
        findFirst: jest.fn().mockResolvedValue({
          id: "terms-version-1"
        })
      },
      paymentTermsStage: {
        findFirst: jest.fn().mockResolvedValue({ ratioBps: 8000 })
      },
      settlement: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({
          id: "settlement-1",
          code: "JS-2026-019"
        })
      },
      approvalInstance: {
        create: jest.fn()
      },
      ...settlementQuotaTables()
    };
    const renderTx = {
      settlement: {
        findUnique: jest.fn().mockResolvedValue({
          id: "settlement-1",
          projectId: "project-1",
          contractId: "contract-1",
          contractVersionId: "contract-version-1",
          paymentTermsVersionId: "terms-1",
          code: "JS-2026-019",
          periodLabel: "2026-06",
          status: "approval_pending",
          amountCents: 1_000_000,
          payableAmountCents: 800_000,
          paidAmountCents: 0,
          isFinal: false,
          finalCumulativeAmountCents: null
        }),
        findMany: jest.fn().mockResolvedValue([])
      },
      contract: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-1",
          code: "HT-2026-009",
          name: "幕墙分包合同",
          counterparty: "上海示例劳务有限公司",
          companyEntityName: "建工智管工程有限公司"
        })
      },
      project: {
        findUnique: jest.fn().mockResolvedValue({
          id: "project-1",
          name: "总部综合楼"
        })
      },
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue({
          id: "approval-instance-1",
          frozenNodes: [{ name: "物资员", mode: "any", roleKeys: ["material_staff"] }]
        })
      },
      approvalActionLog: {
        findMany: jest.fn().mockResolvedValue([])
      },
      user: {
        findMany: jest.fn().mockResolvedValue([])
      }
    };
    const pdfTx = {
      pdfDocument: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: "pdf-latest" }),
        update: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest
        .fn()
        .mockImplementationOnce(async (callback) => callback(createTx))
        .mockImplementationOnce(async (callback) => callback(renderTx))
        .mockImplementationOnce(async (callback) => callback(pdfTx))
    };
    const files = {
      uploadPrivateFile: jest.fn().mockResolvedValue({ id: "file-latest" })
    };
    const settlementService = new SettlementService(
      prisma as never,
      audit as never,
      undefined,
      undefined,
      files as never
    );

    await settlementService.create(
      {
        contractVersionId: "contract-version-1",
        code: "JS-2026-019",
        periodLabel: "2026-06",
        amountCents: 10000000
      },
      "user-contract-staff"
    );

    expect(files.uploadPrivateFile).toHaveBeenCalledWith(
      expect.objectContaining({
        originalName: "JS-2026-019-结算审批最新.pdf",
        uploadedByUserId: "user-contract-staff",
        mimeType: "application/pdf"
      })
    );
    expect(pdfTx.pdfDocument.create).toHaveBeenCalledWith({
      data: {
        businessType: "settlement",
        businessId: "settlement-1",
        fileId: "file-latest",
        templateKey: "settlement_approval_latest"
      }
    });
  });

  it("freezes labor/professional settlement approval route from contract type", async () => {
    const tx = {
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-version-1",
          contractId: "contract-1",
          status: "effective"
        })
      },
      contract: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-1",
          projectId: "project-1",
          contractTypeKey: "labor_subcontract",
          name: "作业合同",
          counterparty: "施工单位"
        })
      },
      paymentTermsVersion: {
        findFirst: jest.fn().mockResolvedValue({
          id: "terms-version-1"
        })
      },
      paymentTermsStage: {
        findFirst: jest.fn().mockResolvedValue({ ratioBps: 8000 })
      },
      settlement: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({
          id: "settlement-1",
          code: "JS-2026-020"
        })
      },
      approvalInstance: {
        create: jest.fn()
      },
      ...settlementQuotaTables()
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const settlementService = new SettlementService(prisma as never, audit as never);

    await settlementService.create(
      {
        contractVersionId: "contract-version-1",
        code: "JS-2026-020",
        periodLabel: "2026-06",
        amountCents: 10000000
      },
      "user-contract-staff"
    );

    expect(tx.approvalInstance.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        frozenNodes: expect.arrayContaining([
          { name: "工长", mode: "any", roleKeys: ["engineering_foreman"] },
          { name: "项目总工", mode: "any", roleKeys: ["engineering_director"] },
          { name: "工程技术部", mode: "any", roleKeys: ["engineering_tech"] }
        ])
      })
    });
  });

  it("falls back to contract wording for legacy settlement approval routing", async () => {
    const tx = {
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-version-1",
          contractId: "contract-1",
          status: "effective"
        })
      },
      contract: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-1",
          projectId: "project-1",
          contractTypeKey: null,
          name: "劳务分包合同",
          counterparty: "劳务单位"
        })
      },
      paymentTermsVersion: {
        findFirst: jest.fn().mockResolvedValue({
          id: "terms-version-1"
        })
      },
      paymentTermsStage: {
        findFirst: jest.fn().mockResolvedValue({ ratioBps: 8000 })
      },
      settlement: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({
          id: "settlement-1",
          code: "JS-2026-021"
        })
      },
      approvalInstance: {
        create: jest.fn()
      },
      ...settlementQuotaTables()
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const settlementService = new SettlementService(prisma as never, audit as never);

    await settlementService.create(
      {
        contractVersionId: "contract-version-1",
        code: "JS-2026-021",
        periodLabel: "2026-06",
        amountCents: 10000000
      },
      "user-contract-staff"
    );

    expect(tx.approvalInstance.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        frozenNodes: expect.arrayContaining([
          { name: "工长", mode: "any", roleKeys: ["engineering_foreman"] },
          { name: "项目总工", mode: "any", roleKeys: ["engineering_director"] },
          { name: "工程技术部", mode: "any", roleKeys: ["engineering_tech"] }
        ])
      })
    });
  });

  it("rejects create settlement from a non-effective contract version", async () => {
    const tx = {
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-version-1",
          contractId: "contract-1",
          status: "draft"
        })
      },
      settlement: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const settlementService = new SettlementService(prisma as never, audit as never);

    await expect(
      settlementService.create({
        contractVersionId: "contract-version-1",
        code: "JS-2026-019",
        periodLabel: "2026-06",
        amountCents: 10000000
      })
    ).rejects.toThrow("合同尚未归档生效，不能创建结算。请先完成合同归档确认。");
    expect(tx.settlement.create).not.toHaveBeenCalled();
  });

  it("uploads a signed settlement archive file and waits for director confirmation", async () => {
    const tx = {
      settlement: {
        findUnique: jest.fn().mockResolvedValue({
          id: "settlement-1",
          status: "approved_pending_archive"
        }),
        update: jest.fn().mockResolvedValue({
          id: "settlement-1",
          status: "pending_archive_confirm"
        })
      },
      fileObject: {
        findUnique: jest.fn().mockResolvedValue({
          id: "file-1"
        })
      },
      settlementArchiveFile: {
        create: jest.fn().mockResolvedValue({
          id: "settlement-archive-file-1",
          status: "pending_confirm"
        })
      },
      auditLog: {
        create: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const files = {
      assertCanDownloadFile: jest.fn().mockResolvedValue({ id: "file-1" })
    };
    const settlementService = new SettlementService(
      prisma as never,
      audit as never,
      undefined,
      undefined,
      files as never
    );

    const result = await settlementService.uploadArchiveFile("settlement-1", "user-contract-staff", {
      fileId: "file-1"
    });

    expect(result.status).toBe("pending_confirm");
    expect(files.assertCanDownloadFile).toHaveBeenCalledWith(tx, "file-1", "user-contract-staff");
    expect(tx.settlementArchiveFile.create).toHaveBeenCalledWith({
      data: {
        settlementId: "settlement-1",
        fileId: "file-1",
        uploadedByUserId: "user-contract-staff",
        status: "pending_confirm"
      }
    });
    expect(tx.settlement.update).toHaveBeenCalledWith({
      where: { id: "settlement-1" },
      data: { status: "pending_archive_confirm" }
    });
    expect(audit.record).toHaveBeenCalledWith(tx, {
      actorUserId: "user-contract-staff",
      action: "settlement.archive.upload",
      businessType: "settlement",
      businessId: "settlement-1",
      metadata: {
        fileId: "file-1",
        archiveFileId: "settlement-archive-file-1"
      }
    });
  });

  it("结算单不存在时不能上传归档文件", async () => {
    const tx = {
      settlement: {
        findUnique: jest.fn().mockResolvedValue(null),
        update: jest.fn()
      },
      settlementArchiveFile: {
        create: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const files = {
      assertCanDownloadFile: jest.fn()
    };
    const settlementService = new SettlementService(
      prisma as never,
      audit as never,
      undefined,
      undefined,
      files as never
    );

    await expect(
      settlementService.uploadArchiveFile("settlement-missing", "user-contract-staff", {
        fileId: "file-1"
      })
    ).rejects.toThrow("未找到结算单，请刷新结算台账后重试");
    expect(files.assertCanDownloadFile).not.toHaveBeenCalled();
    expect(tx.settlementArchiveFile.create).not.toHaveBeenCalled();
  });

  it("结算单尚未通过审批时不能上传归档文件", async () => {
    const tx = {
      settlement: {
        findUnique: jest.fn().mockResolvedValue({
          id: "settlement-1",
          status: "approval_pending"
        }),
        update: jest.fn()
      },
      settlementArchiveFile: {
        create: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const files = {
      assertCanDownloadFile: jest.fn()
    };
    const settlementService = new SettlementService(
      prisma as never,
      audit as never,
      undefined,
      undefined,
      files as never
    );

    await expect(
      settlementService.uploadArchiveFile("settlement-1", "user-contract-staff", {
        fileId: "file-1"
      })
    ).rejects.toThrow("当前结算单尚不能上传归档文件，请确认审批已通过并等待归档");
    expect(files.assertCanDownloadFile).not.toHaveBeenCalled();
    expect(tx.settlementArchiveFile.create).not.toHaveBeenCalled();
  });

  it("approves a settlement and opens signed archive upload", async () => {
    const tx = {
      settlement: {
        findUnique: jest.fn().mockResolvedValue({
          id: "settlement-1",
          projectId: "project-1",
          status: "approval_pending"
        }),
        update: jest.fn().mockResolvedValue({
          id: "settlement-1",
          status: "approved_pending_archive"
        })
      },
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue({
          id: "approval-instance-1",
          currentNodeIndex: 0,
          frozenNodes: [{ name: "预算部主管", mode: "any", roleKeys: ["budget_director"] }]
        }),
        update: jest.fn()
      },
      approvalActionLog: {
        create: jest.fn()
      },
      user: {
        findMany: jest.fn().mockResolvedValue([
          { id: "budget-director-1", name: "张预算", signatureFileId: null }
        ])
      },
      ...approvalRoleTables("budget_director")
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const settlementService = new SettlementService(prisma as never, audit as never);

    const result = await settlementService.reviewApproval("settlement-1", "budget-director-1", {
      decision: "approve"
    });

    expect(result.status).toBe("approved_pending_archive");
    expect(tx.settlement.update).toHaveBeenCalledWith({
      where: { id: "settlement-1" },
      data: { status: "approved_pending_archive" }
    });
    expect(tx.approvalInstance.update).toHaveBeenCalledWith({
      where: { id: "approval-instance-1" },
      data: {
        currentNodeIndex: 1,
        frozenNodes: [
          {
            name: "预算部主管",
            mode: "any",
            roleKeys: ["budget_director"],
            approvedRoleKeys: ["budget_director"]
          }
        ],
        status: "approved"
      }
    });
    expect(audit.record).toHaveBeenCalledWith(tx, {
      actorUserId: "budget-director-1",
      action: "settlement.approval.approve",
      businessType: "settlement",
      businessId: "settlement-1",
      metadata: {
        fromStatus: "approval_pending",
        toStatus: "approved_pending_archive",
        nodeName: "预算部主管",
        nodeCompleted: true
      }
    });
    expect(tx.approvalActionLog.create).toHaveBeenCalledWith({
      data: {
        approvalInstanceId: "approval-instance-1",
        action: "approve",
        actorUserId: "budget-director-1",
        metadata: {
          nodeName: "预算部主管",
          roleKey: "budget_director",
          roleName: "预算部主管",
          approverName: "张预算"
        }
      }
    });
  });

  it("结算审批驳回或退回时必须填写审批意见", async () => {
    const prisma = {
      $transaction: jest.fn()
    };
    const settlementService = new SettlementService(prisma as never, audit as never);

    await expect(
      settlementService.reviewApproval("settlement-1", "budget-director-1", {
        decision: "return_to_applicant",
        comment: "   "
      })
    ).rejects.toThrow("请填写审批意见，说明驳回或退回原因");
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("结算审批不支持的处理方式直接拒绝", async () => {
    const prisma = {
      $transaction: jest.fn()
    };
    const settlementService = new SettlementService(prisma as never, audit as never);

    await expect(
      settlementService.reviewApproval("settlement-1", "budget-director-1", {
        decision: "invalid" as never
      })
    ).rejects.toThrow("不支持的结算审批处理方式，请刷新页面后重试");
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("does not write internal user account into settlement approval metadata when name is unavailable", async () => {
    const tx = {
      user: {
        findMany: jest.fn().mockResolvedValue([])
      }
    };
    const settlementService = new SettlementService();
    const metadata = await (
      settlementService as unknown as {
        approvalLogMetadata(
          tx: unknown,
          node: { name: string; roleKeys: string[]; mode: string },
          actorUserId: string,
          roleKey: string
        ): Promise<Record<string, unknown>>;
      }
    ).approvalLogMetadata(
      tx,
      { name: "预算部主管", roleKeys: ["budget_director"], mode: "any" },
      "budget-director-internal-id",
      "budget_director"
    );

    expect(metadata).toMatchObject({
      nodeName: "预算部主管",
      roleName: "预算部主管",
      approverName: "审批人未读取"
    });
  });

  it("does not expose internal user account in settlement approval PDF rows", async () => {
    const tx = {
      user: {
        findMany: jest.fn().mockResolvedValue([])
      },
      userPosition: {
        findMany: jest.fn().mockResolvedValue([])
      },
      projectMember: {
        findMany: jest.fn().mockResolvedValue([{ positionKey: "budget_director" }])
      },
      position: {
        findMany: jest.fn().mockResolvedValue([])
      }
    };
    const settlementService = new SettlementService();
    const rows = await (
      settlementService as unknown as {
        buildSettlementApprovalRows(
          tx: unknown,
          projectId: string,
          frozenNodes: Array<{ name: string; roleKeys: string[]; mode: string }>,
          actionLogs: Array<{
            action: string;
            actorUserId: string;
            comment: string | null;
            createdAt: Date;
            metadata: unknown;
          }>
        ): Promise<Array<{ approverName: string }>>;
      }
    ).buildSettlementApprovalRows(
      tx,
      "project-1",
      [{ name: "预算部主管", roleKeys: ["budget_director"], mode: "any" }],
      [
        {
          action: "approve",
          actorUserId: "budget-director-internal-id",
          comment: "同意",
          createdAt: new Date("2026-07-03T10:00:00.000Z"),
          metadata: {}
        }
      ]
    );

    expect(rows[0]).toMatchObject({ approverName: "审批人未读取" });
  });

  it("结算单不在审批中时不能处理审批", async () => {
    const tx = {
      settlement: {
        findUnique: jest.fn().mockResolvedValue({
          id: "settlement-1",
          projectId: "project-1",
          status: "effective"
        }),
        update: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const settlementService = new SettlementService(prisma as never, audit as never);

    await expect(
      settlementService.reviewApproval("settlement-1", "budget-director-1", {
        decision: "approve"
      })
    ).rejects.toThrow("当前结算单暂不能处理审批，请确认仍在审批中");
    expect(tx.settlement.update).not.toHaveBeenCalled();
  });

  it("缺少进行中的结算审批流程时不能处理审批", async () => {
    const tx = {
      settlement: {
        findUnique: jest.fn().mockResolvedValue({
          id: "settlement-1",
          projectId: "project-1",
          status: "approval_pending"
        }),
        update: jest.fn()
      },
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue(null)
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const settlementService = new SettlementService(prisma as never, audit as never);

    await expect(
      settlementService.reviewApproval("settlement-1", "budget-director-1", {
        decision: "approve"
      })
    ).rejects.toThrow("未找到进行中的结算审批流程，请刷新后重试");
    expect(tx.settlement.update).not.toHaveBeenCalled();
  });

  it("当前结算审批节点异常时不能处理审批", async () => {
    const tx = {
      settlement: {
        findUnique: jest.fn().mockResolvedValue({
          id: "settlement-1",
          projectId: "project-1",
          status: "approval_pending"
        }),
        update: jest.fn()
      },
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue({
          id: "approval-instance-1",
          currentNodeIndex: 0,
          frozenNodes: []
        }),
        update: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const settlementService = new SettlementService(prisma as never, audit as never);

    await expect(
      settlementService.reviewApproval("settlement-1", "budget-director-1", {
        decision: "approve"
      })
    ).rejects.toThrow("当前结算审批节点异常，请联系管理员核对审批流程");
    expect(tx.settlement.update).not.toHaveBeenCalled();
  });

  it("keeps a countersign settlement node pending until all required roles approve", async () => {
    const frozenNodes = [
      {
        name: "合同部主管 + 预算部主管",
        mode: "all",
        roleKeys: ["contract_director", "budget_director"]
      }
    ];
    const tx = {
      settlement: {
        findUnique: jest.fn().mockResolvedValue({
          id: "settlement-1",
          projectId: "project-1",
          status: "approval_pending"
        }),
        update: jest.fn().mockResolvedValue({
          id: "settlement-1",
          status: "approval_pending"
        })
      },
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue({
          id: "approval-instance-1",
          currentNodeIndex: 0,
          frozenNodes
        }),
        update: jest.fn()
      },
      approvalActionLog: {
        create: jest.fn()
      },
      ...approvalRoleTables("contract_director")
    };
    const renderTx = {
      settlement: {
        findUnique: jest.fn().mockResolvedValue({
          id: "settlement-1",
          projectId: "project-1",
          contractId: "contract-1",
          code: "JS-2026-019",
          periodLabel: "2026-06",
          status: "approval_pending",
          amountCents: 1_000_000,
          payableAmountCents: 800_000,
          paidAmountCents: 0,
          isFinal: false
        }),
        findMany: jest.fn().mockResolvedValue([])
      },
      contract: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-1",
          code: "HT-2026-009",
          name: "幕墙分包合同",
          counterparty: "上海示例劳务有限公司",
          companyEntityName: "建工智管工程有限公司"
        })
      },
      project: {
        findUnique: jest.fn().mockResolvedValue({
          id: "project-1",
          name: "总部综合楼"
        })
      },
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue({
          id: "approval-instance-1"
        })
      },
      approvalActionLog: {
        findMany: jest.fn().mockResolvedValue([
          {
            action: "approve",
            actorUserId: "contract-director-1",
            comment: "",
            createdAt: new Date("2026-07-03T00:00:00.000Z")
          }
        ])
      }
    };
    const pdfTx = {
      pdfDocument: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: "pdf-latest" }),
        update: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest
        .fn()
        .mockImplementationOnce(async (callback) => callback(tx))
        .mockImplementationOnce(async (callback) => callback(renderTx))
        .mockImplementationOnce(async (callback) => callback(pdfTx))
    };
    const files = {
      uploadPrivateFile: jest.fn().mockResolvedValue({ id: "file-latest" })
    };
    const settlementService = new SettlementService(
      prisma as never,
      audit as never,
      undefined,
      undefined,
      files as never
    );

    const result = await settlementService.reviewApproval("settlement-1", "contract-director-1", {
      decision: "approve"
    });

    expect(result.status).toBe("approval_pending");
    expect(tx.settlement.update).toHaveBeenCalledWith({
      where: { id: "settlement-1" },
      data: { status: "approval_pending" }
    });
    expect(tx.approvalInstance.update).toHaveBeenCalledWith({
      where: { id: "approval-instance-1" },
      data: {
        currentNodeIndex: 0,
        frozenNodes: [
          {
            ...frozenNodes[0],
            approvedRoleKeys: ["contract_director"]
          }
        ],
        status: "in_progress"
      }
    });
    expect(files.uploadPrivateFile).toHaveBeenCalledWith(
      expect.objectContaining({
        originalName: "JS-2026-019-结算审批最新.pdf",
        uploadedByUserId: "contract-director-1",
        mimeType: "application/pdf"
      })
    );
    expect(pdfTx.pdfDocument.create).toHaveBeenCalledWith({
      data: {
        businessType: "settlement",
        businessId: "settlement-1",
        fileId: "file-latest",
        templateKey: "settlement_approval_latest"
      }
    });
  });

  it("records latest approval PDF refresh failures without failing an approval action", async () => {
    const tx = {
      settlement: {
        findUnique: jest.fn().mockResolvedValue({
          id: "settlement-1",
          projectId: "project-1",
          status: "approval_pending"
        }),
        update: jest.fn().mockResolvedValue({
          id: "settlement-1",
          status: "approval_pending"
        })
      },
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue({
          id: "approval-instance-1",
          currentNodeIndex: 0,
          frozenNodes: [
            {
              name: "合同部主管 + 预算部主管",
              mode: "all",
              roleKeys: ["contract_director", "budget_director"]
            }
          ]
        }),
        update: jest.fn()
      },
      approvalActionLog: {
        create: jest.fn()
      },
      ...approvalRoleTables("contract_director")
    };
    const renderTx = {
      settlement: {
        findUnique: jest.fn().mockResolvedValue({
          id: "settlement-1",
          projectId: "project-1",
          contractId: "contract-1",
          code: "JS-2026-019",
          periodLabel: "2026-06",
          status: "approval_pending",
          amountCents: 1_000_000,
          payableAmountCents: 800_000,
          paidAmountCents: 0,
          isFinal: false,
          finalCumulativeAmountCents: null
        }),
        findMany: jest.fn().mockResolvedValue([])
      },
      contract: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-1",
          code: "HT-2026-009",
          name: "幕墙分包合同",
          counterparty: "上海示例劳务有限公司",
          companyEntityName: "建工智管工程有限公司"
        })
      },
      project: {
        findUnique: jest.fn().mockResolvedValue({
          id: "project-1",
          name: "总部综合楼"
        })
      },
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue({
          id: "approval-instance-1",
          frozenNodes: [
            {
              name: "合同部主管 + 预算部主管",
              mode: "all",
              roleKeys: ["contract_director", "budget_director"]
            }
          ]
        })
      },
      approvalActionLog: {
        findMany: jest.fn().mockResolvedValue([
          {
            action: "approve",
            actorUserId: "contract-director-1",
            comment: "同意",
            createdAt: new Date("2026-07-03T09:00:00.000Z")
          }
        ])
      },
      user: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ id: "contract-director-1", name: "李合同", signatureFileId: null }])
      }
    };
    const failureAuditTx = {};
    const prisma = {
      $transaction: jest
        .fn()
        .mockImplementationOnce(async (callback) => callback(tx))
        .mockImplementationOnce(async (callback) => callback(renderTx))
        .mockImplementationOnce(async (callback) => callback(failureAuditTx))
    };
    const files = {
      uploadPrivateFile: jest.fn().mockRejectedValue(new Error("COS unavailable"))
    };
    const settlementService = new SettlementService(
      prisma as never,
      audit as never,
      undefined,
      undefined,
      files as never
    );

    const result = await settlementService.reviewApproval("settlement-1", "contract-director-1", {
      decision: "approve"
    });

    expect(result).toEqual({
      id: "settlement-1",
      status: "approval_pending"
    });
    expect(audit.record).toHaveBeenCalledWith(
      failureAuditTx,
      expect.objectContaining({
        actorUserId: "contract-director-1",
        action: "settlement.approval_pdf.refresh_failed",
        businessType: "settlement",
        businessId: "settlement-1",
        metadata: {
          templateKey: "settlement_approval_latest",
          errorMessage: "COS unavailable"
        }
      })
    );
  });

  it("completes a countersign settlement node after the remaining role approves", async () => {
    const frozenNodes = [
      {
        name: "合同部主管 + 预算部主管",
        mode: "all",
        roleKeys: ["contract_director", "budget_director"],
        approvedRoleKeys: ["contract_director"]
      }
    ];
    const tx = {
      settlement: {
        findUnique: jest.fn().mockResolvedValue({
          id: "settlement-1",
          projectId: "project-1",
          status: "approval_pending"
        }),
        update: jest.fn().mockResolvedValue({
          id: "settlement-1",
          status: "approved_pending_archive"
        })
      },
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue({
          id: "approval-instance-1",
          currentNodeIndex: 0,
          frozenNodes
        }),
        update: jest.fn()
      },
      approvalActionLog: {
        create: jest.fn()
      },
      ...approvalRoleTables("budget_director")
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const settlementService = new SettlementService(prisma as never, audit as never);

    const result = await settlementService.reviewApproval("settlement-1", "budget-director-1", {
      decision: "approve"
    });

    expect(result.status).toBe("approved_pending_archive");
    expect(tx.approvalInstance.update).toHaveBeenCalledWith({
      where: { id: "approval-instance-1" },
      data: {
        currentNodeIndex: 1,
        frozenNodes: [
          {
            ...frozenNodes[0],
            approvedRoleKeys: ["contract_director", "budget_director"]
          }
        ],
        status: "approved"
      }
    });
  });

  it("rejects a settlement approval to the previous frozen node", async () => {
    const frozenNodes = [
      {
        name: "物资主管",
        mode: "any",
        roleKeys: ["material_director"],
        approvedRoleKeys: ["material_director"]
      },
      {
        name: "合同部主管 + 预算部主管",
        mode: "all",
        roleKeys: ["contract_director", "budget_director"],
        approvedRoleKeys: ["contract_director", "budget_director"]
      },
      {
        name: "项目经理",
        mode: "any",
        roleKeys: ["project_manager"]
      }
    ];
    const tx = {
      settlement: {
        findUnique: jest.fn().mockResolvedValue({
          id: "settlement-1",
          projectId: "project-1",
          status: "approval_pending"
        }),
        update: jest.fn().mockResolvedValue({
          id: "settlement-1",
          status: "approval_pending"
        })
      },
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue({
          id: "approval-instance-1",
          currentNodeIndex: 2,
          frozenNodes
        }),
        update: jest.fn()
      },
      approvalActionLog: {
        create: jest.fn()
      },
      user: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ id: "project-manager-1", name: "赵经理", signatureFileId: null }])
      },
      ...approvalRoleTables("project_manager")
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const settlementService = new SettlementService(prisma as never, audit as never);

    const result = await settlementService.reviewApproval("settlement-1", "project-manager-1", {
      decision: "reject_previous",
      comment: "请上一节点复核结算依据"
    });

    expect(result.status).toBe("approval_pending");
    expect(tx.approvalInstance.update).toHaveBeenCalledWith({
      where: { id: "approval-instance-1" },
      data: {
        currentNodeIndex: 1,
        frozenNodes: [
          frozenNodes[0],
          {
            ...frozenNodes[1],
            approvedRoleKeys: []
          },
          {
            ...frozenNodes[2],
            approvedRoleKeys: []
          }
        ],
        status: "in_progress"
      }
    });
    expect(tx.approvalActionLog.create).toHaveBeenCalledWith({
      data: {
        approvalInstanceId: "approval-instance-1",
        action: "reject_previous",
        actorUserId: "project-manager-1",
        comment: "请上一节点复核结算依据",
        metadata: {
          nodeName: "项目经理",
          roleKey: "project_manager",
          roleName: "项目经理",
          approverName: "赵经理"
        }
      }
    });
    expect(audit.record).toHaveBeenCalledWith(tx, {
      actorUserId: "project-manager-1",
      action: "settlement.approval.reject_previous",
      businessType: "settlement",
      businessId: "settlement-1",
      metadata: {
        fromStatus: "approval_pending",
        toStatus: "approval_pending",
        fromNodeName: "项目经理",
        toNodeName: "合同部主管 + 预算部主管"
      }
    });
  });

  it("rejects returning to a previous node from the first settlement approval node", async () => {
    const tx = {
      settlement: {
        findUnique: jest.fn().mockResolvedValue({
          id: "settlement-1",
          projectId: "project-1",
          status: "approval_pending"
        }),
        update: jest.fn()
      },
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue({
          id: "approval-instance-1",
          currentNodeIndex: 0,
          frozenNodes: [{ name: "物资员", mode: "any", roleKeys: ["material_staff"] }]
        }),
        update: jest.fn()
      },
      approvalActionLog: {
        create: jest.fn()
      },
      ...approvalRoleTables("material_staff")
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const settlementService = new SettlementService(prisma as never, audit as never);

    await expect(
      settlementService.reviewApproval("settlement-1", "material-staff-1", {
        decision: "reject_previous",
        comment: "无法退回上一节点"
      })
    ).rejects.toThrow("当前已是第一个审批节点，不能退回上一节点");
    expect(tx.settlement.update).not.toHaveBeenCalled();
  });

  it("returns a settlement approval to the applicant and closes the instance", async () => {
    const tx = {
      settlement: {
        findUnique: jest.fn().mockResolvedValue({
          id: "settlement-1",
          projectId: "project-1",
          status: "approval_pending"
        }),
        update: jest.fn().mockResolvedValue({
          id: "settlement-1",
          status: "approval_rejected"
        })
      },
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue({
          id: "approval-instance-1",
          currentNodeIndex: 0,
          frozenNodes: [{ name: "物资主管", mode: "any", roleKeys: ["material_director"] }]
        }),
        update: jest.fn()
      },
      approvalActionLog: {
        create: jest.fn()
      },
      user: {
        findMany: jest.fn().mockResolvedValue([
          { id: "material-director-1", name: "钱物资", signatureFileId: null }
        ])
      },
      projectSettlementExceptionQuotaUsage: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 })
      },
      ...approvalRoleTables("material_director")
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const settlementService = new SettlementService(prisma as never, audit as never);

    const result = await settlementService.reviewApproval("settlement-1", "material-director-1", {
      decision: "return_to_applicant",
      comment: "退回申请人补充资料"
    });

    expect(result.status).toBe("approval_rejected");
    expect(tx.approvalInstance.update).toHaveBeenCalledWith({
      where: { id: "approval-instance-1" },
      data: { status: "returned_to_applicant" }
    });
    expect(tx.approvalActionLog.create).toHaveBeenCalledWith({
      data: {
        approvalInstanceId: "approval-instance-1",
        action: "return_to_applicant",
        actorUserId: "material-director-1",
        comment: "退回申请人补充资料",
        metadata: {
          nodeName: "物资主管",
          roleKey: "material_director",
          roleName: "物资主管",
          approverName: "钱物资"
        }
      }
    });
    expect(tx.projectSettlementExceptionQuotaUsage.updateMany).toHaveBeenCalledWith({
      where: { settlementId: "settlement-1", status: "occupied" },
      data: { status: "released" }
    });
    expect(audit.record).toHaveBeenCalledWith(tx, {
      actorUserId: "material-director-1",
      action: "settlement.exception_quota.release.return_to_applicant",
      businessType: "settlement",
      businessId: "settlement-1",
      metadata: { releasedUsageCount: 1 }
    });
    expect(audit.record).toHaveBeenCalledWith(tx, {
      actorUserId: "material-director-1",
      action: "settlement.approval.return_to_applicant",
      businessType: "settlement",
      businessId: "settlement-1",
      metadata: {
        fromStatus: "approval_pending",
        toStatus: "approval_rejected",
        nodeName: "物资主管"
      }
    });
  });

  it("allows the settlement approval applicant to withdraw before approval completes", async () => {
    const tx = {
      settlement: {
        findUnique: jest.fn().mockResolvedValue({
          id: "settlement-1",
          projectId: "project-1",
          status: "approval_pending"
        }),
        update: jest.fn().mockResolvedValue({
          id: "settlement-1",
          status: "withdrawn"
        })
      },
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue({
          id: "approval-instance-1",
          applicantUserId: "applicant-1"
        }),
        update: jest.fn()
      },
      approvalActionLog: {
        create: jest.fn()
      },
      projectSettlementExceptionQuotaUsage: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 })
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const settlementService = new SettlementService(prisma as never, audit as never);

    const result = await settlementService.withdrawApproval("settlement-1", "applicant-1");

    expect(result.status).toBe("withdrawn");
    expect(tx.settlement.update).toHaveBeenCalledWith({
      where: { id: "settlement-1" },
      data: { status: "withdrawn" }
    });
    expect(tx.approvalInstance.update).toHaveBeenCalledWith({
      where: { id: "approval-instance-1" },
      data: { status: "withdrawn" }
    });
    expect(tx.approvalActionLog.create).toHaveBeenCalledWith({
      data: {
        approvalInstanceId: "approval-instance-1",
        action: "withdraw",
        actorUserId: "applicant-1"
      }
    });
    expect(tx.projectSettlementExceptionQuotaUsage.updateMany).toHaveBeenCalledWith({
      where: { settlementId: "settlement-1", status: "occupied" },
      data: { status: "released" }
    });
    expect(audit.record).toHaveBeenCalledWith(tx, {
      actorUserId: "applicant-1",
      action: "settlement.exception_quota.release.withdraw",
      businessType: "settlement",
      businessId: "settlement-1",
      metadata: { releasedUsageCount: 1 }
    });
    expect(audit.record).toHaveBeenCalledWith(tx, {
      actorUserId: "applicant-1",
      action: "settlement.approval.withdraw",
      businessType: "settlement",
      businessId: "settlement-1",
      metadata: {
        fromStatus: "approval_pending",
        toStatus: "withdrawn",
        applicantUserId: "applicant-1"
      }
    });
  });

  it("rejects settlement approval withdrawal from a non-applicant", async () => {
    const tx = {
      settlement: {
        findUnique: jest.fn().mockResolvedValue({
          id: "settlement-1",
          projectId: "project-1",
          status: "approval_pending"
        }),
        update: jest.fn()
      },
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue({
          id: "approval-instance-1",
          applicantUserId: "applicant-1"
        }),
        update: jest.fn()
      },
      approvalActionLog: {
        create: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const settlementService = new SettlementService(prisma as never, audit as never);

    await expect(
      settlementService.withdrawApproval("settlement-1", "other-user")
    ).rejects.toThrow("只有结算审批申请人可以撤回");
    expect(tx.settlement.update).not.toHaveBeenCalled();
    expect(tx.approvalInstance.update).not.toHaveBeenCalled();
    expect(tx.approvalActionLog.create).not.toHaveBeenCalled();
  });

  it("结算单不存在时不能撤回审批", async () => {
    const tx = {
      settlement: {
        findUnique: jest.fn().mockResolvedValue(null),
        update: jest.fn()
      },
      approvalInstance: {
        findFirst: jest.fn(),
        update: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const settlementService = new SettlementService(prisma as never, audit as never);

    await expect(
      settlementService.withdrawApproval("settlement-missing", "applicant-1")
    ).rejects.toThrow("未找到结算单，请刷新结算台账后重试");
    expect(tx.approvalInstance.findFirst).not.toHaveBeenCalled();
    expect(tx.settlement.update).not.toHaveBeenCalled();
  });

  it("rejects settlement approval withdrawal after approval has left pending status", async () => {
    const tx = {
      settlement: {
        findUnique: jest.fn().mockResolvedValue({
          id: "settlement-1",
          projectId: "project-1",
          status: "approved_pending_archive"
        }),
        update: jest.fn()
      },
      approvalInstance: {
        findFirst: jest.fn(),
        update: jest.fn()
      },
      approvalActionLog: {
        create: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const settlementService = new SettlementService(prisma as never, audit as never);

    await expect(
      settlementService.withdrawApproval("settlement-1", "applicant-1")
    ).rejects.toThrow("当前结算单已不在审批中，不能撤回审批");
    expect(tx.approvalInstance.findFirst).not.toHaveBeenCalled();
    expect(tx.settlement.update).not.toHaveBeenCalled();
  });

  it("缺少进行中的结算审批流程时不能撤回审批", async () => {
    const tx = {
      settlement: {
        findUnique: jest.fn().mockResolvedValue({
          id: "settlement-1",
          projectId: "project-1",
          status: "approval_pending"
        }),
        update: jest.fn()
      },
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const settlementService = new SettlementService(prisma as never, audit as never);

    await expect(
      settlementService.withdrawApproval("settlement-1", "applicant-1")
    ).rejects.toThrow("未找到进行中的结算审批流程，请刷新后重试");
    expect(tx.settlement.update).not.toHaveBeenCalled();
    expect(tx.approvalInstance.update).not.toHaveBeenCalled();
  });

  it("transfers the current settlement approval node to a target user", async () => {
    const frozenNodes = [{ name: "物资主管", mode: "any", roleKeys: ["material_director"] }];
    const tx = {
      settlement: {
        findUnique: jest.fn().mockResolvedValue({
          id: "settlement-1",
          projectId: "project-1",
          status: "approval_pending"
        })
      },
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue({
          id: "approval-instance-1",
          currentNodeIndex: 0,
          frozenNodes
        }),
        update: jest.fn().mockResolvedValue({ id: "approval-instance-1" })
      },
      approvalActionLog: {
        create: jest.fn()
      },
      ...approvalRoleTables("material_director")
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const settlementService = new SettlementService(prisma as never, audit as never);

    await settlementService.transferApproval("settlement-1", "material-director-1", {
      toUserId: "delegate-user-1"
    });

    expect(tx.approvalInstance.update).toHaveBeenCalledWith({
      where: { id: "approval-instance-1" },
      data: {
        frozenNodes: [
          {
            ...frozenNodes[0],
            assignments: [
              {
                kind: "transfer",
                fromUserId: "material-director-1",
                fromRoleKey: "material_director",
                toUserId: "delegate-user-1"
              }
            ]
          }
        ]
      }
    });
    expect(tx.approvalActionLog.create).toHaveBeenCalledWith({
      data: {
        approvalInstanceId: "approval-instance-1",
        action: "transfer",
        actorUserId: "material-director-1"
      }
    });
    expect(audit.record).toHaveBeenCalledWith(tx, {
      actorUserId: "material-director-1",
      action: "settlement.approval.transfer",
      businessType: "settlement",
      businessId: "settlement-1",
      metadata: {
        nodeName: "物资主管",
        fromRoleKey: "material_director",
        toUserId: "delegate-user-1"
      }
    });
  });

  it("结算审批转交接收人无效时直接拒绝", async () => {
    const prisma = {
      $transaction: jest.fn()
    };
    const settlementService = new SettlementService(prisma as never, audit as never);

    await expect(
      settlementService.transferApproval("settlement-1", "material-director-1", {
        toUserId: "material-director-1"
      })
    ).rejects.toThrow("请选择有效的接收人，且不能选择当前操作人自己");
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("结算单不存在时不能转交审批", async () => {
    const tx = {
      settlement: {
        findUnique: jest.fn().mockResolvedValue(null)
      },
      approvalInstance: {
        findFirst: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const settlementService = new SettlementService(prisma as never, audit as never);

    await expect(
      settlementService.transferApproval("settlement-missing", "material-director-1", {
        toUserId: "delegate-user-1"
      })
    ).rejects.toThrow("未找到结算单，请刷新结算台账后重试");
    expect(tx.approvalInstance.findFirst).not.toHaveBeenCalled();
  });

  it("结算单不在审批中时不能转交审批", async () => {
    const tx = {
      settlement: {
        findUnique: jest.fn().mockResolvedValue({
          id: "settlement-1",
          projectId: "project-1",
          status: "effective"
        })
      },
      approvalInstance: {
        findFirst: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const settlementService = new SettlementService(prisma as never, audit as never);

    await expect(
      settlementService.transferApproval("settlement-1", "material-director-1", {
        toUserId: "delegate-user-1"
      })
    ).rejects.toThrow("当前结算单已不在审批中，不能转交或委托审批");
    expect(tx.approvalInstance.findFirst).not.toHaveBeenCalled();
  });

  it("缺少进行中的结算审批流程时不能转交审批", async () => {
    const tx = {
      settlement: {
        findUnique: jest.fn().mockResolvedValue({
          id: "settlement-1",
          projectId: "project-1",
          status: "approval_pending"
        })
      },
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const settlementService = new SettlementService(prisma as never, audit as never);

    await expect(
      settlementService.transferApproval("settlement-1", "material-director-1", {
        toUserId: "delegate-user-1"
      })
    ).rejects.toThrow("未找到进行中的结算审批流程，请刷新后重试");
    expect(tx.approvalInstance.update).not.toHaveBeenCalled();
  });

  it("当前结算审批节点异常时不能转交审批", async () => {
    const tx = {
      settlement: {
        findUnique: jest.fn().mockResolvedValue({
          id: "settlement-1",
          projectId: "project-1",
          status: "approval_pending"
        })
      },
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue({
          id: "approval-instance-1",
          currentNodeIndex: 0,
          frozenNodes: []
        }),
        update: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const settlementService = new SettlementService(prisma as never, audit as never);

    await expect(
      settlementService.transferApproval("settlement-1", "material-director-1", {
        toUserId: "delegate-user-1"
      })
    ).rejects.toThrow("当前结算审批节点异常，请联系管理员核对审批流程");
    expect(tx.approvalInstance.update).not.toHaveBeenCalled();
  });

  it("当前账号无权处理结算审批节点时不能转交审批", async () => {
    const frozenNodes = [{ name: "物资主管", mode: "any", roleKeys: ["material_director"] }];
    const tx = {
      settlement: {
        findUnique: jest.fn().mockResolvedValue({
          id: "settlement-1",
          projectId: "project-1",
          status: "approval_pending"
        })
      },
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue({
          id: "approval-instance-1",
          currentNodeIndex: 0,
          frozenNodes
        }),
        update: jest.fn()
      },
      ...approvalRoleTables("employee")
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const settlementService = new SettlementService(prisma as never, audit as never);

    await expect(
      settlementService.transferApproval("settlement-1", "intruder-1", {
        toUserId: "delegate-user-1"
      })
    ).rejects.toThrow("当前账号不能转交或委托“物资主管”节点，请确认是否为该节点审批人");
    expect(tx.approvalInstance.update).not.toHaveBeenCalled();
  });

  it("lets the transferred user approve as the source role", async () => {
    const frozenNodes = [
      {
        name: "物资主管",
        mode: "any",
        roleKeys: ["material_director"],
        assignments: [
          {
            kind: "transfer",
            fromUserId: "material-director-1",
            fromRoleKey: "material_director",
            toUserId: "delegate-user-1"
          }
        ]
      }
    ];
    const tx = {
      settlement: {
        findUnique: jest.fn().mockResolvedValue({
          id: "settlement-1",
          projectId: "project-1",
          status: "approval_pending"
        }),
        update: jest.fn().mockResolvedValue({
          id: "settlement-1",
          status: "approved_pending_archive"
        })
      },
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue({
          id: "approval-instance-1",
          currentNodeIndex: 0,
          frozenNodes
        }),
        update: jest.fn()
      },
      approvalActionLog: {
        create: jest.fn()
      },
      ...approvalRoleTables("employee")
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const settlementService = new SettlementService(prisma as never, audit as never);

    const result = await settlementService.reviewApproval("settlement-1", "delegate-user-1", {
      decision: "approve"
    });

    expect(result.status).toBe("approved_pending_archive");
    expect(tx.approvalInstance.update).toHaveBeenCalledWith({
      where: { id: "approval-instance-1" },
      data: {
        currentNodeIndex: 1,
        frozenNodes: [
          {
            ...frozenNodes[0],
            approvedRoleKeys: ["material_director"]
          }
        ],
        status: "approved"
      }
    });
  });

  it("lets a standing delegate approve as the delegator's node role", async () => {
    const frozenNodes = [{ name: "物资主管", mode: "any", roleKeys: ["material_director"] }];
    const tx = {
      settlement: {
        findUnique: jest.fn().mockResolvedValue({
          id: "settlement-1",
          projectId: "project-1",
          status: "approval_pending"
        }),
        update: jest.fn().mockResolvedValue({
          id: "settlement-1",
          status: "approved_pending_archive"
        })
      },
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue({
          id: "approval-instance-1",
          currentNodeIndex: 0,
          frozenNodes
        }),
        update: jest.fn()
      },
      approvalActionLog: {
        create: jest.fn()
      },
      userPosition: {
        findMany: jest.fn().mockResolvedValue([])
      },
      position: {
        findMany: jest.fn().mockResolvedValue([])
      },
      projectMember: {
        findMany: jest.fn(({ where }: { where: { userId: string } }) =>
          Promise.resolve(
            where.userId === "delegator-1" ? [{ positionKey: "material_director" }] : []
          )
        )
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const delegations = {
      activeDelegatorIds: jest.fn().mockResolvedValue(["delegator-1"])
    };
    const settlementService = new SettlementService(
      prisma as never,
      audit as never,
      auth as never,
      delegations as never
    );

    const result = await settlementService.reviewApproval("settlement-1", "delegate-user-1", {
      decision: "approve"
    });

    expect(result.status).toBe("approved_pending_archive");
    expect(delegations.activeDelegatorIds).toHaveBeenCalledWith(tx, "delegate-user-1");
    expect(tx.approvalInstance.update).toHaveBeenCalledWith({
      where: { id: "approval-instance-1" },
      data: {
        currentNodeIndex: 1,
        frozenNodes: [
          {
            ...frozenNodes[0],
            approvedRoleKeys: ["material_director"]
          }
        ],
        status: "approved"
      }
    });
  });

  it("rejects approval from a user without role, assignment, or active delegation", async () => {
    const frozenNodes = [{ name: "物资主管", mode: "any", roleKeys: ["material_director"] }];
    const tx = {
      settlement: {
        findUnique: jest.fn().mockResolvedValue({
          id: "settlement-1",
          projectId: "project-1",
          status: "approval_pending"
        }),
        update: jest.fn()
      },
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue({
          id: "approval-instance-1",
          currentNodeIndex: 0,
          frozenNodes
        }),
        update: jest.fn()
      },
      approvalActionLog: {
        create: jest.fn()
      },
      ...approvalRoleTables("employee")
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const delegations = {
      activeDelegatorIds: jest.fn().mockResolvedValue([])
    };
    const settlementService = new SettlementService(
      prisma as never,
      audit as never,
      auth as never,
      delegations as never
    );

    await expect(
      settlementService.reviewApproval("settlement-1", "intruder-1", { decision: "approve" })
    ).rejects.toThrow("当前账号不能处理“物资主管”节点，请确认是否为该节点审批人");
    expect(tx.settlement.update).not.toHaveBeenCalled();
  });

  it("delegates the current settlement approval node to a target user", async () => {
    const frozenNodes = [{ name: "项目经理", mode: "any", roleKeys: ["project_manager"] }];
    const tx = {
      settlement: {
        findUnique: jest.fn().mockResolvedValue({
          id: "settlement-1",
          projectId: "project-1",
          status: "approval_pending"
        })
      },
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue({
          id: "approval-instance-1",
          currentNodeIndex: 0,
          frozenNodes
        }),
        update: jest.fn().mockResolvedValue({ id: "approval-instance-1" })
      },
      approvalActionLog: {
        create: jest.fn()
      },
      approvalDelegation: {
        create: jest.fn()
      },
      ...approvalRoleTables("project_manager")
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const settlementService = new SettlementService(prisma as never, audit as never);

    await settlementService.delegateApproval("settlement-1", "project-manager-1", {
      toUserId: "agent-user-1"
    });

    expect(tx.approvalInstance.update).toHaveBeenCalledWith({
      where: { id: "approval-instance-1" },
      data: {
        frozenNodes: [
          {
            ...frozenNodes[0],
            assignments: [
              {
                kind: "delegate",
                fromUserId: "project-manager-1",
                fromRoleKey: "project_manager",
                toUserId: "agent-user-1"
              }
            ]
          }
        ]
      }
    });
    expect(tx.approvalActionLog.create).toHaveBeenCalledWith({
      data: {
        approvalInstanceId: "approval-instance-1",
        action: "delegate",
        actorUserId: "project-manager-1"
      }
    });
    expect(tx.approvalDelegation.create).toHaveBeenCalledWith({
      data: {
        fromUserId: "project-manager-1",
        toUserId: "agent-user-1",
        startsAt: expect.any(Date),
        endsAt: expect.any(Date)
      }
    });
  });

  it("confirms a signed settlement archive file and makes the settlement effective", async () => {
    const tx = {
      settlement: {
        findUnique: jest.fn().mockResolvedValue({
          id: "settlement-1",
          status: "pending_archive_confirm"
        }),
        update: jest.fn().mockResolvedValue({
          id: "settlement-1",
          status: "effective"
        })
      },
      settlementArchiveFile: {
        findFirst: jest.fn().mockResolvedValue({
          id: "settlement-archive-file-1",
          status: "pending_confirm"
        }),
        update: jest.fn().mockResolvedValue({
          id: "settlement-archive-file-1",
          status: "confirmed"
        })
      },
      projectSettlementExceptionQuotaUsage: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 })
      },
      auditLog: {
        create: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const settlementService = new SettlementService(prisma as never, audit as never, auth as never);

    const result = await settlementService.confirmArchiveFile(
      "settlement-1",
      "user-contract-director",
      {
        archiveFileId: "settlement-archive-file-1",
        confirmationPassword: "current-password"
      }
    );

    expect(result.status).toBe("effective");
    expect(auth.confirmPassword).toHaveBeenCalledWith(
      "user-contract-director",
      "current-password"
    );
    expect(tx.settlementArchiveFile.update).toHaveBeenCalledWith({
      where: { id: "settlement-archive-file-1" },
      data: {
        confirmedByUserId: "user-contract-director",
        confirmedAt: expect.any(Date),
        status: "confirmed"
      }
    });
    expect(tx.settlement.update).toHaveBeenCalledWith({
      where: { id: "settlement-1" },
      data: { status: "effective" }
    });
    expect(tx.projectSettlementExceptionQuotaUsage.updateMany).toHaveBeenCalledWith({
      where: { settlementId: "settlement-1", status: "occupied" },
      data: { status: "used" }
    });
    expect(audit.record).toHaveBeenCalledWith(tx, {
      actorUserId: "user-contract-director",
      action: "settlement.exception_quota.use",
      businessType: "settlement",
      businessId: "settlement-1",
      metadata: { usedUsageCount: 1 }
    });
    expect(audit.record).toHaveBeenCalledWith(tx, {
      actorUserId: "user-contract-director",
      action: "settlement.archive.confirm",
      businessType: "settlement",
      businessId: "settlement-1",
      metadata: {
        archiveFileId: "settlement-archive-file-1"
      }
    });
  });

  it("rejects settlement archive confirmation without a confirmation password", async () => {
    const prisma = {
      $transaction: jest.fn()
    };
    const settlementService = new SettlementService(prisma as never, audit as never, auth as never);

    await expect(
      settlementService.confirmArchiveFile("settlement-1", "user-contract-director", {
        archiveFileId: "settlement-archive-file-1",
        confirmationPassword: ""
      })
    ).rejects.toThrow("确认结算归档需要当前登录密码");
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(auth.confirmPassword).not.toHaveBeenCalled();
  });

  it("结算归档确认服务不可用时给出中文业务提示", async () => {
    const settlementService = new SettlementService(undefined as never, audit as never, auth as never);

    await expect(
      settlementService.confirmArchiveFile("settlement-1", "user-contract-director", {
        archiveFileId: "settlement-archive-file-1",
        confirmationPassword: "current-password"
      })
    ).rejects.toThrow("结算归档确认服务暂不可用，请稍后重试或联系管理员");
    expect(auth.confirmPassword).not.toHaveBeenCalled();
  });

  it("结算归档确认密码服务不可用时给出中文业务提示", async () => {
    const prisma = {
      $transaction: jest.fn()
    };
    const settlementService = new SettlementService(prisma as never, audit as never);

    await expect(
      settlementService.confirmArchiveFile("settlement-1", "user-contract-director", {
        archiveFileId: "settlement-archive-file-1",
        confirmationPassword: "current-password"
      })
    ).rejects.toThrow("当前密码校验服务暂不可用，请稍后重试或联系管理员");
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("结算单不存在时不能确认归档", async () => {
    const tx = {
      settlement: {
        findUnique: jest.fn().mockResolvedValue(null),
        update: jest.fn()
      },
      settlementArchiveFile: {
        findFirst: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const settlementService = new SettlementService(prisma as never, audit as never, auth as never);

    await expect(
      settlementService.confirmArchiveFile("settlement-missing", "user-contract-director", {
        archiveFileId: "settlement-archive-file-1",
        confirmationPassword: "current-password"
      })
    ).rejects.toThrow("未找到结算单，请刷新结算台账后重试");
    expect(tx.settlementArchiveFile.findFirst).not.toHaveBeenCalled();
    expect(tx.settlement.update).not.toHaveBeenCalled();
  });

  it("结算单尚未上传归档文件时不能确认归档", async () => {
    const tx = {
      settlement: {
        findUnique: jest.fn().mockResolvedValue({
          id: "settlement-1",
          status: "approved_pending_archive"
        }),
        update: jest.fn()
      },
      settlementArchiveFile: {
        findFirst: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const settlementService = new SettlementService(prisma as never, audit as never, auth as never);

    await expect(
      settlementService.confirmArchiveFile("settlement-1", "user-contract-director", {
        archiveFileId: "settlement-archive-file-1",
        confirmationPassword: "current-password"
      })
    ).rejects.toThrow("当前结算单尚不能确认归档，请先上传已签署的结算归档文件");
    expect(tx.settlementArchiveFile.findFirst).not.toHaveBeenCalled();
    expect(tx.settlement.update).not.toHaveBeenCalled();
  });

  it("待确认结算归档文件不存在时不能确认归档", async () => {
    const tx = {
      settlement: {
        findUnique: jest.fn().mockResolvedValue({
          id: "settlement-1",
          status: "pending_archive_confirm"
        }),
        update: jest.fn()
      },
      settlementArchiveFile: {
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const settlementService = new SettlementService(prisma as never, audit as never, auth as never);

    await expect(
      settlementService.confirmArchiveFile("settlement-1", "user-contract-director", {
        archiveFileId: "settlement-archive-file-missing",
        confirmationPassword: "current-password"
      })
    ).rejects.toThrow("未找到待确认的结算归档文件，请刷新后重试");
    expect(tx.settlementArchiveFile.update).not.toHaveBeenCalled();
    expect(tx.settlement.update).not.toHaveBeenCalled();
  });

  it("已处理的结算归档文件不能重复确认", async () => {
    const tx = {
      settlement: {
        findUnique: jest.fn().mockResolvedValue({
          id: "settlement-1",
          status: "pending_archive_confirm"
        }),
        update: jest.fn()
      },
      settlementArchiveFile: {
        findFirst: jest.fn().mockResolvedValue({
          id: "settlement-archive-file-1",
          status: "confirmed"
        }),
        update: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const settlementService = new SettlementService(prisma as never, audit as never, auth as never);

    await expect(
      settlementService.confirmArchiveFile("settlement-1", "user-contract-director", {
        archiveFileId: "settlement-archive-file-1",
        confirmationPassword: "current-password"
      })
    ).rejects.toThrow("该结算归档文件已处理，不能重复确认");
    expect(tx.settlementArchiveFile.update).not.toHaveBeenCalled();
    expect(tx.settlement.update).not.toHaveBeenCalled();
  });

  it("exports a draft settlement Excel sheet with the settlement template layout", async () => {
    const tx = {
      settlement: {
        findUnique: jest.fn().mockResolvedValue({
          id: "settlement-1",
          projectId: "project-1",
          contractId: "contract-1",
          contractVersionId: "contract-version-1",
          paymentTermsVersionId: "terms-1",
          code: "JS-2026-019",
          periodLabel: "2026-06",
          status: "approval_pending",
          amountCents: 1_000_000,
          payableAmountCents: 800_000,
          paidAmountCents: 0,
          isFinal: false,
          createdAt: new Date("2026-07-01T00:00:00.000Z")
        }),
        findMany: jest.fn().mockResolvedValue([
          { amountCents: 300_000 }
        ])
      },
      contract: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-1",
          code: "HT-2026-009",
          name: "幕墙分包合同",
          counterparty: "上海示例劳务有限公司",
          companyEntityName: "建工智管工程有限公司"
        })
      },
      project: {
        findUnique: jest.fn().mockResolvedValue({
          id: "project-1",
          name: "总部综合楼"
        })
      },
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue(null)
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const settlementService = new SettlementService(prisma as never, audit as never);

    const result = await settlementService.exportDraftExcel("settlement-1", "contract-staff-1");
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(result.buffer as unknown as ExcelJS.Buffer);

    expect(result.fileName).toBe("JS-2026-019-结算单-草稿.xlsx");
    expect(workbook.getWorksheet("结算单")?.getCell("A2").value).toBe("草稿 DRAFT");
    expect(workbook.getWorksheet("结算单")?.pageSetup.orientation).toBe("landscape");
  });

  it("rejects draft settlement Excel export when the export service is unavailable", async () => {
    await expect(service.exportDraftExcel("settlement-1", "contract-staff-1")).rejects.toThrow(
      "结算明细表导出服务暂不可用，请稍后重试或联系管理员"
    );
  });

  it("rejects draft settlement Excel export when the settlement is missing", async () => {
    const tx = {
      settlement: {
        findUnique: jest.fn().mockResolvedValue(null)
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const settlementService = new SettlementService(prisma as never, audit as never);

    await expect(settlementService.exportDraftExcel("settlement-missing", "contract-staff-1")).rejects.toThrow(
      "结算单不存在，无法导出结算明细表。请刷新结算台账后重试"
    );
  });

  it("rejects draft settlement Excel export after the draft stage", async () => {
    const tx = {
      settlement: {
        findUnique: jest.fn().mockResolvedValue({
          id: "settlement-1",
          status: "effective"
        })
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const settlementService = new SettlementService(prisma as never, audit as never);

    await expect(settlementService.exportDraftExcel("settlement-1", "contract-staff-1")).rejects.toThrow(
      "当前结算单不是待审批或已退回状态，不能导出草稿明细表。请在结算发起或退回后再导出"
    );
  });

  it("exports approval signature rows with frozen node names, role labels, and approver names", async () => {
    const tx = {
      settlement: {
        findUnique: jest.fn().mockResolvedValue({
          id: "settlement-1",
          projectId: "project-1",
          contractId: "contract-1",
          contractVersionId: "contract-version-1",
          paymentTermsVersionId: "terms-1",
          code: "JS-2026-019",
          periodLabel: "2026-06",
          status: "approval_pending",
          amountCents: 1_000_000,
          payableAmountCents: 800_000,
          paidAmountCents: 0,
          isFinal: false,
          finalCumulativeAmountCents: null
        }),
        findMany: jest.fn().mockResolvedValue([])
      },
      contract: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-1",
          code: "HT-2026-009",
          name: "幕墙分包合同",
          counterparty: "上海示例劳务有限公司",
          companyEntityName: "建工智管工程有限公司"
        })
      },
      project: {
        findUnique: jest.fn().mockResolvedValue({
          id: "project-1",
          name: "总部综合楼"
        })
      },
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue({
          id: "approval-instance-1",
          currentNodeIndex: 1,
          frozenNodes: [
            { name: "物资员", mode: "any", roleKeys: ["material_staff"] },
            {
              name: "合同部主管 + 预算部主管",
              mode: "all",
              roleKeys: ["contract_director", "budget_director"]
            }
          ]
        })
      },
      approvalActionLog: {
        findMany: jest.fn().mockResolvedValue([
          {
            action: "approve",
            actorUserId: "material-staff-1",
            comment: "数量属实",
            createdAt: new Date("2026-07-03T09:00:00.000Z"),
            metadata: {
              nodeName: "物资员",
              roleKey: "material_staff",
              roleName: "物资员",
              approverName: "王材料"
            }
          },
          {
            action: "approve",
            actorUserId: "contract-director-1",
            comment: "同意",
            createdAt: new Date("2026-07-03T10:00:00.000Z"),
            metadata: {
              nodeName: "合同部主管 + 预算部主管",
              roleKey: "contract_director",
              roleName: "合同部主管",
              approverName: "李合同"
            }
          }
        ])
      },
      userPosition: {
        findMany: jest.fn().mockResolvedValue([])
      },
      projectMember: {
        findMany: jest.fn().mockResolvedValue([{ positionKey: "employee" }])
      },
      position: {
        findMany: jest.fn().mockResolvedValue([])
      },
      user: {
        findMany: jest.fn().mockResolvedValue([
          { id: "material-staff-1", name: "王材料", signatureFileId: null },
          { id: "contract-director-1", name: "李合同", signatureFileId: null }
        ])
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const settlementService = new SettlementService(prisma as never, audit as never);

    const result = await settlementService.exportDraftExcel("settlement-1", "contract-staff-1");
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(result.buffer as unknown as ExcelJS.Buffer);
    const rows = workbook.getWorksheet("结算单")?.getSheetValues() as ExcelJS.CellValue[][];

    expect(rows.some((row) => row?.includes("物资员") && row.includes("物资员"))).toBe(true);
    expect(rows.some((row) => row?.includes("王材料") && row.includes("数量属实"))).toBe(true);
    expect(
      rows.some(
        (row) =>
          row?.includes("合同部主管 + 预算部主管") &&
          row.includes("合同部主管") &&
          row.includes("李合同")
      )
    ).toBe(true);
    expect(
      rows.some((row) => Array.isArray(row) && row[2] === "审批角色" && row[3] === "李合同")
    ).toBe(false);
    expect(rows.flat()).not.toContain("contract-director-1");
  });

  it("generates a settlement PDF file and records its archive", async () => {
    const tx = {
      settlement: {
        findUnique: jest.fn().mockResolvedValue({
          id: "settlement-1",
          projectId: "project-1",
          contractId: "contract-1",
          code: "JS-2026-019",
          periodLabel: "2026-06",
          status: "approved_pending_archive",
          amountCents: 1_000_000,
          payableAmountCents: 800_000,
          paidAmountCents: 0,
          isFinal: false
        }),
        findMany: jest.fn().mockResolvedValue([
          { amountCents: 300_000 }
        ])
      },
      contract: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-1",
          code: "HT-2026-009",
          name: "幕墙分包合同",
          counterparty: "上海示例劳务有限公司",
          companyEntityName: "建工智管工程有限公司"
        })
      },
      project: {
        findUnique: jest.fn().mockResolvedValue({
          id: "project-1",
          name: "总部综合楼"
        })
      },
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue(null)
      },
      pdfDocument: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: "pdf-1" })
      },
      archiveRecord: {
        create: jest.fn().mockResolvedValue({ id: "archive-1" })
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const files = {
      uploadPrivateFile: jest.fn().mockResolvedValue({ id: "file-generated" })
    };
    const settlementService = new SettlementService(
      prisma as never,
      audit as never,
      undefined,
      undefined,
      files as never
    );

    const result = await settlementService.generatePdfArchive("settlement-1", "contract-staff-1");

    expect(result.pdfDocument.id).toBe("pdf-1");
    expect(files.uploadPrivateFile).toHaveBeenCalledWith({
      originalName: "JS-2026-019-settlement_archive.pdf",
      mimeType: "application/pdf",
      sizeBytes: expect.any(Number),
      uploadedByUserId: "contract-staff-1",
      buffer: expect.any(Buffer)
    });
    const uploadedBuffer = files.uploadPrivateFile.mock.calls[0][0].buffer as Buffer;
    expect(uploadedBuffer.subarray(0, 5).toString("ascii")).toBe("%PDF-");
    expect(tx.pdfDocument.create).toHaveBeenCalledWith({
      data: {
        businessType: "settlement",
        businessId: "settlement-1",
        fileId: "file-generated",
        templateKey: "settlement_archive"
      }
    });
  });

  it("downloads the latest in-progress settlement approval PDF", async () => {
    const tx = {
      settlement: {
        findUnique: jest.fn().mockResolvedValue({
          id: "settlement-1",
          code: "JS-2026-019"
        })
      },
      pdfDocument: {
        findFirst: jest.fn().mockResolvedValue({
          id: "pdf-latest",
          fileId: "file-latest"
        })
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const files = {
      assertCanDownloadFileById: jest.fn().mockResolvedValue(undefined),
      getFileBuffer: jest.fn().mockResolvedValue({ buffer: Buffer.from("%PDF-latest") })
    };
    const settlementService = new SettlementService(
      prisma as never,
      audit as never,
      auth as never,
      undefined,
      files as never
    );

    const result = await settlementService.downloadLatestApprovalPdf(
      "settlement-1",
      "approver-1",
      "current-password",
      "结算审批复核"
    );

    expect(auth.confirmPassword).toHaveBeenCalledWith("approver-1", "current-password");
    expect(tx.pdfDocument.findFirst).toHaveBeenCalledWith({
      where: {
        businessType: "settlement",
        businessId: "settlement-1",
        templateKey: "settlement_approval_latest"
      }
    });
    expect(files.assertCanDownloadFileById).toHaveBeenCalledWith("file-latest", "approver-1");
    expect(audit.record).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({
        action: "settlement.approval_pdf.download",
        actorUserId: "approver-1",
        metadata: expect.objectContaining({ downloadReason: "结算审批复核" })
      })
    );
    expect(result.fileName).toBe("JS-2026-019-结算审批最新.pdf");
    expect(result.buffer).toEqual(Buffer.from("%PDF-latest"));
  });

  it("rejects settlement approval PDF download without a download reason", async () => {
    const settlementService = new SettlementService(
      {} as never,
      audit as never,
      auth as never,
      undefined,
      {} as never
    );

    await expect(
      settlementService.downloadLatestApprovalPdf(
        "settlement-1",
        "approver-1",
        "current-password",
        ""
      )
    ).rejects.toThrow("结算审批单下载原因必填");
    expect(auth.confirmPassword).not.toHaveBeenCalled();
  });

  it("结算审批单下载服务不可用时给出中文业务提示", async () => {
    const settlementService = new SettlementService(undefined as never, audit as never, auth as never);

    await expect(
      settlementService.downloadLatestApprovalPdf(
        "settlement-1",
        "approver-1",
        "current-password",
        "结算审批复核"
      )
    ).rejects.toThrow("结算审批单下载服务暂不可用，请稍后重试或联系管理员");
    expect(auth.confirmPassword).not.toHaveBeenCalled();
  });

  it("结算审批单下载密码服务不可用时给出中文业务提示", async () => {
    const prisma = {
      $transaction: jest.fn()
    };
    const files = {
      assertCanDownloadFileById: jest.fn(),
      getFileBuffer: jest.fn()
    };
    const settlementService = new SettlementService(
      prisma as never,
      audit as never,
      undefined,
      undefined,
      files as never
    );

    await expect(
      settlementService.downloadLatestApprovalPdf(
        "settlement-1",
        "approver-1",
        "current-password",
        "结算审批复核"
      )
    ).rejects.toThrow("当前密码校验服务暂不可用，请稍后重试或联系管理员");
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(files.assertCanDownloadFileById).not.toHaveBeenCalled();
  });

  it("regenerates the latest settlement approval PDF during download when it is missing", async () => {
    const firstSourceTx = {
      settlement: {
        findUnique: jest.fn().mockResolvedValue({
          id: "settlement-1",
          code: "JS-2026-019"
        })
      },
      pdfDocument: {
        findFirst: jest.fn().mockResolvedValue(null)
      }
    };
    const authTx = {
      settlement: {
        findUnique: jest.fn().mockResolvedValue({
          id: "settlement-1",
          projectId: "project-1"
        })
      },
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue({
          id: "approval-instance-1",
          applicantUserId: "applicant-1",
          frozenNodes: [{ name: "合同部主管", mode: "any", roleKeys: ["contract_director"] }]
        })
      },
      approvalActionLog: {
        findFirst: jest.fn().mockResolvedValue(null)
      },
      userPosition: { findMany: jest.fn().mockResolvedValue([]) },
      position: { findMany: jest.fn().mockResolvedValue([]) },
      projectMember: { findMany: jest.fn().mockResolvedValue([{ positionKey: "contract_director" }]) }
    };
    const renderTx = {
      settlement: {
        findUnique: jest.fn().mockResolvedValue({
          id: "settlement-1",
          projectId: "project-1",
          contractId: "contract-1",
          code: "JS-2026-019",
          periodLabel: "2026-06",
          status: "approval_pending",
          amountCents: 1_000_000,
          payableAmountCents: 800_000,
          paidAmountCents: 0,
          isFinal: false,
          finalCumulativeAmountCents: null
        }),
        findMany: jest.fn().mockResolvedValue([])
      },
      contract: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-1",
          code: "HT-2026-009",
          name: "幕墙分包合同",
          counterparty: "上海示例劳务有限公司",
          companyEntityName: "建工智管工程有限公司"
        })
      },
      project: {
        findUnique: jest.fn().mockResolvedValue({
          id: "project-1",
          name: "总部综合楼"
        })
      },
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue({
          id: "approval-instance-1",
          frozenNodes: []
        })
      },
      approvalActionLog: {
        findMany: jest.fn().mockResolvedValue([])
      }
    };
    const pdfTx = {
      pdfDocument: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({
          id: "pdf-latest",
          fileId: "file-generated"
        })
      }
    };
    const finalSourceTx = {
      settlement: {
        findUnique: jest.fn().mockResolvedValue({
          id: "settlement-1",
          code: "JS-2026-019"
        })
      },
      pdfDocument: {
        findFirst: jest.fn().mockResolvedValue({
          id: "pdf-latest",
          fileId: "file-generated"
        })
      }
    };
    const prisma = {
      $transaction: jest
        .fn()
        .mockImplementationOnce(async (callback) => callback(firstSourceTx))
        .mockImplementationOnce(async (callback) => callback(authTx))
        .mockImplementationOnce(async (callback) => callback(renderTx))
        .mockImplementationOnce(async (callback) => callback(pdfTx))
        .mockImplementationOnce(async (callback) => callback(finalSourceTx))
    };
    const files = {
      uploadPrivateFile: jest.fn().mockResolvedValue({ id: "file-generated" }),
      assertCanDownloadFileById: jest.fn().mockResolvedValue(undefined),
      getFileBuffer: jest.fn().mockResolvedValue({ buffer: Buffer.from("%PDF-regenerated") })
    };
    const settlementService = new SettlementService(
      prisma as never,
      audit as never,
      auth as never,
      undefined,
      files as never
    );

    const result = await settlementService.downloadLatestApprovalPdf(
      "settlement-1",
      "approver-1",
      "current-password",
      "结算审批复核"
    );

    expect(files.uploadPrivateFile).toHaveBeenCalledWith(
      expect.objectContaining({
        originalName: "JS-2026-019-结算审批最新.pdf",
        uploadedByUserId: "approver-1"
      })
    );
    expect(files.assertCanDownloadFileById).toHaveBeenCalledWith("file-generated", "approver-1");
    expect(result.buffer).toEqual(Buffer.from("%PDF-regenerated"));
  });

  it("does not regenerate a missing latest settlement approval PDF for an unauthorized actor", async () => {
    const firstSourceTx = {
      settlement: {
        findUnique: jest.fn().mockResolvedValue({
          id: "settlement-1",
          code: "JS-2026-019"
        })
      },
      pdfDocument: {
        findFirst: jest.fn().mockResolvedValue(null)
      }
    };
    const authTx = {
      settlement: {
        findUnique: jest.fn().mockResolvedValue({
          id: "settlement-1",
          projectId: "project-1"
        })
      },
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue({
          id: "approval-instance-1",
          applicantUserId: "applicant-1",
          frozenNodes: [{ name: "物资员", mode: "any", roleKeys: ["material_staff"] }]
        })
      },
      approvalActionLog: {
        findFirst: jest.fn().mockResolvedValue(null)
      },
      userPosition: { findMany: jest.fn().mockResolvedValue([]) },
      position: { findMany: jest.fn().mockResolvedValue([]) },
      projectMember: {
        findMany: jest.fn().mockResolvedValue([{ positionKey: "engineering_tech" }])
      }
    };
    const prisma = {
      $transaction: jest
        .fn()
        .mockImplementationOnce(async (callback) => callback(firstSourceTx))
        .mockImplementationOnce(async (callback) => callback(authTx))
    };
    const files = {
      uploadPrivateFile: jest.fn(),
      assertCanDownloadFileById: jest.fn(),
      getFileBuffer: jest.fn()
    };
    const settlementService = new SettlementService(
      prisma as never,
      audit as never,
      auth as never,
      undefined,
      files as never
    );

    await expect(
      settlementService.downloadLatestApprovalPdf(
        "settlement-1",
        "engineering-user-1",
        "current-password",
        "结算审批复核"
      )
    ).rejects.toThrow("当前账号无权下载该结算审批单");
    expect(files.uploadPrivateFile).not.toHaveBeenCalled();
    expect(files.assertCanDownloadFileById).not.toHaveBeenCalled();
  });

  it("结算审批单刷新后仍缺失时提示稍后重试", async () => {
    const firstSourceTx = {
      settlement: {
        findUnique: jest.fn().mockResolvedValue({
          id: "settlement-1",
          code: "JS-2026-019"
        })
      },
      pdfDocument: {
        findFirst: jest.fn().mockResolvedValue(null)
      }
    };
    const authTx = {
      settlement: {
        findUnique: jest.fn().mockResolvedValue({
          id: "settlement-1",
          projectId: "project-1"
        })
      },
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue({
          id: "approval-instance-1",
          applicantUserId: "applicant-1",
          frozenNodes: [{ name: "合同部主管", mode: "any", roleKeys: ["contract_director"] }]
        })
      },
      approvalActionLog: {
        findFirst: jest.fn().mockResolvedValue(null)
      },
      userPosition: { findMany: jest.fn().mockResolvedValue([]) },
      position: { findMany: jest.fn().mockResolvedValue([]) },
      projectMember: { findMany: jest.fn().mockResolvedValue([{ positionKey: "contract_director" }]) }
    };
    const renderTx = {
      settlement: {
        findUnique: jest.fn().mockResolvedValue({
          id: "settlement-1",
          projectId: "project-1",
          contractId: "contract-1",
          code: "JS-2026-019",
          periodLabel: "2026-06",
          status: "approval_pending",
          amountCents: 1_000_000,
          payableAmountCents: 800_000,
          paidAmountCents: 0,
          isFinal: false,
          finalCumulativeAmountCents: null
        }),
        findMany: jest.fn().mockResolvedValue([])
      },
      contract: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-1",
          code: "HT-2026-009",
          name: "幕墙分包合同",
          counterparty: "上海示例劳务有限公司",
          companyEntityName: "建工智管工程有限公司"
        })
      },
      project: {
        findUnique: jest.fn().mockResolvedValue({
          id: "project-1",
          name: "总部综合楼"
        })
      },
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue({
          id: "approval-instance-1",
          frozenNodes: []
        })
      },
      approvalActionLog: {
        findMany: jest.fn().mockResolvedValue([])
      }
    };
    const pdfTx = {
      pdfDocument: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({
          id: "pdf-latest",
          fileId: "file-generated"
        })
      }
    };
    const finalSourceTx = {
      settlement: {
        findUnique: jest.fn().mockResolvedValue({
          id: "settlement-1",
          code: "JS-2026-019"
        })
      },
      pdfDocument: {
        findFirst: jest.fn().mockResolvedValue(null)
      }
    };
    const prisma = {
      $transaction: jest
        .fn()
        .mockImplementationOnce(async (callback) => callback(firstSourceTx))
        .mockImplementationOnce(async (callback) => callback(authTx))
        .mockImplementationOnce(async (callback) => callback(renderTx))
        .mockImplementationOnce(async (callback) => callback(pdfTx))
        .mockImplementationOnce(async (callback) => callback(finalSourceTx))
    };
    const files = {
      uploadPrivateFile: jest.fn().mockResolvedValue({ id: "file-generated" }),
      assertCanDownloadFileById: jest.fn(),
      getFileBuffer: jest.fn()
    };
    const settlementService = new SettlementService(
      prisma as never,
      audit as never,
      auth as never,
      undefined,
      files as never
    );

    await expect(
      settlementService.downloadLatestApprovalPdf(
        "settlement-1",
        "approver-1",
        "current-password",
        "结算审批复核"
      )
    ).rejects.toThrow("结算审批单暂不可下载，请稍后刷新后重试");
    expect(files.assertCanDownloadFileById).not.toHaveBeenCalled();
    expect(files.getFileBuffer).not.toHaveBeenCalled();
  });

  it("rejects settlement PDF generation when the archive already exists", async () => {
    const tx = {
      settlement: {
        findUnique: jest.fn().mockResolvedValue({
          id: "settlement-1",
          code: "JS-2026-019",
          periodLabel: "2026-06",
          status: "effective",
          amountCents: 1_000_000,
          payableAmountCents: 800_000,
          paidAmountCents: 0
        })
      },
      pdfDocument: {
        findFirst: jest.fn().mockResolvedValue({ id: "pdf-existing" })
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const files = {
      uploadPrivateFile: jest.fn()
    };
    const settlementService = new SettlementService(
      prisma as never,
      audit as never,
      undefined,
      undefined,
      files as never
    );

    await expect(
      settlementService.generatePdfArchive("settlement-1", "contract-staff-1")
    ).rejects.toThrow("结算归档 PDF 已生成，请勿重复生成");
    expect(files.uploadPrivateFile).not.toHaveBeenCalled();
  });

  it("结算归档 PDF 服务不可用时给出中文业务提示", async () => {
    const settlementService = new SettlementService(undefined as never, audit as never);

    await expect(
      settlementService.generatePdfArchive("settlement-1", "contract-staff-1")
    ).rejects.toThrow("结算归档 PDF 服务暂不可用，请稍后重试或联系管理员");
  });

  it("结算归档 PDF 文件服务不可用时给出中文业务提示", async () => {
    const prisma = {
      $transaction: jest.fn()
    };
    const settlementService = new SettlementService(prisma as never, audit as never);

    await expect(
      settlementService.generatePdfArchive("settlement-1", "contract-staff-1")
    ).rejects.toThrow("结算归档 PDF 文件服务暂不可用，请稍后重试或联系管理员");
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("结算单不存在时不能生成归档 PDF", async () => {
    const tx = {
      settlement: {
        findUnique: jest.fn().mockResolvedValue(null)
      },
      pdfDocument: {
        findFirst: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const files = {
      uploadPrivateFile: jest.fn()
    };
    const settlementService = new SettlementService(
      prisma as never,
      audit as never,
      undefined,
      undefined,
      files as never
    );

    await expect(
      settlementService.generatePdfArchive("settlement-missing", "contract-staff-1")
    ).rejects.toThrow("未找到结算单，请刷新结算台账后重试");
    expect(tx.pdfDocument.findFirst).not.toHaveBeenCalled();
    expect(files.uploadPrivateFile).not.toHaveBeenCalled();
  });

  it("结算单状态尚不支持时不能生成归档 PDF", async () => {
    const tx = {
      settlement: {
        findUnique: jest.fn().mockResolvedValue({
          id: "settlement-1",
          status: "approval_pending"
        })
      },
      pdfDocument: {
        findFirst: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const files = {
      uploadPrivateFile: jest.fn()
    };
    const settlementService = new SettlementService(
      prisma as never,
      audit as never,
      undefined,
      undefined,
      files as never
    );

    await expect(
      settlementService.generatePdfArchive("settlement-1", "contract-staff-1")
    ).rejects.toThrow("当前结算单尚不能生成归档 PDF，请先完成审批或归档确认");
    expect(tx.pdfDocument.findFirst).not.toHaveBeenCalled();
    expect(files.uploadPrivateFile).not.toHaveBeenCalled();
  });

  it("does not confirm a settlement archive when the confirmation password is wrong", async () => {
    auth.confirmPassword.mockRejectedValueOnce(new Error("Invalid confirmation password"));
    const prisma = {
      $transaction: jest.fn()
    };
    const settlementService = new SettlementService(prisma as never, audit as never, auth as never);

    await expect(
      settlementService.confirmArchiveFile("settlement-1", "user-contract-director", {
        archiveFileId: "settlement-archive-file-1",
        confirmationPassword: "wrong-password"
      })
    ).rejects.toThrow("Invalid confirmation password");
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("lets the applicant remind an overdue in-progress settlement approval", async () => {
    const lastActivityAt = new Date("2026-06-23T00:00:00.000Z");
    const now = new Date("2026-06-25T00:00:00.000Z"); // +48h, hits the default SLA
    const tx = {
      settlement: {
        findUnique: jest.fn().mockResolvedValue({
          id: "settlement-1",
          projectId: "project-1",
          status: "approval_pending"
        })
      },
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue({
          id: "approval-instance-1",
          applicantUserId: "applicant-1",
          status: "in_progress",
          currentNodeIndex: 1,
          updatedAt: lastActivityAt,
          frozenNodes: [
            { name: "物资员", mode: "any", roleKeys: ["material_staff"] },
            { name: "物资主管", mode: "any", roleKeys: ["material_director"] }
          ]
        })
      },
      approvalActionLog: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: "action-log-1", action: "remind" })
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const settlementService = new SettlementService(prisma as never, audit as never);

    const result = await settlementService.remindApproval("settlement-1", "applicant-1", now);

    expect(result.action).toBe("remind");
    expect(tx.approvalActionLog.create).toHaveBeenCalledWith({
      data: {
        approvalInstanceId: "approval-instance-1",
        action: "remind",
        actorUserId: "applicant-1"
      }
    });
    expect(audit.record).toHaveBeenCalledWith(tx, {
      actorUserId: "applicant-1",
      action: "settlement.approval.remind",
      businessType: "settlement",
      businessId: "settlement-1",
      metadata: {
        approvalInstanceId: "approval-instance-1",
        currentNodeIndex: 1,
        nodeName: "物资主管",
        overdueHours: 48
      }
    });
  });

  it("rejects a settlement approval reminder before the SLA has elapsed", async () => {
    const lastActivityAt = new Date("2026-06-23T00:00:00.000Z");
    const now = new Date("2026-06-24T00:00:00.000Z"); // +24h, under the default 48h SLA
    const tx = {
      settlement: {
        findUnique: jest.fn().mockResolvedValue({
          id: "settlement-1",
          projectId: "project-1",
          status: "approval_pending"
        })
      },
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue({
          id: "approval-instance-1",
          applicantUserId: "applicant-1",
          status: "in_progress",
          currentNodeIndex: 0,
          updatedAt: lastActivityAt,
          frozenNodes: [{ name: "物资员", mode: "any", roleKeys: ["material_staff"] }]
        })
      },
      approvalActionLog: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const settlementService = new SettlementService(prisma as never, audit as never);

    await expect(
      settlementService.remindApproval("settlement-1", "applicant-1", now)
    ).rejects.toThrow("当前还未到可催办时间，请稍后再试");
    expect(tx.approvalActionLog.create).not.toHaveBeenCalled();
  });

  it("结算单不存在时不能发起催办", async () => {
    const tx = {
      settlement: {
        findUnique: jest.fn().mockResolvedValue(null)
      },
      approvalInstance: {
        findFirst: jest.fn()
      },
      approvalActionLog: {
        create: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const settlementService = new SettlementService(prisma as never, audit as never);

    await expect(
      settlementService.remindApproval(
        "settlement-missing",
        "applicant-1",
        new Date("2026-06-25T00:00:00.000Z")
      )
    ).rejects.toThrow("未找到结算单，请刷新结算台账后重试");
    expect(tx.approvalInstance.findFirst).not.toHaveBeenCalled();
    expect(tx.approvalActionLog.create).not.toHaveBeenCalled();
  });

  it("结算单不在审批中时不能发起催办", async () => {
    const tx = {
      settlement: {
        findUnique: jest.fn().mockResolvedValue({
          id: "settlement-1",
          projectId: "project-1",
          status: "effective"
        })
      },
      approvalInstance: {
        findFirst: jest.fn()
      },
      approvalActionLog: {
        create: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const settlementService = new SettlementService(prisma as never, audit as never);

    await expect(
      settlementService.remindApproval(
        "settlement-1",
        "applicant-1",
        new Date("2026-06-25T00:00:00.000Z")
      )
    ).rejects.toThrow("当前结算单已不在审批中，不能发起催办");
    expect(tx.approvalInstance.findFirst).not.toHaveBeenCalled();
    expect(tx.approvalActionLog.create).not.toHaveBeenCalled();
  });

  it("缺少进行中的结算审批流程时不能发起催办", async () => {
    const tx = {
      settlement: {
        findUnique: jest.fn().mockResolvedValue({
          id: "settlement-1",
          projectId: "project-1",
          status: "approval_pending"
        })
      },
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue(null)
      },
      approvalActionLog: {
        create: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const settlementService = new SettlementService(prisma as never, audit as never);

    await expect(
      settlementService.remindApproval(
        "settlement-1",
        "applicant-1",
        new Date("2026-06-25T00:00:00.000Z")
      )
    ).rejects.toThrow("未找到进行中的结算审批流程，请刷新后重试");
    expect(tx.approvalActionLog.create).not.toHaveBeenCalled();
  });

  it("rejects a settlement approval reminder from a non-applicant", async () => {
    const tx = {
      settlement: {
        findUnique: jest.fn().mockResolvedValue({
          id: "settlement-1",
          projectId: "project-1",
          status: "approval_pending"
        })
      },
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue({
          id: "approval-instance-1",
          applicantUserId: "applicant-1",
          status: "in_progress",
          currentNodeIndex: 0,
          updatedAt: new Date("2026-06-23T00:00:00.000Z"),
          frozenNodes: [{ name: "物资员", mode: "any", roleKeys: ["material_staff"] }]
        })
      },
      approvalActionLog: {
        findFirst: jest.fn(),
        create: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const settlementService = new SettlementService(prisma as never, audit as never);

    await expect(
      settlementService.remindApproval(
        "settlement-1",
        "intruder-1",
        new Date("2026-06-25T00:00:00.000Z")
      )
    ).rejects.toThrow("只有结算审批申请人可以催办");
    expect(tx.approvalActionLog.create).not.toHaveBeenCalled();
  });
});
