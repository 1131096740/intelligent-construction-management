import { ArrayMaxSize, ArrayMinSize, Equals, IsArray, IsIn, IsInt, IsOptional, IsString, Length, Matches, MaxLength, Min, ValidateNested } from "class-validator";
import { Type } from "class-transformer";
import { ROLE_KEYS, type RoleKey } from "@jiangkong/shared-domain";

export class EmployeeRegistrationDto {
  @IsString({ message: "请填写真实姓名" })
  @Length(1, 100, { message: "姓名需要填写1到100个字符" })
  @Matches(/\S/u, { message: "请填写真实姓名" })
  name!: string;

  @Matches(/^1[3-9]\d{9}$/u, { message: "请填写正确的手机号" })
  phone!: string;

  @IsString({ message: "请设置登录密码" })
  @Length(8, 72, { message: "密码需要8到72个字符" })
  @Matches(/\S/u, { message: "密码不能全为空格" })
  password!: string;
  @IsOptional()
  @Matches(/^\d{6}$/u, { message: "请输入6位短信验证码" })
  code?: string;
}

export class ApplicationLoginDto {
  @Matches(/^1[3-9]\d{9}$/u, { message: "请填写正确的手机号" })
  phone!: string;

  @IsString({ message: "请输入密码" })
  @MaxLength(256, { message: "密码过长" })
  password!: string;
}

export class ResubmitEmployeeRegistrationDto {
  @IsString({ message: "请填写真实姓名" })
  @Length(1, 100, { message: "姓名需要填写1到100个字符" })
  @Matches(/\S/u, { message: "请填写真实姓名" })
  name!: string;
  @IsInt({ message: "请刷新申请后重试" })
  @Min(1, { message: "请刷新申请后重试" })
  revision!: number;
}

export class EmployeeRoleDto {
  @IsIn(ROLE_KEYS, { message: "请选择有效岗位" })
  roleKey!: RoleKey;
  @IsOptional()
  @IsIn(["global", "project"], { message: "请选择公司或项目岗位范围" })
  scope?: "global" | "project";
  @IsOptional()
  @IsString({ message: "请选择有效项目" })
  @Length(1, 128, { message: "请选择有效项目" })
  projectId?: string;
}

export class ReviewEmployeeRegistrationDto {
  @IsInt({ message: "请刷新申请后重试" })
  @Min(1, { message: "请刷新申请后重试" })
  revision!: number;
  @IsIn(["approve", "refer", "return"], { message: "请选择同意、转交或退回" })
  decision!: "approve" | "refer" | "return";
  @IsOptional()
  @IsString({ message: "请选择部门" })
  @Length(1, 128, { message: "请选择有效部门" })
  departmentId?: string;
  @IsOptional()
  @IsArray({ message: "请安排至少一个岗位" })
  @ArrayMinSize(1, { message: "请安排至少一个岗位" })
  @ArrayMaxSize(20, { message: "一次最多安排20个岗位" })
  @ValidateNested({ each: true })
  @Type(() => EmployeeRoleDto)
  roles?: EmployeeRoleDto[];
  @IsOptional()
  @Equals(true, { message: "请确认已经核对员工本人及手机号" })
  identityVerified?: boolean;
  @IsOptional()
  @IsString({ message: "请填写处理原因" })
  @MaxLength(500, { message: "处理原因不能超过500个字符" })
  reason?: string;
  @IsString({ message: "请输入当前登录密码" })
  @Length(1, 256, { message: "请输入当前登录密码" })
  confirmationPassword!: string;
}
