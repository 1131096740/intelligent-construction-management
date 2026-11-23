import { HistoryExpenseController } from "./history-expense.controller";
import type { HistoryExpenseService } from "./history-expense.service";

describe("HistoryExpenseController", () => {
  const user = { id: "actor-1" } as never;
  const service = {
    capability: jest.fn(),
    precheck: jest.fn(),
    createBatch: jest.fn(),
    list: jest.fn(),
    detail: jest.fn(),
    verifyRow: jest.fn(),
    confirm: jest.fn(),
    activate: jest.fn(),
    correctRow: jest.fn()
  };
  const controller = new HistoryExpenseController(service as unknown as HistoryExpenseService);

  beforeEach(() => jest.clearAllMocks());

  it("passes the authenticated actor and project to every capability read", async () => {
    const input = { rows: [{ values: { businessRef: "费用-1" } }] };
    await controller.precheck("project-1", user, input);
    expect(service.precheck).toHaveBeenCalledWith("project-1", "actor-1", input);
    await controller.capability("project-1", user);
    expect(service.capability).toHaveBeenCalledWith("project-1", "actor-1");
  });

  it("keeps row verification, supervisor confirmation and activation as separate endpoints", async () => {
    const rowInput = { expectedRevision: 2, reviewOutcome: "verified" as const };
    await controller.verifyRow("project-1", "batch-1", "row-1", user, rowInput);
    expect(service.verifyRow).toHaveBeenCalledWith(
      "project-1",
      "batch-1",
      "row-1",
      "actor-1",
      rowInput
    );
    const confirmInput = { expectedRevision: 4, idempotencyKey: "idem-1" };
    await controller.confirm("project-1", "batch-1", user, confirmInput);
    expect(service.confirm).toHaveBeenCalledWith(
      "project-1",
      "batch-1",
      "actor-1",
      confirmInput
    );
    await controller.activate("project-1", "batch-1", user, { expectedRevision: 5 });
    expect(service.activate).toHaveBeenCalledWith("project-1", "batch-1", "actor-1", {
      expectedRevision: 5
    });
    const correctionInput = {
      expectedRevision: 3,
      reason: "原始凭据金额更正",
      values: { amountYuan: "700.00" }
    };
    await controller.correctRow("project-1", "batch-1", "row-1", user, correctionInput);
    expect(service.correctRow).toHaveBeenCalledWith(
      "project-1",
      "batch-1",
      "row-1",
      "actor-1",
      correctionInput
    );
  });
});
