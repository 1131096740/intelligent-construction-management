import { IsRequiredText } from "../../validation/static-field-validation";

export class ConfirmContractArchiveDto {
  @IsRequiredText({
    requiredMessage: "归档文件不能为空",
    typeMessage: "归档文件编号必须是文字",
    blankMessage: "归档文件不能为空白"
  })
  archiveFileId!: string;

  @IsRequiredText({
    requiredMessage: "请输入当前登录密码",
    typeMessage: "当前登录密码必须是文字",
    blankMessage: "请输入当前登录密码"
  })
  confirmationPassword!: string;
}
