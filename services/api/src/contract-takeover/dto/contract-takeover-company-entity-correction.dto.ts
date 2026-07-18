import { IsIn, IsOptional } from "class-validator";
import {
  IsOptionalNonBlankText,
  IsRequiredText
} from "../../validation/static-field-validation";

export class SubmitContractTakeoverCompanyEntityCorrectionDto {
  @IsRequiredText({
    requiredMessage: "请选择更正后的我方签约主体",
    typeMessage: "我方签约主体编号必须是文字",
    blankMessage: "请选择更正后的我方签约主体"
  })
  targetCompanyEntityId!: string;

  @IsRequiredText({
    requiredMessage: "请填写更正原因",
    typeMessage: "更正原因必须是文字",
    blankMessage: "请填写更正原因"
  })
  reason!: string;

  @IsRequiredText({
    requiredMessage: "请选择更正责任人",
    typeMessage: "更正责任人编号必须是文字",
    blankMessage: "请选择更正责任人"
  })
  responsibleUserId!: string;

  @IsRequiredText({
    requiredMessage: "请上传更正依据附件",
    typeMessage: "更正依据附件编号必须是文字",
    blankMessage: "请上传更正依据附件"
  })
  attachmentFileId!: string;

  @IsRequiredText({
    requiredMessage: "请填写当前登录密码后再提交主体更正",
    typeMessage: "当前登录密码必须是文字",
    blankMessage: "请填写当前登录密码后再提交主体更正"
  })
  currentPassword!: string;
}

export class ReviewContractTakeoverCompanyEntityCorrectionDto {
  @IsIn(["approve", "reject"], { message: "主体更正处理结果不正确" })
  decision!: "approve" | "reject";

  @IsRequiredText({
    requiredMessage: "请填写当前登录密码后再处理主体更正",
    typeMessage: "当前登录密码必须是文字",
    blankMessage: "请填写当前登录密码后再处理主体更正"
  })
  currentPassword!: string;

  @IsOptional()
  @IsOptionalNonBlankText({
    typeMessage: "处理意见必须是文字",
    blankMessage: "处理意见不能为空白"
  })
  comment?: string;
}
