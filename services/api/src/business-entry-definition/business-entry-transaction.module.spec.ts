import { Test } from "@nestjs/testing";
import { BusinessEntryTransactionService } from "./business-entry-transaction.service";
import { BusinessEntryTransactionModule } from "./business-entry-transaction.module";
import {
  BUSINESS_ENTRY_TRANSACTION_SCENE_REGISTRY,
  type BusinessEntryTransactionSceneRegistry
} from "./business-entry-transaction-scene-registry";

describe("BusinessEntryTransactionModule production wiring", () => {
  it("exports the narrow domain-callable capability without importing business domains", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [BusinessEntryTransactionModule]
    }).compile();

    expect(moduleRef.get(BusinessEntryTransactionService)).toBeInstanceOf(
      BusinessEntryTransactionService
    );
    expect(() => moduleRef.get<BusinessEntryTransactionSceneRegistry>(
      BUSINESS_ENTRY_TRANSACTION_SCENE_REGISTRY
    ).get("contract_formal_entry")).toThrow("事务业务场景未登记");

    await moduleRef.close();
  });
});
