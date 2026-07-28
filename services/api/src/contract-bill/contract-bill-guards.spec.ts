import { Prisma } from "@prisma/client";
import { loadOwnedEditableBill } from "./contract-bill-guards";
import { resolveContractBillRowFacts } from "./contract-bill-row-rules";

describe("loadOwnedEditableBill", () => {
  const validBill = {
    id: "bill-1",
    contractVersionId: "version-1",
    pricingMode: "tax_inclusive"
  };
  const validVersion = {
    id: "version-1",
    contractId: "contract-1",
    status: "draft"
  };
  const validContract = {
    id: "contract-1",
    ownerUserId: "owner-1",
    voidedAt: null
  };

  it.each([
    {
      name: "清单不存在",
      bill: null,
      version: validVersion,
      contract: validContract,
      message: "合同清单不存在"
    },
    {
      name: "计价模式无效",
      bill: { ...validBill, pricingMode: "invalid" },
      version: validVersion,
      contract: validContract,
      message: "合同清单计价模式无效"
    },
    {
      name: "草稿版本不存在",
      bill: validBill,
      version: null,
      contract: validContract,
      message: "合同草稿版本不存在"
    },
    {
      name: "草稿不存在",
      bill: validBill,
      version: validVersion,
      contract: null,
      message: "合同草稿不存在"
    },
    {
      name: "非经办人",
      bill: validBill,
      version: validVersion,
      contract: { ...validContract, ownerUserId: "another-user" },
      message: "只有合同草稿经办人可以编辑清单"
    },
    {
      name: "状态不可编辑",
      bill: validBill,
      version: { ...validVersion, status: "pending_approval" },
      contract: validContract,
      message: "当前合同草稿状态不可编辑清单"
    },
    {
      name: "草稿已作废",
      bill: validBill,
      version: validVersion,
      contract: { ...validContract, voidedAt: new Date() },
      message: "合同草稿已作废，不能编辑清单"
    }
  ])("用中文说明$name", async ({ bill, version, contract, message }) => {
    const tx = {
      contractBill: { findUnique: jest.fn().mockResolvedValue(bill) },
      contractVersion: { findUnique: jest.fn().mockResolvedValue(version) },
      contract: { findUnique: jest.fn().mockResolvedValue(contract) }
    };

    await expect(
      loadOwnedEditableBill(tx as never, "bill-1", "owner-1")
    ).rejects.toThrow(message);
  });
});

describe("contract bill row tax normalization", () => {
  const baseContext = {
    pricingMode: "tax_inclusive",
    pricingNature: "fixed_total",
    amountLimitType: "capped",
    defaultTaxRatePercent: new Prisma.Decimal("9")
  };

  it("always inherits the normalized version rate for a single-rate contract", () => {
    expect(
      resolveContractBillRowFacts(
        {
          quantity: "1",
          unitPrice: "100",
          taxRatePercent: "9.000000",
          taxRateSource: "row_override"
        },
        { ...baseContext, taxMode: "single_rate" }
      )
    ).toMatchObject({
      taxRatePercent: "9",
      taxRateSource: "version_default"
    });
    expect(
      resolveContractBillRowFacts(
        {
          quantity: "1",
          unitPrice: "100"
        },
        {
          ...baseContext,
          taxMode: "single_rate",
          defaultTaxRatePercent: new Prisma.Decimal("0")
        }
      )
    ).toMatchObject({
      taxRatePercent: "0",
      taxRateSource: "version_default"
    });
  });

  it("derives multi-rate source from normalized equality instead of trusting the client", () => {
    expect(
      resolveContractBillRowFacts(
        {
          quantity: "1",
          unitPrice: "100",
          taxRatePercent: "9.000000",
          taxRateSource: "row_override"
        },
        { ...baseContext, taxMode: "multiple_rate" }
      )
    ).toMatchObject({
      taxRatePercent: "9",
      taxRateSource: "version_default"
    });
    expect(
      resolveContractBillRowFacts(
        {
          quantity: "1",
          unitPrice: "100",
          taxRatePercent: "6",
          taxRateSource: "version_default"
        },
        { ...baseContext, taxMode: "multiple_rate" }
      )
    ).toMatchObject({
      taxRatePercent: "6",
      taxRateSource: "row_override"
    });
  });
});
