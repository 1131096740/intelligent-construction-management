import { Type } from "class-transformer";
import {
  IsBoolean,
  IsIn,
  IsString,
  ValidateIf,
  ValidateNested
} from "class-validator";
import {
  IsCanonicalMoneyText,
  IsIntegerInRange,
  IsOptionalNonEmptyArray,
  IsRequiredText
} from "../../validation/static-field-validation";

export class CreatePaymentTermsStageDto {
  @IsRequiredText({
    requiredMessage: "付款阶段名称不能为空",
    typeMessage: "付款阶段名称必须是文字",
    blankMessage: "付款阶段名称不能为空白"
  })
  name!: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsIn(["advance", "progress", "final", "retention", "other"], {
    message: "付款阶段类型不正确"
  })
  stageType?: "advance" | "progress" | "final" | "retention" | "other";

  @IsIn(
    [
      "contract_amount",
      "current_settlement",
      "cumulative_settlement",
      "fixed_amount",
      "manual_amount"
    ],
    { message: "付款依据不正确" }
  )
  basis!:
    | "contract_amount"
    | "current_settlement"
    | "cumulative_settlement"
    | "fixed_amount"
    | "manual_amount";

  @ValidateIf((_object, value) => value !== undefined)
  @IsIntegerInRange({
    min: 0,
    max: 10_000,
    typeMessage: "付款比例必须是整数",
    rangeMessage: "付款比例必须在 0 到 10000 之间"
  })
  ratioBps?: number;

  @ValidateIf((_object, value) => value !== undefined)
  @IsCanonicalMoneyText({
    typeMessage: "固定金额格式不正确",
    formatMessage: "固定金额必须按分填写为 0 或更大的整数"
  })
  fixedAmountCents?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsIn(["contract_effective", "settlement_effective", "final_settlement_effective"], {
    message: "付款触发节点不正确"
  })
  triggerAnchor?: "contract_effective" | "settlement_effective" | "final_settlement_effective";

  @IsRequiredText({
    requiredMessage: "付款触发说明不能为空",
    typeMessage: "付款触发说明必须是文字",
    blankMessage: "付款触发说明不能为空白"
  })
  triggerEvent!: string;

  @IsIntegerInRange({
    min: 0,
    max: 2_147_483_647,
    typeMessage: "付款期限必须是整数天",
    rangeMessage: "付款期限必须在 0 到 2147483647 天之间"
  })
  dueDays!: number;

  @ValidateIf((_object, value) => value !== undefined)
  @IsIn(["none", "per_settlement_ratio", "after_cumulative_settlement_ratio"], {
    message: "预付款扣回方式不正确"
  })
  advanceDeductionMode?: "none" | "per_settlement_ratio" | "after_cumulative_settlement_ratio";

  @ValidateIf((_object, value) => value !== undefined)
  @IsIntegerInRange({
    min: 0,
    max: 10_000,
    typeMessage: "预付款扣回比例必须是整数",
    rangeMessage: "预付款扣回比例必须在 0 到 10000 之间"
  })
  advanceDeductionRatioBps?: number;

  @ValidateIf((_object, value) => value !== undefined)
  @IsIntegerInRange({
    min: 0,
    max: 10_000,
    typeMessage: "预付款起扣比例必须是整数",
    rangeMessage: "预付款起扣比例必须在 0 到 10000 之间"
  })
  advanceDeductionStartRatioBps?: number;

  @IsBoolean({ message: "是否要求发票必须是布尔值" })
  requiresInvoice!: boolean;

  @IsBoolean({ message: "是否允许提前付款必须是布尔值" })
  allowsEarlyPayment!: boolean;

  @IsBoolean({ message: "是否允许分次付款必须是布尔值" })
  allowsInstallments!: boolean;

  @ValidateIf((_object, value) => value !== undefined)
  @IsIntegerInRange({
    min: 0,
    max: 10_000,
    typeMessage: "质保金比例必须是整数",
    rangeMessage: "质保金比例必须在 0 到 10000 之间"
  })
  retentionBps?: number;

  @IsRequiredText({
    requiredMessage: "付款条款原文不能为空",
    typeMessage: "付款条款原文必须是文字",
    blankMessage: "付款条款原文不能为空白"
  })
  originalText!: string;
}

/** Minimal payload to seed a workbench draft from a published business template. */
export class CreateContractDraftDto {
  @IsRequiredText({
    requiredMessage: "项目编号不能为空",
    typeMessage: "项目编号必须是文字",
    blankMessage: "项目编号不能为空白"
  })
  projectId!: string;

  @IsRequiredText({
    requiredMessage: "合同类型不能为空",
    typeMessage: "合同类型必须是文字",
    blankMessage: "合同类型不能为空白"
  })
  contractTypeKey!: string;

  @IsRequiredText({
    requiredMessage: "合同模板版本不能为空",
    typeMessage: "合同模板版本编号必须是文字",
    blankMessage: "合同模板版本不能为空白"
  })
  businessTemplateVersionId!: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString({ message: "付款条款原文必须是文字" })
  paymentTermsOriginalText?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsOptionalNonEmptyArray({
    typeMessage: "付款阶段必须是数组",
    emptyMessage: "付款阶段至少要填写一条"
  })
  @ValidateNested({ each: true, message: "每条付款阶段必须是对象" })
  @Type(() => CreatePaymentTermsStageDto)
  paymentStages?: CreatePaymentTermsStageDto[];
}
