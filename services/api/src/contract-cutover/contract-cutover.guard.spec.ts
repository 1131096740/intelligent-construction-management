import type { ExecutionContext } from "@nestjs/common";
import { HttpException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { BusinessPartyController } from "../business-party/business-party.controller";
import { ContractBillController } from "../contract-bill/contract-bill.controller";
import { ContractBillExcelController } from "../contract-bill/contract-bill-excel.controller";
import { ContractBillTransitionController } from "../contract-bill/contract-bill-transition.controller";
import { ContractDraftBillExcelController } from "../contract-bill/contract-draft-bill-excel.controller";
import { ContractDocumentController } from "../contract-document/contract-document.controller";
import { ContractTakeoverController } from "../contract-takeover/contract-takeover.controller";
import { ContractController } from "../contract/contract.controller";
import { ContractDraftController } from "../contract-workbench/contract-draft.controller";
import { ContractWorkbenchController } from "../contract-workbench/contract-workbench.controller";
import {
  CONTRACT_CUTOVER_SURFACE_KEY,
  CONTRACT_CUTOVER_TOMBSTONE_WRITE_KEY,
  ContractCutoverLegacyWrite,
  ContractCutoverSurface
} from "./contract-cutover.decorators";
import { ContractCutoverGuard } from "./contract-cutover.guard";

const originalMode = process.env.CONTRACT_CUTOVER_MODE;
const originalCanaryUsers = process.env.CONTRACT_CUTOVER_CANARY_USER_IDS;

function restoreEnvironment() {
  if (originalMode === undefined) delete process.env.CONTRACT_CUTOVER_MODE;
  else process.env.CONTRACT_CUTOVER_MODE = originalMode;
  if (originalCanaryUsers === undefined) {
    delete process.env.CONTRACT_CUTOVER_CANARY_USER_IDS;
  } else {
    process.env.CONTRACT_CUTOVER_CANARY_USER_IDS = originalCanaryUsers;
  }
}

@ContractCutoverSurface()
class MarkedController {
  write() {}

  @ContractCutoverLegacyWrite()
  legacyWrite() {}
}

class UnmarkedController {
  write() {}
}

function contextFor(input: {
  controller?: object;
  handler?: object;
  method?: string;
  userId?: string;
} = {}): ExecutionContext {
  const controller = input.controller ?? MarkedController;
  const handler = input.handler ?? MarkedController.prototype.write;
  return {
    getClass: () => controller,
    getHandler: () => handler,
    switchToHttp: () => ({
      getRequest: () => ({
        method: input.method ?? "POST",
        user: input.userId
          ? { id: input.userId, name: "切换验收人", phone: null }
          : undefined
      })
    })
  } as unknown as ExecutionContext;
}

function expectHttpFailure(action: () => unknown, status: number, code: string) {
  try {
    action();
    throw new Error("expected guard to reject the request");
  } catch (error) {
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(status);
    expect((error as HttpException).getResponse()).toEqual(
      expect.objectContaining({ statusCode: status, code })
    );
  }
}

describe("ContractCutoverGuard", () => {
  const guard = new ContractCutoverGuard(new Reflector());

  afterEach(() => {
    restoreEnvironment();
  });

  it("keeps Release A backward compatible by default", () => {
    delete process.env.CONTRACT_CUTOVER_MODE;
    expect(guard.canActivate(contextFor({ userId: "user-a" }))).toBe(true);
    expect(
      guard.canActivate(
        contextFor({
          handler: MarkedController.prototype.legacyWrite,
          userId: "user-a"
        })
      )
    ).toBe(true);
  });

  it("blocks only marked writes during the transition maintenance window", () => {
    process.env.CONTRACT_CUTOVER_MODE = "maintenance";
    expectHttpFailure(
      () => guard.canActivate(contextFor({ userId: "user-a" })),
      503,
      "CONTRACT_CUTOVER_MAINTENANCE"
    );
    expect(
      guard.canActivate(contextFor({ method: "GET", userId: "user-a" }))
    ).toBe(true);
    expect(
      guard.canActivate(
        contextFor({
          controller: UnmarkedController,
          handler: UnmarkedController.prototype.write,
          userId: "user-a"
        })
      )
    ).toBe(true);
  });

  it("keeps new writes canary-only while returning 410 to legacy clients", () => {
    process.env.CONTRACT_CUTOVER_MODE = "release-b-maintenance";
    process.env.CONTRACT_CUTOVER_CANARY_USER_IDS = " user-canary ,user-second ";

    expect(
      guard.canActivate(contextFor({ userId: "user-canary" }))
    ).toBe(true);
    expectHttpFailure(
      () => guard.canActivate(contextFor({ userId: "user-other" })),
      503,
      "CONTRACT_CUTOVER_MAINTENANCE"
    );
    expectHttpFailure(
      () =>
        guard.canActivate(
          contextFor({
            handler: MarkedController.prototype.legacyWrite,
            userId: "user-canary"
          })
        ),
      410,
      "CONTRACT_WORKBENCH_CLIENT_UPGRADE_REQUIRED"
    );
  });

  it("opens new writes but permanently rejects marked legacy writes in Release B", () => {
    process.env.CONTRACT_CUTOVER_MODE = "release-b";
    expect(guard.canActivate(contextFor({ userId: "user-a" }))).toBe(true);
    expectHttpFailure(
      () =>
        guard.canActivate(
          contextFor({
            handler: MarkedController.prototype.legacyWrite,
            userId: "user-a"
          })
        ),
      410,
      "CONTRACT_WORKBENCH_CLIENT_UPGRADE_REQUIRED"
    );
  });

  it("fails closed for an invalid mode without replacing authentication", () => {
    process.env.CONTRACT_CUTOVER_MODE = "release-c";
    expectHttpFailure(
      () => guard.canActivate(contextFor({ userId: "user-a" })),
      503,
      "CONTRACT_CUTOVER_CONFIGURATION_INVALID"
    );
    expect(guard.canActivate(contextFor())).toBe(true);
  });

  it("marks the aggregate, legacy workbench and takeover controllers as cutover surfaces", () => {
    for (const controller of [
      ContractDraftController,
      ContractWorkbenchController,
      ContractTakeoverController,
      ContractBillController,
      ContractBillExcelController,
      ContractDraftBillExcelController,
      ContractBillTransitionController
    ]) {
      expect(Reflect.getMetadata(CONTRACT_CUTOVER_SURFACE_KEY, controller)).toBe(
        true
      );
    }
    expect(
      Reflect.getMetadata(
        CONTRACT_CUTOVER_TOMBSTONE_WRITE_KEY,
        ContractWorkbenchController.prototype.save
      )
    ).toBe(true);
    expect(
      Reflect.getMetadata(
        CONTRACT_CUTOVER_TOMBSTONE_WRITE_KEY,
        ContractTakeoverController.prototype.confirm
      )
    ).toBe(true);
  });

  it("marks draft mutations outside the aggregate controllers without blocking read-only tickets", () => {
    for (const [controller, methods] of [
      [
        ContractController,
        [
          "create",
          "createChangeDraft",
          "copyAbandonedDraft",
          "abandonDraft",
          "submitApproval",
          "setAuthorization"
        ]
      ],
      [
        BusinessPartyController,
        [
          "addContractParty",
          "updateContractPartyRole",
          "removeContractParty"
        ]
      ],
      [
        ContractDocumentController,
        [
          "queue",
          "uploadOfflineRevision",
          "openNegotiationRound",
          "closeNegotiationRound",
          "disposeDifference",
          "retryOfflineRevision",
          "retry"
        ]
      ]
    ] as const) {
      for (const method of methods) {
        expect(
          Reflect.getMetadata(
            CONTRACT_CUTOVER_SURFACE_KEY,
            (controller.prototype as unknown as Record<string, object>)[method]
          )
        ).toBe(true);
      }
    }
    expect(
      Reflect.getMetadata(
        CONTRACT_CUTOVER_SURFACE_KEY,
        ContractDocumentController.prototype.createOfflineRevisionPreviewDownloadTicket
      )
    ).toBeUndefined();
  });
});
