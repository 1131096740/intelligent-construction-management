import "reflect-metadata";
import { REQUIRED_PROJECT_ACTION_KEY } from "../auth/decorators/require-project-role.decorator";
import { ExpenseClaimController } from "./expense-claim.controller";

const uploadedFile = {
  fieldname: "file",
  originalname: "付款凭证.pdf",
  encoding: "7bit",
  mimetype: "application/pdf",
  size: 3,
  buffer: Buffer.from("pdf")
};

describe("ExpenseClaimController capability and upload wiring", () => {
  it("forwards exact claim and repayment capability coordinates", async () => {
    const claims = {
      getActionCapability: jest.fn().mockResolvedValue({ claimId: "claim-1" }),
      getRepaymentActionCapability: jest.fn().mockResolvedValue({ repaymentId: "repayment-1" })
    };
    const controller = new ExpenseClaimController(claims as never);

    await controller.actionCapability("claim-1", { id: "user-1" } as never);
    await controller.repaymentActionCapability(
      "claim-1",
      "repayment-1",
      { id: "user-1" } as never
    );

    expect(claims.getActionCapability).toHaveBeenCalledWith("claim-1", "user-1");
    expect(claims.getRepaymentActionCapability).toHaveBeenCalledWith(
      "claim-1",
      "repayment-1",
      "user-1"
    );
  });

  it.each([
    ["uploadDraftAttachmentFile", "attach_expense_claim_attachment", "expense_claim.create"],
    ["uploadAppendAttachmentFile", "append_expense_claim_attachment", "expense_claim.attachment.append"],
    ["uploadPaymentVoucherFile", "record_expense_claim_payment", "expense_claim.payment.execute"],
    ["uploadDisbursementVoucherFile", "record_expense_claim_loan_disbursement", "expense_claim.disburse"],
    ["uploadRepaymentVoucherFile", "record_expense_claim_loan_repayment", "expense_claim.repayment.record"]
  ] as const)(
    "%s checks the server action before private-file storage",
    async (method, action, projectAction) => {
      const claims = {
        assertActionAvailable: jest.fn().mockResolvedValue(undefined)
      };
      const files = {
        uploadPrivateFile: jest.fn().mockResolvedValue({ id: "file-1" })
      };
      const controller = new ExpenseClaimController(claims as never, files as never);

      await controller[method](
        "claim-1",
        uploadedFile,
        { id: "user-1" } as never,
        "idempotency-1"
      );

      expect(claims.assertActionAvailable).toHaveBeenCalledWith(
        "claim-1",
        "user-1",
        action
      );
      expect(files.uploadPrivateFile).toHaveBeenCalledWith(
        expect.objectContaining({
          originalName: "付款凭证.pdf",
          uploadedByUserId: "user-1",
          idempotencyKey: "idempotency-1"
        })
      );
      expect(
        claims.assertActionAvailable.mock.invocationCallOrder[0]
      ).toBeLessThan(files.uploadPrivateFile.mock.invocationCallOrder[0]!);
      expect(
        Reflect.getMetadata(
          REQUIRED_PROJECT_ACTION_KEY,
          ExpenseClaimController.prototype[method]
        )
      ).toBe(projectAction);
    }
  );
});
