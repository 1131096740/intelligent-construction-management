import { MODULE_METADATA } from "@nestjs/common/constants";
import { APP_GUARD } from "@nestjs/core";
import { AuthModule } from "../auth/auth.module";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { PermissionGuard } from "../auth/guards/permission.guard";
import { ContractCutoverGuard } from "../contract-cutover/contract-cutover.guard";
import { OperationalWriteFreezeGuard } from "./operational-write-freeze.guard";

describe("operational write freeze global wiring", () => {
  it("authenticates first, freezes writes before resource permission reads, and preserves contract cutover", () => {
    const providers = Reflect.getMetadata(
      MODULE_METADATA.PROVIDERS,
      AuthModule
    ) as Array<{ provide?: unknown; useClass?: unknown }>;
    const guards = providers
      .filter((provider) => provider.provide === APP_GUARD)
      .map((provider) => provider.useClass);

    expect(guards).toEqual([
      JwtAuthGuard,
      OperationalWriteFreezeGuard,
      PermissionGuard,
      ContractCutoverGuard
    ]);
  });
});
