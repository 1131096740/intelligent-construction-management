import { PDFDocument } from "pdf-lib";
import { renderExpenseClaimApprovalForm } from "./expense-claim-approval-form-renderer";

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAen63NgAAAAASUVORK5CYII=",
  "base64"
);

describe("expense claim approval form renderer", () => {
  it("renders an A5 landscape reimbursement original with same-size continuation pages and frozen signatures", async () => {
    const buffer = await renderExpenseClaimApprovalForm({
      claimType: "reimbursement",
      code: "BX-20260723-001",
      companyName: "四川建工智管建筑工程有限公司",
      projectName: "科技园项目",
      applicantName: "申请人甲",
      handlerName: "经办人乙",
      submittedAt: new Date("2026-07-23T00:00:00.000Z"),
      reason: "现场交通及材料搬运",
      requestedAmountCents: 123456n,
      loanOffsetAmountCents: 0n,
      companyPayableAmountCents: 123456n,
      paymentMethod: "银行转账",
      payeeName: "申请人甲",
      loanExpectedClearanceAt: null,
      lines: Array.from({ length: 3 }, (_, index) => ({
        sortOrder: index + 1,
        expenseCategory: "交通",
        occurredOn: new Date("2026-07-22T00:00:00.000Z"),
        purpose: `现场往返 ${index + 1}`,
        receiptCount: 1,
        amountCents: 41152n
      })),
      approvals: [{
        name: "项目经理甲",
        position: "项目经理",
        comment: "同意",
        signedAt: new Date("2026-07-23T00:00:00.000Z"),
        signature: PNG_1X1
      }]
    });

    const document = await PDFDocument.load(buffer);
    expect(buffer.subarray(0, 5).toString()).toBe("%PDF-");
    expect(document.getPageCount()).toBe(2);
    for (const page of document.getPages()) {
      expect(page.getWidth()).toBeCloseTo(595.28, 1);
      expect(page.getHeight()).toBeCloseTo(419.53, 1);
    }
  });
});
