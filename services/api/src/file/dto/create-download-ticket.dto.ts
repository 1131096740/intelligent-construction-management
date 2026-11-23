import { IsIn, IsOptional, IsString } from "class-validator";
import {
  IsMaxUnicodeTextLength,
  IsOptionalNonBlankText
} from "../../validation/static-field-validation";

export class CreateDownloadTicketDto {
  // 兼容旧客户端仍提交密码字段；附件访问只按当前登录身份与单据可见权限鉴权。
  @IsOptional()
  @IsString({ message: "当前登录密码必须是文字" })
  confirmationPassword?: string;

  @IsOptional()
  @IsString({ message: "下载原因必须是文字" })
  @IsMaxUnicodeTextLength({ max: 200, message: "下载原因不能超过 200 个字" })
  downloadReason?: string;

  @IsOptional()
  @IsIn(["download", "preview"], { message: "文件访问方式不正确" })
  accessMode?: "download" | "preview";

  @IsOptionalNonBlankText({
    typeMessage: "委托人编号必须是文字",
    blankMessage: "委托人编号不能为空白"
  })
  @IsMaxUnicodeTextLength({ max: 128, message: "委托人编号不能超过 128 个字符" })
  delegatorUserId?: string;
}
