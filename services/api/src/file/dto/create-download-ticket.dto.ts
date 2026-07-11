import { IsNotEmpty, IsString, Length } from "class-validator";

export class CreateDownloadTicketDto {
  @IsString({ message: "请输入当前登录密码" })
  @IsNotEmpty({ message: "请输入当前登录密码" })
  confirmationPassword!: string;

  @IsString({ message: "请填写下载原因" })
  @Length(1, 200, { message: "下载原因不能超过 200 个字" })
  downloadReason!: string;
}
