import type { ForwardReference, Provider, Type } from "@nestjs/common";
import { MODULE_METADATA } from "@nestjs/common/constants";
import { AppModule } from "../app.module";
import { ContractModule } from "../contract/contract.module";
import { ContractDocumentController } from "./contract-document.controller";
import { ContractDocumentModule } from "./contract-document.module";
import { ContractDocumentProcessor } from "./contract-document.processor";
import { ContractDocumentService } from "./contract-document.service";

function moduleGraph(root: Type<unknown>): Set<Type<unknown>> {
  const modules = new Set<Type<unknown>>();
  function visit(module: Type<unknown>) {
    if (modules.has(module)) return;
    modules.add(module);
    const imports = (Reflect.getMetadata(MODULE_METADATA.IMPORTS, module) ?? []) as
      Array<Type<unknown> | ForwardReference<() => Type<unknown>>>;
    for (const entry of imports) {
      visit(typeof entry === "function" ? entry : entry.forwardRef());
    }
  }
  visit(root);
  return modules;
}

function processorRegistrations(modules: Set<Type<unknown>>) {
  return [...modules].flatMap(module => {
    const providers = (Reflect.getMetadata(MODULE_METADATA.PROVIDERS, module) ?? []) as Provider[];
    return providers.filter(provider =>
      (typeof provider === "function" ? provider : provider.provide) === ContractDocumentProcessor
    );
  });
}

describe("contract document worker module wiring", () => {
  it("keeps document routes and services available from the contract API without scheduling document jobs", () => {
    const modules = moduleGraph(ContractModule);
    expect(modules.has(ContractDocumentModule)).toBe(true);
    expect(Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, ContractDocumentModule)).toContain(ContractDocumentController);
    expect(Reflect.getMetadata(MODULE_METADATA.EXPORTS, ContractDocumentModule)).toContain(ContractDocumentService);
    expect(processorRegistrations(modules)).toHaveLength(0);
  });

  it("registers the original document processor exactly once in the production application", () => {
    expect(processorRegistrations(moduleGraph(AppModule))).toEqual([ContractDocumentProcessor]);
  });
});
