import "reflect-metadata";
import {
  type ExecutionContext,
  HttpException
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { PermissionGuard } from "../auth/guards/permission.guard";
import { createApiValidationPipe } from "../validation/api-validation";
import { SettlementController } from "./settlement.controller";
import { SettlementService } from "./settlement.service";

const ACTOR_USER_ID = "ledger-user-1";
const SETTLEMENT_ID = "settlement-target-1";
const VALID_WITHDRAWAL = {
  expectedSettlementUpdatedAt: "2026-08-02T04:00:00.000Z",
  expectedApprovalInstanceId: "approval-instance-1",
  expectedNodeIndex: 1,
  expectedApprovalUpdatedAt: "2026-08-02T04:00:01.000Z"
};

type RuntimeDto = new () => object;

function withdrawalContext(request: unknown): ExecutionContext {
  return {
    getHandler: () => SettlementController.prototype.withdrawApproval,
    getClass: () => SettlementController,
    switchToHttp: () => ({ getRequest: () => request })
  } as unknown as ExecutionContext;
}

function normalizedHttpFailure(error: unknown) {
  if (!(error instanceof HttpException)) {
    throw error;
  }
  return {
    statusCode: error.getStatus(),
    response: error.getResponse()
  };
}

async function invokeWithdrawalRoute(
  resourceExists: boolean,
  body: Record<string, unknown>
) {
  const order: string[] = [];
  const prisma = {
    settlement: {
      findFirst: jest.fn().mockImplementation(async () => {
        order.push("guard:resolve-settlement-project");
        return resourceExists ? { projectId: "external-project-1" } : null;
      })
    },
    userPosition: {
      findMany: jest.fn().mockResolvedValue([])
    },
    projectMember: {
      findMany: jest.fn().mockImplementation(async ({ where }: { where: Record<string, unknown> }) => {
        order.push("guard:load-role-scope");
        return Object.hasOwn(where, "projectId")
          ? []
          : [{ positionKey: "contract_staff" }];
      })
    },
    position: {
      findMany: jest.fn().mockResolvedValue([])
    },
    approvalInstance: {
      findFirst: jest.fn().mockImplementation(async () => {
        order.push("service:bind-withdrawal-identity");
        return null;
      })
    }
  };
  const guard = new PermissionGuard(new Reflector(), prisma as never);
  const settlementService = new SettlementService(prisma as never, {} as never);
  const controller = new SettlementController(
    {} as never,
    {} as never,
    settlementService,
    {} as never,
    {} as never
  );
  const request = {
    user: { id: ACTOR_USER_ID },
    params: { settlementId: SETTLEMENT_ID },
    body
  };

  try {
    order.push("guard:start");
    await guard.canActivate(withdrawalContext(request));
    order.push("guard:pass");
    const metatype = Reflect.getMetadata(
      "design:paramtypes",
      SettlementController.prototype,
      "withdrawApproval"
    )?.[2] as RuntimeDto | undefined;
    if (!metatype) {
      throw new Error("Missing withdrawal DTO metadata");
    }
    order.push("pipe:start");
    const validatedBody = await createApiValidationPipe().transform(body, {
      type: "body",
      metatype,
      data: undefined
    });
    order.push("pipe:pass");
    await controller.withdrawApproval(
      SETTLEMENT_ID,
      { id: ACTOR_USER_ID } as never,
      validatedBody as never
    );
    throw new Error("Expected withdrawal route to reject an unbound applicant");
  } catch (error) {
    return {
      failure: normalizedHttpFailure(error),
      order,
      projectResolutionCalls: prisma.settlement.findFirst.mock.calls.length,
      serviceIdentityCalls: prisma.approvalInstance.findFirst.mock.calls.length
    };
  }
}

describe("settlement approval withdrawal route authorization order", () => {
  it("returns the same validation failure for an external-project and a missing settlement", async () => {
    const invalidBody = {
      ...VALID_WITHDRAWAL,
      expectedSettlementUpdatedAt: "not-a-date"
    };

    const external = await invokeWithdrawalRoute(true, invalidBody);
    const missing = await invokeWithdrawalRoute(false, invalidBody);

    expect(external.failure).toEqual(missing.failure);
    expect(external.failure).toMatchObject({ statusCode: 400 });
    expect(external.projectResolutionCalls).toBe(0);
    expect(missing.projectResolutionCalls).toBe(0);
    expect(external.serviceIdentityCalls).toBe(0);
    expect(missing.serviceIdentityCalls).toBe(0);
    expect(external.order).toEqual([
      "guard:start",
      "guard:load-role-scope",
      "guard:pass",
      "pipe:start"
    ]);
    expect(missing.order).toEqual(external.order);
  });

  it("returns the same service denial for an external-project and a missing settlement", async () => {
    const external = await invokeWithdrawalRoute(true, VALID_WITHDRAWAL);
    const missing = await invokeWithdrawalRoute(false, VALID_WITHDRAWAL);

    expect(external.failure).toEqual(missing.failure);
    expect(external.failure).toEqual({
      statusCode: 403,
      response: {
        error: "Forbidden",
        message: "只有结算审批申请人可以撤回审批",
        statusCode: 403
      }
    });
    expect(external.projectResolutionCalls).toBe(0);
    expect(missing.projectResolutionCalls).toBe(0);
    expect(external.serviceIdentityCalls).toBe(1);
    expect(missing.serviceIdentityCalls).toBe(1);
    expect(external.order).toEqual([
      "guard:start",
      "guard:load-role-scope",
      "guard:pass",
      "pipe:start",
      "pipe:pass",
      "service:bind-withdrawal-identity"
    ]);
    expect(missing.order).toEqual(external.order);
  });
});
