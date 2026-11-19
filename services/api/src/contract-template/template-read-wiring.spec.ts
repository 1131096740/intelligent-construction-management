import { MODULE_METADATA } from "@nestjs/common/constants";
import { ModuleRef } from "@nestjs/core";
import { GENERATED_ARCHIVE_PREPARATION_READER } from "../contract/contract-generated-archive-preparation";
import { ContractModule } from "../contract/contract.module";
import { ContractReadService } from "../contract/contract-read.service";
import { CONTRACT_VERSION_FILE_READ_AUTHORITY } from "../contract/contract-version-file-read-authority";
import { FileModule } from "../file/file.module";
import { FileService, PrivateFileStorage } from "../file/file.service";
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
  it("wires archive preparation to the configured private storage instance", () => {
    expect(Reflect.getMetadata(MODULE_METADATA.IMPORTS, ContractModule)).toContain(FileModule);
    expect(Reflect.getMetadata(MODULE_METADATA.EXPORTS, FileModule)).toContain(PrivateFileStorage);
    expect(Reflect.getMetadata(MODULE_METADATA.PROVIDERS, ContractModule))
      .toContainEqual({ provide: GENERATED_ARCHIVE_PREPARATION_READER, useExisting: PrivateFileStorage });
  });
  it("resolves the same initialized real read service instance through actual ModuleRef", async () => {
    const server = await createTemplateTestServer();
    try { expect(server.moduleRef.get(CONTRACT_VERSION_FILE_READ_AUTHORITY, { strict: false })).toBe(server.moduleRef.get(ContractReadService, { strict: false })); }
    finally { await server.app.close(); }
  });
});
