import { BusinessPartyModule } from "../business-party/business-party.module";
import { ContractBillModule } from "../contract-bill/contract-bill.module";
import { ContractBillService } from "../contract-bill/contract-bill.service";
import { FileModule } from "../file/file.module";
import { ContractWorkbenchModule } from "./contract-workbench.module";

describe("contract draft aggregate module wiring", () => {
  it("imports every aggregate writer and exports the shared bill service", () => {
    const workbenchImports = Reflect.getMetadata(
      "imports",
      ContractWorkbenchModule
    ) as unknown[];
    const billExports = Reflect.getMetadata("exports", ContractBillModule) as unknown[];

    expect(workbenchImports).toEqual(
      expect.arrayContaining([
        BusinessPartyModule,
        ContractBillModule,
        FileModule
      ])
    );
    expect(billExports).toContain(ContractBillService);
  });
});
