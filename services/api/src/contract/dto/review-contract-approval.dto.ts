import { Type } from "class-transformer";
import {
  IsBoolean,
  IsISO8601,
  IsIn,
  IsInt,
  IsObject,
  IsString,
  Min,
  ValidateIf,
  ValidateNested
} from "class-validator";
import {
  IsCanonicalMoneyText,
  IsMaxUnicodeTextLength,
  IsRequiredText
} from "../../validation/static-field-validation";

export class ExpectedContractOwnerRiskDto {
  @IsIn(["clear", "missing_owner_contract", "exceeds_owner_contract"], {
    message: "预期业主主合同风险状态不正确"
  })
  status!: "clear" | "missing_owner_contract" | "exceeds_owner_contract";

  @IsCanonicalMoneyText({
    typeMessage: "预期业主主合同金额格式不正确",
    formatMessage: "预期业主主合同金额必须按分填写为 0 或更大的整数"
  })
  ownerContractAmountCents!: string;

  @IsCanonicalMoneyText({
    typeMessage: "预期对下合同金额格式不正确",
    formatMessage: "预期对下合同金额必须按分填写为 0 或更大的整数"
  })
  downstreamContractAmountCents!: string;

  @IsCanonicalMoneyText({
    typeMessage: "预期超额金额格式不正确",
    formatMessage: "预期超额金额必须按分填写为 0 或更大的整数"
  })
  excessAmountCents!: string;

  @IsRequiredText({
    requiredMessage: "缺少预期业主主合同风险提示",
    typeMessage: "预期业主主合同风险提示必须是文字",
    blankMessage: "预期业主主合同风险提示不能为空"
  })
  @IsMaxUnicodeTextLength({
    max: 500,
    message: "预期业主主合同风险提示不能超过 500 个字符"
  })
  message!: string;

  @IsBoolean({ message: "预期业主主合同风险确认要求必须是布尔值" })
  requiresExplicitConfirmation!: boolean;
}

export class ReviewContractApprovalDto {
  @IsIn(["approve", "reject", "reject_previous", "return_to_applicant"], {
    message: "合同审批决定不正确"
  })
  decision!: "approve" | "reject" | "reject_previous" | "return_to_applicant";

  @IsRequiredText({
    requiredMessage: "缺少预期合同版本",
    typeMessage: "预期合同版本格式不正确",
    blankMessage: "预期合同版本格式不正确"
  })
  @IsISO8601({}, { message: "预期合同版本格式不正确" })
  expectedContractUpdatedAt!: string;

  @IsRequiredText({
    requiredMessage: "缺少预期审批实例",
    typeMessage: "预期审批实例格式不正确",
    blankMessage: "预期审批实例不能为空白"
  })
  expectedApprovalInstanceId!: string;

  @IsInt({ message: "预期审批节点必须是整数" })
  @Min(0, { message: "预期审批节点不能小于 0" })
  expectedNodeIndex!: number;

  @IsRequiredText({
    requiredMessage: "缺少预期审批版本",
    typeMessage: "预期审批版本格式不正确",
    blankMessage: "预期审批版本格式不正确"
  })
  @IsISO8601({}, { message: "预期审批版本格式不正确" })
  expectedApprovalUpdatedAt!: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString({ message: "审批意见必须是文字" })
  comment?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString({ message: "自审原因必须是文字" })
  @IsMaxUnicodeTextLength({ max: 500, message: "自审原因不能超过 500 个字符" })
  selfReviewReason?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString({ message: "当前密码必须是文字" })
  @IsMaxUnicodeTextLength({ max: 256, message: "当前密码格式不正确" })
  confirmationPassword?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsBoolean({ message: "业主主合同风险确认必须是布尔值" })
  ownerContractRiskConfirmed?: boolean;

  @ValidateIf((_object, value) => value !== undefined)
  @IsObject({ message: "预期业主主合同风险必须是对象" })
  @ValidateNested({ message: "预期业主主合同风险必须是对象" })
  @Type(() => ExpectedContractOwnerRiskDto)
  expectedOwnerContractRisk?: ExpectedContractOwnerRiskDto;
}
