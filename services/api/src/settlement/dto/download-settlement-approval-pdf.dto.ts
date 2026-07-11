import {
  IsMaxUnicodeTextLength,
  IsRequiredText
} from "../../validation/static-field-validation";

export class DownloadSettlementApprovalPdfDto {
  @IsRequiredText({
    requiredMessage: "结算审批单下载密码必填",
    typeMessage: "当前登录密码必须是文字",
    blankMessage: "结算审批单下载密码必填"
  })
  confirmationPassword!: string;

  @IsRequiredText({
    requiredMessage: "结算审批单下载原因必填",
    typeMessage: "结算审批单下载原因必须是文字",
    blankMessage: "结算审批单下载原因不能为空白"
  })
  @IsMaxUnicodeTextLength({ max: 200, message: "结算审批单下载原因不能超过 200 个字" })
  downloadReason!: string;
}
