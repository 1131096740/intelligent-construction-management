import { IsIn, IsISO8601, IsString, MaxLength, ValidateIf } from "class-validator";

export class AbandonContractTakeoverDto {
  @IsISO8601({}, { message: "接管记录更新时间不正确，请刷新后重试" })
  expectedUpdatedAt!: string;

  @IsIn(["delete_pristine_draft", "abandon_application"], {
    message: "接管草稿处理动作不正确，请刷新后重试"
  })
  action!: "delete_pristine_draft" | "abandon_application";

  @ValidateIf((_object, value) => value !== undefined)
  @IsString({ message: "放弃原因必须是文字" })
  @MaxLength(200, { message: "放弃原因不能超过 200 个字" })
  reason?: string;
}
