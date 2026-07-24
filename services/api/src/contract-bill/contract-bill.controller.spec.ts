import type { AuthenticatedUser } from "../auth/auth.types";
import { ContractBillController } from "./contract-bill.controller";

describe("ContractBillController", () => {
  it("replaces the complete bill row set for the current user", async () => {
    const service = {
      replaceRows: jest.fn().mockResolvedValue({ bill: { revision: 8 }, rows: [] })
    };
    const controller = new ContractBillController(service as never);
    const user = { id: "user-1" } as AuthenticatedUser;
    const input = {
      expectedBillRevision: 7,
      idempotencyKey: "save-20260724-001",
      rows: [
        {
          clientRowKey: "local-1",
          sortOrder: 0,
          itemName: "混凝土",
          unit: "m³",
          quantity: "12.50",
          unitPrice: "480.00",
          taxRateSource: "version_default" as const,
          customData: {}
        }
      ]
    };

    await expect(controller.replaceRows("bill-1", user, input)).resolves.toEqual({
      bill: { revision: 8 },
      rows: []
    });
    expect(service.replaceRows).toHaveBeenCalledWith("bill-1", user.id, input);
  });
});
