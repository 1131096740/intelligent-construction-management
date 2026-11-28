import "reflect-metadata";
import { GoneException } from "@nestjs/common";
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
    await controller.actionCapability("claim-1", { id: "user-1" } as never, "public_cash");
    await controller.repaymentActionCapability(
      "claim-1",
      "repayment-1",
      { id: "user-1" } as never
    );

    expect(claims.getActionCapability).toHaveBeenCalledWith("claim-1", "user-1");
    expect(claims.getActionCapability).toHaveBeenCalledWith("claim-1", "user-1", "public_cash");
    expect(claims.getRepaymentActionCapability).toHaveBeenCalledWith(
      "claim-1",
      "repayment-1",
      "user-1"
    );
  });

  it.each([
    ["uploadDraftAttachmentFile", "attach_expense_claim_attachment", undefined],
    ["uploadAppendAttachmentFile", "append_expense_claim_attachment", "expense_claim.attachment.append"],
    ["uploadPaymentVoucherFile", "record_expense_claim_payment", "expense_claim.payment.execute"]
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

      await controller[method]("claim-1", uploadedFile, { id: "user-1" } as never, { idempotencyKey: "idempotency-1" });

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

  it.each([
    ["uploadDisbursementVoucherFile", "expense_claim.disburse"],
    ["uploadRepaymentVoucherFile", "expense_claim.repayment.record"]
  ] as const)("%s stops before private-file storage", (method, projectAction) => {
    const claims = { assertActionAvailable: jest.fn() };
    const files = { uploadPrivateFile: jest.fn() };
    const controller = new ExpenseClaimController(claims as never, files as never);

    expect(() => controller[method]()).toThrow(GoneException);
    expect(claims.assertActionAvailable).not.toHaveBeenCalled();
    expect(files.uploadPrivateFile).not.toHaveBeenCalled();
    expect(
      Reflect.getMetadata(REQUIRED_PROJECT_ACTION_KEY, ExpenseClaimController.prototype[method])
    ).toBe(projectAction);
  });
});

it("按审批职责读取和重试短信，并在访问 outbox 前拒绝越界坐标", async () => {
  const notifications = {
    approvalStatus: jest.fn().mockResolvedValue(null),
    retryApproval: jest.fn().mockResolvedValue({ status: "accepted" })
  };
  const controller = new ExpenseClaimController({} as never, undefined, notifications as never);
  const actor = { id: "current-user" } as never;
  const attempt = { attemptId: "a".repeat(64) };

  await expect(controller.approvalDutySmsStatus("claim-1", actor, -1)).rejects.toThrow("审批职责编号无效");
  expect(() => controller.retryApprovalDutySms("claim-1", actor, attempt, Number.MAX_SAFE_INTEGER + 1))
    .toThrow("审批职责编号无效");
  expect(notifications.approvalStatus).not.toHaveBeenCalled();
  expect(notifications.retryApproval).not.toHaveBeenCalled();

  await expect(controller.approvalDutySmsStatus("claim-1", actor, 0, "")).rejects.toThrow("审批轮次无效");
  await controller.approvalDutySmsStatus("claim-1", actor, 0, "round-1");
  await controller.retryApprovalDutySms("claim-1", actor, attempt, 1, "round-1");
  expect(notifications.approvalStatus).toHaveBeenCalledWith("claim-1", "current-user", 0, "round-1");
  expect(notifications.retryApproval).toHaveBeenCalledWith("claim-1", "current-user", attempt.attemptId, 1, "round-1");
});
