import { principalReturnAmounts, principalReturnDuties } from "./fund-principal-return-state";

describe("registered principal return", () => {
  it("keeps exact four-place payment and reservation amounts without double counting paid portions", () => {
    expect(principalReturnAmounts("100000.0001", [
      {status:"paid", paidYuan:"60000.0000", requestedYuan:"60000.0000", approvedYuan:"60000.0000"},
      {status:"partially_paid", paidYuan:"0.0001", requestedYuan:"30000.0001", approvedYuan:"30000.0001"},
      {status:"pending", paidYuan:"0", requestedYuan:"9999.9999", approvedYuan:null},
    ])).toEqual({paidYuan:"60000.0001",reservedYuan:"39999.9999",availableYuan:"0.0001"});
  });

  it("releases rejected, withdrawn, and reduced unused principal", () => {
    expect(principalReturnAmounts("10.2000", [
      {status:"rejected",paidYuan:"0",requestedYuan:"2.2000",approvedYuan:null},
      {status:"withdrawn",paidYuan:"0",requestedYuan:"2.2000",approvedYuan:null},
      {status:"approved",paidYuan:"0",requestedYuan:"5.1000",approvedYuan:"1.1000"},
    ])).toEqual({paidYuan:"0.0000",reservedYuan:"1.1000",availableYuan:"9.1000"});
  });

  it("includes project management only for associated projects, with one alternative leadership duty", () => {
    expect(principalReturnDuties(null).map(node=>node.roleKeys)).toEqual([
      ["comprehensive_director"],["finance_director"],["general_manager","chairman"],
    ]);
    expect(principalReturnDuties("project").map(node=>node.roleKeys)).toEqual([
      ["comprehensive_director"],["project_manager"],["finance_director"],["general_manager","chairman"],
    ]);
  });
});
