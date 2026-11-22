import type { ExecutionContext } from "@nestjs/common";
import { HttpException } from "@nestjs/common";
import { SignedContractSettlementController } from "../settlement/signed-contract-settlement.controller";
import { OperationalWriteFreezeGuard } from "./operational-write-freeze.guard";
import { OperationalWriteFreezeService } from "./operational-write-freeze.service";

const originalMode = process.env.OPERATIONAL_WRITE_FREEZE_MODE;
const originalModules = process.env.OPERATIONAL_WRITE_FREEZE_MODULES;

class PaymentController {
  create() {}
}

class FundAccountController {
  mutate() {}
}

class FundAccountAdvanceController {
  register() {}
  registerCompanyOwned() {}
  companyOwnedBankOptions() {}
}

class FundPrincipalReturnController {
  list() {}
  apply() {}
  act() {}
  pay() {}
  result() {}
}

class RegisteredPaymentExecutionController {
  mutate() {}
}

class ProjectController {
  recordOwnerSettlement() {}
  uploadOwnerSettlementFile() {}
  recordUpstreamFundFact() {}
  confirmUpstreamFundFact() {}
}

class ContractController {
  create() {}
}

class OperatingProjectionController {
  export() {}
}

class UnclassifiedController {
  mutate() {}
}

class AuthController {
  login() {}
  changePassword() {}
  updateMyProfile() {}
}

class BusinessEntryDefinitionController {
  freeze() {}
}

function contextFor(input: {
  controller: object;
  handler: object;
  method?: string;
  params?: Record<string, string>;
  body?: { confirmedReceipt?: boolean };
}): ExecutionContext {
  return {
    getClass: () => input.controller,
    getHandler: () => input.handler,
    switchToHttp: () => ({
      getRequest: () => ({
        method: input.method ?? "POST",
        params: input.params,
        body: input.body
      })
    })
  } as unknown as ExecutionContext;
}

