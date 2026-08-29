import "reflect-metadata";

import { BadRequestException } from "@nestjs/common";

import { REQUIRED_POSITIONS_KEY } from "../auth/decorators/require-positions.decorator";
import { FundMovementController } from "./fund-movement.controller";

const user = { id: "finance-1", name: "财务", phone: null };

function validBody() {
  return {
    kind: "cross_project_payment" as const,
    paymentExecutionId: "execution-1",
    sourceProjectId: "project-source",
    beneficiaryProjectId: "project-beneficiary",
    sourceCompanyEntityId: "company-source",
    beneficiaryCompanyEntityId: "company-beneficiary",
    paymentAmountCents: "100",
    projectFundUsedCents: "100",
    companyAdvanceCents: "0",
    legs: [
      {
        role: "source" as const,
        projectId: "project-source",
        companyEntityId: "company-source",
        counterpartyProjectId: "project-beneficiary",
        counterpartyCompanyEntityId: "company-beneficiary",
        direction: "decrease" as const,
        amountCents: "100",
        sourceType: "payable",
        sourceAggregateId: "payable-1",
        sourceAllocationCount: 1,
        sourceAllocationAmountCents: "100",
        contractId: "contract-1",
        contractVersionId: "contract-version-1",
        sourceSnapshot: { source: "test" }
      },
      {
        role: "beneficiary" as const,
        projectId: "project-beneficiary",
        companyEntityId: "company-beneficiary",
        counterpartyProjectId: "project-source",
        counterpartyCompanyEntityId: "company-source",
        direction: "increase" as const,
        amountCents: "100",
        sourceType: "payable",
        sourceAggregateId: "payable-1",
        sourceAllocationCount: 1,
        sourceAllocationAmountCents: "100",
        contractId: "contract-1",
        contractVersionId: "contract-version-1",
        sourceSnapshot: { source: "test" }
      }
    ],
    idempotencyKey: "11111111-1111-4111-8111-111111111111"
  };
}

describe("FundMovementController", () => {
  it("requires finance roles at the route and delegates normalized integer cents", async () => {
    const movements = { create: jest.fn().mockResolvedValue({ movementId: "movement-1" }) };
    const controller = new FundMovementController(movements as never);

    await expect(controller.create(user, validBody())).resolves.toEqual({ movementId: "movement-1" });
    expect(movements.create).toHaveBeenCalledWith("finance-1", expect.objectContaining({
      paymentAmountCents: 100n,
      projectFundUsedCents: 100n,
      companyAdvanceCents: 0n,
      legs: expect.arrayContaining([
        expect.objectContaining({
          counterpartyProjectId: "project-beneficiary",
          sourceAllocationAmountCents: 100n
        })
      ])
    }));
    expect(Reflect.getMetadata(REQUIRED_POSITIONS_KEY, FundMovementController.prototype.create)).toEqual([
      "finance_staff",
      "finance_director"
    ]);
    expect(Reflect.getMetadata(REQUIRED_POSITIONS_KEY, FundMovementController.prototype.confirm)).toEqual([
      "finance_director"
    ]);
  });

  it("rejects malformed money before invoking the service", async () => {
    const movements = { create: jest.fn() };
    const controller = new FundMovementController(movements as never);
    expect(() => controller.create(user, { ...validBody(), paymentAmountCents: "0" })).toThrow(BadRequestException);
    expect(movements.create).not.toHaveBeenCalled();
  });

  it("never accepts a client-side actor id for lifecycle commands", async () => {
    const movements = { submit: jest.fn().mockResolvedValue({ status: "submitted" }) };
    const controller = new FundMovementController(movements as never);
    await controller.submit(user, "movement-1", {
      expectedRevision: 1,
      idempotencyKey: "22222222-2222-4222-8222-222222222222",
      actorUserId: "attacker"
    } as never);
    expect(movements.submit).toHaveBeenCalledWith("finance-1", {
      movementId: "movement-1",
      expectedRevision: 1,
      idempotencyKey: "22222222-2222-4222-8222-222222222222"
    });
  });
});
