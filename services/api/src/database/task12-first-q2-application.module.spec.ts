import { MODULE_METADATA } from "@nestjs/common/constants";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";
import { AuthModule } from "../auth/auth.module";
import { ContractModule } from "../contract/contract.module";
import { ProjectOperatingConstraintFilter } from "../project/project-operating-constraint.filter";
import { DatabaseModule } from "./database.module";
import { Task12FirstQ2ApplicationModule } from "./task12-first-q2-application.module";

describe("first Q2 application root", () => {
  it("uses the original contract routes, shared Auth guards, and production exception filter", () => {
    expect(Reflect.getMetadata(MODULE_METADATA.IMPORTS, Task12FirstQ2ApplicationModule))
      .toEqual([DatabaseModule, ContractModule]);
    expect(Reflect.getMetadata(MODULE_METADATA.IMPORTS, ContractModule)).toContain(AuthModule);
    const authProviders = Reflect.getMetadata(MODULE_METADATA.PROVIDERS, AuthModule) as Array<{ provide?: string }>;
    expect(authProviders.filter(provider => provider.provide === APP_GUARD)).toHaveLength(6);
    expect(Reflect.getMetadata(MODULE_METADATA.PROVIDERS, Task12FirstQ2ApplicationModule))
      .toEqual([{ provide: APP_FILTER, useClass: ProjectOperatingConstraintFilter }]);
  });
});
