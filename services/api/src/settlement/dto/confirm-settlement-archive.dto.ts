import { IsRequiredText } from "../../validation/static-field-validation";
import { IsOptional, IsString } from "class-validator";

export class ConfirmSettlementArchiveDto {
  @IsOptional()
  @IsString()
  archiveFileId?: string;

  @IsRequiredText({
    requiredMessage: "确认结算归档需要当前登录密码",
    typeMessage: "当前登录密码必须是文字",
    blankMessage: "确认结算归档需要当前登录密码"
  })
  confirmationPassword!: string;
}
