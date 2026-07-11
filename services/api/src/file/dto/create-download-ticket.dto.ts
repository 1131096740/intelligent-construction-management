import { IsNotEmpty, IsString, Matches, MaxLength } from "class-validator";

export class CreateDownloadTicketDto {
  @IsString({ message: "请输入当前登录密码" })
  @IsNotEmpty({ message: "请输入当前登录密码" })
  @Matches(/\S/u, { message: "当前登录密码不能全为空白字符" })
  confirmationPassword!: string;

  @IsString({ message: "请填写下载原因" })
  @IsNotEmpty({ message: "请填写下载原因" })
  @Matches(/\S/u, { message: "下载原因不能全为空白字符" })
  @MaxLength(200, { message: "下载原因不能超过 200 个字" })
  downloadReason!: string;
}
