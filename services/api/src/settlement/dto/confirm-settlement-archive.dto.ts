import { IsRequiredText } from "../../validation/static-field-validation";

export class ConfirmSettlementArchiveDto {
  @IsRequiredText({
    requiredMessage: "请选择结算归档文件",
    typeMessage: "结算归档文件编号必须是文字",
    blankMessage: "请选择结算归档文件"
  })
  archiveFileId!: string;

  @IsRequiredText({
    requiredMessage: "确认结算归档需要当前登录密码",
    typeMessage: "当前登录密码必须是文字",
    blankMessage: "确认结算归档需要当前登录密码"
  })
  confirmationPassword!: string;
}
