import { Test } from "@nestjs/testing";
import { BusinessEntryDefinitionModule } from "./business-entry-definition.module";
import { BusinessEntryDefinitionService } from "./business-entry-definition.service";
import { BusinessEntrySceneAuthorizationService } from "./business-entry-scene-authorization.service";

describe("BusinessEntryDefinitionModule production wiring", () => {
  it("instantiates the definition service with the production authorization provider", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [BusinessEntryDefinitionModule]
    }).compile();

    expect(moduleRef.get(BusinessEntryDefinitionService)).toBeInstanceOf(
      BusinessEntryDefinitionService
    );
    expect(moduleRef.get(BusinessEntrySceneAuthorizationService)).toBeInstanceOf(
      BusinessEntrySceneAuthorizationService
    );

    await moduleRef.close();
  });
});
