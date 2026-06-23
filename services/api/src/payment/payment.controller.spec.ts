import "reflect-metadata";
import { IS_PUBLIC_KEY } from "../auth/decorators/public.decorator";
import { REQUIRED_PROJECT_ACTION_KEY } from "../auth/decorators/require-project-role.decorator";
import { PaymentController } from "./payment.controller";

describe("PaymentController authorization wiring", () => {
  it("is not publicly accessible (auth guard must run)", () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, PaymentController)).toBeFalsy();
  });

  it.each([
    ["reviewApproval", "payment.approve"],
    ["recordExecution", "payment.execution"],
    ["recordFinance", "payment.finance_record"],
    ["recordPdfArchive", "payment.pdf_archive"]
  ])("guards %s with the %s action", (method, action) => {
    const handler = (PaymentController.prototype as unknown as Record<string, object>)[method];

    expect(Reflect.getMetadata(REQUIRED_PROJECT_ACTION_KEY, handler)).toBe(action);
  });
});
