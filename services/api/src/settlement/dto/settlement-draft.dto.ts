import { Type } from "class-transformer";
import {
  IsArray,
  IsBoolean,
  IsInt,
  Min,
  ValidateIf,
  ValidateNested
} from "class-validator";
import {
  IsCanonicalMoneyText,
  IsRequiredText
} from "../../validation/static-field-validation";
import { CreateSettlementLineDto } from "./create-settlement.dto";

export class SaveSettlementDraftDto {
  @IsRequiredText({
    requiredMessage: "请选择有效合同版本",
    typeMessage: "合同版本编号必须是文字",
    blankMessage: "请选择有效合同版本"
  })
  contractVersionId!: string;

  @IsRequiredText({
    requiredMessage: "请选择结算模板版本",
    typeMessage: "结算模板版本编号必须是文字",
    blankMessage: "请选择结算模板版本"
  })
  settlementTemplateVersionId!: string;

  @IsRequiredText({
    requiredMessage: "请填写结算编号",
    typeMessage: "结算编号必须是文字",
    blankMessage: "请填写结算编号"
  })
  code!: string;

  @IsRequiredText({
    requiredMessage: "请填写结算期间",
    typeMessage: "结算期间必须是文字",
    blankMessage: "请填写结算期间"
  })
  periodLabel!: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsBoolean({ message: "是否最终结算必须是布尔值" })
  isFinal?: boolean;

  @ValidateIf((_object, value) => value !== undefined)
  @IsCanonicalMoneyText({
    typeMessage: "审定累计结算金额格式不正确",
    formatMessage: "审定累计结算金额必须按分填写为 0 或更大的整数"
  })
  finalCumulativeAmountCents?: string;

  @IsArray({ message: "结算草稿明细必须是数组" })
  @ValidateNested({ each: true, message: "每条结算草稿明细必须是对象" })
  @Type(() => CreateSettlementLineDto)
  settlementLines!: CreateSettlementLineDto[];

  @ValidateIf((_object, value) => value !== undefined)
  @IsInt({ message: "结算草稿修订号必须是整数" })
  @Min(1, { message: "结算草稿修订号必须大于 0" })
  expectedRevision?: number;
}

export class SubmitSettlementDraftDto {
  @IsInt({ message: "结算草稿修订号必须是整数" })
  @Min(1, { message: "结算草稿修订号必须大于 0" })
  expectedRevision!: number;
}
