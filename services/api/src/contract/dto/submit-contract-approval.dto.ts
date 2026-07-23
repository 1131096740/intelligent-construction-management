import { IsOptionalNonBlankText } from "../../validation/static-field-validation";

export class SubmitContractApprovalDto {
  // Retained only so older clients can complete the staged rollout. New contracts
  // receive their formal number on first manual draft save and ignore this field.
  @IsOptionalNonBlankText({
    typeMessage: "编号规则编号必须是文字",
    blankMessage: "编号规则编号不能为空"
  })
  numberRuleId?: string;

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
