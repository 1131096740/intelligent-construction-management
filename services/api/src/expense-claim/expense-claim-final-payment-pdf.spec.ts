import { PDFDocument } from "pdf-lib";
import PDFKit = require("pdfkit");
import { renderExpenseClaimFinalPaymentPdf } from "./expense-claim-final-payment-pdf";

describe("renderExpenseClaimFinalPaymentPdf", () => {
  it("renders a one-page A5 landscape PDF for a frozen final payment fact", async () => {
    const buffer = await renderExpenseClaimFinalPaymentPdf({
      code: "BX-20260724-001",
      companyName: "建工智管有限公司",
      paymentSubjectName: "建工智管有限公司",
      projectName: "JGXM-001 · 科技园项目",
      applicantName: "张三",
      reason: "现场交通费",
      requestedAmountCents: 12_500n,
      loanOffsetAmountCents: 2_500n,
      companyPayableAmountCents: 10_000n,
      paidAmountCents: 10_000n,
      payments: [{ paidAt: new Date("2026-07-24T00:00:00.000Z"), paymentMethod: "对公转账", amountCents: 10_000n, note: "最终付款" }]
    });

    expect(buffer.subarray(0, 5).toString("ascii")).toBe("%PDF-");
    const document = await PDFDocument.load(buffer);
    expect(document.getPageCount()).toBe(1);
    const { width, height } = document.getPage(0)!.getSize();
    expect(width).toBeGreaterThan(height);
    expect(width).toBeCloseTo(595.28, 1);
    expect(height).toBeCloseTo(419.53, 1);
  });

  it("renders each frozen registered payer on its own row", async () => {
    const text = jest.spyOn(PDFKit.prototype, "text");
    try {
      const buffer = await renderExpenseClaimFinalPaymentPdf({
        code: "BX-20260724-002",
        companyName: "原债务公司",
        paymentSubjectName: "当前审批主体",
        projectName: "科技园项目",
        applicantName: "张三",
        reason: "现场交通费",
        requestedAmountCents: 10_000n,
        loanOffsetAmountCents: 0n,
        companyPayableAmountCents: 10_000n,
        paidAmountCents: 10_000n,
        payments: [
          { paidAt: new Date("2026-07-24"), paymentMethod: "对公转账", amountCents: 4_000n, note: null, actualPayerName: "第一次登记付款公司" },
          { paidAt: new Date("2026-07-25"), paymentMethod: "对公转账", amountCents: 6_000n, note: null, actualPayerName: "第二次登记付款公司" }
        ]
      });

      expect((await PDFDocument.load(buffer)).getPageCount()).toBe(1);
      expect(text.mock.calls.map(([value]) => value)).toEqual(expect.arrayContaining([
        "详见下方付款明细", "第一次登记付款公司", "第二次登记付款公司"
      ]));
      expect(text.mock.calls.map(([value]) => value)).not.toContain("当前审批主体");
    } finally {
      text.mockRestore();
    }
  });
});
