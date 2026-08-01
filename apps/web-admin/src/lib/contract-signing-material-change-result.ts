export class ContractSigningMaterialChangeResultUnknownError extends Error {
  constructor(readonly originalError: unknown) {
    super("签署实质变化申报结果暂时无法确认");
    this.name = "ContractSigningMaterialChangeResultUnknownError";
  }
}
