import { MODULE_METADATA } from "@nestjs/common/constants";

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
});