function restoreEnvironment() {
  if (originalMode === undefined) delete process.env.OPERATIONAL_WRITE_FREEZE_MODE;
  else process.env.OPERATIONAL_WRITE_FREEZE_MODE = originalMode;
  if (originalModules === undefined) delete process.env.OPERATIONAL_WRITE_FREEZE_MODULES;
  else process.env.OPERATIONAL_WRITE_FREEZE_MODULES = originalModules;
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

describe("OperationalWriteFreezeGuard", () => {
  const guard = new OperationalWriteFreezeGuard(new OperationalWriteFreezeService());

  afterEach(() => restoreEnvironment());

  it("keeps the project freeze and also blocks only the new project financial writes during a finance freeze", () => {
    process.env.OPERATIONAL_WRITE_FREEZE_MODE = "modules";
    process.env.OPERATIONAL_WRITE_FREEZE_MODULES = "finance";
    const projectWrite = (handler: object, body?: { confirmedReceipt: boolean }) =>
      guard.canActivate(contextFor({ controller: ProjectController, handler, body }));
    const project = ProjectController.prototype;
    for (const handler of [project.recordOwnerSettlement, project.uploadOwnerSettlementFile]) {
      expectHttpFailure(() => projectWrite(handler), 503, "OPERATIONAL_WRITE_FREEZE_ACTIVE");
    }
    expectHttpFailure(() => projectWrite(project.recordUpstreamFundFact, { confirmedReceipt: true }), 503, "OPERATIONAL_WRITE_FREEZE_ACTIVE");
    expect(projectWrite(project.recordUpstreamFundFact)).toBe(true);
    expect(projectWrite(project.confirmUpstreamFundFact)).toBe(true);

    process.env.OPERATIONAL_WRITE_FREEZE_MODULES = "project";
    expectHttpFailure(() => projectWrite(project.recordOwnerSettlement), 503, "OPERATIONAL_WRITE_FREEZE_ACTIVE");
  });

  it("keeps the new advance writes behind the finance freeze and preserves candidate reads", () => {
    process.env.OPERATIONAL_WRITE_FREEZE_MODE = "modules";
    process.env.OPERATIONAL_WRITE_FREEZE_MODULES = "finance";
    const controller = FundAccountAdvanceController;
    for (const handler of [controller.prototype.register, controller.prototype.registerCompanyOwned]) {
      expectHttpFailure(() => guard.canActivate(contextFor({ controller, handler })), 503, "OPERATIONAL_WRITE_FREEZE_ACTIVE");
    }
    expect(guard.canActivate(contextFor({ controller, handler: controller.prototype.companyOwnedBankOptions, method: "GET" }))).toBe(true);
  });

  it("freezes principal return writes while preserving the list and original-key lookup", () => {
    process.env.OPERATIONAL_WRITE_FREEZE_MODE = "modules";
    process.env.OPERATIONAL_WRITE_FREEZE_MODULES = "finance";
    const controller = FundPrincipalReturnController;
    for (const handler of [controller.prototype.apply, controller.prototype.act, controller.prototype.pay]) {
      expectHttpFailure(() => guard.canActivate(contextFor({ controller, handler })), 503, "OPERATIONAL_WRITE_FREEZE_ACTIVE");
    }
    for (const handler of [controller.prototype.list, controller.prototype.result]) {
      expect(guard.canActivate(contextFor({ controller, handler, method: "GET" }))).toBe(true);
    }
  });

  it("keeps classified writes open by default", () => {
    delete process.env.OPERATIONAL_WRITE_FREEZE_MODE;
    delete process.env.OPERATIONAL_WRITE_FREEZE_MODULES;
    expect(
      guard.canActivate(
        contextFor({
          controller: PaymentController,
          handler: PaymentController.prototype.create
        })
      )
    ).toBe(true);
  });

  it("blocks every classified business write in all mode while preserving safe GETs", () => {
    process.env.OPERATIONAL_WRITE_FREEZE_MODE = "all";
    delete process.env.OPERATIONAL_WRITE_FREEZE_MODULES;
    expectHttpFailure(
      () =>
        guard.canActivate(
          contextFor({
            controller: PaymentController,
            handler: PaymentController.prototype.create
          })
        ),
      503,
      "OPERATIONAL_WRITE_FREEZE_ACTIVE"
    );
    expect(
      guard.canActivate(
        contextFor({
          controller: PaymentController,
          handler: PaymentController.prototype.create,
          method: "GET"
        })
      )
    ).toBe(true);
  });

  it("blocks only explicitly selected modules in modules mode", () => {
    process.env.OPERATIONAL_WRITE_FREEZE_MODE = "modules";
    process.env.OPERATIONAL_WRITE_FREEZE_MODULES = "payment,settlement";
    expectHttpFailure(
      () =>
        guard.canActivate(
          contextFor({
            controller: PaymentController,
            handler: PaymentController.prototype.create
          })
        ),
      503,
      "OPERATIONAL_WRITE_FREEZE_ACTIVE"
    );
    expect(
      guard.canActivate(
        contextFor({
          controller: ContractController,
          handler: ContractController.prototype.create
        })
      )
    ).toBe(true);
  });

  it.each([
    { controller: FundAccountController, module: "finance", otherModule: "payment" },
    { controller: RegisteredPaymentExecutionController, module: "payment", otherModule: "finance" }
  ])("classifies $controller.name under the $module write freeze", ({ controller, module, otherModule }) => {
    const context = contextFor({ controller, handler: controller.prototype.mutate });
    process.env.OPERATIONAL_WRITE_FREEZE_MODE = "modules";
    process.env.OPERATIONAL_WRITE_FREEZE_MODULES = otherModule;
    expect(guard.canActivate(context)).toBe(true);

    process.env.OPERATIONAL_WRITE_FREEZE_MODULES = module;
    expectHttpFailure(() => guard.canActivate(context), 503, "OPERATIONAL_WRITE_FREEZE_ACTIVE");
  });

  it("keeps audited exports open without a freeze and blocks them in the finance freeze", () => {
    delete process.env.OPERATIONAL_WRITE_FREEZE_MODE;
    delete process.env.OPERATIONAL_WRITE_FREEZE_MODULES;
    expect(
      guard.canActivate(
        contextFor({
          controller: OperatingProjectionController,
          handler: OperatingProjectionController.prototype.export
        })
      )
    ).toBe(true);

    process.env.OPERATIONAL_WRITE_FREEZE_MODE = "modules";
    process.env.OPERATIONAL_WRITE_FREEZE_MODULES = "finance";
    expectHttpFailure(
      () =>
        guard.canActivate(
          contextFor({
            controller: OperatingProjectionController,
            handler: OperatingProjectionController.prototype.export
          })
        ),
      503,
      "OPERATIONAL_WRITE_FREEZE_ACTIVE"
    );
  });

  it("preserves the explicit authentication lifecycle during every freeze mode", () => {
    process.env.OPERATIONAL_WRITE_FREEZE_MODE = "all";
    delete process.env.OPERATIONAL_WRITE_FREEZE_MODULES;
    for (const handler of [
      AuthController.prototype.login,
      AuthController.prototype.changePassword
    ]) {
      expect(
        guard.canActivate(
          contextFor({ controller: AuthController, handler })
        )
      ).toBe(true);
    }
    expectHttpFailure(
      () =>
        guard.canActivate(
          contextFor({
            controller: AuthController,
            handler: AuthController.prototype.updateMyProfile
          })
        ),
      503,
      "OPERATIONAL_WRITE_FREEZE_ACTIVE"
    );
  });

  it("fails closed for invalid mode and module combinations without blocking safe GETs", () => {
    process.env.OPERATIONAL_WRITE_FREEZE_MODE = "modules";
    process.env.OPERATIONAL_WRITE_FREEZE_MODULES = "payment,unknown";
    expectHttpFailure(
      () =>
        guard.canActivate(
          contextFor({
            controller: PaymentController,
            handler: PaymentController.prototype.create
          })
        ),
      503,
      "OPERATIONAL_WRITE_FREEZE_CONFIGURATION_INVALID"
    );
    expect(
      guard.canActivate(
        contextFor({
          controller: PaymentController,
          handler: PaymentController.prototype.create,
          method: "HEAD"
        })
      )
    ).toBe(true);
  });

  it("keeps signed settlement mutations under settlement freeze and leaves reads available", () => {
    const controller = SignedContractSettlementController;
    const mutations = ["upload", "create", "update", "submit", "review", "attachmentDownloadTicket"] as const;
    process.env.OPERATIONAL_WRITE_FREEZE_MODE = "modules";
    process.env.OPERATIONAL_WRITE_FREEZE_MODULES = "settlement";
    for (const action of mutations) {
      expectHttpFailure(() => guard.canActivate(contextFor({
        controller, handler: controller.prototype[action], method: action === "update" ? "PATCH" : "POST"
      })), 503, "OPERATIONAL_WRITE_FREEZE_ACTIVE");
    }
    expect(guard.canActivate(contextFor({ controller, handler: controller.prototype.contracts, method: "GET" }))).toBe(true);
    process.env.OPERATIONAL_WRITE_FREEZE_MODE = "off";
    delete process.env.OPERATIONAL_WRITE_FREEZE_MODULES;
    for (const action of mutations) {
      expect(guard.canActivate(contextFor({
        controller, handler: controller.prototype[action], method: action === "update" ? "PATCH" : "POST"
      }))).toBe(true);
    }
  });

  it("fails closed for every unclassified mutation even when the configured mode is off", () => {
    process.env.OPERATIONAL_WRITE_FREEZE_MODE = "off";
    delete process.env.OPERATIONAL_WRITE_FREEZE_MODULES;
    expectHttpFailure(
      () =>
        guard.canActivate(
          contextFor({
            controller: UnclassifiedController,
            handler: UnclassifiedController.prototype.mutate
          })
        ),
      503,
      "OPERATIONAL_WRITE_FREEZE_ROUTE_UNCLASSIFIED"
    );
  });

  it("maps only the business-party definition scene to master-data freeze", () => {
    process.env.OPERATIONAL_WRITE_FREEZE_MODE = "modules";
    process.env.OPERATIONAL_WRITE_FREEZE_MODULES = "master_data";
    expectHttpFailure(
      () => guard.canActivate(contextFor({
        controller: BusinessEntryDefinitionController,
        handler: BusinessEntryDefinitionController.prototype.freeze,
        params: { sceneKey: "business_party" }
      })),
      503,
      "OPERATIONAL_WRITE_FREEZE_ACTIVE"
    );
    expect(guard.canActivate(contextFor({
      controller: BusinessEntryDefinitionController,
      handler: BusinessEntryDefinitionController.prototype.freeze,
      params: { sceneKey: "company_profile" }
    }))).toBe(true);
  });
});
