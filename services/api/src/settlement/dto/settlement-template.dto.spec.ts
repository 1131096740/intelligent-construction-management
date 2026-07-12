import "reflect-metadata";
import { validate } from "class-validator";
import { CreateSettlementDto } from "./create-settlement.dto";
import { PreviewSettlementImportDto } from "./preview-settlement-import.dto";
import { CreateSettlementTemplateDto } from "./settlement-template.dto";

describe("Settlement template DTO", () => {
  it("fails closed for unregistered amount roles and pricing modes", async () => {
    const input = Object.assign(new CreateSettlementTemplateDto(), {
      name: "测试结算模板",
      code: "SET-TEST",
      xlsxFileId: "file-1",
      compatibleContractTypeKeys: [],
      compatibleAmountRoles: ["unknown_role"],
      compatiblePricingModes: ["unknown_pricing"],
      columnSchema: {},
      printRules: {},
      evidenceRules: {},
      anomalyRules: {}
    });

    const messages = (await validate(input)).flatMap((error) =>
      Object.values(error.constraints ?? {})
    );

    expect(messages).toEqual(
      expect.arrayContaining([
        "兼容金额角色不在系统允许范围内",
        "兼容计价模式不在系统允许范围内"
      ])
    );
  });

  it("requires a settlement template version at both create and import runtime boundaries", async () => {
    const create = Object.assign(new CreateSettlementDto(), {
      contractVersionId: "contract-version-1",
      code: "JS-001",
      periodLabel: "2026-07",
      settlementLines: [{ sourceType: "manual_adjustment", name: "调整", amountCents: "1", reason: "测试" }]
    });
    const preview = Object.assign(new PreviewSettlementImportDto(), { fileId: "file-1" });

    const messages = [
      ...(await validate(create)),
      ...(await validate(preview))
    ].flatMap((error) => Object.values(error.constraints ?? {}));
    expect(messages.filter((message) => message === "请选择结算模板版本")).toHaveLength(2);
  });
});
