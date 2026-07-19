import { IsIn, IsInt, IsString, MaxLength, Min, ValidateIf } from "class-validator";

export class AbandonSettlementDraftDto {
  @IsInt({ message: "结算草稿修订号必须是整数" })
  @Min(1, { message: "结算草稿修订号必须大于 0" })
  expectedRevision!: number;

  @IsIn(["delete_pristine_draft", "abandon_application"], {
    message: "结算草稿处理动作不正确，请刷新后重试"
  })
  action!: "delete_pristine_draft" | "abandon_application";

  @ValidateIf((_object, value) => value !== undefined)
  @IsString({ message: "放弃原因必须是文字" })
  @MaxLength(200, { message: "放弃原因不能超过 200 个字" })
  reason?: string;
}
