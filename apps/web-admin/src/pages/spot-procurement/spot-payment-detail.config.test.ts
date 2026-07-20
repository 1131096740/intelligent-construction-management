import { describe, expect, it } from "vitest";
import type { SpotProcurementPaymentDetailReadModel } from "../../api/spot-procurement.api";
import {
  firstIncompletePaymentStep,
  resolveSpotPaymentMerchantPayee,
  spotPaymentDetailTabs
} from "./spot-payment-detail.config";

describe("spot payment detail configuration", () => {
  it("fixes the six detail tabs in business order", () => {
    expect(spotPaymentDetailTabs).toEqual([
      { value: "current", label: "当前办理" },
      { value: "application", label: "付款申请" },
      { value: "approval", label: "审批进度" },
      { value: "executions", label: "实际付款与凭证" },
      { value: "fulfillment", label: "收货与发票" },
      { value: "archives", label: "归档资料" }
    ]);
  });

  it("returns the first incomplete saved draft step", () => {
    expect(firstIncompletePaymentStep(detail({ paymentType: null }))).toBe(0);
    expect(firstIncompletePaymentStep(detail({}, { materials: [] }))).toBe(1);
    expect(firstIncompletePaymentStep(detail({}, { paymentChannels: [] }))).toBe(2);
    expect(firstIncompletePaymentStep(detail())).toBe(3);
  });

  it("keeps an invoiced material on step two until its saved VAT rate exists", () => {
    expect(firstIncompletePaymentStep(detail({}, {
      materials: [{
        id: "material-1",
        procurementLineId: "line-1",
        sortOrder: 1,
        materialName: "钢筋",
        specification: null,
        unit: "吨",
        approvedQuantity: "2",
        paymentQuantity: "2",
        unitPrice: "3000",
        amountCents: "600000",
        expectedInvoiceCondition: "vat_special",
        vatRateOptionId: null,
        vatRateLabel: null
      }]
    }))).toBe(1);
  });

  it("defaults a company-direct payee to the merchant", () => {
    expect(resolveSpotPaymentMerchantPayee({
      paymentType: "company_direct",
      merchantName: " 昆明建材商行 ",
      payeeDiffersFromMerchant: false,
      payeeName: "",
      mismatchNote: "",
      handlerNameSnapshot: "经办人甲"
    })).toEqual({
      merchantName: "昆明建材商行",
      payeeName: "昆明建材商行",
      merchantPayeeMismatchNote: null
    });
  });

  it("requires an independent payee and explanation when the exception is enabled", () => {
    expect(() => resolveSpotPaymentMerchantPayee({
      paymentType: "company_direct",
      merchantName: "昆明建材商行",
      payeeDiffersFromMerchant: true,
      payeeName: "昆明建材商行",
      mismatchNote: "商户指定代收",
      handlerNameSnapshot: "经办人甲"
    })).toThrow("例外收款对象必须与实际商户不同");

    expect(() => resolveSpotPaymentMerchantPayee({
      paymentType: "company_direct",
      merchantName: "昆明建材商行",
      payeeDiffersFromMerchant: true,
      payeeName: "张三",
      mismatchNote: " ",
      handlerNameSnapshot: "经办人甲"
    })).toThrow("请填写商户与收款对象不一致说明");

    expect(resolveSpotPaymentMerchantPayee({
      paymentType: "company_direct",
      merchantName: "昆明建材商行",
      payeeDiffersFromMerchant: true,
      payeeName: "张三",
      mismatchNote: " 商户指定代收 ",
      handlerNameSnapshot: "经办人甲"
    })).toEqual({
      merchantName: "昆明建材商行",
      payeeName: "张三",
      merchantPayeeMismatchNote: "商户指定代收"
    });
  });

  it("freezes the current handler as payee for handler reimbursement", () => {
    expect(resolveSpotPaymentMerchantPayee({
      paymentType: "handler_reimbursement",
      merchantName: "昆明建材商行",
      payeeDiffersFromMerchant: true,
      payeeName: "不应采用",
      mismatchNote: "不应采用",
      handlerNameSnapshot: " 经办人甲 "
    })).toEqual({
      merchantName: "昆明建材商行",
      payeeName: "经办人甲",
      merchantPayeeMismatchNote: "经办人垫付后报回"
    });
  });
});

function detail(
  payment: Partial<SpotProcurementPaymentDetailReadModel["payment"]> = {},
  rest: Partial<SpotProcurementPaymentDetailReadModel> = {}
): SpotProcurementPaymentDetailReadModel {
  return {
    payment: {
      paymentType: "company_direct",
      merchantName: "昆明建材商行",
      merchantPayeeMismatchNote: null,
      payee: {
        name: "昆明建材商行",
        accountName: "昆明建材商行",
        primaryChannel: null
      },
      handler: { id: "handler-1", name: "经办人甲" },
      ...payment
    },
    materials: [{
      id: "material-1",
      procurementLineId: "line-1",
      sortOrder: 1,
      materialName: "钢筋",
      specification: null,
      unit: "吨",
      approvedQuantity: "2",
      paymentQuantity: "2",
      unitPrice: "3000",
      amountCents: "600000",
      expectedInvoiceCondition: "no_invoice",
      vatRateOptionId: null,
      vatRateLabel: null
    }],
    paymentMethods: [{ value: "bank_transfer", label: "银行转账" }],
    paymentChannels: [{
      id: "channel-1",
      sortOrder: 1,
      channelType: "bank_transfer",
      channelTypeLabel: "银行转账",
      accountName: "昆明建材商行",
      bankName: "建设银行",
      accountNumberLast4: "1234",
      note: null,
      primary: true
    }],
    ...rest
  } as SpotProcurementPaymentDetailReadModel;
}
