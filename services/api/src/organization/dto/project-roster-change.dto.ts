import { IsIn, IsString, IsUUID, Matches, MaxLength, MinLength } from "class-validator";

import { IsRequiredText } from "../../validation/static-field-validation";

export class ProjectRosterChangeDto {
  @IsIn(["join", "leave"], { message: "请选择调入或调出" })
  operation!: "join" | "leave";

  @IsRequiredText({ requiredMessage: "请选择有效项目", typeMessage: "请选择有效项目", blankMessage: "请选择有效项目" })
  @MaxLength(128, { message: "项目标识超出长度限制" })
  projectId!: string;

  @IsUUID("all", { message: "请选择有效人员" })
  userId!: string;

  @IsString({ message: "请填写调整原因" })
  @MinLength(1, { message: "请填写调整原因" })
  @MaxLength(300, { message: "调整原因最多300字" })
  @Matches(/\S/u, { message: "请填写调整原因" })
  reason!: string;
}

export class ApplyProjectRosterChangeDto extends ProjectRosterChangeDto {
  @Matches(/^sha256:[a-f0-9]{64}$/, { message: "请先重新预览调整" })
  snapshotHash!: string;

  @IsString({ message: "请输入本人当前登录密码" })
  @MinLength(1, { message: "请输入本人当前登录密码" })
  @MaxLength(200, { message: "密码长度超出限制" })
  confirmationPassword!: string;
}
