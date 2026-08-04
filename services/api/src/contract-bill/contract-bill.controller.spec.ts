import type { AuthenticatedUser } from "../auth/auth.types";
import { REQUIRED_PROJECT_ACTION_KEY } from "../auth/decorators/require-project-role.decorator";
import { createApiValidationPipe } from "../validation/api-validation";
import { ContractBillController } from "./contract-bill.controller";
import { CancelBillRowRemainderDto } from "./dto/contract-bill.dto";

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

  it("forwards the complete remainder-cancellation CAS coordinate", async () => {
    const service = { cancelRemainder: jest.fn().mockResolvedValue({ rows: [] }) };
    const controller = new ContractBillController(service as never);
    const user = { id: "user-1" } as AuthenticatedUser;
    const input = Object.assign(new CancelBillRowRemainderDto(), {
      expectedBillRevision: 7,
      expectedDraftRevision: 12,
      expectedOccupancyToken: "a".repeat(64),
      reason: "现场范围核减"
    });

    await expect(controller.cancelRemainder(
      "bill-1",
      "row/key",
      user,
      "lease-token",
      input
    ))
      .resolves.toEqual({ rows: [] });
    expect(service.cancelRemainder).toHaveBeenCalledWith(
      "bill-1",
      "row/key",
      user.id,
      "lease-token",
      input
    );
  });

  it("requires contract.create for remainder cancellation", () => {
    expect(Reflect.getMetadata(
      REQUIRED_PROJECT_ACTION_KEY,
      ContractBillController.prototype.cancelRemainder
    )).toBe("contract.create");
  });

  it("validates remainder-cancellation revisions, token, reason, and field whitelist", async () => {
    const pipe = createApiValidationPipe();
    const metadata = {
      type: "body" as const,
      metatype: CancelBillRowRemainderDto,
      data: undefined
    };
    const valid = {
      expectedBillRevision: 7,
      expectedDraftRevision: 12,
      expectedOccupancyToken: "a".repeat(64),
      reason: "现场范围核减"
    };

    await expect(pipe.transform(valid, metadata)).resolves.toEqual(valid);
    for (const invalid of [
      { ...valid, expectedBillRevision: 0 },
      { ...valid, expectedDraftRevision: 1.5 },
      { ...valid, expectedOccupancyToken: "not-a-sha" },
      { ...valid, reason: "   " },
      { ...valid, reason: "原".repeat(501) },
      { ...valid, unexpected: true }
    ]) {
      await expect(pipe.transform(invalid, metadata)).rejects.toThrow();
    }
  });
});
