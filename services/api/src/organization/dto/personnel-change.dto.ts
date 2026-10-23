import { Type } from "class-transformer";
import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength, ValidateIf, ValidateNested } from "class-validator";
import { PreviewRoleAdditionDto } from "./preview-role-addition.dto";
import { PreviewRoleRemovalDto } from "./preview-role-removal.dto";

export class PersonnelRosterChangeDto {
  @IsString({ message: "请选择有效项目" })
  @Matches(/\S/u, { message: "请选择有效项目" })
  @MaxLength(128, { message: "项目选择不正确，请重新选择" })
  projectId!: string;
  @IsIn(["join", "leave"], { message: "请选择调入或调出" })
  operation!: "join" | "leave";
}
export class PersonnelChangeDto {
  @IsUUID("4", { message: "请重新开始本次办理" })
  commandKey!: string;
  @IsString({ message: "请选择有效员工" })
  @Matches(/\S/u, { message: "请选择有效员工" })
  @MaxLength(128, { message: "员工选择不正确，请重新选择" })
  userId!: string;
  @IsIn(["join", "adjust", "offboard", "rehire"], { message: "请选择入职、调动、离职或返聘" })
  action!: "join" | "adjust" | "offboard" | "rehire";
  @IsString({ message: "请填写办理原因" })
  @Matches(/\S/u, { message: "请填写办理原因" })
  @MaxLength(500, { message: "办理原因最多500字" })
  reason!: string;
  @ValidateIf((_object, value) => value !== undefined)
  @IsString({ message: "请选择有效部门" })
  @Matches(/\S/u, { message: "请选择有效部门" })
  @MaxLength(128, { message: "部门选择不正确，请重新选择" })
  departmentId?: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: "入职日期格式不正确" })
  startedOn?: string;
  @ValidateIf((_object, value) => value !== undefined)
  @IsString({ message: "请选择有效的用工公司；未知时请留空" })
  @Matches(/\S/u, { message: "请选择有效的用工公司；未知时请留空" })
  @MaxLength(128, { message: "用工公司选择不正确，请重新选择" })
  companyEntityId?: string;
  @IsOptional() @IsArray({ message: "新增岗位请按完整列表提交" })
  @ArrayMaxSize(20, { message: "一次最多新增20项岗位" })
  @ValidateNested({ each: true, message: "请补全新增岗位的安排" }) @Type(() => PreviewRoleAdditionDto)
  additions?: PreviewRoleAdditionDto[];
  @IsOptional() @IsArray({ message: "撤销岗位请按完整列表提交" })
  @ArrayMaxSize(20, { message: "一次最多撤销20项岗位" })
  @ValidateNested({ each: true, message: "请补全撤销岗位的安排" }) @Type(() => PreviewRoleRemovalDto)
  removals?: PreviewRoleRemovalDto[];
  @IsOptional() @IsArray({ message: "项目调整请按完整列表提交" })
  @ArrayMaxSize(20, { message: "一次最多调整20项项目归属" })
  @ValidateNested({ each: true, message: "请补全项目调整的安排" }) @Type(() => PersonnelRosterChangeDto)
  rosterChanges?: PersonnelRosterChangeDto[];
}
export class ApplyPersonnelChangeDto extends PersonnelChangeDto {
  @IsString({ message: "请重新预览后提交" }) @Matches(/^sha256:[a-f0-9]{64}$/, { message: "请重新预览后提交" })
  snapshotHash!: string;
  @IsString({ message: "请输入当前登录密码" })
  @Matches(/\S/u, { message: "请输入当前登录密码" })
  @MaxLength(256, { message: "当前登录密码长度超出限制" })
  confirmationPassword!: string;
}
