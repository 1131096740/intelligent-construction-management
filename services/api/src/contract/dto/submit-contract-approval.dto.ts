import {
  IsOptionalNonBlankText,
  IsRequiredText
} from "../../validation/static-field-validation";

export class SubmitContractApprovalDto {
  @IsRequiredText({
    requiredMessage: "提交合同审批前请先选择编号规则",
    typeMessage: "编号规则编号必须是文字",
    blankMessage: "提交合同审批前请先选择编号规则"
  })
  numberRuleId!: string;

  @IsOptionalNonBlankText({
    typeMessage: "正式合同编号必须是文字",
    blankMessage: "正式合同编号不能为空"
  })
  formalCodeOverride?: string;

  @IsOptionalNonBlankText({
    typeMessage: "编号调整原因必须是文字",
    blankMessage: "调整正式合同编号时请填写原因"
  })
  overrideReason?: string;
}
