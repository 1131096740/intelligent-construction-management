import "reflect-metadata";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PATH_METADATA } from "@nestjs/common/constants";
import { SpotProcurementController } from "./spot-procurement.controller";
import { SpotProcurementReceiptController } from "./spot-procurement-receipt.controller";
import { InvoiceLedgerController } from "../invoice-ledger/invoice-ledger.controller";

const chainScenarios = [
  "物资员申请经物资主管和项目经理审批后生成付款草稿",
  "物资主管申请跳过本级后由项目经理审批",
  "公司直付供应商支持多笔实付和凭证",
  "经办人垫付后报回",
  "先收货后付款",
  "先付款后收货并委托相册上传",
  "少货未付满取消未执行额度",
  "少货多付整笔退款到账",
  "少货多付转同项目同供应商余额并后单抵扣",
  "全部无票由财务主管确认",
  "部分发票部分无票分别覆盖",
  "票据异常确认后计入覆盖",
  "最后事实满足后后端自动办结"
] as const;

describe("spot procurement complete-chain contracts", () => {
  it("locks all thirteen controlled procurement scenarios", () => {
    expect(chainScenarios).toHaveLength(13);
    expect(new Set(chainScenarios).size).toBe(13);
  });

  it("exposes independent procurement, receipt, settlement and ticket routes", () => {
    expect(Reflect.getMetadata(PATH_METADATA, SpotProcurementController)).toBe("spot-procurements");
    expect(Reflect.getMetadata(PATH_METADATA, SpotProcurementReceiptController)).toBe("spot-procurements");
    expect(Reflect.getMetadata(PATH_METADATA, InvoiceLedgerController)).toBe("/");
    const methods = [
      SpotProcurementController.prototype.create,
      SpotProcurementController.prototype.createOrConfirmDiscrepancy,
      SpotProcurementController.prototype.recordRefund,
      SpotProcurementController.prototype.creditSupplierBalance,
      SpotProcurementReceiptController.prototype.attachPhoto,
      SpotProcurementReceiptController.prototype.submit,
      SpotProcurementReceiptController.prototype.review,
      InvoiceLedgerController.prototype.createProcurementInvoice,
      InvoiceLedgerController.prototype.createNoInvoiceConfirmation,
      InvoiceLedgerController.prototype.createInvoiceException
    ];
    expect(methods.every((method) => Reflect.hasMetadata(PATH_METADATA, method))).toBe(true);
  });

  it("keeps the new write path isolated from legacy ProjectExpenseRequest", () => {
    const root = join(__dirname);
    for (const file of [
      "spot-procurement-application.service.ts",
      "spot-procurement-payment.service.ts",
      "spot-procurement-receipt.service.ts",
      "spot-procurement-settlement.service.ts"
    ]) {
      const source = readFileSync(join(root, file), "utf8");
      expect(source).not.toMatch(/projectExpenseRequest\.(create|update|delete)/u);
    }
  });

  it("has no client-controlled close route", () => {
    const source = readFileSync(join(__dirname, "spot-procurement.controller.ts"), "utf8");
    expect(source).not.toMatch(/@(?:Post|Patch)\([^)]*clos/iu);
    expect(source).not.toContain("status: \"closed\"");
  });
});
