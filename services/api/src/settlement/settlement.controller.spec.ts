import "reflect-metadata";
import { IS_PUBLIC_KEY } from "../auth/decorators/public.decorator";
import { REQUIRED_POSITIONS_KEY } from "../auth/decorators/require-positions.decorator";
import { REQUIRED_PROJECT_ACTION_KEY } from "../auth/decorators/require-project-role.decorator";
import { SettlementController } from "./settlement.controller";

describe("SettlementController authorization wiring", () => {
  it("is not publicly accessible (auth guard must run)", () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, SettlementController)).toBeFalsy();
  });

  it.each([
    ["create", "settlement.create"],
    ["reviewApproval", "settlement.approve"],
    ["transferApproval", "settlement.approve"],
    ["delegateApproval", "settlement.approve"],
    ["uploadArchiveFile", "settlement.archive.upload"],
    ["confirmArchiveFile", "settlement.archive.confirm"],
    ["generatePdfArchive", "settlement.archive.upload"],
    ["downloadDraftExcel", "settlement.archive.upload"]
  ])("guards %s with the %s action", (method, action) => {
    const handler = (SettlementController.prototype as unknown as Record<string, object>)[method];

    expect(Reflect.getMetadata(REQUIRED_PROJECT_ACTION_KEY, handler)).toBe(action);
  });

  it.each([["withdrawApproval"], ["remindApproval"], ["downloadLatestApprovalPdf"]])(
    "allows the approval applicant to %s without project approval action metadata",
    (method) => {
      const handler = (SettlementController.prototype as unknown as Record<string, object>)[method];

      expect(Reflect.getMetadata(REQUIRED_PROJECT_ACTION_KEY, handler)).toBeUndefined();
    }
  );

  it("guards the settlement ledger with business positions", () => {
    expect(Reflect.getMetadata(REQUIRED_POSITIONS_KEY, SettlementController.prototype.list)).toEqual([
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
});
