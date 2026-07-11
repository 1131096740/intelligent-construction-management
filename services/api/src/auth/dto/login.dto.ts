import { IsNotEmpty, IsString } from "class-validator";

export class LoginDto {
  @IsString({ message: "手机号必须是字符串" })
  @IsNotEmpty({ message: "请输入手机号" })
  phone!: string;

  @IsString({ message: "密码必须是字符串" })
  @IsNotEmpty({ message: "请输入登录密码" })
  password!: string;
}
