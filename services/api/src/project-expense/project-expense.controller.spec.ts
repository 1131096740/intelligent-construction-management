import "reflect-metadata";
import { REQUIRED_POSITIONS_KEY } from "../auth/decorators/require-positions.decorator";
import { REQUIRED_PROJECT_ACTION_KEY } from "../auth/decorators/require-project-role.decorator";
import { ProjectExpenseController } from "./project-expense.controller";

describe("ProjectExpenseController authorization wiring", () => {
  const fundsOverviewPositions = [
    "chairman",
    "general_manager",
    "project_manager",
    "finance_director",
    "finance_staff"
  ];

  it("guards the expense request list with funds overview positions", () => {
    expect(Reflect.getMetadata(REQUIRED_POSITIONS_KEY, ProjectExpenseController.prototype.list)).toEqual(
      fundsOverviewPositions
    );
  });

  it.each([
    ["create", "project_expense.create"],
    ["reviewApproval", "project_expense.approve"],
    ["voidRequest", "project_expense.void"],
    ["recordExecution", "project_expense.execution"],
    ["recordFinance", "project_expense.finance_record"]
  ])("guards %s with the %s action", (method, action) => {
    const handler = (ProjectExpenseController.prototype as unknown as Record<string, object>)[method];

    expect(Reflect.getMetadata(REQUIRED_PROJECT_ACTION_KEY, handler)).toBe(action);
  });

  it("keeps withdrawal applicant-scoped without project action metadata", () => {
    expect(
      Reflect.getMetadata(REQUIRED_PROJECT_ACTION_KEY, ProjectExpenseController.prototype.withdrawApproval)
    ).toBeUndefined();
  });

  it("keeps attachment ticket creation scoped by business file permission", () => {
    expect(
      Reflect.getMetadata(
        REQUIRED_PROJECT_ACTION_KEY,
        ProjectExpenseController.prototype.createAttachmentDownloadTicket
      )
    ).toBeUndefined();
    expect(
      Reflect.getMetadata(
        REQUIRED_PROJECT_ACTION_KEY,
        ProjectExpenseController.prototype.createApprovalPdfDownloadTicket
      )
    ).toBeUndefined();
  });

  it("forwards list requests to the service", async () => {
    const expenses = { list: jest.fn() };
    const controller = new ProjectExpenseController(expenses as never);

    await controller.list("project-1");

    expect(expenses.list).toHaveBeenCalledWith("project-1");
  });

  it("forwards create requests with the authenticated user id", async () => {
    const expenses = { create: jest.fn() };
    const controller = new ProjectExpenseController(expenses as never);
    const body = {
      code: "ZC-2026-001",
      expenseType: "sporadic_payment" as const,
      expenseSubtype: "sporadic_material" as const,
      paymentSubject: "建工智管",
      reason: "零星材料",
      requestedAmountCents: 10000,
      paymentMethod: "bank_transfer" as const
    };

    await controller.create("project-1", { id: "user-1" } as never, body);

    expect(expenses.create).toHaveBeenCalledWith("project-1", "user-1", body);
  });

  it("forwards attachment download ticket requests with the authenticated user id", async () => {
    const expenses = { createAttachmentDownloadTicket: jest.fn() };
    const controller = new ProjectExpenseController(expenses as never);

    await controller.createAttachmentDownloadTicket(
      "project-1",
      "expense-1",
      { id: "user-1" } as never,
      { confirmationPassword: "current-password" }
    );

    expect(expenses.createAttachmentDownloadTicket).toHaveBeenCalledWith(
      "project-1",
      "expense-1",
      "user-1",
      "current-password"
    );
  });

  it("forwards approval PDF download ticket requests with the authenticated user id", async () => {
    const expenses = { createApprovalPdfDownloadTicket: jest.fn() };
    const controller = new ProjectExpenseController(expenses as never);

    await controller.createApprovalPdfDownloadTicket(
      "project-1",
      "expense-1",
      { id: "user-1" } as never,
      { confirmationPassword: "current-password" }
    );

    expect(expenses.createApprovalPdfDownloadTicket).toHaveBeenCalledWith(
      "project-1",
      "expense-1",
      "user-1",
      "current-password"
    );
  });
});
