import { Type } from "class-transformer";
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
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
  @ValidateIf((_object, value) => value !== undefined)
  @IsRequiredText({
    requiredMessage: "请选择现场复核人",
    typeMessage: "现场复核人编号必须是文字",
    blankMessage: "请选择现场复核人"
  })
  fieldReviewerUserId?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsIn(["material_staff", "engineering_foreman", "engineering_tech"], {
    message: "现场复核人岗位不符合结算规则"
  })
  fieldReviewerRoleKey?: "material_staff" | "engineering_foreman" | "engineering_tech";
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
  @IsDateString({ strict: true }, { message: "结算结束日格式不正确" })
  periodEnd?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsBoolean({ message: "是否最终结算必须是布尔值" })
  isFinal?: boolean;

  /**
   * V2 最终结算只保留一份总体声明。五项历史确认字段仍保留在
   * 既有记录中用于只读追溯，新的工作台不得再写入它们。
   */
  @ValidateIf((_object, value) => value !== undefined)
  @IsBoolean({ message: "最终结算总体声明必须是布尔值" })
  finalDeclarationAccepted?: boolean;

  @ValidateIf((_object, value) => value !== undefined)
  @IsBoolean({ message: "请确认合同范围内应结事项已完成" })
  finalScopeCompleted?: boolean;

  @ValidateIf((_object, value) => value !== undefined)
  @IsBoolean({ message: "请确认历史过程结算已完整纳入累计数据" })
  finalPriorSettlementsIncluded?: boolean;

  @ValidateIf((_object, value) => value !== undefined)
  @IsBoolean({ message: "请确认不存在尚未处理的结算" })
  finalNoOutstandingSettlements?: boolean;

  @ValidateIf((_object, value) => value !== undefined)
  @IsBoolean({ message: "请确认累计结算符合合同金额上限" })
  finalWithinContractCap?: boolean;

  @ValidateIf((_object, value) => value !== undefined)
  @IsBoolean({ message: "请确认后续不再发起普通过程结算" })
  finalNoFurtherOrdinarySettlements?: boolean;

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
