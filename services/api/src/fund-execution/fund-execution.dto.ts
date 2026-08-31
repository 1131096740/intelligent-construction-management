import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested
} from "class-validator";

import { IsRequiredText } from "../validation/static-field-validation";

export class CreateFundExecutionCaseDto {
  @IsRequiredText({
    requiredMessage: "银行流水候选不能为空",
    typeMessage: "银行流水候选格式不正确",
    blankMessage: "银行流水候选不能为空白"
  })
  @MaxLength(256, { message: "银行流水候选格式不正确" })
  observationSelectionRef!: string;

  @IsRequiredText({
    requiredMessage: "资金执行原因不能为空",
    typeMessage: "资金执行原因格式不正确",
    blankMessage: "资金执行原因不能为空白"
  })
  @MaxLength(500, { message: "资金执行原因不能超过 500 个字符" })
  reason!: string;

  @IsUUID("4", { message: "资金执行请求格式不正确" })
  idempotencyKey!: string;
}

export class FundExecutionAxisSelectionDto {
  @IsRequiredText({
    requiredMessage: "逐轴业务选项不能为空",
    typeMessage: "逐轴业务选项格式不正确",
    blankMessage: "逐轴业务选项不能为空白"
  })
  @MaxLength(256, { message: "逐轴业务选项格式不正确" })
  selectionRef!: string;
}

export class UpdateFundExecutionCaseDto {
  @IsInt({ message: "资金执行案件修订号必须是整数" })
  @Min(1, { message: "资金执行案件修订号必须大于零" })
  expectedRevision!: number;

  @IsRequiredText({
    requiredMessage: "资金执行原因不能为空",
    typeMessage: "资金执行原因格式不正确",
    blankMessage: "资金执行原因不能为空白"
  })
  @MaxLength(500, { message: "资金执行原因不能超过 500 个字符" })
  reason!: string;

  @IsArray({ message: "逐轴业务选项必须是数组" })
  @ArrayMinSize(4, { message: "逐轴业务选项必须覆盖完整四轴" })
  @ArrayMaxSize(400, { message: "逐轴业务选项数量过多" })
  @ValidateNested({ each: true })
  @Type(() => FundExecutionAxisSelectionDto)
  selections!: FundExecutionAxisSelectionDto[];

  @IsUUID("4", { message: "资金执行请求格式不正确" })
  idempotencyKey!: string;
}

export class UpdateFundExecutionReversalCaseDto {
  @IsInt({ message: "资金执行案件修订号必须是整数" })
  @Min(1, { message: "资金执行案件修订号必须大于零" })
  expectedRevision!: number;

  @IsRequiredText({
    requiredMessage: "反向执行原因不能为空",
    typeMessage: "反向执行原因格式不正确",
    blankMessage: "反向执行原因不能为空白"
  })
  @MaxLength(500, { message: "反向执行原因不能超过 500 个字符" })
  reason!: string;

  @IsUUID("4", { message: "资金执行请求格式不正确" })
  idempotencyKey!: string;
}

export class FundExecutionCaseCommandDto {
  @IsInt({ message: "资金执行案件修订号必须是整数" })
  @Min(1, { message: "资金执行案件修订号必须大于零" })
  expectedRevision!: number;

  @IsUUID("4", { message: "资金执行请求格式不正确" })
  idempotencyKey!: string;
}

export class ReturnFundExecutionCaseDto extends FundExecutionCaseCommandDto {
  @IsRequiredText({
    requiredMessage: "退回原因不能为空",
    typeMessage: "退回原因格式不正确",
    blankMessage: "退回原因不能为空白"
  })
  @MaxLength(500, { message: "退回原因不能超过 500 个字符" })
  reason!: string;
}

export class CreateFundExecutionReversalCaseDto {
  @IsRequiredText({
    requiredMessage: "原业务事项不能为空",
    typeMessage: "原业务事项格式不正确",
    blankMessage: "原业务事项不能为空白"
  })
  @MaxLength(256, { message: "原业务事项格式不正确" })
  targetSelectionRef!: string;

  @IsRequiredText({
    requiredMessage: "反向银行流水候选不能为空",
    typeMessage: "反向银行流水候选格式不正确",
    blankMessage: "反向银行流水候选不能为空白"
  })
  @MaxLength(256, { message: "反向银行流水候选格式不正确" })
  observationSelectionRef!: string;

  @IsRequiredText({
    requiredMessage: "反向执行原因不能为空",
    typeMessage: "反向执行原因格式不正确",
    blankMessage: "反向执行原因不能为空白"
  })
  @MaxLength(500, { message: "反向执行原因不能超过 500 个字符" })
  reason!: string;

  @IsUUID("4", { message: "反向执行请求格式不正确" })
  idempotencyKey!: string;
}

export class ReviewFundExecutionApprovalDto {
  @IsIn(["approve", "return_to_applicant"], {
    message: "资金执行审批动作无效"
  })
  action!: "approve" | "return_to_applicant";

  @IsOptional()
  @IsString({ message: "审批意见格式不正确" })
  @MaxLength(500, { message: "审批意见不能超过 500 个字符" })
  comment?: string;
}
