import "reflect-metadata";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PATH_METADATA } from "@nestjs/common/constants";
import { SpotProcurementController } from "./spot-procurement.controller";
import { SpotProcurementInvoiceController } from "./spot-procurement-invoice.controller";
import { SpotProcurementReceiptController } from "./spot-procurement-receipt.controller";

const realFormScenarios = [
  "无价采购审批后生成唯一付款草稿",
  "公司直付且商户与收款对象一致，一次付款一次收货",
  "商户与个人收款对象不一致并填写说明",
  "经办人垫付报回并锁定本人收款",
  "一张付款两次实际付款，各自凭证，首笔后开放收货",
  "现金付款上传收据，后续补传发票",
  "全部无票并正常办结",
  "预计有票待补发票办结，办结后补传不重开流程",
  "同项目受托人相册上传并确认，物资主管复核",
  "少货后商户补货并重新复核收货",
  "少货多付后退款并上传凭证",
  "实付后财务主管确认异常终止",
  "审批 PDF 保持哈希不变，付款退款发票只追加归档版本"
] as const;

describe("spot procurement real-form complete-chain contracts", () => {
  it("locks the thirteen real-form pilot scenarios", () => {
    expect(realFormScenarios).toHaveLength(13);
    expect(new Set(realFormScenarios).size).toBe(13);
    expect(realFormScenarios.join("\n")).not.toMatch(/供应商余额|票据覆盖|无票确认|票据异常/u);
  });

  it("exposes the independent A4, A5, receipt, refund and payment-level invoice routes", () => {
    expect(Reflect.getMetadata(PATH_METADATA, SpotProcurementController)).toBe("spot-procurements");
    expect(Reflect.getMetadata(PATH_METADATA, SpotProcurementReceiptController)).toBe("spot-procurements");
    expect(Reflect.getMetadata(PATH_METADATA, SpotProcurementInvoiceController)).toBe("spot-procurement-payments");
    const methods = [
      SpotProcurementController.prototype.create,
      SpotProcurementController.prototype.createOrConfirmDiscrepancy,
      SpotProcurementController.prototype.recordRefund,
      SpotProcurementReceiptController.prototype.createDelegation,
      SpotProcurementReceiptController.prototype.attachPhoto,
      SpotProcurementReceiptController.prototype.submit,
      SpotProcurementReceiptController.prototype.review,
      SpotProcurementReceiptController.prototype.revokeReview,
      SpotProcurementInvoiceController.prototype.append,
      SpotProcurementInvoiceController.prototype.invalidate
    ];
    expect(methods.every((method) => Reflect.hasMetadata(PATH_METADATA, method))).toBe(true);
  });

  it("keeps the real write path isolated from ProjectExpenseRequest and retired balance or structured-invoice calls", () => {
    const root = join(__dirname);
    const source = [
      "spot-procurement-application.service.ts",
      "spot-procurement-payment.service.ts",
      "spot-procurement-receipt.service.ts",
      "spot-procurement-settlement.service.ts",
      "spot-procurement-invoice.service.ts"
    ].map((file) => readFileSync(join(root, file), "utf8")).join("\n");

    expect(source).not.toMatch(/projectExpenseRequest\.(create|update|delete)/u);
    expect(readFileSync(join(root, "spot-procurement-invoice.service.ts"), "utf8")).not.toMatch(/InvoiceLedger|noInvoiceConfirmation|invoiceException/u);
  });

  it("has no client-controlled close route", () => {
    const source = readFileSync(join(__dirname, "spot-procurement.controller.ts"), "utf8");
    expect(source).not.toMatch(/@(?:Post|Patch)\([^)]*clos/iu);
    expect(source).not.toContain('status: "closed"');
  });
});
