import { MODULE_METADATA } from "@nestjs/common/constants";
import { readFileSync } from "node:fs";

import { ProjectModule } from "./project.module";
import { ProjectService } from "./project.service";
import { ProjectUpstreamFundBusinessEntryService } from "./project-upstream-fund-business-entry.service";

describe("ProjectModule business-entry wiring", () => {
  it("always wires upstream-fund fact creation with the same-transaction snapshot service", () => {
    const providers = Reflect.getMetadata(MODULE_METADATA.PROVIDERS, ProjectModule) as unknown[];

    expect(providers).toEqual(expect.arrayContaining([
      ProjectService,
      ProjectUpstreamFundBusinessEntryService
    ]));
  });

  it("requires and unconditionally invokes the upstream-fund snapshot dependency", () => {
    const source = readFileSync(`${__dirname}/project.service.ts`, "utf8");

    expect(source).not.toMatch(
      /@Optional\(\)\s*private readonly upstreamFundBusinessEntry\?/
    );
    expect(source).toMatch(
      /await this\.upstreamFundBusinessEntry\.freeze\(\s*tx,\s*actorUserId,\s*created\s*\)/
    );
    expect(source).not.toContain("this.upstreamFundBusinessEntry\n          ?");
  });
});
