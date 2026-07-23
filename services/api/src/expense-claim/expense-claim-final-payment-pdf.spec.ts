import { PDFDocument } from "pdf-lib";
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
});
