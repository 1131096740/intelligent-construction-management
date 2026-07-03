import "reflect-metadata";
import { IS_PUBLIC_KEY } from "../auth/decorators/public.decorator";
import { REQUIRED_POSITIONS_KEY } from "../auth/decorators/require-positions.decorator";
import { REQUIRED_PROJECT_ACTION_KEY } from "../auth/decorators/require-project-role.decorator";
import { PaymentController } from "./payment.controller";

describe("PaymentController authorization wiring", () => {
  it("is not publicly accessible (auth guard must run)", () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, PaymentController)).toBeFalsy();
  });

  it.each([
    ["create", "payment.create"],
    ["contractApplication", "payment.create"],
    ["reviewApproval", "payment.approve"],
    ["transferApproval", "payment.approve"],
    ["delegateApproval", "payment.approve"],
    ["recordExecution", "payment.execution"],
    ["recordFinance", "payment.finance_record"],
    ["recordPdfArchive", "payment.pdf_archive"],
    ["generatePdfArchive", "payment.pdf_archive"]
  ])("guards %s with the %s action", (method, action) => {
    const handler = (PaymentController.prototype as unknown as Record<string, object>)[method];

    expect(Reflect.getMetadata(REQUIRED_PROJECT_ACTION_KEY, handler)).toBe(action);
  });

  it.each([["withdrawApproval"], ["remindApproval"]])(
    "allows the approval applicant to %s without project approval action metadata",
    (method) => {
      const handler = (PaymentController.prototype as unknown as Record<string, object>)[method];

      expect(Reflect.getMetadata(REQUIRED_PROJECT_ACTION_KEY, handler)).toBeUndefined();
    }
  );

  it("guards the payment ledger with business positions", () => {
    expect(Reflect.getMetadata(REQUIRED_POSITIONS_KEY, PaymentController.prototype.list)).toEqual([
      "chairman",
      "general_manager",
      "project_manager",
      "contract_director",
      "contract_staff",
      "budget_director",
      "budget_staff",
      "finance_director",
      "finance_staff",
      "super_admin"
    ]);
  });

  it("forwards contract application preview requests to the payment read service", async () => {
    const paymentRead = {
      getContractApplication: jest.fn().mockResolvedValue({ contract: { contractVersionId: "contract-version-1" } })
    };
    const controller = new PaymentController(paymentRead as never, {} as never);

    await expect(controller.contractApplication("contract-version-1")).resolves.toEqual({
      contract: { contractVersionId: "contract-version-1" }
    });
    expect(paymentRead.getContractApplication).toHaveBeenCalledWith("contract-version-1");
  });
});
