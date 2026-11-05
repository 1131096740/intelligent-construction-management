import { MODULE_METADATA } from "@nestjs/common/constants";
import { ModuleRef } from "@nestjs/core";
import { ContractModule } from "../contract/contract.module";
import { ContractReadService } from "../contract/contract-read.service";
import { CONTRACT_VERSION_FILE_READ_AUTHORITY } from "../contract/contract-version-file-read-authority";
import { FileService } from "../file/file.service";
import { createTemplateTestServer } from "./template-management.test-support";

describe("contract file read authority Nest wiring", () => {
  it("exports useExisting and keeps File/Read constructor metadata initialized", () => {
    const providers = Reflect.getMetadata(MODULE_METADATA.PROVIDERS, ContractModule) as Array<unknown>;
    expect(providers).toContainEqual({ provide: CONTRACT_VERSION_FILE_READ_AUTHORITY, useExisting: ContractReadService });
    expect(Reflect.getMetadata(MODULE_METADATA.EXPORTS, ContractModule)).toContain(CONTRACT_VERSION_FILE_READ_AUTHORITY);
    expect(Reflect.getMetadata("design:paramtypes", FileService)).toContain(ModuleRef);
    expect(Reflect.getMetadata("design:paramtypes", FileService)).not.toContain(undefined);
    expect(Reflect.getMetadata("design:paramtypes", ContractReadService)).not.toContain(undefined);
  });
  it("resolves the same initialized real read service instance through actual ModuleRef", async () => {
    const server = await createTemplateTestServer();
    try { expect(server.moduleRef.get(CONTRACT_VERSION_FILE_READ_AUTHORITY, { strict: false })).toBe(server.moduleRef.get(ContractReadService, { strict: false })); }
    finally { await server.app.close(); }
  });
});
