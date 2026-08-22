import type { ExecutionContext } from "@nestjs/common";
import { HttpException } from "@nestjs/common";
import { OperationalWriteFreezeGuard } from "./operational-write-freeze.guard";

const originalMode = process.env.OPERATIONAL_WRITE_FREEZE_MODE;
const originalModules = process.env.OPERATIONAL_WRITE_FREEZE_MODULES;

class PaymentController {
  create() {}
}

class ContractController {
  create() {}
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
}): ExecutionContext {
  return {
    getClass: () => input.controller,
    getHandler: () => input.handler,
    switchToHttp: () => ({
      getRequest: () => ({
        method: input.method ?? "POST",
        params: input.params
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
  const guard = new OperationalWriteFreezeGuard();

  afterEach(() => restoreEnvironment());

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
