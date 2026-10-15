import { Equals, IsIn, IsString, Length, Matches } from "class-validator";

export class ConfirmAccountPasswordDto {
  @IsString({ message: "请输入当前登录密码" })
  @Length(1, 256, { message: "请输入当前登录密码" })
  confirmationPassword!: string;
}

export class AdminResetPasswordDto extends ConfirmAccountPasswordDto {
  @Equals(true, { message: "请先核对员工本人及手机号" })
  identityVerified!: boolean;
}

export class RecoveryCodeResetDto {
  @Matches(/^1[3-9]\d{9}$/u, { message: "请填写正确手机号" })
  phone!: string;
  @IsString({ message: "请输入本人保管的恢复码" })
  @Length(32, 128, { message: "请输入完整恢复码" })
  recoveryCode!: string;
  @IsString({ message: "请设置新密码" })
  @Length(8, 72, { message: "新密码需要8到72个字符" })
  newPassword!: string;
}

export class SmsPhoneDto {
  @Matches(/^1[3-9]\d{9}$/u, { message: "请填写正确手机号" })
  phone!: string;
}
export class SendSmsDto extends SmsPhoneDto {
  @IsIn(["register", "reset"], { message: "短信验证用途不正确，请刷新页面" })
  purpose!: "register" | "reset";
}
export class SmsPasswordResetDto extends SmsPhoneDto {
  @Matches(/^\d{6}$/u, { message: "请输入6位短信验证码" })
  code!: string;
  @IsString({ message: "请设置新密码" })
  @Length(8, 72, { message: "新密码需要8到72个字符" })
  newPassword!: string;
}
export class ApplicationPasswordDto {
  @IsString({ message: "请设置本人密码" })
  @Length(8, 72, { message: "密码需要8到72个字符" })
  newPassword!: string;
}
