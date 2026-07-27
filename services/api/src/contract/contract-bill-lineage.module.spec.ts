import { ContractBillModule } from "../contract-bill/contract-bill.module";
import { ContractWorkbenchModule } from "../contract-workbench/contract-workbench.module";
import { ContractModule } from "./contract.module";

describe("contract bill lineage module wiring", () => {
  it("makes the lineage provider available to every direct consumer", () => {
    expect(Reflect.getMetadata("imports", ContractModule)).toContain(ContractBillModule);
    expect(Reflect.getMetadata("imports", ContractWorkbenchModule)).toContain(ContractBillModule);
  });
});
