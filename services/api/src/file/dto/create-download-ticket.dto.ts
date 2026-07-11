import {
  IsMaxUnicodeTextLength,
  IsRequiredText
} from "../../validation/static-field-validation";

export class CreateDownloadTicketDto {
  @IsRequiredText({
    requiredMessage: "请输入当前登录密码",
    typeMessage: "当前登录密码必须是文字",
    blankMessage: "请输入当前登录密码"
  })
  confirmationPassword!: string;

  @IsRequiredText({
    requiredMessage: "请填写下载原因",
    typeMessage: "下载原因必须是文字",
    blankMessage: "请填写下载原因"
  })
  @IsMaxUnicodeTextLength({ max: 200, message: "下载原因不能超过 200 个字" })
  downloadReason!: string;
}
